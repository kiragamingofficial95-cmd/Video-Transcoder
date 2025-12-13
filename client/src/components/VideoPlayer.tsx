import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Video, ResolutionType } from "@shared/schema";
import { Resolution } from "@shared/schema";
import { useState, useRef, useEffect } from "react";
import Hls from "hls.js";

interface VideoPlayerProps {
  video: Video | null;
  initialResolution?: ResolutionType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VideoPlayer({ video, initialResolution = Resolution.R1080P, open, onOpenChange }: VideoPlayerProps) {
  const [selectedResolution, setSelectedResolution] = useState<ResolutionType>(initialResolution);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    if (initialResolution) {
      setSelectedResolution(initialResolution);
    }
  }, [initialResolution]);

  // Initialize HLS.js for non-Safari browsers
  useEffect(() => {
    if (!video || !open) return;
    
    const hlsUrl = video.hlsUrls?.[selectedResolution];
    if (!hlsUrl || !videoRef.current) return;

    const videoElement = videoRef.current;

    // Cleanup previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Check if browser has native HLS support (Safari)
    if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari has native HLS support
      videoElement.src = hlsUrl;
      videoElement.load();
    } else if (Hls.isSupported()) {
      // Use hls.js for Chrome, Firefox, etc.
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(videoElement);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoElement.play().catch(() => {
          // Autoplay may be blocked, that's ok
        });
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          console.error('HLS fatal error:', data.type, data.details);
        }
      });
    } else {
      console.error('HLS is not supported in this browser');
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [video, selectedResolution, open]);

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
                playsInline
                data-testid="video-player"
              />
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

          <div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
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
