import fs from "fs/promises";
import { existsSync, statSync } from "fs";
import path from "path";

const STORAGE_DIR = process.env.STORAGE_DIR || "./storage";
const CHUNKS_DIR = path.join(STORAGE_DIR, "chunks");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const TRANSCODED_DIR = path.join(STORAGE_DIR, "transcoded");

const TEMP_FILE_MAX_AGE_MS = 5 * 60 * 1000;
const ORPHAN_SESSION_MAX_AGE_MS = 30 * 60 * 1000;
const MIN_FREE_SPACE_MB = 100;

export async function cleanupTempFiles(): Promise<number> {
  let cleaned = 0;
  try {
    if (!existsSync(CHUNKS_DIR)) return 0;
    
    const files = await fs.readdir(CHUNKS_DIR);
    const now = Date.now();
    
    for (const file of files) {
      if (file.startsWith("temp_")) {
        const filePath = path.join(CHUNKS_DIR, file);
        try {
          const stat = statSync(filePath);
          const age = now - stat.mtimeMs;
          if (age > TEMP_FILE_MAX_AGE_MS) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch (e) {
          await fs.unlink(filePath).catch(() => {});
          cleaned++;
        }
      }
    }
  } catch (error) {
    console.error("Error cleaning temp files:", error);
  }
  return cleaned;
}

export async function cleanupOrphanedSessions(
  activeSessionIds: Set<string>,
  sessionExpiryMap?: Map<string, string>
): Promise<number> {
  let cleaned = 0;
  try {
    if (!existsSync(CHUNKS_DIR)) return 0;
    
    const entries = await fs.readdir(CHUNKS_DIR, { withFileTypes: true });
    const now = Date.now();
    
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith("temp_")) {
        const sessionDir = path.join(CHUNKS_DIR, entry.name);
        const sessionId = entry.name;
        
        let shouldClean = false;
        
        if (sessionExpiryMap && sessionExpiryMap.has(sessionId)) {
          const expiresAt = new Date(sessionExpiryMap.get(sessionId)!).getTime();
          if (now > expiresAt) {
            shouldClean = true;
          }
        } else if (!activeSessionIds.has(sessionId)) {
          try {
            const stat = statSync(sessionDir);
            const age = now - stat.mtimeMs;
            if (age > ORPHAN_SESSION_MAX_AGE_MS) {
              shouldClean = true;
            }
          } catch (e) {
            shouldClean = true;
          }
        }
        
        if (shouldClean) {
          await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {});
          cleaned++;
        }
      }
    }
  } catch (error) {
    console.error("Error cleaning orphaned sessions:", error);
  }
  return cleaned;
}

export async function checkDiskSpace(): Promise<{ hasSpace: boolean; freeMB: number }> {
  try {
    const stats = await getStorageStats();
    const usedMB = stats.totalSize / 1024 / 1024;
    const estimatedFreeMB = Math.max(0, 500 - usedMB);
    return { hasSpace: estimatedFreeMB >= MIN_FREE_SPACE_MB, freeMB: estimatedFreeMB };
  } catch (error) {
    console.error("Error checking disk space:", error);
    return { hasSpace: true, freeMB: 100 };
  }
}

export async function cleanupUploadFile(videoId: string): Promise<boolean> {
  try {
    const extensions = [".mp4", ".webm", ".mov", ".avi", ".mkv"];
    for (const ext of extensions) {
      const uploadPath = path.join(UPLOADS_DIR, `${videoId}${ext}`);
      if (existsSync(uploadPath)) {
        await fs.unlink(uploadPath);
        return true;
      }
    }
  } catch (error) {
    console.error("Error cleaning upload file:", error);
  }
  return false;
}

export async function cleanupTranscodedFiles(videoId: string): Promise<boolean> {
  try {
    const transcodedDir = path.join(TRANSCODED_DIR, videoId);
    if (existsSync(transcodedDir)) {
      await fs.rm(transcodedDir, { recursive: true, force: true });
      return true;
    }
  } catch (error) {
    console.error("Error cleaning transcoded files:", error);
  }
  return false;
}

export async function getStorageStats(): Promise<{
  chunksSize: number;
  uploadsSize: number;
  transcodedSize: number;
  totalSize: number;
  tempFileCount: number;
  sessionDirCount: number;
}> {
  const stats = {
    chunksSize: 0,
    uploadsSize: 0,
    transcodedSize: 0,
    totalSize: 0,
    tempFileCount: 0,
    sessionDirCount: 0,
  };

  try {
    stats.chunksSize = await getDirSize(CHUNKS_DIR);
    stats.uploadsSize = await getDirSize(UPLOADS_DIR);
    stats.transcodedSize = await getDirSize(TRANSCODED_DIR);
    stats.totalSize = stats.chunksSize + stats.uploadsSize + stats.transcodedSize;

    if (existsSync(CHUNKS_DIR)) {
      const entries = await fs.readdir(CHUNKS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith("temp_")) {
          stats.tempFileCount++;
        } else if (entry.isDirectory()) {
          stats.sessionDirCount++;
        }
      }
    }
  } catch (error) {
    console.error("Error getting storage stats:", error);
  }

  return stats;
}

async function getDirSize(dirPath: string): Promise<number> {
  let size = 0;
  try {
    if (!existsSync(dirPath)) return 0;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += await getDirSize(fullPath);
      } else {
        try {
          const stat = statSync(fullPath);
          size += stat.size;
        } catch (e) {}
      }
    }
  } catch (error) {}
  return size;
}

export async function runFullCleanup(
  activeSessionIds: Set<string>,
  sessionExpiryMap?: Map<string, string>
): Promise<{
  tempFilesCleaned: number;
  sessionsCleaned: number;
}> {
  console.log("Running storage cleanup...");
  const tempFilesCleaned = await cleanupTempFiles();
  const sessionsCleaned = await cleanupOrphanedSessions(activeSessionIds, sessionExpiryMap);
  
  if (tempFilesCleaned > 0 || sessionsCleaned > 0) {
    console.log(`Cleanup complete: ${tempFilesCleaned} temp files, ${sessionsCleaned} orphaned sessions removed`);
  }
  
  return { tempFilesCleaned, sessionsCleaned };
}
