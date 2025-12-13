import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Loader2, CloudUpload, Clock } from "lucide-react";
import type { VideoStatusType } from "@shared/schema";
import { VideoStatus } from "@shared/schema";

interface StatusBadgeProps {
  status: VideoStatusType;
}

const statusConfig: Record<VideoStatusType, {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  icon: typeof CheckCircle;
  className?: string;
}> = {
  [VideoStatus.UPLOADING]: {
    label: "Uploading",
    variant: "secondary",
    icon: CloudUpload,
    className: "text-chart-1",
  },
  [VideoStatus.UPLOAD_COMPLETED]: {
    label: "Uploaded",
    variant: "outline",
    icon: CheckCircle,
    className: "text-chart-2",
  },
  [VideoStatus.QUEUED]: {
    label: "Queued",
    variant: "secondary",
    icon: Clock,
    className: "text-muted-foreground",
  },
  [VideoStatus.TRANSCODING]: {
    label: "Processing",
    variant: "outline",
    icon: Loader2,
    className: "text-chart-3",
  },
  [VideoStatus.COMPLETED]: {
    label: "Ready",
    variant: "default",
    icon: CheckCircle,
    className: "text-chart-2",
  },
  [VideoStatus.FAILED]: {
    label: "Failed",
    variant: "destructive",
    icon: XCircle,
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const isSpinning = status === VideoStatus.TRANSCODING || status === VideoStatus.UPLOADING;

  return (
    <Badge variant={config.variant} className="gap-1.5" data-testid={`badge-status-${status}`}>
      <Icon className={`h-3 w-3 ${config.className || ""} ${isSpinning ? "animate-spin" : ""}`} />
      {config.label}
    </Badge>
  );
}
