import { useState, useRef, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MapPin, CheckCircle2, XCircle, AlertTriangle, Keyboard } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getAddressLabels } from "@/lib/address-labels";

interface WmsAddress {
  id: string;
  bairro: string;
  rua: string;
  bloco: string;
  nivel: string;
  code: string;
}

interface AddressPickerProps {
  availableAddresses: WmsAddress[];
  onAddressSelect: (addressId: string) => void;
  onClear: () => void;
  value?: string;
  label?: string;
  occupiedWarning?: string;
}

export function AddressPicker({ availableAddresses, onAddressSelect, onClear, value, label, occupiedWarning }: AddressPickerProps) {
  const { companyId } = useAuth();
  const addrLabels = getAddressLabels(companyId);
  const [bairro, setBairro] = useState("");
  const [rua, setRua] = useState("");
  const [bloco, setBloco] = useState("");
  const [nivel, setNivel] = useState("");
  const [activeField, setActiveField] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  /** Teclado virtual ativado apenas quando o operador precisar digitar manualmente */
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);

  const ruaRef   = useRef<HTMLInputElement>(null);
  const blocoRef = useRef<HTMLInputElement>(null);
  const nivelRef = useRef<HTMLInputElement>(null);
  const bairroRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const onAddressSelectRef = useRef(onAddressSelect);
  onAddressSelectRef.current = onAddressSelect;
  const onClearRef = useRef(onClear);
  onClearRef.current = onClear;
  const addressesRef = useRef(availableAddresses);
  addressesRef.current = availableAddresses;

  // Sincroniza campos quando valor externo é definido
  useEffect(() => {
    if (value) {
      const match = addressesRef.current.find(a => a.id === value);
      if (match) {
        setBairro(match.bairro);
        setRua(match.rua);
        setBloco(match.bloco);
        setNivel(match.nivel);
      }
    } else {
      setBairro("");
      setRua("");
      setBloco("");
      setNivel("");
    }
  }, [value]);

  const alphaNumOnly = (v: string) => v.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

  const currentMatch = useMemo(() => {
    return availableAddresses.find(
      a => a.bairro === bairro && a.rua === rua && a.bloco === bloco && a.nivel === nivel
    );
  }, [bairro, rua, bloco, nivel, availableAddresses]);

  useEffect(() => {
    if (currentMatch) {
      onAddressSelectRef.current(currentMatch.id);
    } else if (bairro || rua || bloco || nivel) {
      onClearRef.current();
    }
  }, [currentMatch, bairro, rua, bloco, nivel]);

  const clearAll = () => {
    setBairro("");
    setRua("");
    setBloco("");
    setNivel("");
    onClear();
    bairroRef.current?.focus();
  };

  const suggestions = useMemo(() => {
    if (!activeField) return [];

    const filtered = availableAddresses.filter(a => {
      if (activeField === "bairro") return !bairro || a.bairro.startsWith(bairro);
      if (activeField === "rua")    return a.bairro === bairro && (!rua   || a.rua.startsWith(rua));
      if (activeField === "bloco")  return a.bairro === bairro && a.rua === rua && (!bloco || a.bloco.startsWith(bloco));
      if (activeField === "nível")  return a.bairro === bairro && a.rua === rua && a.bloco === bloco && (!nivel || a.nivel.startsWith(nivel));
      return false;
    });

    const fieldKey = activeField === "bairro" ? "bairro" : activeField === "rua" ? "rua" : activeField === "bloco" ? "bloco" : "nivel";
    const unique = [...new Set(filtered.map(a => a[fieldKey]))].sort();
    return unique.slice(0, 8);
  }, [activeField, bairro, rua, bloco, nivel, availableAddresses]);

  useEffect(() => {
    setHighlightIndex(-1);
  }, [suggestions]);

  const selectSuggestion = (val: string) => {
    if (activeField === "bairro") { setBairro(val); ruaRef.current?.focus(); }
    else if (activeField === "rua")   { setRua(val);   blocoRef.current?.focus(); }
    else if (activeField === "bloco") { setBloco(val); nivelRef.current?.focus(); }
    else if (activeField === "nível") { setNivel(val); }
    setActiveField(null);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    fieldName: string,
    nextRef: React.RefObject<HTMLInputElement> | null
  ) => {
    // Navega sugestões com setas
    if (suggestions.length > 0 && activeField === fieldName) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex(prev => Math.min(prev + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex(prev => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" && highlightIndex >= 0) {
        e.preventDefault();
        selectSuggestion(suggestions[highlightIndex]);
        return;
      }
      if (e.key === "Tab" && suggestions.length === 1 && nextRef) {
        e.preventDefault();
        selectSuggestion(suggestions[0]);
        return;
      }
    }

    // Enter avança para o próximo campo (comportamento de bipe de QR code)
    if (e.key === "Enter") {
      e.preventDefault();
      if (nextRef) {
        nextRef.current?.focus();
      } else {
        // Último campo (Nível) — fecha sugestões e perde foco
        setActiveField(null);
        nivelRef.current?.blur();
      }
    }

    if (e.key === "Escape") {
      setActiveField(null);
    }
  };

  const fieldClass = "text-center font-bold text-lg h-12";

  const fields = [
    { label: addrLabels.bairro, name: "bairro", ref: bairroRef, value: bairro, set: setBairro, next: ruaRef },
    { label: addrLabels.rua,    name: "rua",    ref: ruaRef,    value: rua,    set: setRua,    next: blocoRef },
    { label: addrLabels.bloco,  name: "bloco",  ref: blocoRef,  value: bloco,  set: setBloco,  next: nivelRef },
    { label: addrLabels.nivel,  name: "nível",  ref: nivelRef,  value: nivel,  set: setNivel,  next: null },
  ];

  return (
    <div className="space-y-3 p-4 border rounded-xl bg-muted/20">
      {/* Cabeçalho: rótulo + botão de teclado */}
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-primary font-semibold">
          <MapPin className="h-4 w-4" /> {label || "Endereço de Destino"}
        </Label>
        <div className="flex items-center gap-2">
          {/* Status do endereço */}
          {currentMatch ? (
            <span className="text-xs font-bold text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> {currentMatch.code}
            </span>
          ) : (
            (bairro || rua || bloco || nivel) && (
              <span className="text-xs font-bold text-red-500 flex items-center gap-1">
                <XCircle className="h-3.5 w-3.5" /> Não encontrado
              </span>
            )
          )}

          {/* Toggle de teclado virtual */}
          <Button
            type="button"
            variant={keyboardEnabled ? "default" : "outline"}
            size="sm"
            className="h-7 w-7 p-0"
            title={keyboardEnabled ? "Desativar teclado" : "Ativar teclado"}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              flushSync(() => setKeyboardEnabled(k => !k));
              bairroRef.current?.blur();
              bairroRef.current?.focus();
            }}
            data-testid="btn-toggle-keyboard-address"
          >
            <Keyboard className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Campos BAIRRO / RUA / BLOCO / NÍVEL */}
      <div className="grid grid-cols-4 gap-2">
        {fields.map(({ label: fieldLabel, name, ref, value: val, set, next }) => (
          <div key={fieldLabel} className="space-y-1 relative">
            <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">{fieldLabel}</Label>
            <Input
              ref={ref}
              placeholder=""
              value={val}
              inputMode={keyboardEnabled ? "text" : "none"}
              onChange={e => set(alphaNumOnly(e.target.value))}
              className={fieldClass}
              onFocus={() => setActiveField(name)}
              onBlur={() => setTimeout(() => setActiveField(prev => prev === name ? null : prev), 150)}
              onKeyDown={e => handleKeyDown(e, name, next)}
              data-testid={`input-address-${fieldLabel.toLowerCase()}`}
            />
            {/* Sugestões de autocomplete */}
            {activeField === name && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute z-50 top-full mt-1 w-full bg-popover border rounded-md shadow-lg max-h-40 overflow-y-auto"
                data-testid={`suggestions-${name}`}
              >
                {suggestions.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    className={`w-full text-center text-sm py-1.5 px-2 cursor-pointer transition-colors ${
                      i === highlightIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                    }`}
                    onMouseDown={e => { e.preventDefault(); selectSuggestion(s); }}
                    data-testid={`suggestion-${name}-${s}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        Bipe o endereço — Enter avança ao próximo campo &nbsp;·&nbsp;
        <button
          type="button"
          className="underline underline-offset-2 hover:text-foreground transition-colors"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => { flushSync(() => setKeyboardEnabled(k => !k)); bairroRef.current?.blur(); bairroRef.current?.focus(); }}
        >
          {keyboardEnabled ? "desativar teclado" : "ativar teclado"}
        </button>
      </p>

      {occupiedWarning && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-700 dark:text-amber-400">{occupiedWarning}</span>
        </div>
      )}

      {(bairro || rua || bloco || nivel) && (
        <Button variant="ghost" size="sm" className="w-full text-xs h-7 text-muted-foreground" onClick={clearAll}>
          Limpar endereço
        </Button>
      )}
    </div>
  );
}
