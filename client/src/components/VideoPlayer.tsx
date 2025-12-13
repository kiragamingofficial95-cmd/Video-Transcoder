import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Video, ResolutionType } from "@shared/schema";
import { Resolution } from "@shared/schema";
import { useState, useRef, useEffect } from "react";

interface VideoPlayerProps {
  video: Video | null;
  initialResolution?: ResolutionType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VideoPlayer({ video, initialResolution = Resolution.R1080P, open, onOpenChange }: VideoPlayerProps) {
  const [selectedResolution, setSelectedResolution] = useState<ResolutionType>(initialResolution);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (initialResolution) {
      setSelectedResolution(initialResolution);
    }
  }, [initialResolution]);

  if (!video) return null;

  const hlsUrl = video.hlsUrls?.[selectedResolution];
  const availableResolutions = Object.values(Resolution).filter(
    res => video.hlsUrls?.[res]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="truncate pr-8">{video.filename}</DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4">
          <div className="aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
            {hlsUrl ? (
              <video
                ref={videoRef}
                className="w-full h-full"
                controls
                autoPlay
                playsInline
                data-testid="video-player"
              >
                <source src={hlsUrl} type="application/x-mpegURL" />
                Your browser does not support HLS playback.
              </video>
            ) : (
              <div className="text-muted-foreground">
                Video not available at this resolution
              </div>
            )}
          </div>

          <Tabs value={selectedResolution} onValueChange={(v) => setSelectedResolution(v as ResolutionType)}>
            <TabsList className="w-full justify-start">
              {availableResolutions.map(res => (
                <TabsTrigger key={res} value={res} data-testid={`tab-resolution-${res}`}>
                  {res}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Stream URL:</span>
            <code className="font-mono text-xs bg-muted px-2 py-1 rounded truncate max-w-md">
              {hlsUrl || "N/A"}
            </code>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
