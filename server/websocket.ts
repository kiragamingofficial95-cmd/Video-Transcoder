import { Server as HttpServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import { eventEmitter } from "./queue";
import type { VideoEvent } from "@shared/schema";

let io: SocketServer | null = null;

export function setupWebSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    path: "/socket.io",
  });

  io.on("connection", (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on("subscribe", (videoId: string) => {
      socket.join(`video:${videoId}`);
      console.log(`Client ${socket.id} subscribed to video ${videoId}`);
    });

    socket.on("unsubscribe", (videoId: string) => {
      socket.leave(`video:${videoId}`);
      console.log(`Client ${socket.id} unsubscribed from video ${videoId}`);
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  eventEmitter.on("video-event", (event: VideoEvent) => {
    if (io) {
      io.to(`video:${event.videoId}`).emit("video-event", event);
      io.emit("global-event", event);
    }
  });

  console.log("WebSocket server initialized");
  return io;
}

export function getIO(): SocketServer | null {
  return io;
}

export function broadcastEvent(event: VideoEvent): void {
  if (io) {
    io.to(`video:${event.videoId}`).emit("video-event", event);
    io.emit("global-event", event);
  }
}
