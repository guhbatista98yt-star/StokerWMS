import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Delete, CornerDownLeft, ArrowBigUp, X } from "lucide-react";

interface VirtualKeyboardProps {
  value: string;
  onChange: (next: string) => void;
  onConfirm: () => void;
  onClose?: () => void;
  className?: string;
  /** Quando false, todos os botões ficam desabilitados (somente leitura). */
  enabled?: boolean;
}

const ROW_NUM = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const ROW_TOP = ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"];
const ROW_MID = ["A", "S", "D", "F", "G", "H", "J", "K", "L"];
const ROW_BOT = ["Z", "X", "C", "V", "B", "N", "M"];

/**
 * Teclado virtual on-screen para tablets/coletores sem teclado físico.
 * Honra o bloqueio de digitação manual: quando enabled=false, nenhuma tecla escreve.
 */
export function VirtualKeyboard({
  value,
  onChange,
  onConfirm,
  onClose,
  className,
  enabled = true,
}: VirtualKeyboardProps) {
  const [shift, setShift] = useState(false);

  const press = (ch: string) => {
    if (!enabled) return;
    const c = shift ? ch.toUpperCase() : ch.toLowerCase();
    onChange(value + c);
  };

  const back = () => {
    if (!enabled) return;
    onChange(value.slice(0, -1));
  };

  const clear = () => {
    if (!enabled) return;
    onChange("");
  };

  const Key = ({ label, onClick, wide = false, accent = false, danger = false }: {
    label: React.ReactNode;
    onClick: () => void;
    wide?: boolean;
    accent?: boolean;
    danger?: boolean;
  }) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={!enabled}
      data-scan-exclude="true"
      className={cn(
        "h-10 rounded-md font-medium text-sm select-none transition-colors",
        "border border-border bg-background hover:bg-muted active:bg-muted/80",
        wide ? "px-4" : "min-w-[2.25rem] px-2",
        accent && "bg-primary text-primary-foreground border-primary hover:bg-primary/90",
        danger && "bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20",
        !enabled && "opacity-40 cursor-not-allowed",
      )}
    >
      {label}
    </button>
  );

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card shadow-lg p-2 space-y-1.5",
        className,
      )}
      data-scan-exclude="true"
    >
      {!enabled && (
        <div className="text-[11px] text-destructive font-medium px-1 pb-1">
          Digitação manual bloqueada para este usuário.
        </div>
      )}

      <div className="flex gap-1 justify-center flex-wrap">
        {ROW_NUM.map(k => <Key key={k} label={k} onClick={() => press(k)} />)}
      </div>
      <div className="flex gap-1 justify-center flex-wrap">
        {ROW_TOP.map(k => <Key key={k} label={shift ? k : k.toLowerCase()} onClick={() => press(k)} />)}
      </div>
      <div className="flex gap-1 justify-center flex-wrap">
        {ROW_MID.map(k => <Key key={k} label={shift ? k : k.toLowerCase()} onClick={() => press(k)} />)}
      </div>
      <div className="flex gap-1 justify-center flex-wrap">
        <Key
          label={<ArrowBigUp className={cn("h-4 w-4", shift && "text-primary")} />}
          onClick={() => setShift(s => !s)}
        />
        {ROW_BOT.map(k => <Key key={k} label={shift ? k : k.toLowerCase()} onClick={() => press(k)} />)}
        <Key label={<Delete className="h-4 w-4" />} onClick={back} />
      </div>

      <div className="flex gap-1 justify-between pt-1">
        <Key label="Limpar" onClick={clear} danger />
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-scan-exclude="true"
            className="h-10 px-3 text-xs"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Fechar
          </Button>
        )}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onConfirm}
          disabled={!enabled || !value.trim()}
          data-scan-exclude="true"
          className={cn(
            "h-10 px-4 rounded-md font-semibold text-sm flex items-center gap-1.5 transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            (!enabled || !value.trim()) && "opacity-40 cursor-not-allowed",
          )}
        >
          <CornerDownLeft className="h-4 w-4" />
          Confirmar
        </button>
      </div>
    </div>
  );
}
