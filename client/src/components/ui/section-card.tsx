import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface SectionCardProps {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function SectionCard({
  title,
  icon,
  children,
  actions,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <Card className={cn("shadow-sm border-border/50", className)}>
      {(title || actions) && (
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
          {title && (
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              {icon}
              {title}
            </CardTitle>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </CardHeader>
      )}
      <CardContent className={cn(title ? "" : "pt-6", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}
