import { useCallback, useState, useRef } from "react";
import { Upload, FileVideo, X, Play, Pause, AlertCircle, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChunkedProgressBar } from "./ProgressBar";
import type { UploadProgress } from "@shared/schema";

const CHUNK_SIZE = 10 * 1024 * 1024;
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;
const ALLOWED_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"];

interface UploadZoneProps {
  onUploadStart: (file: File) => void;
  uploadProgress: UploadProgress | null;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
}

export function UploadZone({ 
  onUploadStart, 
  uploadProgress,
  onPause,
  onResume,
  onCancel,
  onRetry,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return "Invalid file type. Please upload MP4, WebM, MOV, or AVI files.";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "File too large. Maximum size is 10GB.";
    }
    return null;
  };

  const handleFile = useCallback((file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    onUploadStart(file);
  }, [onUploadStart]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatSpeed = (bytesPerSecond: number) => {
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const isUploading = uploadProgress && uploadProgress.status === "uploading";
  const isPaused = uploadProgress && uploadProgress.status === "paused";
  const isFailed = uploadProgress && uploadProgress.status === "failed";
  const isCompleted = uploadProgress && uploadProgress.status === "completed";

  if (uploadProgress && !isCompleted) {
    return (
      <Card className="p-6">
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-3 rounded-lg bg-primary/10 shrink-0">
                <FileVideo className="h-6 w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-medium truncate" data-testid="text-upload-filename">
                  {uploadProgress.filename}
                </p>
                <p className="text-sm text-muted-foreground font-mono">
                  {formatSize(uploadProgress.uploadedSize)} / {formatSize(uploadProgress.totalSize)}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 shrink-0">
              {isUploading && onPause && (
                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={onPause}
                  data-testid="button-pause-upload"
                >
                  <Pause className="h-4 w-4" />
                </Button>
              )}
              {isPaused && onResume && (
                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={onResume}
                  data-testid="button-resume-upload"
                >
                  <Play className="h-4 w-4" />
                </Button>
              )}
              {isFailed && onRetry && (
                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={onRetry}
                  data-testid="button-retry-upload"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              )}
              {onCancel && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={onCancel}
                  data-testid="button-cancel-upload"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-3xl font-bold font-mono" data-testid="text-upload-percentage">
                {Math.round(uploadProgress.percentage)}%
              </span>
              <div className="text-right text-sm text-muted-foreground">
                {isUploading && (
                  <>
                    <p className="font-mono">{formatSpeed(uploadProgress.speed)}</p>
                    <p>{formatTime(uploadProgress.remainingTime)} remaining</p>
                  </>
                )}
                {isPaused && <p className="text-chart-3">Paused</p>}
                {isFailed && <p className="text-destructive">Upload failed</p>}
              </div>
            </div>

            <ChunkedProgressBar chunks={uploadProgress.chunks} />
          </div>

          {isFailed && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Upload failed. Click retry to resume from the last successful chunk.</span>
            </div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card 
      className={`relative transition-all ${
        isDragging 
          ? "border-primary border-2 border-dashed bg-primary/5" 
          : "border-dashed border-2"
      }`}
    >
      <div
        className="min-h-64 flex flex-col items-center justify-center p-8 cursor-pointer"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        data-testid="dropzone-upload"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_TYPES.join(",")}
          onChange={handleInputChange}
          className="hidden"
          data-testid="input-file-upload"
        />

        <div className={`p-4 rounded-full mb-4 transition-colors ${
          isDragging ? "bg-primary/20" : "bg-muted"
        }`}>
          <Upload className={`h-8 w-8 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
        </div>

        <h3 className="text-lg font-semibold mb-1">
          {isDragging ? "Drop your video here" : "Upload a video"}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Drag and drop or click to browse
        </p>

        <Button variant="default" size="default" data-testid="button-browse-files">
          Browse Files
        </Button>

        <div className="mt-6 flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileVideo className="h-3 w-3" />
            MP4, WebM, MOV, AVI
          </span>
          <span>Max 10GB</span>
          <span>{Math.round(CHUNK_SIZE / (1024 * 1024))}MB chunks</span>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
