import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { EventEmitter } from "events";
import { spawn } from "child_process";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import type { ResolutionType } from "@shared/schema";
import { Resolution, EventType, VideoStatus } from "@shared/schema";
import { storage } from "./storage";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// IMPORTANT: Always use simulation mode (in-process transcoding) when using MemStorage
// The BullMQ worker runs in a separate process and can't update in-memory storage
// This ensures video status is properly updated after transcoding completes
// Set USE_REDIS_QUEUE=true only if you have a shared database (PostgreSQL/MongoDB)
const USE_REDIS_QUEUE = process.env.USE_REDIS_QUEUE === 'true';
const DEV_MODE = !USE_REDIS_QUEUE || !process.env.REDIS_URL;

let connection: IORedis | null = null;
let transcodingQueue: Queue | null = null;
let redisAvailable = false;
let redisCheckDone = DEV_MODE; // If DEV_MODE, mark as already checked (unavailable)

export const eventEmitter = new EventEmitter();

export interface TranscodingJobData {
  videoId: string;
  jobId: string;
  resolution: ResolutionType;
  inputPath: string;
  outputDir: string;
}

export function getRedisConnection(): IORedis | null {
  // In DEV_MODE, skip Redis entirely - use simulation mode
  if (DEV_MODE) {
    if (!redisCheckDone) {
      console.log("DEV_MODE enabled: Running without Redis (simulation mode)");
      redisCheckDone = true;
    }
    return null;
  }
  
  // If we've already determined Redis is unavailable, return null immediately
  if (redisCheckDone && !redisAvailable) {
    return null;
  }
  
  if (!connection) {
    try {
      connection = new IORedis(REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
        retryStrategy: (times) => {
          if (times > 3) {
            console.log("Redis connection failed, running without queue system");
            redisAvailable = false;
            redisCheckDone = true;
            return null;
          }
          return Math.min(times * 100, 3000);
        },
      });
      
      connection.on("error", (err) => {
        console.log("Redis connection error (non-fatal):", err.message);
        redisAvailable = false;
        redisCheckDone = true;
      });
      
      connection.on("connect", () => {
        console.log("Connected to Redis");
        redisAvailable = true;
        redisCheckDone = true;
      });
      
      // Try to connect - don't wait for it
      connection.connect().catch(() => {
        redisAvailable = false;
        redisCheckDone = true;
      });
    } catch (err) {
      console.log("Redis not available, running in demo mode");
      redisAvailable = false;
      redisCheckDone = true;
      return null;
    }
  }
  
  // Return connection only if Redis is confirmed available
  return redisAvailable ? connection : null;
}

