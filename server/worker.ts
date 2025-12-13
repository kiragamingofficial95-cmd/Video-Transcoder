import { Worker, Job } from "bullmq";
import { spawn } from "child_process";
import path from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import IORedis from "ioredis";
import type { TranscodingJobData } from "./queue";
import { Resolution } from "@shared/schema";
import type { ResolutionType } from "@shared/schema";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const RESOLUTION_CONFIG: Record<ResolutionType, { width: number; height: number; bitrate: string }> = {
  [Resolution.R360P]: { width: 640, height: 360, bitrate: "800k" },
  [Resolution.R720P]: { width: 1280, height: 720, bitrate: "2500k" },
  [Resolution.R1080P]: { width: 1920, height: 1080, bitrate: "5000k" },
};

async function transcodeVideo(
  inputPath: string,
  outputDir: string,
  resolution: ResolutionType,
  onProgress: (progress: number) => void
): Promise<string> {
  const config = RESOLUTION_CONFIG[resolution];
  const resolutionDir = path.join(outputDir, resolution);
  
  if (!existsSync(resolutionDir)) {
    mkdirSync(resolutionDir, { recursive: true });
  }

  const playlistPath = path.join(resolutionDir, "playlist.m3u8");
  const segmentPath = path.join(resolutionDir, "segment_%03d.ts");

  return new Promise((resolve, reject) => {
    const args = [
      "-i", inputPath,
      "-vf", `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-b:v", config.bitrate,
      "-maxrate", config.bitrate,
      "-bufsize", `${parseInt(config.bitrate) * 2}k`,
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "44100",
      "-f", "hls",
      "-hls_time", "4",
      "-hls_list_size", "0",
      "-hls_segment_filename", segmentPath,
      "-progress", "pipe:1",
      "-y",
      playlistPath,
    ];

    const ffmpeg = spawn("ffmpeg", args);
    let duration = 0;
    let currentTime = 0;

    ffmpeg.stderr.on("data", (data: Buffer) => {
      const output = data.toString();
      
      const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
      if (durationMatch) {
        const [, hours, minutes, seconds] = durationMatch;
        duration = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
      }
    });

    ffmpeg.stdout.on("data", (data: Buffer) => {
      const output = data.toString();
      
      const timeMatch = output.match(/out_time_ms=(\d+)/);
      if (timeMatch && duration > 0) {
        currentTime = parseInt(timeMatch[1]) / 1000000;
        const progress = Math.min((currentTime / duration) * 100, 99);
        onProgress(progress);
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        onProgress(100);
        resolve(playlistPath);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", (error) => {
      reject(error);
    });
  });
}

async function publishProgress(
  redis: IORedis,
  videoId: string,
  jobId: string,
  resolution: ResolutionType,
  progress: number
): Promise<void> {
  const event = {
    type: "TRANSCODING_PROGRESS",
    videoId,
    data: { resolution, progress, jobId },
    timestamp: new Date().toISOString(),
  };
  
  await redis.publish("video-events", JSON.stringify(event));
}

async function publishCompletion(
  redis: IORedis,
  videoId: string,
  jobId: string,
  resolution: ResolutionType,
  hlsUrl: string
): Promise<void> {
  const event = {
    type: "TRANSCODING_COMPLETED",
    videoId,
    data: { resolution, jobId, hlsUrl },
    timestamp: new Date().toISOString(),
  };
  
  await redis.publish("video-events", JSON.stringify(event));
}

async function publishFailure(
  redis: IORedis,
  videoId: string,
  jobId: string,
  resolution: ResolutionType,
  error: string
): Promise<void> {
  const event = {
    type: "TRANSCODING_FAILED",
    videoId,
    data: { resolution, jobId, error },
    timestamp: new Date().toISOString(),
  };
  
  await redis.publish("video-events", JSON.stringify(event));
}

/**
 * Worker for real Redis+BullMQ deployments.
 * 
 * NOTE: This worker publishes events via Redis pub/sub but cannot update
 * the in-memory storage (since it runs as a separate process).
 * 
 * For production deployments:
 * - Replace MemStorage with PostgreSQL/MongoDB for shared state
 * - Worker would update the database directly
 * - Or use Redis pub/sub to notify the API server to update storage
 * 
 * In the Replit free-tier demo (no Redis), the simulateTranscoding function
 * in queue.ts handles everything in-process, updating storage directly.
 */
export function startWorker(): void {
  console.log("Starting transcoding worker...");
  
  const connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker<TranscodingJobData>(
    "transcoding",
    async (job: Job<TranscodingJobData>) => {
      const { videoId, jobId, resolution, inputPath, outputDir } = job.data;
      
      console.log(`Processing job ${jobId}: ${resolution} for video ${videoId}`);

      let lastProgress = 0;
      
      try {
        const hlsPath = await transcodeVideo(
          inputPath,
          outputDir,
          resolution,
          async (progress) => {
            if (progress - lastProgress >= 5) {
              lastProgress = progress;
              await publishProgress(connection, videoId, jobId, resolution, progress);
              await job.updateProgress(progress);
            }
          }
        );

        const hlsUrl = `/api/stream/${videoId}/${resolution}/playlist.m3u8`;
        await publishCompletion(connection, videoId, jobId, resolution, hlsUrl);
        
        console.log(`Completed ${resolution} transcoding for ${videoId}`);
        
        return { hlsUrl, resolution };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        await publishFailure(connection, videoId, jobId, resolution, errorMessage);
        throw error;
      }
    },
    {
      connection,
      concurrency: 2,
      limiter: {
        max: 3,
        duration: 60000,
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`Job ${job.id} completed`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Job ${job?.id} failed:`, error.message);
  });

  worker.on("error", (error) => {
    console.error("Worker error:", error);
  });

  console.log("Transcoding worker started");
}

if (require.main === module) {
  startWorker();
}
