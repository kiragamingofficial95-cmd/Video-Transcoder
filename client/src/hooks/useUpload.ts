import { useState, useCallback, useRef } from "react";
import type { UploadProgress, ChunkInfo, UploadSession } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks for better reliability
const MAX_PARALLEL_CHUNKS = 2;
const MAX_RETRIES = 3;

interface UseUploadOptions {
  onComplete?: (videoId: string) => void;
  onError?: (error: Error) => void;
}

export function useUpload({ onComplete, onError }: UseUploadOptions = {}) {
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<UploadSession | null>(null);
  const fileRef = useRef<File | null>(null);
  const pausedRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const uploadedBytesRef = useRef<number>(0);

  const createChunks = (file: File): ChunkInfo[] => {
    const chunks: ChunkInfo[] = [];
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      chunks.push({
        index: i,
        start,
        end,
        size: end - start,
        uploaded: false,
      });
    }
    
    return chunks;
  };

  const uploadChunkWithRetry = async (
    file: File,
    chunk: ChunkInfo,
    sessionId: string,
    signal: AbortSignal
  ): Promise<boolean> => {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const formData = new FormData();
        const blob = file.slice(chunk.start, chunk.end);
        formData.append("chunk", blob);
        formData.append("chunkIndex", String(chunk.index));
        formData.append("sessionId", sessionId);

        // Create a timeout controller for this specific request
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), 60000); // 60s timeout per chunk

        // Combine signals: abort if main signal or timeout
        const combinedSignal = signal.aborted ? signal : timeoutController.signal;

        try {
          const response = await fetch("/api/upload/chunk", {
            method: "POST",
            body: formData,
            signal: combinedSignal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`Chunk upload failed: ${response.status} ${response.statusText}`);
          }

          return true;
        } catch (fetchError) {
          clearTimeout(timeoutId);
          throw fetchError;
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError" && signal.aborted) {
          throw error; // Don't retry if main signal was aborted
        }
        
        lastError = error instanceof Error ? error : new Error("Unknown error");
        console.warn(`Chunk ${chunk.index} upload attempt ${attempt + 1}/${MAX_RETRIES} failed:`, lastError.message);
        
        if (attempt < MAX_RETRIES - 1) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError || new Error(`Chunk ${chunk.index} upload failed after ${MAX_RETRIES} attempts`);
  };

  const updateProgress = (chunks: ChunkInfo[], file: File, videoId: string) => {
    const uploadedChunks = chunks.filter(c => c.uploaded);
    const uploadedSize = uploadedChunks.reduce((sum, c) => sum + c.size, 0);
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const speed = elapsed > 0 ? uploadedSize / elapsed : 0;
    const remainingSize = file.size - uploadedSize;
    const remainingTime = speed > 0 ? remainingSize / speed : 0;

    setProgress({
      videoId,
      filename: file.name,
      totalSize: file.size,
      uploadedSize,
      percentage: (uploadedSize / file.size) * 100,
      chunks,
      speed,
      remainingTime,
      status: pausedRef.current ? "paused" : "uploading",
    });
  };

  const uploadChunksInParallel = async (
    file: File,
    chunks: ChunkInfo[],
    sessionId: string,
    videoId: string,
    signal: AbortSignal
  ) => {
    const pendingChunks = chunks.filter(c => !c.uploaded);
    let workerError: Error | null = null;
    const indexLock = { current: 0 }; // Prevent race conditions

    const uploadNextChunk = async (): Promise<void> => {
      while (!signal.aborted && !pausedRef.current && !workerError) {
        // Atomic index increment to prevent race conditions
        const myIndex = indexLock.current++;
        if (myIndex >= pendingChunks.length) {
          break;
        }
        
        const chunk = pendingChunks[myIndex];
        if (chunk && !chunk.uploaded) {
          try {
            await uploadChunkWithRetry(file, chunk, sessionId, signal);
            chunk.uploaded = true;
            uploadedBytesRef.current += chunk.size;
            updateProgress([...chunks], file, videoId);
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              throw error; // Propagate abort errors
            }
            // Store the error and stop all workers
            workerError = error instanceof Error ? error : new Error("Chunk upload failed");
            throw workerError;
          }
        }
      }
    };

    const workers = Array(Math.min(MAX_PARALLEL_CHUNKS, pendingChunks.length))
      .fill(null)
      .map(() => uploadNextChunk());

    // Wait for all workers, but throw the first error if any failed
    const results = await Promise.allSettled(workers);
    const failedResult = results.find(r => r.status === "rejected");
    if (failedResult && failedResult.status === "rejected") {
      throw failedResult.reason;
    }
  };

  const startUpload = useCallback(async (file: File) => {
    try {
      setIsUploading(true);
      pausedRef.current = false;
      fileRef.current = file;
      startTimeRef.current = Date.now();
      uploadedBytesRef.current = 0;
      
      abortControllerRef.current = new AbortController();
      const { signal } = abortControllerRef.current;

      const session = await apiRequest<UploadSession>("POST", "/api/upload/session", {
        filename: file.name,
        totalSize: file.size,
        mimeType: file.type,
      });

      sessionRef.current = session;
      
      const chunks = createChunks(file);
      
      setProgress({
        videoId: session.videoId,
        filename: file.name,
        totalSize: file.size,
        uploadedSize: 0,
        percentage: 0,
        chunks,
        speed: 0,
        remainingTime: 0,
        status: "uploading",
      });

      await uploadChunksInParallel(file, chunks, session.id, session.videoId, signal);

      if (!pausedRef.current && !signal.aborted) {
        await apiRequest("POST", "/api/upload/complete", {
          sessionId: session.id,
        });

        setProgress(prev => prev ? { ...prev, status: "completed", percentage: 100 } : null);
        onComplete?.(session.videoId);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      
      setProgress(prev => prev ? { ...prev, status: "failed" } : null);
      onError?.(error instanceof Error ? error : new Error("Upload failed"));
    } finally {
      setIsUploading(false);
    }
  }, [onComplete, onError]);

  const pauseUpload = useCallback(() => {
    pausedRef.current = true;
    setProgress(prev => prev ? { ...prev, status: "paused" } : null);
  }, []);

  const resumeUpload = useCallback(async () => {
    if (!fileRef.current || !sessionRef.current) return;

    pausedRef.current = false;
    setIsUploading(true);
    startTimeRef.current = Date.now() - (uploadedBytesRef.current / (progress?.speed || 1)) * 1000;
    
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    try {
      const file = fileRef.current;
      const session = sessionRef.current;
      const chunks = progress?.chunks || createChunks(file);
      
      setProgress(prev => prev ? { ...prev, status: "uploading" } : null);

      await uploadChunksInParallel(file, chunks, session.id, session.videoId, signal);

      if (!pausedRef.current && !signal.aborted) {
        await apiRequest("POST", "/api/upload/complete", {
          sessionId: session.id,
        });

        setProgress(prev => prev ? { ...prev, status: "completed", percentage: 100 } : null);
        onComplete?.(session.videoId);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setProgress(prev => prev ? { ...prev, status: "failed" } : null);
      onError?.(error instanceof Error ? error : new Error("Upload failed"));
    } finally {
      setIsUploading(false);
    }
  }, [progress, onComplete, onError]);

  const cancelUpload = useCallback(() => {
    abortControllerRef.current?.abort();
    pausedRef.current = false;
    setProgress(null);
    setIsUploading(false);
    sessionRef.current = null;
    fileRef.current = null;
  }, []);

  const retryUpload = useCallback(() => {
    if (fileRef.current) {
      resumeUpload();
    }
  }, [resumeUpload]);

  return {
    progress,
    isUploading,
    startUpload,
    pauseUpload,
    resumeUpload,
    cancelUpload,
    retryUpload,
  };
}
