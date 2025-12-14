import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AlertCircle, Download, RefreshCw, Loader2 } from "lucide-react";
import type { Video, ResolutionType } from "@shared/schema";
import { Resolution, VideoStatus } from "@shared/schema";
import { useState, useRef, useEffect, useCallback } from "react";
import Hls from "hls.js";

interface VideoPlayerProps {
  video: Video | null;
  initialResolution?: ResolutionType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VideoPlayer({ video, initialResolution = Resolution.R1080P, open, onOpenChange }: VideoPlayerProps) {
  const [selectedResolution, setSelectedResolution] = useState<ResolutionType>(initialResolution);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    if (initialResolution) {
      setSelectedResolution(initialResolution);
    }
  }, [initialResolution]);

  const cleanupHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  const loadVideo = useCallback(() => {
    if (!video || !open) return;
    
    const hlsUrl = video.hlsUrls?.[selectedResolution];
    if (!hlsUrl || !videoRef.current) return;

    const videoElement = videoRef.current;
    setError(null);
    setLoading(true);

    // Cleanup previous HLS instance
    cleanupHls();

    // Check if browser has native HLS support (Safari)
    if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      videoElement.src = hlsUrl;
      videoElement.load();
      
      videoElement.onloadeddata = () => setLoading(false);
      videoElement.onerror = () => {
        setLoading(false);
        setError("Failed to load video. The file may not be ready yet.");
      };
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        startFragRetry: 3,
        fragLoadingRetryDelay: 1000,
        manifestLoadingRetryDelay: 1000,
      });
      hlsRef.current = hls;
      
      hls.loadSource(hlsUrl);
      hls.attachMedia(videoElement);
      
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        videoElement.play().catch(() => {});
      });
      
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setLoading(false);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
                setError("Video file not found. It may still be processing.");
              } else {
                setError("Network error loading video. Please check your connection.");
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              // Try to recover from media errors automatically
              hls.recoverMediaError();
              // Don't show error if recovery might work
              setTimeout(() => {
                if (hlsRef.current) {
                  setError(null);
                }
              }, 1000);
              break;
            default:
              setError("Unable to play video. Please try again.");
          }
        }
      });
    } else {
      setLoading(false);
      setError('HLS video playback is not supported in this browser.');
    }
  }, [video, selectedResolution, open, cleanupHls]);

  // Initialize HLS.js for non-Safari browsers
  useEffect(() => {
    loadVideo();

    return () => {
      cleanupHls();
    };
  }, [loadVideo, cleanupHls, retryCount]);

  const handleRetry = () => {
    setRetryCount(c => c + 1);
  };

  const handleDownload = async () => {
    if (!video) return;
    
    const hlsUrl = video.hlsUrls?.[selectedResolution];
    if (!hlsUrl) return;
    
    // Open the playlist URL - browser will handle download or playback
    window.open(hlsUrl, '_blank');
  };

  if (!video) return null;

  const hlsUrl = video.hlsUrls?.[selectedResolution];
  const availableResolutions = Object.values(Resolution).filter(
    res => video.hlsUrls?.[res]
  );
  
  // Allow playback if the selected resolution has an HLS URL, even if still transcoding other resolutions
  const isSelectedResolutionReady = !!hlsUrl && video.status !== VideoStatus.FAILED;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="truncate pr-8">{video.filename}</DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4">
          <div className="aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center relative">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10">
                <Loader2 className="h-8 w-8 text-white animate-spin" />
              </div>
            )}
            
            {error ? (
              <div className="flex flex-col items-center gap-4 text-center p-4">
                <AlertCircle className="h-12 w-12 text-destructive" />
                <p className="text-muted-foreground">{error}</p>
                <Button onClick={handleRetry} variant="outline" data-testid="button-retry-video">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              </div>
            ) : isSelectedResolutionReady ? (
              <video
                ref={videoRef}
                className="w-full h-full"
                controls
                playsInline
                data-testid="video-player"
              />
            ) : (
              <div className="text-muted-foreground text-center p-4">
                {video.status === VideoStatus.TRANSCODING ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <span>Video is still being processed...</span>
                  </div>
                ) : video.status === VideoStatus.FAILED ? (
                  <div className="flex flex-col items-center gap-2">
                    <AlertCircle className="h-8 w-8 text-destructive" />
                    <span>Video processing failed</span>
                    <span className="text-xs">{video.errorMessage}</span>
                  </div>
                ) : (
                  "Video not available at this resolution"
                )}
              </div>
            )}
          </div>

          {availableResolutions.length > 0 && (
            <Tabs value={selectedResolution} onValueChange={(v) => setSelectedResolution(v as ResolutionType)}>
              <TabsList className="w-full justify-start">
                {availableResolutions.map(res => (
                  <TabsTrigger key={res} value={res} data-testid={`tab-resolution-${res}`}>
                    {res}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span>Stream URL:</span>
              <code className="font-mono text-xs bg-muted px-2 py-1 rounded truncate max-w-md">
                {hlsUrl || "N/A"}
              </code>
            </div>
            
            {isSelectedResolutionReady && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleDownload}
                data-testid="button-download-video"
              >
                <Download className="mr-2 h-4 w-4" />
                Open Stream
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
