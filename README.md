# VideoForge - Scalable Video Transcoding Platform

A production-ready, event-driven video transcoding platform demonstrating YouTube-like architecture with chunked uploads, Redis-based job queues, FFmpeg workers, and HLS streaming output.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React)                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Upload Zone │  │ Video Cards │  │ Queue Stats │  │ HLS Player  │        │
│  │  (Chunked)  │  │  (Status)   │  │  (Real-time)│  │ (Streaming) │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │               │
│         └────────────────┴────────────────┴────────────────┘               │
│                                   │                                         │
│                          WebSocket + REST API                               │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
┌───────────────────────────────────┼─────────────────────────────────────────┐
│                           API SERVER (Express)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Upload    │  │   Chunk     │  │   Video     │  │  WebSocket  │        │
│  │  Sessions   │  │  Handler    │  │   Status    │  │   Events    │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │               │
│         └────────────────┴────────────────┴────────────────┘               │
│                                   │                                         │
│                          Event Emission Layer                               │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
        ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
        │     Redis     │   │   File Store  │   │   WebSocket   │
        │  (BullMQ)     │   │   /chunks     │   │   Broadcast   │
        │   Job Queue   │   │   /uploads    │   │               │
        └───────┬───────┘   │   /transcoded │   └───────────────┘
                │           └───────────────┘
                │
┌───────────────┼─────────────────────────────────────────────────────────────┐
│               ▼          TRANSCODING WORKERS (Scalable)                     │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │  Worker 1   │   Worker 2   │   Worker 3   │   Worker N   │  ... │       │
│  │   FFmpeg    │    FFmpeg    │    FFmpeg    │    FFmpeg    │      │       │
│  │  360p/720p  │   720p/1080p │    360p      │    1080p     │      │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                   │                                         │
│                          HLS Output Generation                              │
│                     (.m3u8 playlists + .ts segments)                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Event Flow

```
UPLOAD FLOW:
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Create  │───▶│  Upload  │───▶│  Merge   │───▶│  UPLOAD_ │───▶│  Queue   │
│  Session │    │  Chunks  │    │  Chunks  │    │ COMPLETED│    │   Jobs   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
     │               │               │               │               │
     ▼               ▼               ▼               ▼               ▼
  videoId        Progress        Complete         Event          3 Jobs
  sessionId      Updates         File            Emitted        (360/720/1080p)

TRANSCODING FLOW:
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│TRANSCODE_│───▶│  FFmpeg  │───▶│TRANSCODE_│───▶│TRANSCODE_│───▶│  Update  │
│ STARTED  │    │ Process  │    │ PROGRESS │    │ COMPLETED│    │  Video   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
     │               │               │               │               │
     ▼               ▼               ▼               ▼               ▼
  Per-res         HLS Gen        WebSocket        HLS URLs       Status=
  Job Start       Segments       Updates         Available       Ready
```

## Key Features

### 1. Chunked Upload System
- **10MB chunks** for optimal network efficiency
- **Parallel uploads** (3 concurrent chunks by default)
- **Resumable** - resume from last successful chunk on failure
- **Progress tracking** - real-time per-chunk and overall progress
- **Session management** - 24-hour session expiry

### 2. Event-Driven Architecture
- **Decoupled components** - API server and workers communicate via events
- **Redis pub/sub** - real-time event propagation
- **BullMQ job queue** - reliable, persistent job processing
- **WebSocket** - instant client updates

### 3. Multi-Resolution Transcoding
- **360p** (640x360, 800kbps) - Mobile/low bandwidth
- **720p** (1280x720, 2500kbps) - Standard HD
- **1080p** (1920x1080, 5000kbps) - Full HD

### 4. HLS Streaming
- **Adaptive bitrate** ready structure
- **4-second segments** for low latency
- **Cross-platform** compatibility

## Scalability Explanation

### Why Chunked Uploads Enable Fast, Reliable Uploads

1. **Parallel Processing**: Multiple chunks upload simultaneously, utilizing full bandwidth
2. **Failure Isolation**: One chunk failure doesn't affect others
3. **Resume Capability**: Only re-upload failed chunks, not entire file
4. **Memory Efficiency**: Server processes chunks individually, not entire file in memory

