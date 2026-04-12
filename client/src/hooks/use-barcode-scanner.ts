import { useEffect, useRef } from "react";

const SCANNER_GAP_MS = 120;
const ENTER_GRACE_MS = 300;

export function useBarcodeScanner(
  onScan: (barcode: string) => void,
  enabled: boolean = true
) {
  const bufferRef = useRef("");
  const lastKeyTimeRef = useRef(0);
  const lastCharTimeRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const isScanInput = (el: HTMLElement) =>
      (el as HTMLInputElement).dataset?.scanInput === "true";

    const isEditableTarget = (el: HTMLElement) =>
      (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "hidden") ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable;

    const clearScanInput = (el: HTMLElement) => {
      try {
        if (el.tagName === "INPUT") {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          if (setter) { setter.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true })); }
        } else if (el.tagName === "TEXTAREA") {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
          if (setter) { setter.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true })); }
        } else if (el.isContentEditable) {
          el.textContent = "";
        }
      } catch (_) {}
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const gap = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      const target = e.target as HTMLElement;
      const inEditable = isEditableTarget(target);
      const inScanInput = inEditable && isScanInput(target);
      const inOtherEditable = inEditable && !inScanInput;

      if (e.key === "Enter") {
        const sinceLastChar = now - lastCharTimeRef.current;
        if (bufferRef.current.length > 2 && sinceLastChar <= ENTER_GRACE_MS) {
          e.preventDefault();
          e.stopPropagation();
          const barcode = bufferRef.current;
          bufferRef.current = "";

          if (inScanInput) clearScanInput(target);

          onScanRef.current(barcode);
        } else {
          bufferRef.current = "";
        }
      } else if (e.key && e.key.length === 1) {
        if (gap > SCANNER_GAP_MS) {
          bufferRef.current = "";
        }
        bufferRef.current += e.key;
        lastCharTimeRef.current = now;

        const shouldPrevent = gap <= SCANNER_GAP_MS && bufferRef.current.length >= 2;
        if (shouldPrevent && (!inEditable || inOtherEditable)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled]);
}