export function getTranscodingQueue(): Queue<TranscodingJobData> | null {
  const redis = getRedisConnection();
  if (!redis) return null;
  
  if (!transcodingQueue) {
    transcodingQueue = new Queue<TranscodingJobData>("transcoding", {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
  }
  return transcodingQueue;
}

export async function addTranscodingJobs(
  videoId: string,
  inputPath: string,
  outputDir: string,
  jobIds: Record<ResolutionType, string>
): Promise<void> {
  const queue = getTranscodingQueue();
  
  const resolutions: ResolutionType[] = [Resolution.R360P, Resolution.R720P, Resolution.R1080P];
  
  // Create all job data
  const jobs = resolutions.map(resolution => ({
    videoId,
    jobId: jobIds[resolution],
    resolution,
    inputPath,
    outputDir,
  }));
  
  if (queue) {
    // Add to Redis queue with priorities
    for (const jobData of jobs) {
      await queue.add(`transcode-${jobData.resolution}`, jobData, {
        priority: jobData.resolution === Resolution.R360P ? 1 : jobData.resolution === Resolution.R720P ? 2 : 3,
      });
    }
  } else {
    // OPTIMIZATION: Run all resolutions in PARALLEL for faster transcoding
    // This significantly speeds up the overall process
    Promise.all(jobs.map(jobData => simulateTranscoding(jobData))).catch(err => {
      console.error("Parallel transcoding error:", err);
    });
  }
  
  emitEvent(EventType.TRANSCODING_STARTED, videoId, { resolutions });
}

const RESOLUTION_CONFIG: Record<ResolutionType, { width: number; height: number; bitrate: string }> = {
  [Resolution.R360P]: { width: 640, height: 360, bitrate: "800k" },
  [Resolution.R720P]: { width: 1280, height: 720, bitrate: "2500k" },
  [Resolution.R1080P]: { width: 1920, height: 1080, bitrate: "5000k" },
};

// Check if FFmpeg is available
let ffmpegAvailable: boolean | null = null;
async function checkFfmpegAvailable(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  
  return new Promise((resolve) => {
    const check = spawn("ffmpeg", ["-version"]);
    check.on("error", () => {
      console.log("FFmpeg not available - preview/playback will not work until videos are transcoded with Redis worker");
      ffmpegAvailable = false;
      resolve(false);
    });
    check.on("close", (code) => {
      ffmpegAvailable = code === 0;
      if (ffmpegAvailable) {
        console.log("FFmpeg detected - real transcoding enabled");
      }
      resolve(ffmpegAvailable);
    });
  });
}

async function transcodeVideoFile(
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
      "-threads", "0",
      "-vf", `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`,
      "-c:v", "libx264",
      "-preset", "ultrafast",
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

async function simulateTranscoding(jobData: TranscodingJobData): Promise<void> {
  const { videoId, jobId, resolution, inputPath, outputDir } = jobData;
  
  // Update video status to transcoding
  await storage.updateVideo(videoId, { status: VideoStatus.TRANSCODING });
  await storage.updateTranscodingJob(jobId, { status: "processing", startedAt: new Date().toISOString() });
  
  emitEvent(EventType.TRANSCODING_PROGRESS, videoId, { 
    resolution, 
    progress: 0,
    jobId,
  });

  // Check if FFmpeg is available for real transcoding
  const hasFfmpeg = await checkFfmpegAvailable();
  
  if (!hasFfmpeg) {
    // Fallback: Show clear error since preview requires actual files
    console.error(`Cannot transcode ${resolution} for ${videoId}: FFmpeg not available`);
    
    await storage.updateTranscodingJob(jobId, { 
      status: "failed", 
      completedAt: new Date().toISOString(),
    });
    
    await storage.updateVideo(videoId, {
      status: VideoStatus.FAILED,
      errorMessage: "FFmpeg not available - install FFmpeg to enable video transcoding",
    });
    
    emitEvent(EventType.TRANSCODING_FAILED, videoId, {
      resolution,
      jobId,
      error: "FFmpeg not available",
    });
    return;
  }

  let lastProgress = 0;
  
  try {
    // Actually transcode the video using FFmpeg
    await transcodeVideoFile(
      inputPath,
      outputDir,
      resolution,
      async (progress) => {
        // Only emit progress updates when progress changes significantly
        if (progress - lastProgress >= 5 || progress === 100) {
          lastProgress = progress;
          
          // Update transcoding progress in storage
          const video = await storage.getVideo(videoId);
          if (video) {
            const currentProgress = video.transcodingProgress || {};
            currentProgress[resolution] = progress;
            await storage.updateVideo(videoId, { transcodingProgress: currentProgress });
          }
          await storage.updateTranscodingJob(jobId, { progress });
          
          emitEvent(EventType.TRANSCODING_PROGRESS, videoId, {
            resolution,
            progress,
            jobId,
          });
        }
      }
    );
    
    const hlsUrl = `/api/stream/${videoId}/${resolution}/playlist.m3u8`;
    
    // Update job and video with completion
    await storage.updateTranscodingJob(jobId, { 
      status: "completed", 
      progress: 100,
      outputPath: hlsUrl,
      completedAt: new Date().toISOString(),
    });
    
    // Update video HLS URLs and check if all resolutions are done
    const video = await storage.getVideo(videoId);
    if (video) {
      const currentHlsUrls = video.hlsUrls || {};
      currentHlsUrls[resolution] = hlsUrl;
      
      const currentProgress = video.transcodingProgress || {};
      currentProgress[resolution] = 100;
      
      // Check if all resolutions are completed
      const allResolutions: ResolutionType[] = [Resolution.R360P, Resolution.R720P, Resolution.R1080P];
      const allCompleted = allResolutions.every(r => currentProgress[r] === 100);
      
      await storage.updateVideo(videoId, {
        hlsUrls: currentHlsUrls,
        transcodingProgress: currentProgress,
        status: allCompleted ? VideoStatus.COMPLETED : VideoStatus.TRANSCODING,
        completedAt: allCompleted ? new Date().toISOString() : undefined,
      });
    }
    
    emitEvent(EventType.TRANSCODING_COMPLETED, videoId, {
      resolution,
      jobId,
      hlsUrl,
    });
    
    console.log(`Completed ${resolution} transcoding for ${videoId}`);
  } catch (error) {
    console.error(`Transcoding failed for ${resolution}:`, error);
    
    // Update job status to failed
    await storage.updateTranscodingJob(jobId, { 
      status: "failed", 
      completedAt: new Date().toISOString(),
    });
    
    // Update video status to failed
    await storage.updateVideo(videoId, {
      status: VideoStatus.FAILED,
      errorMessage: error instanceof Error ? error.message : "Transcoding failed",
    });
    
    emitEvent(EventType.TRANSCODING_FAILED, videoId, {
      resolution,
      jobId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function emitEvent(
  type: string,
  videoId: string,
  data?: Record<string, unknown>
): void {
  const event = {
    type,
    videoId,
    data,
    timestamp: new Date().toISOString(),
  };
  
  eventEmitter.emit("video-event", event);
  
  const redis = getRedisConnection();
  if (redis) {
    redis.publish("video-events", JSON.stringify(event)).catch(() => {});
  }
}

export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}> {
  try {
    const queue = getTranscodingQueue();
    if (!queue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0 };
    }
    
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
    ]);
    
    return { waiting, active, completed, failed };
  } catch (error) {
    return { waiting: 0, active: 0, completed: 0, failed: 0 };
  }
}

export async function closeQueue(): Promise<void> {
  if (transcodingQueue) {
    await transcodingQueue.close();
  }
  if (connection) {
    await connection.quit();
  }
}
