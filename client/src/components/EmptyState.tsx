import { FileVideo, Upload } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="p-4 rounded-full bg-muted mb-4">
        <FileVideo className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
        {description}
      </p>
      {action}
    </div>
  );
}

export function UploadingState({ filename, progress }: { filename: string; progress: number }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="p-4 rounded-full bg-primary/10 mb-4 animate-pulse">
        <Upload className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-1">Uploading...</h3>
      <p className="text-sm text-muted-foreground text-center max-w-sm">
        {filename}
      </p>
      <span className="text-3xl font-bold font-mono mt-4">{Math.round(progress)}%</span>
    </div>
  );
}
