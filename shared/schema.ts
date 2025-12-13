import { z } from "zod";

export const VideoStatus = {
  UPLOADING: "uploading",
  UPLOAD_COMPLETED: "upload_completed",
  QUEUED: "queued",
  TRANSCODING: "transcoding",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type VideoStatusType = (typeof VideoStatus)[keyof typeof VideoStatus];

export const Resolution = {
  R360P: "360p",
  R720P: "720p",
  R1080P: "1080p",
} as const;

export type ResolutionType = (typeof Resolution)[keyof typeof Resolution];

export const EventType = {
  UPLOAD_COMPLETED: "UPLOAD_COMPLETED",
  TRANSCODING_STARTED: "TRANSCODING_STARTED",
  TRANSCODING_PROGRESS: "TRANSCODING_PROGRESS",
  TRANSCODING_COMPLETED: "TRANSCODING_COMPLETED",
  TRANSCODING_FAILED: "TRANSCODING_FAILED",
} as const;

export type EventTypeType = (typeof EventType)[keyof typeof EventType];

export const videoSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  originalSize: z.number(),
  mimeType: z.string(),
  status: z.enum([
    VideoStatus.UPLOADING,
    VideoStatus.UPLOAD_COMPLETED,
    VideoStatus.QUEUED,
    VideoStatus.TRANSCODING,
    VideoStatus.COMPLETED,
    VideoStatus.FAILED,
  ]),
  uploadProgress: z.number().min(0).max(100),
  transcodingProgress: z.record(
    z.enum([Resolution.R360P, Resolution.R720P, Resolution.R1080P]),
    z.number().min(0).max(100)
  ).optional(),
  hlsUrls: z.record(
    z.enum([Resolution.R360P, Resolution.R720P, Resolution.R1080P]),
    z.string()
  ).optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export type Video = z.infer<typeof videoSchema>;

export const uploadSessionSchema = z.object({
  id: z.string().uuid(),
  videoId: z.string().uuid(),
  filename: z.string(),
  totalSize: z.number(),
  chunkSize: z.number(),
  totalChunks: z.number(),
  uploadedChunks: z.array(z.number()),
  status: z.enum(["active", "completed", "expired"]),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

export type UploadSession = z.infer<typeof uploadSessionSchema>;

export const createUploadSessionSchema = z.object({
  filename: z.string().min(1),
  totalSize: z.number().positive(),
  mimeType: z.string(),
});

export type CreateUploadSession = z.infer<typeof createUploadSessionSchema>;

export const chunkUploadSchema = z.object({
  sessionId: z.string().uuid(),
  chunkIndex: z.number().min(0),
});

export type ChunkUpload = z.infer<typeof chunkUploadSchema>;

export const transcodingJobSchema = z.object({
  id: z.string().uuid(),
  videoId: z.string().uuid(),
  resolution: z.enum([Resolution.R360P, Resolution.R720P, Resolution.R1080P]),
  status: z.enum(["pending", "processing", "completed", "failed"]),
  progress: z.number().min(0).max(100),
  inputPath: z.string(),
  outputPath: z.string().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});

export type TranscodingJob = z.infer<typeof transcodingJobSchema>;

export const videoEventSchema = z.object({
  type: z.enum([
    EventType.UPLOAD_COMPLETED,
    EventType.TRANSCODING_STARTED,
    EventType.TRANSCODING_PROGRESS,
    EventType.TRANSCODING_COMPLETED,
    EventType.TRANSCODING_FAILED,
  ]),
  videoId: z.string().uuid(),
  data: z.record(z.any()).optional(),
  timestamp: z.string().datetime(),
});

export type VideoEvent = z.infer<typeof videoEventSchema>;

export const queueStatsSchema = z.object({
  waiting: z.number(),
  active: z.number(),
  completed: z.number(),
  failed: z.number(),
});

export type QueueStats = z.infer<typeof queueStatsSchema>;

export interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  size: number;
  uploaded: boolean;
}

export interface UploadProgress {
  videoId: string;
  filename: string;
  totalSize: number;
  uploadedSize: number;
  percentage: number;
  chunks: ChunkInfo[];
  speed: number;
  remainingTime: number;
  status: "uploading" | "paused" | "completed" | "failed";
}
