import { Play, Clock, FileVideo, Copy, Check, AlertCircle, Trash2 } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "./StatusBadge";
import { ResolutionProgress } from "./ProgressBar";
import type { Video, ResolutionType } from "@shared/schema";
import { VideoStatus, Resolution } from "@shared/schema";
import { useState } from "react";

interface VideoCardProps {
  video: Video;
  onPlay?: (videoId: string, resolution: ResolutionType) => void;
  onDelete?: (videoId: string) => void;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function VideoCard({ video, onPlay, onDelete }: VideoCardProps) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const copyUrl = async (resolution: ResolutionType) => {
    const url = video.hlsUrls?.[resolution];
    if (url) {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(resolution);
      setTimeout(() => setCopiedUrl(null), 2000);
    }
  };

  const resolutions = Object.values(Resolution);
  const isTranscoding = video.status === VideoStatus.TRANSCODING;
  const isCompleted = video.status === VideoStatus.COMPLETED;
  const isFailed = video.status === VideoStatus.FAILED;

  const resolutionProgress = resolutions.map(res => ({
    resolution: res,
    progress: video.transcodingProgress?.[res] ?? 0,
    status: isCompleted 
      ? "completed" as const
      : isFailed 
        ? "failed" as const
        : (video.transcodingProgress?.[res] ?? 0) > 0 
          ? "processing" as const 
          : "pending" as const,
  }));

  return (
    <Card className="overflow-visible group" data-testid={`card-video-${video.id}`}>
      <CardHeader className="p-0">
        <div className="aspect-video bg-muted rounded-t-lg flex items-center justify-center relative overflow-hidden">
          <FileVideo className="h-12 w-12 text-muted-foreground/50" />
          
          {isCompleted && (
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Button 
                variant="secondary" 
                size="icon"
                className="h-12 w-12 rounded-full"
                onClick={() => onPlay?.(video.id, Resolution.R1080P)}
                data-testid={`button-play-${video.id}`}
              >
                <Play className="h-6 w-6" />
              </Button>
            </div>
          )}

          <div className="absolute top-2 right-2">
            <StatusBadge status={video.status} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        <div>
          <Tooltip>
            <TooltipTrigger asChild>
              <h3 className="font-medium truncate cursor-default" data-testid={`text-filename-${video.id}`}>
                {video.filename}
              </h3>
            </TooltipTrigger>
            <TooltipContent>
              <p>{video.filename}</p>
            </TooltipContent>
          </Tooltip>
          
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{formatSize(video.originalSize)}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDate(video.createdAt)}
            </span>
          </div>
        </div>

        {isTranscoding && (
          <ResolutionProgress resolutions={resolutionProgress} />
        )}

        {isFailed && video.errorMessage && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="break-words">{video.errorMessage}</span>
          </div>
        )}

        {isCompleted && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Available resolutions</p>
            <div className="flex flex-wrap gap-2">
              {resolutions.map(res => (
                <div key={res} className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPlay?.(video.id, res)}
                    data-testid={`button-play-${res}-${video.id}`}
                  >
                    <Play className="h-3 w-3 mr-1" />
                    {res}
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => copyUrl(res)}
                        data-testid={`button-copy-${res}-${video.id}`}
                      >
                        {copiedUrl === res ? (
                          <Check className="h-3 w-3 text-chart-2" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {copiedUrl === res ? "Copied!" : "Copy HLS URL"}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="p-4 pt-0 flex justify-between gap-2">
        <span className="text-xs font-mono text-muted-foreground truncate">
          {video.id.slice(0, 8)}
        </span>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(video.id)}
            data-testid={`button-delete-${video.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
