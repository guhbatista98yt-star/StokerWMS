import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface GradientHeaderProps {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function GradientHeader({ title, subtitle, children, className, compact = false }: GradientHeaderProps) {
  return (
    <header
      className={cn(
        "bg-card border-b border-border/40 shrink-0",
        compact ? "h-14 flex items-center px-4" : "px-4 py-4 md:px-6 md:py-5",
        className
      )}
    >
      <div className={cn("max-w-7xl mx-auto w-full", compact ? "flex items-center" : "")}>
        {title ? (
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="min-w-0">
              <h1 className={cn(
                "font-bold tracking-tight truncate text-foreground",
                compact ? "text-base" : "text-xl md:text-2xl"
              )}>
                {title}
              </h1>
              {subtitle && (
                <p className="text-muted-foreground text-xs truncate mt-0.5">{subtitle}</p>
              )}
            </div>
            {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
          </div>
        ) : (
          <div className={cn(compact ? "flex items-center w-full" : "")}>
            {children}
          </div>
        )}
      </div>
    </header>
  );
}
