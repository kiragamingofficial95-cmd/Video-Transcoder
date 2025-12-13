import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { EventEmitter } from "events";
import type { ResolutionType } from "@shared/schema";
import { Resolution, EventType, VideoStatus } from "@shared/schema";
import { storage } from "./storage";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// DEV_MODE: Skip Redis entirely for local development/demo
// Set DEV_MODE=true or leave REDIS_URL unset to run in simulation mode
const DEV_MODE = process.env.DEV_MODE === 'true' || !process.env.REDIS_URL;

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
  
  for (const resolution of resolutions) {
    const jobData: TranscodingJobData = {
      videoId,
      jobId: jobIds[resolution],
      resolution,
      inputPath,
      outputDir,
    };
    
    if (queue) {
      await queue.add(`transcode-${resolution}`, jobData, {
        priority: resolution === Resolution.R360P ? 1 : resolution === Resolution.R720P ? 2 : 3,
      });
    } else {
      simulateTranscoding(jobData);
    }
  }
  
  emitEvent(EventType.TRANSCODING_STARTED, videoId, { resolutions });
}

async function simulateTranscoding(jobData: TranscodingJobData): Promise<void> {
  const { videoId, jobId, resolution } = jobData;
  
  // Update video status to transcoding
  await storage.updateVideo(videoId, { status: VideoStatus.TRANSCODING });
  await storage.updateTranscodingJob(jobId, { status: "processing", startedAt: new Date().toISOString() });
  
  emitEvent(EventType.TRANSCODING_PROGRESS, videoId, { 
    resolution, 
    progress: 0,
    jobId,
  });
  
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
    
    const progress = (i / steps) * 100;
    
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
