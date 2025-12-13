# Video Transcoding Platform - Design Guidelines

## Design Approach
**Dashboard/Tool Application** - This is a professional internal tool focused on efficiency and clarity, NOT a marketing site. Design system: **Material Design** with productivity-focused patterns similar to Google Cloud Console, AWS Console, or Vercel Dashboard.

## Layout System

**Spacing**: Use Tailwind units of **4, 6, 8, 12** (p-4, gap-6, h-8, mb-12)

**Dashboard Structure**:
- Fixed header navigation (h-16)
- Main content area with max-w-7xl container
- Sidebar optional for future navigation expansion
- Cards with shadow-sm for content grouping

## Typography

**Font Stack**: 
- Primary: Inter (via Google Fonts)
- Monospace: JetBrains Mono (for video IDs, file sizes, technical data)

**Hierarchy**:
- Page titles: text-3xl font-bold
- Section headers: text-xl font-semibold
- Card titles: text-lg font-medium
- Body text: text-base
- Metadata/labels: text-sm text-gray-600
- Technical data: text-sm font-mono

## Core Components

**Upload Zone**:
- Large dropzone area (min-h-64) with dashed border
- File input trigger as primary button
- Clear file type and size constraints display
- Drag-and-drop visual feedback states

**Progress Indicators**:
- Chunked upload progress: Multi-segment progress bar showing individual chunk completion
- Overall progress percentage (text-2xl font-bold)
- Current/total chunks counter
- Upload speed indicator (MB/s)
- Time remaining estimate

**Status Cards**:
- Grid layout (grid-cols-1 md:grid-cols-2 lg:grid-cols-3)
- Each video as a card with:
  - Thumbnail placeholder (aspect-video bg-gray-100)
  - Video filename (truncate with tooltip)
  - Status badge (processing/completed/failed)
  - Resolution buttons (360p, 720p, 1080p) when ready
  - Timestamp and file size in mono font
- Cards use rounded-lg with hover:shadow-md transition

**Video Status Display**:
- Current processing stage indicator
- Resolution-specific progress (separate progress bars for 360p/720p/1080p)
- Queue position if waiting
- Estimated completion time

**Navigation Header**:
- Logo/title left-aligned
- Upload count badge
- Processing queue indicator
- Settings/profile right-aligned

## Error & Success States

**Error Display**:
- Toast notifications for upload failures
- Inline error messages below upload zone
- Failed chunk retry mechanism with clear retry button
- Error logs expandable accordion

**Success States**:
- Completion checkmark animation (single, subtle)
- "Ready to play" badge on cards
- One-click copy link functionality for video URLs

## Icons
Use **Heroicons** (outline for UI, solid for states):
- Upload: cloud-arrow-up
- Processing: cog-6-tooth (with subtle rotation)
- Completed: check-circle
- Failed: x-circle
- Play: play-circle

## Responsive Behavior
- Mobile: Single column, collapsible upload zone
- Tablet: Two-column video grid
- Desktop: Three-column video grid, expanded upload interface

## Data Visualization
- Queue depth chart (simple bar/line)
- Upload throughput graph
- Processing time per resolution comparison

No large hero images - this is a functional dashboard. Focus on data clarity, immediate actionability, and professional presentation of technical information.