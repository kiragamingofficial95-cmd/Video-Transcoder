import { Progress } from "@/components/ui/progress";

interface ProgressBarProps {
  value: number;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "success" | "warning" | "error";
}

const sizeClasses = {
  sm: "h-1",
  md: "h-2",
  lg: "h-3",
};

const variantClasses = {
  default: "[&>div]:bg-primary",
  success: "[&>div]:bg-chart-2",
  warning: "[&>div]:bg-chart-3",
  error: "[&>div]:bg-destructive",
};

export function ProgressBar({ 
  value, 
  showLabel = false, 
  size = "md",
  variant = "default"
}: ProgressBarProps) {
  return (
    <div className="flex items-center gap-3 w-full">
      <Progress 
        value={value} 
        className={`flex-1 ${sizeClasses[size]} ${variantClasses[variant]}`}
      />
      {showLabel && (
        <span className="text-sm font-mono text-muted-foreground min-w-[3rem] text-right">
          {Math.round(value)}%
        </span>
      )}
    </div>
  );
}

interface ChunkedProgressBarProps {
  chunks: { index: number; uploaded: boolean }[];
  className?: string;
}

export function ChunkedProgressBar({ chunks, className = "" }: ChunkedProgressBarProps) {
  const uploadedCount = chunks.filter(c => c.uploaded).length;
  const percentage = chunks.length > 0 ? (uploadedCount / chunks.length) * 100 : 0;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex gap-0.5">
        {chunks.map((chunk) => (
          <div
            key={chunk.index}
            className={`h-2 flex-1 rounded-sm transition-colors ${
              chunk.uploaded 
                ? "bg-chart-2" 
                : "bg-muted"
            }`}
            data-testid={`chunk-indicator-${chunk.index}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="font-mono">{uploadedCount}/{chunks.length} chunks</span>
        <span className="font-mono">{Math.round(percentage)}%</span>
      </div>
    </div>
  );
}

interface ResolutionProgressProps {
  resolutions: {
    resolution: string;
    progress: number;
    status: "pending" | "processing" | "completed" | "failed";
  }[];
}

export function ResolutionProgress({ resolutions }: ResolutionProgressProps) {
  return (
    <div className="space-y-3">
      {resolutions.map(({ resolution, progress, status }) => (
        <div key={resolution} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="font-medium">{resolution}</span>
            <span className="font-mono text-muted-foreground">
              {status === "completed" ? "Done" : status === "failed" ? "Failed" : `${Math.round(progress)}%`}
            </span>
          </div>
          <Progress 
            value={status === "completed" ? 100 : progress} 
            className={`h-1.5 ${
              status === "completed" ? "[&>div]:bg-chart-2" : 
              status === "failed" ? "[&>div]:bg-destructive" : 
              "[&>div]:bg-primary"
            }`}
          />
        </div>
      ))}
    </div>
  );
}
