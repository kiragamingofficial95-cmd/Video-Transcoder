import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { existsSync, mkdirSync, createReadStream, statSync } from "fs";
import { storage } from "./storage";
import { setupWebSocket } from "./websocket";
import { addTranscodingJobs, emitEvent, getQueueStats } from "./queue";
import { createUploadSessionSchema } from "@shared/schema";
import { VideoStatus, Resolution, EventType } from "@shared/schema";
import type { ResolutionType } from "@shared/schema";

const STORAGE_DIR = process.env.STORAGE_DIR || "./storage";
const CHUNKS_DIR = path.join(STORAGE_DIR, "chunks");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const TRANSCODED_DIR = path.join(STORAGE_DIR, "transcoded");

const CHUNK_SIZE = 10 * 1024 * 1024;

[CHUNKS_DIR, UPLOADS_DIR, TRANSCODED_DIR].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      // Store temporarily first, we'll move it after parsing
      cb(null, CHUNKS_DIR);
    },
    filename: (req, file, cb) => {
      // Generate a temp filename, will be renamed after body is parsed
      const tempName = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      cb(null, tempName);
    },
  }),
  limits: {
    fileSize: CHUNK_SIZE + 1024,
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupWebSocket(httpServer);

  app.post("/api/upload/session", async (req: Request, res: Response) => {
    try {
      const parsed = createUploadSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
      }

      const { filename, totalSize, mimeType } = parsed.data;
      
      const video = await storage.createVideo(filename, totalSize, mimeType);
      const session = await storage.createUploadSession(
        video.id,
        filename,
        totalSize,
        CHUNK_SIZE
      );

      res.json(session);
    } catch (error) {
      console.error("Error creating upload session:", error);
      res.status(500).json({ error: "Failed to create upload session" });
    }
  });

  app.get("/api/upload/session/:id", async (req: Request, res: Response) => {
    try {
      const session = await storage.getUploadSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(session);
    } catch (error) {
      console.error("Error fetching upload session:", error);
      res.status(500).json({ error: "Failed to fetch session" });
    }
  });

  app.post("/api/upload/chunk", chunkUpload.single("chunk"), async (req: Request, res: Response) => {
    try {
      const { sessionId, chunkIndex } = req.body;
      
      if (!sessionId || chunkIndex === undefined) {
        // Clean up temp file if body is invalid
        if (req.file) {
          await fs.unlink(req.file.path).catch(() => {});
        }
        return res.status(400).json({ error: "Missing sessionId or chunkIndex" });
      }

      // Move the temp file to the correct session directory
      if (req.file) {
        const sessionDir = path.join(CHUNKS_DIR, sessionId);
        if (!existsSync(sessionDir)) {
          mkdirSync(sessionDir, { recursive: true });
        }
        const finalPath = path.join(sessionDir, `chunk_${chunkIndex}`);
        await fs.rename(req.file.path, finalPath);
      }

      const session = await storage.markChunkUploaded(sessionId, parseInt(chunkIndex));
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      res.json({
        success: true,
        uploadedChunks: session.uploadedChunks.length,
        totalChunks: session.totalChunks,
        progress: (session.uploadedChunks.length / session.totalChunks) * 100,
      });
    } catch (error) {
      console.error("Error uploading chunk:", error);
      res.status(500).json({ error: "Failed to upload chunk" });
    }
  });

  app.post("/api/upload/complete", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body;
      
      const session = await storage.getUploadSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (session.uploadedChunks.length !== session.totalChunks) {
        return res.status(400).json({ 
          error: "Upload incomplete",
          uploaded: session.uploadedChunks.length,
          total: session.totalChunks,
        });
      }

      const outputPath = path.join(UPLOADS_DIR, `${session.videoId}${path.extname(session.filename)}`);
      const sessionChunksDir = path.join(CHUNKS_DIR, sessionId);
      
      const writeStream = require("fs").createWriteStream(outputPath);
      
      for (let i = 0; i < session.totalChunks; i++) {
        const chunkPath = path.join(sessionChunksDir, `chunk_${i}`);
        const chunkData = await fs.readFile(chunkPath);
        writeStream.write(chunkData);
      }
      
      await new Promise<void>((resolve, reject) => {
        writeStream.end((err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await fs.rm(sessionChunksDir, { recursive: true, force: true });

      await storage.updateUploadSession(sessionId, { status: "completed" });
      await storage.updateVideo(session.videoId, {
        status: VideoStatus.UPLOAD_COMPLETED,
        uploadProgress: 100,
      });

      emitEvent(EventType.UPLOAD_COMPLETED, session.videoId, {
        filename: session.filename,
        size: session.totalSize,
      });

      const videoOutputDir = path.join(TRANSCODED_DIR, session.videoId);
      if (!existsSync(videoOutputDir)) {
        mkdirSync(videoOutputDir, { recursive: true });
      }

      const resolutions: ResolutionType[] = [Resolution.R360P, Resolution.R720P, Resolution.R1080P];
      const jobIds: Record<ResolutionType, string> = {} as Record<ResolutionType, string>;
      
      for (const resolution of resolutions) {
        const resDir = path.join(videoOutputDir, resolution);
        if (!existsSync(resDir)) {
          mkdirSync(resDir, { recursive: true });
        }
        
        const job = await storage.createTranscodingJob(session.videoId, resolution, outputPath);
        jobIds[resolution] = job.id;
      }

      await storage.updateVideo(session.videoId, {
        status: VideoStatus.QUEUED,
        transcodingProgress: {
          [Resolution.R360P]: 0,
          [Resolution.R720P]: 0,
          [Resolution.R1080P]: 0,
        },
      });

      await addTranscodingJobs(session.videoId, outputPath, videoOutputDir, jobIds);

      res.json({
        success: true,
        videoId: session.videoId,
        message: "Upload complete, transcoding started",
      });
    } catch (error) {
      console.error("Error completing upload:", error);
      res.status(500).json({ error: "Failed to complete upload" });
    }
  });

  app.get("/api/videos", async (req: Request, res: Response) => {
    try {
      const videos = await storage.getAllVideos();
      res.json(videos);
    } catch (error) {
      console.error("Error fetching videos:", error);
      res.status(500).json({ error: "Failed to fetch videos" });
    }
  });

  app.get("/api/videos/:id", async (req: Request, res: Response) => {
    try {
      const video = await storage.getVideo(req.params.id);
      if (!video) {
        return res.status(404).json({ error: "Video not found" });
      }
      res.json(video);
    } catch (error) {
      console.error("Error fetching video:", error);
      res.status(500).json({ error: "Failed to fetch video" });
    }
  });

  app.delete("/api/videos/:id", async (req: Request, res: Response) => {
    try {
      const videoId = req.params.id;
      
      const videoDir = path.join(TRANSCODED_DIR, videoId);
      if (existsSync(videoDir)) {
        await fs.rm(videoDir, { recursive: true, force: true });
      }

      const deleted = await storage.deleteVideo(videoId);
      if (!deleted) {
        return res.status(404).json({ error: "Video not found" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting video:", error);
      res.status(500).json({ error: "Failed to delete video" });
    }
  });

  app.get("/api/queue/stats", async (req: Request, res: Response) => {
    try {
      const queueStats = await getQueueStats();
      const storageStats = await storage.getQueueStats();
      
      res.json({
        waiting: queueStats.waiting || storageStats.waiting,
        active: queueStats.active || storageStats.active,
        completed: queueStats.completed || storageStats.completed,
        failed: queueStats.failed || storageStats.failed,
      });
    } catch (error) {
      console.error("Error fetching queue stats:", error);
      res.status(500).json({ error: "Failed to fetch queue stats" });
    }
  });

  app.get("/api/stream/:videoId/:resolution/playlist.m3u8", async (req: Request, res: Response) => {
    try {
      const { videoId, resolution } = req.params;
      const playlistPath = path.join(TRANSCODED_DIR, videoId, resolution, "playlist.m3u8");
      
      if (!existsSync(playlistPath)) {
        return res.status(404).json({ error: "Playlist not found" });
      }

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      
      const stream = createReadStream(playlistPath);
      stream.pipe(res);
    } catch (error) {
      console.error("Error serving playlist:", error);
      res.status(500).json({ error: "Failed to serve playlist" });
    }
  });

  app.get("/api/stream/:videoId/:resolution/:segment", async (req: Request, res: Response) => {
    try {
      const { videoId, resolution, segment } = req.params;
      const segmentPath = path.join(TRANSCODED_DIR, videoId, resolution, segment);
      
      if (!existsSync(segmentPath)) {
        return res.status(404).json({ error: "Segment not found" });
      }

      const stat = statSync(segmentPath);
      res.setHeader("Content-Type", "video/mp2t");
      res.setHeader("Content-Length", stat.size);
      res.setHeader("Access-Control-Allow-Origin", "*");
      
      const stream = createReadStream(segmentPath);
      stream.pipe(res);
    } catch (error) {
      console.error("Error serving segment:", error);
      res.status(500).json({ error: "Failed to serve segment" });
    }
  });

  return httpServer;
}
