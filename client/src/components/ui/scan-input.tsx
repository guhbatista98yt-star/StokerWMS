import { useEffect, useRef, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ScanLine, Check, X, AlertTriangle, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ScanInputProps {
  placeholder?: string;
  onScan: (value: string) => void;
  status?: "idle" | "success" | "error" | "warning";
  statusMessage?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  value?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  showKeyboardToggle?: boolean;
}

const DIALOG_SELECTORS = '[role="dialog"], [role="alertdialog"], [data-radix-dialog-content], [data-radix-alert-dialog-content]';

function hasOpenDialog(): boolean {
  return !!document.querySelector(DIALOG_SELECTORS);
}

export function ScanInput({
  placeholder = "Aguardando leitura...",
  onScan,
  status = "idle",
  statusMessage,
  disabled = false,
  autoFocus = true,
  className,
  value: controlledValue,
  onChange: controlledOnChange,
  readOnly = false,
  inputMode = "none",
  showKeyboardToggle = false,
}: ScanInputProps) {
  const [internalValue, setInternalValue] = useState("");
  const [keyboardMode, setKeyboardMode] = useState(false);
  const refocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const value = controlledValue !== undefined ? controlledValue : internalValue;
  const setValue = useCallback((newValue: string) => {
    if (controlledOnChange) {
      controlledOnChange(newValue);
    } else {
      setInternalValue(newValue);
    }
  }, [controlledOnChange]);

  const tryFocus = useCallback(() => {
    if (inputRef.current && !inputRef.current.disabled && !hasOpenDialog()) {
      inputRef.current.focus();
    }
  }, []);

  const scheduleFocus = useCallback((delay = 80) => {
    if (refocusTimerRef.current) clearTimeout(refocusTimerRef.current);
    refocusTimerRef.current = setTimeout(tryFocus, delay);
  }, [tryFocus]);

  useEffect(() => {
    if (autoFocus && inputRef.current && !disabled) {
      inputRef.current.focus();
    }
  }, [autoFocus, disabled]);

  useEffect(() => {
    if (!autoFocus || disabled) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      // Skip if clicking inside a dialog
      if (target.closest(DIALOG_SELECTORS)) return;
      // Skip if clicking on another input/textarea/select that is NOT the scan input itself
      // This prevents stealing focus from quantity inputs, search fields, etc.
      const tagName = target.tagName;
      if (
        (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") &&
        target !== inputRef.current
      ) return;
      // Skip if target has data-scan-exclude attribute (explicit opt-out)
      if (target.closest("[data-scan-exclude]")) return;
      scheduleFocus(80);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      if (refocusTimerRef.current) clearTimeout(refocusTimerRef.current);
    };
  }, [autoFocus, disabled, scheduleFocus]);

  useEffect(() => {
    if (!autoFocus || disabled) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (let i = 0; i < mutation.removedNodes.length; i++) {
          const node = mutation.removedNodes[i];
          if (node instanceof HTMLElement) {
            if (
              (node.matches && node.matches(DIALOG_SELECTORS)) ||
              (node.querySelector && node.querySelector(DIALOG_SELECTORS))
            ) {
              scheduleFocus(150);
              return;
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [autoFocus, disabled, scheduleFocus]);

  const handleBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    if (!autoFocus || disabled) return;
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    if (relatedTarget?.closest(DIALOG_SELECTORS)) return;
    // Don't steal focus back if the user clicked another input/textarea/select
    if (
      relatedTarget &&
      (relatedTarget.tagName === "INPUT" ||
        relatedTarget.tagName === "TEXTAREA" ||
        relatedTarget.tagName === "SELECT")
    ) return;
    // Don't steal back if clicking something with data-scan-exclude
    if (relatedTarget?.closest("[data-scan-exclude]")) return;
    scheduleFocus(120);
  }, [autoFocus, disabled, scheduleFocus]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && value.trim()) {
      e.preventDefault();
      const scannedValue = value.trim();
      setValue("");
      onScan(scannedValue);
    }
  };

  const toggleKeyboard = () => {
    setKeyboardMode(prev => {
      const next = !prev;
      // Re-focus after toggle
      setTimeout(() => inputRef.current?.focus(), 50);
      return next;
    });
  };

  const statusColors = {
    idle: "border-input focus:ring-primary",
    success: "border-green-500 bg-green-50 dark:bg-green-950/30 ring-2 ring-green-500",
    error: "border-red-500 bg-red-50 dark:bg-red-950/30 ring-2 ring-red-500",
    warning: "border-yellow-500 bg-yellow-50 dark:bg-yellow-950/30 ring-2 ring-yellow-500",
  };

  const StatusIcon = {
    idle: ScanLine,
    success: Check,
    error: X,
    warning: AlertTriangle,
  }[status];

  const iconColors = {
    idle: "text-muted-foreground",
    success: "text-green-600 dark:text-green-400",
    error: "text-red-600 dark:text-red-400",
    warning: "text-yellow-600 dark:text-yellow-400",
  };

  const effectiveInputMode = keyboardMode ? "text" : inputMode;

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <StatusIcon
            className={cn(
              "h-5 w-5 transition-colors",
              iconColors[status]
            )}
          />
        </div>
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          inputMode={effectiveInputMode}
          data-scan-input="true"
          className={cn(
            "pl-11 h-14 text-lg font-mono transition-all",
            showKeyboardToggle && "pr-11",
            statusColors[status]
          )}
          data-testid="input-scan"
        />
        {showKeyboardToggle && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleKeyboard}
              className={cn(
                "h-7 w-7 rounded-lg transition-colors",
                keyboardMode
                  ? "text-primary bg-primary/10 hover:bg-primary/20"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title={keyboardMode ? "Modo teclado ativo — clique para voltar ao scanner" : "Digitar manualmente"}
              data-testid="button-keyboard-toggle"
              data-scan-exclude="true"
            >
              <Keyboard className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <div className="h-6 mt-1 flex items-center">
        {statusMessage && (
          <p
            className={cn(
              "text-sm font-medium truncate",
              {
                "text-green-600 dark:text-green-400": status === "success",
                "text-red-600 dark:text-red-400": status === "error",
                "text-yellow-600 dark:text-yellow-400": status === "warning",
              }
            )}
          >
            {statusMessage}
          </p>
        )}
      </div>
    </div>
  );
}