### How This Design Handles High Traffic

```
Load Balancer
      │
      ├──▶ API Server 1 ──┐
      ├──▶ API Server 2 ──┼──▶ Redis (Shared State)
      └──▶ API Server N ──┘          │
                                     │
      ┌──────────────────────────────┘
      │
      ├──▶ Worker 1 (GPU-enabled)
      ├──▶ Worker 2 (GPU-enabled)
      └──▶ Worker N (Auto-scaled)
```

**Horizontal Scaling Points:**
- **API Servers**: Stateless, scale behind load balancer
- **Workers**: Independent, scale based on queue depth
- **Redis**: Cluster mode for high availability
- **Storage**: Replace with S3/GCS for unlimited scale

### Production Migration Path

| Component | Demo | Production |
|-----------|------|------------|
| Storage | Local filesystem | S3/GCS with presigned URLs |
| Queue | In-memory fallback | Redis Cluster |
| Workers | Single process | Kubernetes pods with GPU |
| CDN | Direct serve | CloudFront/Fastly |
| Database | In-memory | PostgreSQL/DynamoDB |

## API Reference

### Upload Endpoints

```
POST /api/upload/session
Body: { filename, totalSize, mimeType }
Response: { id, videoId, totalChunks, chunkSize }

POST /api/upload/chunk
Body: FormData { chunk, sessionId, chunkIndex }
Response: { success, uploadedChunks, totalChunks, progress }

POST /api/upload/complete
Body: { sessionId }
Response: { success, videoId, message }
```

### Video Endpoints

```
GET /api/videos
Response: Video[]

GET /api/videos/:id
Response: Video

DELETE /api/videos/:id
Response: { success }
```

### Queue Endpoints

```
GET /api/queue/stats
Response: { waiting, active, completed, failed }
```

### Streaming Endpoints

```
GET /api/stream/:videoId/:resolution/playlist.m3u8
Response: HLS Playlist

GET /api/stream/:videoId/:resolution/:segment
Response: TS Segment
```

## Environment Variables

```env
# Server
PORT=5000
NODE_ENV=development

# Redis (optional - falls back to in-memory simulation)
REDIS_URL=redis://localhost:6379

# Storage
STORAGE_DIR=./storage

# Session
SESSION_SECRET=your-secret-key
```

## Running Locally

```bash
# Install dependencies
npm install

# Start development server (API + Frontend)
npm run dev

# Start worker (separate terminal, requires Redis)
npx tsx server/worker.ts
```

## Docker Deployment

### API Server Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 5000
CMD ["node", "dist/server/index.js"]
```

### Worker Dockerfile

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["node", "dist/server/worker.js"]
```

### Docker Compose

```yaml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    ports:
      - "5000:5000"
    environment:
      - REDIS_URL=redis://redis:6379
      - STORAGE_DIR=/data
    volumes:
      - video-storage:/data
    depends_on:
      - redis

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      - REDIS_URL=redis://redis:6379
      - STORAGE_DIR=/data
    volumes:
      - video-storage:/data
    depends_on:
      - redis
    deploy:
      replicas: 3

volumes:
  video-storage:
```

## Trade-offs & Limitations

### Current Demo Limitations

1. **In-Memory Storage**: Videos lost on restart (production: use database)
2. **Local Files**: Limited to single server (production: use S3/GCS)
3. **No Authentication**: Open access (production: add auth layer)
4. **Single Worker**: One transcoding process (production: scale workers)

### Design Trade-offs

| Decision | Trade-off | Reasoning |
|----------|-----------|-----------|
| 10MB chunks | Memory vs speed | Balances browser memory with upload parallelism |
| 3 parallel chunks | Bandwidth vs reliability | Prevents overwhelming connections |
| 4s HLS segments | Latency vs seeking | Standard for live/VOD balance |
| FFmpeg preset=fast | Quality vs speed | Prioritizes demo responsiveness |

## Tech Stack

- **Frontend**: React, Tailwind CSS, TanStack Query, Socket.io-client
- **Backend**: Node.js, Express, TypeScript
- **Queue**: Redis, BullMQ
- **Transcoding**: FFmpeg
- **Real-time**: Socket.io, Redis Pub/Sub

## License

MIT
