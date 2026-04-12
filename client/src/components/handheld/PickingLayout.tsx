
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PickingLayoutProps {
    children: ReactNode;
    className?: string;
}

export function PickingLayout({ children, className }: PickingLayoutProps) {
    return (
        <div className={cn("flex flex-col h-[100dvh] w-full max-w-full bg-background text-foreground overflow-hidden", className)}>
            {/* 
        This layout is designed for full-screen handheld usage.
        It intentionally omits sidebars and headers to maximize space.
      */}
            <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 flex flex-col relative min-w-0">
                {children}
            </main>
        </div>
    );
}
