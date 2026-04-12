import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface SummaryPillProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export function SummaryPill({ icon: Icon, label, value, trend, className }: SummaryPillProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 bg-white dark:bg-card rounded-xl p-4 shadow-sm border border-border/50",
        className
      )}
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-lg font-semibold text-foreground">
          {value}
          {trend && (
            <span
              className={cn("ml-1 text-xs", {
                "text-green-600": trend === "up",
                "text-red-600": trend === "down",
                "text-muted-foreground": trend === "neutral",
              })}
            >
              {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
