import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Minus, Plus, X } from "lucide-react";
import { useEffect, useRef, useCallback } from "react";

const SCANNER_GAP_MS = 120;

interface ScanQuantityModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  productName: string;
  productCode: string;
  multiplier: number;
  onMultiplierChange: (val: number) => void;
  accumulatedQty: number;
  onAdd: () => void;
  onSubtract: () => void;
}

export function ScanQuantityModal({
  open,
  onClose,
  onConfirm,
  productName,
  productCode,
  multiplier,
  onMultiplierChange,
  accumulatedQty,
  onAdd,
  onSubtract,
}: ScanQuantityModalProps) {
  const multiplierInputRef = useRef<HTMLInputElement>(null);
  const lastKeyTimeRef = useRef(0);
  const savedMultiplierRef = useRef(multiplier);

  savedMultiplierRef.current = multiplier;

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleMultiplierKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const now = Date.now();
    const gap = now - lastKeyTimeRef.current;
    lastKeyTimeRef.current = now;

    if (e.key.length === 1 && /\d/.test(e.key)) {
      if (gap < SCANNER_GAP_MS) {
        e.preventDefault();
        e.stopPropagation();
        onMultiplierChange(savedMultiplierRef.current);
      }
    }
  }, [onMultiplierChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      data-testid="scan-quantity-modal-overlay"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative bg-background rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:w-[340px] sm:max-w-[92vw] p-5 pb-6 space-y-4 safe-bottom animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        data-testid="scan-quantity-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full bg-muted/60 text-muted-foreground active:bg-muted transition-colors"
          onClick={onClose}
          data-testid="button-close-scan-modal"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="pr-10">
          <p className="font-bold text-sm leading-tight truncate" data-testid="text-scan-modal-product">
            {productName}
          </p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{productCode}</p>
        </div>

        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="icon"
            className="h-14 w-14 rounded-full shrink-0 text-lg border-2"
            onClick={onSubtract}
            data-testid="button-subtract-qty"
          >
            <Minus className="h-6 w-6" />
          </Button>
          <Input
            ref={multiplierInputRef}
            type="number"
            min={1}
            value={multiplier}
            onChange={(e) => onMultiplierChange(Math.max(1, parseInt(e.target.value) || 1))}
            onFocus={(e) => e.target.select()}
            onKeyDown={handleMultiplierKeyDown}
            className="h-14 w-20 text-center font-bold text-xl border-2 border-primary rounded-xl [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            data-testid="input-multiplier"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-14 w-14 rounded-full shrink-0 text-lg border-2"
            onClick={onAdd}
            data-testid="button-add-qty"
          >
            <Plus className="h-6 w-6" />
          </Button>
        </div>

        <div className="bg-muted/40 rounded-xl p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Total</p>
          <p className="text-3xl font-bold tabular-nums" data-testid="text-accumulated-qty">
            {accumulatedQty}
          </p>
        </div>

        <Button
          onClick={onConfirm}
          disabled={accumulatedQty <= 0}
          className="w-full h-14 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-base active:scale-[0.98] transition-transform"
          data-testid="button-confirm-scan-modal"
        >
          <Check className="h-5 w-5 mr-2" />
          Confirmar
        </Button>
      </div>
    </div>
  );
}
