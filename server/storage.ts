import { randomUUID } from "crypto";
import type { Video, UploadSession, TranscodingJob, QueueStats, VideoStatusType, ResolutionType } from "@shared/schema";
import { VideoStatus, Resolution } from "@shared/schema";

export interface IStorage {
  createVideo(filename: string, size: number, mimeType: string): Promise<Video>;
  getVideo(id: string): Promise<Video | undefined>;
  getAllVideos(): Promise<Video[]>;
  updateVideo(id: string, updates: Partial<Video>): Promise<Video | undefined>;
  deleteVideo(id: string): Promise<boolean>;
  
  createUploadSession(videoId: string, filename: string, totalSize: number, chunkSize: number): Promise<UploadSession>;
  getUploadSession(id: string): Promise<UploadSession | undefined>;
  updateUploadSession(id: string, updates: Partial<UploadSession>): Promise<UploadSession | undefined>;
  markChunkUploaded(sessionId: string, chunkIndex: number): Promise<UploadSession | undefined>;
  
  createTranscodingJob(videoId: string, resolution: ResolutionType, inputPath: string): Promise<TranscodingJob>;
  getTranscodingJob(id: string): Promise<TranscodingJob | undefined>;
  getTranscodingJobsByVideo(videoId: string): Promise<TranscodingJob[]>;
  updateTranscodingJob(id: string, updates: Partial<TranscodingJob>): Promise<TranscodingJob | undefined>;
  
  getQueueStats(): Promise<QueueStats>;
}

export class MemStorage implements IStorage {
  private videos: Map<string, Video>;
  private uploadSessions: Map<string, UploadSession>;
  private transcodingJobs: Map<string, TranscodingJob>;

  constructor() {
    this.videos = new Map();
    this.uploadSessions = new Map();
    this.transcodingJobs = new Map();
  }

  async createVideo(filename: string, size: number, mimeType: string): Promise<Video> {
    const id = randomUUID();
    const video: Video = {
      id,
      filename,
      originalSize: size,
      mimeType,
      status: VideoStatus.UPLOADING,
      uploadProgress: 0,
      createdAt: new Date().toISOString(),
    };
    this.videos.set(id, video);
    return video;
  }

  async getVideo(id: string): Promise<Video | undefined> {
    return this.videos.get(id);
  }

  async getAllVideos(): Promise<Video[]> {
    return Array.from(this.videos.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async updateVideo(id: string, updates: Partial<Video>): Promise<Video | undefined> {
    const video = this.videos.get(id);
    if (!video) return undefined;
    
    const updated = { ...video, ...updates };
    this.videos.set(id, updated);
    return updated;
  }

  async deleteVideo(id: string): Promise<boolean> {
    return this.videos.delete(id);
  }

  async createUploadSession(
    videoId: string,
    filename: string,
    totalSize: number,
    chunkSize: number
  ): Promise<UploadSession> {
    const id = randomUUID();
    const totalChunks = Math.ceil(totalSize / chunkSize);
    const now = new Date();
    const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    const session: UploadSession = {
      id,
      videoId,
      filename,
      totalSize,
      chunkSize,
      totalChunks,
      uploadedChunks: [],
      status: "active",
      createdAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };
    
    this.uploadSessions.set(id, session);
    return session;
  }

  async getUploadSession(id: string): Promise<UploadSession | undefined> {
    return this.uploadSessions.get(id);
  }

  async updateUploadSession(id: string, updates: Partial<UploadSession>): Promise<UploadSession | undefined> {
    const session = this.uploadSessions.get(id);
    if (!session) return undefined;
    
    const updated = { ...session, ...updates };
    this.uploadSessions.set(id, updated);
    return updated;
  }

  async markChunkUploaded(sessionId: string, chunkIndex: number): Promise<UploadSession | undefined> {
    const session = this.uploadSessions.get(sessionId);
    if (!session) return undefined;
    
    if (!session.uploadedChunks.includes(chunkIndex)) {
      session.uploadedChunks.push(chunkIndex);
      session.uploadedChunks.sort((a, b) => a - b);
    }
    
    this.uploadSessions.set(sessionId, session);
    
    const video = this.videos.get(session.videoId);
    if (video) {
      const progress = (session.uploadedChunks.length / session.totalChunks) * 100;
      this.videos.set(session.videoId, { ...video, uploadProgress: progress });
    }
    
    return session;
  }

  async createTranscodingJob(
    videoId: string,
    resolution: ResolutionType,
    inputPath: string
  ): Promise<TranscodingJob> {
    const id = randomUUID();
    const job: TranscodingJob = {
      id,
      videoId,
      resolution,
      status: "pending",
      progress: 0,
      inputPath,
      createdAt: new Date().toISOString(),
    };
    
    this.transcodingJobs.set(id, job);
    return job;
  }

  async getTranscodingJob(id: string): Promise<TranscodingJob | undefined> {
    return this.transcodingJobs.get(id);
  }

  async getTranscodingJobsByVideo(videoId: string): Promise<TranscodingJob[]> {
    return Array.from(this.transcodingJobs.values()).filter(j => j.videoId === videoId);
  }

  async updateTranscodingJob(id: string, updates: Partial<TranscodingJob>): Promise<TranscodingJob | undefined> {
    const job = this.transcodingJobs.get(id);
    if (!job) return undefined;
    
    const updated = { ...job, ...updates };
    this.transcodingJobs.set(id, updated);
    return updated;
  }

  async getQueueStats(): Promise<QueueStats> {
    const jobs = Array.from(this.transcodingJobs.values());
    return {
      waiting: jobs.filter(j => j.status === "pending").length,
      active: jobs.filter(j => j.status === "processing").length,
      completed: jobs.filter(j => j.status === "completed").length,
      failed: jobs.filter(j => j.status === "failed").length,
    };
  }
}

export const storage = new MemStorage();
