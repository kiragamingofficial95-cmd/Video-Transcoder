import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { existsSync, mkdirSync, createReadStream, createWriteStream, statSync } from "fs";
import { pipeline } from "stream/promises";
import { storage } from "./storage";
import { setupWebSocket } from "./websocket";
import { addTranscodingJobs, emitEvent, getQueueStats } from "./queue";
import { createUploadSessionSchema } from "@shared/schema";
import { VideoStatus, Resolution, EventType } from "@shared/schema";
import type { ResolutionType } from "@shared/schema";
import { 
  cleanupTempFiles, 
  cleanupOrphanedSessions, 
  cleanupUploadFile,
  cleanupTranscodedFiles,
  runFullCleanup,
  getStorageStats,
  checkDiskSpace
} from "./storage-cleanup";

const STORAGE_DIR = process.env.STORAGE_DIR || "./storage";
const CHUNKS_DIR = path.join(STORAGE_DIR, "chunks");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const TRANSCODED_DIR = path.join(STORAGE_DIR, "transcoded");

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks for better reliability

[CHUNKS_DIR, UPLOADS_DIR, TRANSCODED_DIR].forEach(dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

async function getActiveSessionIds(): Promise<Set<string>> {
  const sessions = await storage.getActiveUploadSessions();
  return new Set(sessions.map(s => s.id));
}

async function getSessionExpiryMap(): Promise<Map<string, string>> {
  const sessions = await storage.getActiveUploadSessions();
  const map = new Map<string, string>();
  for (const session of sessions) {
    map.set(session.id, session.expiresAt);
  }
  return map;
}

async function ensureStorageSpace(): Promise<{ hasSpace: boolean; freeMB: number }> {
  await cleanupTempFiles();
  return checkDiskSpace();
}

runFullCleanup(new Set()).then(() => {
  console.log("Initial storage cleanup completed");
}).catch(err => {
  console.error("Initial cleanup error:", err);
});

setInterval(async () => {
  try {
    const activeIds = await getActiveSessionIds();
    const expiryMap = await getSessionExpiryMap();
    await runFullCleanup(activeIds, expiryMap);
  } catch (err) {
    console.error("Periodic cleanup error:", err);
  }
}, 5 * 60 * 1000);

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
    // CRITICAL: Allow CHUNK_SIZE + 128KB for multipart FormData overhead
    // FormData encoding adds boundaries, headers, and metadata that can exceed 10KB
    // Using 128KB buffer ensures even edge cases with long filenames are handled
    fileSize: CHUNK_SIZE + 1024 * 128,
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

  const handleChunkUpload = (req: Request, res: Response, next: () => void) => {
    ensureStorageSpace().then(({ hasSpace, freeMB }) => {
      if (!hasSpace) {
        return res.status(507).json({
          success: false,
          error: `Insufficient storage space (${freeMB.toFixed(1)}MB free). Please delete some videos to continue.`,
          code: "STORAGE_FULL",
          retryable: false
        });
      }
      
      chunkUpload.single("chunk")(req, res, async (err: any) => {
        if (err) {
          if (err.code === "LIMIT_FILE_SIZE") {
            console.error("Chunk size limit exceeded:", err);
            return res.status(413).json({ 
              success: false, 
              error: "Chunk size exceeds server limit. This should not happen - please contact support.",
              code: "LIMIT_FILE_SIZE"
            });
          }
          
          if (err.errno === -122 || err.code === "EDQUOT" || (err.message && err.message.includes("-122"))) {
            console.error("Disk quota exceeded, attempting cleanup:", err);
            try {
              const activeIds = await getActiveSessionIds();
              await runFullCleanup(activeIds);
            } catch (cleanupErr) {
              console.error("Emergency cleanup failed:", cleanupErr);
            }
            return res.status(507).json({ 
              success: false, 
              error: "Storage space temporarily unavailable. Please try again in a few moments.",
              code: "STORAGE_FULL",
              retryable: true
            });
          }
          
          console.error("Multer error:", err);
          return res.status(500).json({ success: false, error: `Upload error: ${err.message}` });
        }
        next();
      });
    }).catch((cleanupErr) => {
      console.error("Pre-upload cleanup failed:", cleanupErr);
      chunkUpload.single("chunk")(req, res, (err: any) => {
        if (err) {
          console.error("Multer error after failed cleanup:", err);
          return res.status(500).json({ success: false, error: `Upload error: ${err.message}` });
        }
        next();
      });
    });
  };

  app.post("/api/upload/chunk", (req: Request, res: Response) => {
    handleChunkUpload(req, res, async () => {
      try {
        const { sessionId, chunkIndex } = req.body;
        
        if (!sessionId || chunkIndex === undefined) {
          // Clean up temp file if body is invalid
          if (req.file) {
            await fs.unlink(req.file.path).catch(() => {});
          }
          return res.status(400).json({ success: false, error: "Missing sessionId or chunkIndex" });
        }

        // Validate that we actually received chunk data
        if (!req.file) {
          return res.status(400).json({ success: false, error: "No chunk data received" });
        }

        // Verify the chunk file has actual content
        const chunkStats = statSync(req.file.path);
        if (chunkStats.size === 0) {
          await fs.unlink(req.file.path).catch(() => {});
          return res.status(400).json({ success: false, error: "Empty chunk received" });
        }

        // Validate session exists before moving file
        const existingSession = await storage.getUploadSession(sessionId);
        if (!existingSession) {
          await fs.unlink(req.file.path).catch(() => {});
          return res.status(404).json({ success: false, error: "Session not found" });
        }

        // Validate chunk index is within expected range
        const chunkIdx = parseInt(chunkIndex);
        if (isNaN(chunkIdx) || chunkIdx < 0 || chunkIdx >= existingSession.totalChunks) {
          await fs.unlink(req.file.path).catch(() => {});
          return res.status(400).json({ success: false, error: `Invalid chunk index: ${chunkIndex}` });
        }

        // Move the temp file to the correct session directory
        const sessionDir = path.join(CHUNKS_DIR, sessionId);
        if (!existsSync(sessionDir)) {
          mkdirSync(sessionDir, { recursive: true });
        }
        const finalPath = path.join(sessionDir, `chunk_${chunkIdx}`);
        await fs.rename(req.file.path, finalPath);

        // Verify the file was moved successfully
        if (!existsSync(finalPath)) {
          return res.status(500).json({ success: false, error: "Failed to save chunk" });
        }

        const session = await storage.markChunkUploaded(sessionId, chunkIdx);
        if (!session) {
          return res.status(404).json({ success: false, error: "Session not found" });
        }

        res.json({
          success: true,
          uploadedChunks: session.uploadedChunks.length,
          totalChunks: session.totalChunks,
          progress: (session.uploadedChunks.length / session.totalChunks) * 100,
        });
      } catch (error) {
        console.error("Error uploading chunk:", error);
        // Clean up temp file on error
        if (req.file) {
          await fs.unlink(req.file.path).catch(() => {});
        }
        res.status(500).json({ success: false, error: "Failed to upload chunk" });
      }
    });
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
      
      // Verify all chunks exist before starting reassembly
      const missingChunks: number[] = [];
      for (let i = 0; i < session.totalChunks; i++) {
        const chunkPath = path.join(sessionChunksDir, `chunk_${i}`);
        if (!existsSync(chunkPath)) {
          missingChunks.push(i);
        }
      }
      
      if (missingChunks.length > 0) {
        return res.status(400).json({
          error: "Missing chunk files",
          missingChunks: missingChunks.slice(0, 10), // Return first 10 missing
          totalMissing: missingChunks.length,
        });
      }

      // Stream chunks to output file with proper backpressure handling
      const writeStream = createWriteStream(outputPath, { highWaterMark: 64 * 1024 });
      
      // Helper to stream a single chunk with proper backpressure
      const streamChunk = (chunkPath: string): Promise<void> => {
        return new Promise((resolve, reject) => {
          const readStream = createReadStream(chunkPath, { highWaterMark: 64 * 1024 });
          
          readStream.on("error", (err) => {
            readStream.destroy();
            reject(err);
          });
          
          readStream.on("data", (chunk: Buffer) => {
            const canContinue = writeStream.write(chunk);
            if (!canContinue) {
              // Pause reading until write buffer drains
              readStream.pause();
              writeStream.once("drain", () => readStream.resume());
            }
          });
          
          readStream.on("end", () => resolve());
        });
      };
      
      try {
        for (let i = 0; i < session.totalChunks; i++) {
          const chunkPath = path.join(sessionChunksDir, `chunk_${i}`);
          await streamChunk(chunkPath);
        }
        
        // Close the write stream and wait for all data to flush
        await new Promise<void>((resolve, reject) => {
          writeStream.on("error", reject);
          writeStream.end(() => resolve());
        });
      } catch (streamError) {
        // Clean up on error
        writeStream.destroy();
        await fs.unlink(outputPath).catch(() => {});
        throw streamError;
      }

      // Clean up chunks after successful reassembly
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
      
      await cleanupTranscodedFiles(videoId);
      await cleanupUploadFile(videoId);

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

  app.post("/api/storage/cleanup", async (req: Request, res: Response) => {
    try {
      const activeIds = await getActiveSessionIds();
      const result = await runFullCleanup(activeIds);
      const stats = await getStorageStats();
      res.json({ 
        success: true, 
        cleaned: result,
        storage: {
          totalMB: Math.round(stats.totalSize / 1024 / 1024),
          chunksMB: Math.round(stats.chunksSize / 1024 / 1024),
          uploadsMB: Math.round(stats.uploadsSize / 1024 / 1024),
          transcodedMB: Math.round(stats.transcodedSize / 1024 / 1024),
        }
      });
    } catch (error) {
      console.error("Error during cleanup:", error);
      res.status(500).json({ error: "Cleanup failed" });
    }
  });

  app.get("/api/storage/stats", async (req: Request, res: Response) => {
    try {
      const stats = await getStorageStats();
      res.json({
        totalMB: Math.round(stats.totalSize / 1024 / 1024),
        chunksMB: Math.round(stats.chunksSize / 1024 / 1024),
        uploadsMB: Math.round(stats.uploadsSize / 1024 / 1024),
        transcodedMB: Math.round(stats.transcodedSize / 1024 / 1024),
        tempFiles: stats.tempFileCount,
        activeSessions: stats.sessionDirCount,
      });
    } catch (error) {
      console.error("Error getting storage stats:", error);
      res.status(500).json({ error: "Failed to get storage stats" });
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
