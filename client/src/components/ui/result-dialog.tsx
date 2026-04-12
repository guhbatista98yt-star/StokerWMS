import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type ResultType = "success" | "error" | "warning";

interface ResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: ResultType;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function ResultDialog({
  open,
  onOpenChange,
  type,
  title,
  message,
  actionLabel = "Continuar",
  onAction,
}: ResultDialogProps) {
  const iconConfig = {
    success: {
      Icon: Check,
      bgClass: "bg-green-100 dark:bg-green-900/30",
      iconClass: "text-green-600 dark:text-green-400",
    },
    error: {
      Icon: X,
      bgClass: "bg-red-100 dark:bg-red-900/30",
      iconClass: "text-red-600 dark:text-red-400",
    },
    warning: {
      Icon: AlertTriangle,
      bgClass: "bg-yellow-100 dark:bg-yellow-900/30",
      iconClass: "text-yellow-600 dark:text-yellow-400",
    },
  };

  const { Icon, bgClass, iconClass } = iconConfig[type];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex flex-col items-center text-center pt-4">
          <div
            className={cn(
              "w-16 h-16 rounded-full flex items-center justify-center mb-4",
              bgClass
            )}
          >
            <Icon className={cn("h-8 w-8", iconClass)} />
          </div>
          <DialogTitle className="text-xl">{title}</DialogTitle>
          <DialogDescription className="text-center mt-2">
            {message}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center mt-4">
          <Button
            onClick={() => {
              onAction?.();
              onOpenChange(false);
            }}
            className="min-w-32"
            data-testid="button-result-action"
          >
            {actionLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
