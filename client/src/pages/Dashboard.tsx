import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { UploadZone } from "@/components/UploadZone";
import { VideoCard } from "@/components/VideoCard";
import { VideoPlayer } from "@/components/VideoPlayer";
import { QueueStats } from "@/components/QueueStats";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { useUpload } from "@/hooks/useUpload";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Video, QueueStats as QueueStatsType, ResolutionType } from "@shared/schema";

export default function Dashboard() {
  const { toast } = useToast();
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<ResolutionType | undefined>();
  const [playerOpen, setPlayerOpen] = useState(false);

  const { 
    progress, 
    isUploading, 
    startUpload, 
    pauseUpload, 
    resumeUpload, 
    cancelUpload,
    retryUpload,
  } = useUpload({
    onComplete: (videoId) => {
      toast({
        title: "Upload complete",
        description: "Your video is now being processed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      queryClient.invalidateQueries({ queryKey: ["/api/queue/stats"] });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: videos = [], isLoading: videosLoading } = useQuery<Video[]>({
    queryKey: ["/api/videos"],
    refetchInterval: 3000,
  });

  const { data: queueStats } = useQuery<QueueStatsType>({
    queryKey: ["/api/queue/stats"],
    refetchInterval: 5000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (videoId: string) => {
      await apiRequest("DELETE", `/api/videos/${videoId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos"] });
      toast({
        title: "Video deleted",
        description: "The video has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Delete failed",
        description: "Could not delete the video.",
        variant: "destructive",
      });
    },
  });

  const handlePlay = (videoId: string, resolution: ResolutionType) => {
    const video = videos.find(v => v.id === videoId);
    if (video) {
      setSelectedVideo(video);
      setSelectedResolution(resolution);
      setPlayerOpen(true);
    }
  };

  const handleDelete = (videoId: string) => {
    deleteMutation.mutate(videoId);
  };

  const uploadCount = videos.length;
  const processingCount = videos.filter(v => 
    v.status === "uploading" || v.status === "transcoding" || v.status === "queued"
  ).length;

  return (
    <div className="min-h-screen bg-background">
      <Header uploadCount={uploadCount} processingCount={processingCount} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <section>
          <h1 className="text-3xl font-bold mb-2">Video Transcoding</h1>
          <p className="text-muted-foreground mb-6">
            Upload videos for multi-resolution HLS transcoding
          </p>
          
          <UploadZone
            onUploadStart={startUpload}
            uploadProgress={progress}
            onPause={pauseUpload}
            onResume={resumeUpload}
            onCancel={cancelUpload}
            onRetry={retryUpload}
          />
        </section>

        {queueStats && (
          <section>
            <QueueStats stats={queueStats} />
          </section>
        )}

        <section>
          <h2 className="text-xl font-semibold mb-4">Your Videos</h2>
          
          {videosLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <Card key={i} className="overflow-hidden">
                  <Skeleton className="aspect-video" />
                  <div className="p-4 space-y-2">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </Card>
              ))}
            </div>
          ) : videos.length === 0 ? (
            <EmptyState
              title="No videos yet"
              description="Upload your first video to get started with multi-resolution transcoding."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {videos.map(video => (
                <VideoCard
                  key={video.id}
                  video={video}
                  onPlay={handlePlay}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <VideoPlayer
        video={selectedVideo}
        initialResolution={selectedResolution}
        open={playerOpen}
        onOpenChange={setPlayerOpen}
      />
    </div>
  );
}
