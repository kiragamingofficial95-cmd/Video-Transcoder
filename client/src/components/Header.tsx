import { Film, CloudUpload, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";

interface HeaderProps {
  uploadCount: number;
  processingCount: number;
}

export function Header({ uploadCount, processingCount }: HeaderProps) {
  return (
    <header className="h-16 border-b bg-card flex items-center justify-between px-6 sticky top-0 z-50">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-md bg-primary/10">
            <Film className="h-5 w-5 text-primary" />
          </div>
          <span className="text-xl font-bold tracking-tight">VideoForge</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <CloudUpload className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Uploads</span>
          <Badge variant="secondary" className="font-mono text-xs" data-testid="badge-upload-count">
            {uploadCount}
          </Badge>
        </div>

        {processingCount > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-chart-3 animate-pulse" />
            <span className="text-sm text-muted-foreground">Processing</span>
            <Badge variant="outline" className="font-mono text-xs" data-testid="badge-processing-count">
              {processingCount}
            </Badge>
          </div>
        )}

        <div className="h-6 w-px bg-border" />
        
        <Button variant="ghost" size="icon" data-testid="button-settings">
          <Settings className="h-5 w-5" />
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
