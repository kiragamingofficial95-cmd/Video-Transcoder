import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Loader2, CheckCircle, XCircle } from "lucide-react";
import type { QueueStats as QueueStatsType } from "@shared/schema";

interface QueueStatsProps {
  stats: QueueStatsType;
}

export function QueueStats({ stats }: QueueStatsProps) {
  const items = [
    {
      label: "Waiting",
      value: stats.waiting,
      icon: Clock,
      color: "text-muted-foreground",
      bg: "bg-muted",
    },
    {
      label: "Active",
      value: stats.active,
      icon: Loader2,
      color: "text-chart-3",
      bg: "bg-chart-3/10",
      animate: stats.active > 0,
    },
    {
      label: "Completed",
      value: stats.completed,
      icon: CheckCircle,
      color: "text-chart-2",
      bg: "bg-chart-2/10",
    },
    {
      label: "Failed",
      value: stats.failed,
      icon: XCircle,
      color: "text-destructive",
      bg: "bg-destructive/10",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Queue Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {items.map(({ label, value, icon: Icon, color, bg, animate }) => (
            <div 
              key={label} 
              className={`p-4 rounded-lg ${bg} flex flex-col items-center justify-center gap-2`}
              data-testid={`stat-${label.toLowerCase()}`}
            >
              <Icon className={`h-5 w-5 ${color} ${animate ? "animate-spin" : ""}`} />
              <span className={`text-2xl font-bold font-mono ${color}`}>{value}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
