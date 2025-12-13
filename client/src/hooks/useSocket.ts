import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { VideoEvent } from "@shared/schema";

interface UseSocketOptions {
  onVideoEvent?: (event: VideoEvent) => void;
  onGlobalEvent?: (event: VideoEvent) => void;
}

export function useSocket({ onVideoEvent, onGlobalEvent }: UseSocketOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const subscribedVideosRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("WebSocket connected:", socket.id);
      
      subscribedVideosRef.current.forEach(videoId => {
        socket.emit("subscribe", videoId);
      });
    });

    socket.on("disconnect", () => {
      console.log("WebSocket disconnected");
    });

    socket.on("video-event", (event: VideoEvent) => {
      console.log("Video event received:", event);
      onVideoEvent?.(event);
    });

    socket.on("global-event", (event: VideoEvent) => {
      console.log("Global event received:", event);
      onGlobalEvent?.(event);
    });

    return () => {
      socket.disconnect();
    };
  }, [onVideoEvent, onGlobalEvent]);

  const subscribe = useCallback((videoId: string) => {
    subscribedVideosRef.current.add(videoId);
    if (socketRef.current?.connected) {
      socketRef.current.emit("subscribe", videoId);
    }
  }, []);

  const unsubscribe = useCallback((videoId: string) => {
    subscribedVideosRef.current.delete(videoId);
    if (socketRef.current?.connected) {
      socketRef.current.emit("unsubscribe", videoId);
    }
  }, []);

  return {
    subscribe,
    unsubscribe,
    isConnected: socketRef.current?.connected ?? false,
  };
}
