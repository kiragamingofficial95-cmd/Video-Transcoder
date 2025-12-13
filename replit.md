# VideoForge - Scalable Video Transcoding Platform

## Overview

VideoForge is a production-ready, event-driven video transcoding platform demonstrating YouTube-like architecture. The platform enables users to upload large video files via chunked uploads, processes them through a Redis-based job queue with FFmpeg workers, and outputs HLS (HTTP Live Streaming) format at multiple resolutions (360p, 720p, 1080p).

The application follows a dashboard/tool design pattern focused on efficiency and clarity, with real-time status updates via WebSocket connections.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Build Tool**: Vite with path aliases (`@/` for client source, `@shared/` for shared code)
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens, supporting light/dark themes
- **Real-time Updates**: Socket.io client for WebSocket communication

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **HTTP Server**: Node.js HTTP server (supports WebSocket upgrade)
- **File Uploads**: Multer middleware for chunked file handling
- **WebSocket**: Socket.io for real-time event broadcasting
- **Job Queue**: BullMQ with Redis for background job processing
- **Video Processing**: FFmpeg workers for transcoding to HLS format

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` contains all type definitions and Zod validation schemas
- **File Storage**: Local filesystem with organized directories:
  - `/storage/chunks` - Temporary chunk storage during upload
  - `/storage/uploads` - Completed uploaded files
  - `/storage/transcoded` - HLS output files organized by resolution

### Event-Driven Design Pattern
- Central `EventEmitter` in `server/queue.ts` broadcasts video processing events
- WebSocket server relays events to subscribed clients
- Event types: UPLOAD_COMPLETED, TRANSCODING_STARTED, TRANSCODING_PROGRESS, TRANSCODING_COMPLETED, TRANSCODING_FAILED

### Video Status Flow
Videos progress through states: `uploading` → `upload_completed` → `queued` → `transcoding` → `completed`/`failed`

### Chunked Upload System
- 10MB chunk size for reliable large file uploads
- Session-based upload tracking with resumable capability
- Parallel chunk uploads (up to 3 concurrent)

## External Dependencies

### Required Services
- **Redis**: BullMQ job queue backend (graceful fallback to demo mode if unavailable)
- **PostgreSQL**: Primary database (connection via `DATABASE_URL` environment variable)
- **FFmpeg**: System binary for video transcoding (must be installed on host)

### Key NPM Packages
- `bullmq` - Redis-based job queue for transcoding tasks
- `drizzle-orm` + `drizzle-kit` - Database ORM and migrations
- `socket.io` - WebSocket server for real-time updates
- `multer` - Multipart form handling for file uploads
- `zod` - Runtime type validation for API schemas

### Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (required)
- `REDIS_URL` - Redis connection string (optional, defaults to localhost:6379)
- `STORAGE_DIR` - File storage base path (optional, defaults to ./storage)