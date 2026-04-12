import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";

interface ActionTileProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  href: string;
  badge?: string | number;
  disabled?: boolean;
  className?: string;
  color?: string;
}

export function ActionTile({
  icon: Icon,
  title,
  href,
  badge,
  disabled = false,
  className,
  color,
}: ActionTileProps) {
  const content = (
    <div
      className={cn(
        "group relative flex flex-col items-center justify-center p-3",
        "bg-white dark:bg-card rounded-xl",
        "border border-border/50",
        "transition-all duration-150",
        "min-h-[88px]",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "active:scale-[0.97] active:bg-muted/50 cursor-pointer",
        className
      )}
    >
      {badge !== undefined && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[1.25rem] h-5 flex items-center justify-center px-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full shadow-sm">
          {badge}
        </span>
      )}
      <div className={cn(
        "w-10 h-10 rounded-lg flex items-center justify-center mb-1.5",
        color || "bg-primary/10"
      )}>
        <Icon className={cn(
          "h-5 w-5",
          color ? "text-white" : "text-primary"
        )} />
      </div>
      <h3 className="font-medium text-foreground text-center text-[11px] leading-tight">{title}</h3>
    </div>
  );

  if (disabled) {
    return content;
  }

  return (
    <Link href={href} data-testid={`tile-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      {content}
    </Link>
  );
}
