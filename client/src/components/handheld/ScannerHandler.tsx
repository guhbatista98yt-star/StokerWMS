
import { useEffect, useRef } from "react";
import { usePickingStore } from "@/lib/pickingStore";
import { useToast } from "@/hooks/use-toast";

interface ScannerHandlerProps {
    onScan?: (barcode: string) => void;
}

export function ScannerHandler({ onScan }: ScannerHandlerProps) {
    const buffer = useRef<string>("");
    const lastKeyTime = useRef<number>(0);
    const { toast } = useToast();

    // Configurable thresholds for "scanner-like" input speed
    const SCANNER_THRESHOLD_MS = 50;
    const BARCODE_MIN_LENGTH = 3;

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input field
            if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
                return;
            }

            const now = Date.now();
            const timeDiff = now - lastKeyTime.current;

            // If time between keystrokes is large, reset buffer (it's manual typing)
            if (timeDiff > SCANNER_THRESHOLD_MS && buffer.current.length > 0) {
                // If buffer was long enough, maybe it was a paste or fast type? 
                // Real scanner is usually < 20-30ms per char.
                // For robustness, we reset if it's too slow.
                if (buffer.current.length < BARCODE_MIN_LENGTH) {
                    buffer.current = "";
                }
            }

            lastKeyTime.current = now;

            if (e.key === "Enter") {
                if (buffer.current.length >= BARCODE_MIN_LENGTH) {
                    if (onScan) {
                        onScan(buffer.current);
                    } else {
                        // Default handling if no specific handler passed (global store action?)
                        // For now, let's just log or show toast
                        // toast({ title: "Scanner", description: `Lido: ${buffer.current}` });
                    }
                    buffer.current = "";
                }
            } else if (e.key.length === 1) {
                // Append printable characters
                buffer.current += e.key;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onScan, toast]);

    return null; // This component handles logic only, no UI
}
