import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, Search, Package, BarChart2, Keyboard, X, Barcode as BarcodeIcon, MapPin as MapPinIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StockQuerySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: number | null | undefined;
  /** Quando false, esconde o botão e bloqueia o teclado virtual. */
  manualInputAllowed?: boolean;
}

interface StockProduct {
  id: string;
  name: string;
  erpCode: string;
  barcode?: string;
  manufacturer?: string;
  unit?: string;
  totalStock?: number;
  addresses?: { code: string; quantity: number }[];
}

export function StockQuerySheet({ open, onOpenChange, companyId, manualInputAllowed = true }: StockQuerySheetProps) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  // nativeKbdActive=true → inputMode "text" para o SO abrir o teclado nativo do dispositivo.
  const [nativeKbdActive, setNativeKbdActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: products = [], isLoading } = useQuery<StockProduct[]>({
    queryKey: [`/api/products/search?q=${encodeURIComponent(debounced)}`, companyId],
    enabled: !!companyId && debounced.length >= 2,
  });

  // Reset ao fechar
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebounced("");
      setNativeKbdActive(false);
    } else {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  const toggleNativeKbd = () => {
    const willActivate = !nativeKbdActive;
    // flushSync atualiza o DOM (inputMode) imediatamente, ainda DENTRO do gesto do clique.
    // Necessário para iOS Safari abrir o teclado nativo (sem isso, o focus em setTimeout
    // perde a "user activation" e o teclado não aparece).
    flushSync(() => setNativeKbdActive(willActivate));
    const el = inputRef.current;
    if (!el) return;
    try { el.blur(); } catch {}
    el.focus();
  };

  const handleChange = (v: string) => {
    setQuery(v);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebounced(v), 350);
  };

  const submitNow = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    setDebounced(query);
  };

  const canShowKeyboardToggle = manualInputAllowed;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col" data-scan-exclude="true">
        <SheetHeader className="px-4 py-3 border-b border-border/50 shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <BarChart2 className="h-4 w-4 text-blue-500" />
            Consultar Estoque
          </SheetTitle>
        </SheetHeader>

        {/* Barra de busca */}
        <div className="px-3 py-2.5 border-b border-border/30 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
            <input
              ref={inputRef}
              placeholder="Cód. ERP, cód. de barras ou parte do nome..."
              value={query}
              readOnly={!manualInputAllowed}
              onChange={(e) => {
                if (!manualInputAllowed) return;
                handleChange(e.target.value);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") submitNow(); }}
              className="w-full pl-9 pr-16 h-10 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              inputMode={nativeKbdActive ? "text" : "none"}
              autoComplete="off"
              data-scan-exclude="true"
              data-testid="input-stock-search"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {query && (
                <button
                  type="button"
                  className="p-1"
                  onClick={() => { setQuery(""); setDebounced(""); inputRef.current?.focus(); }}
                  data-testid="button-stock-clear"
                  data-scan-exclude="true"
                >
                  {isLoading
                    ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    : <X className="h-4 w-4 text-muted-foreground" />}
                </button>
              )}
              {canShowKeyboardToggle && (
                <button
                  type="button"
                  className={cn(
                    "h-7 w-7 rounded-lg flex items-center justify-center transition-colors",
                    nativeKbdActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                  onClick={toggleNativeKbd}
                  data-testid="button-stock-keyboard"
                  data-scan-exclude="true"
                  title={nativeKbdActive ? "Voltar para modo scanner" : "Abrir teclado do dispositivo"}
                >
                  <Keyboard className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Texto de ajuda profissional */}
          <p className="mt-2 text-[11px] text-muted-foreground leading-snug px-0.5">
            Você pode buscar pelo <span className="font-semibold text-foreground">código ERP exato</span>,
            ler o <span className="font-semibold text-foreground">código de barras</span> com o leitor,
            ou digitar parte do <span className="font-semibold text-foreground">nome do produto</span>.
          </p>
        </div>

        {/* Resultados */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary/50" />
            </div>
          )}

          {!isLoading && debounced.length >= 2 && products.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">Nenhum produto encontrado</p>
              <p className="text-[11px] mt-0.5 opacity-60">"{debounced}"</p>
            </div>
          )}

          {debounced.length < 2 && !isLoading && (
            <div className="text-center py-10 text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm font-medium">Digite pelo menos 2 caracteres</p>
              <p className="text-[11px] mt-1 opacity-60 max-w-[240px] mx-auto leading-snug">
                Os resultados mostram o saldo total e os endereços onde o produto está armazenado.
              </p>
            </div>
          )}

          {products.length > 0 && (
            <div className="divide-y divide-border/40">
              {products.map((p) => {
                const real = Number(p.totalStock || 0);
                const hasStock = real > 0;
                return (
                  <div key={p.id} className="px-3 py-2.5" data-testid={`stock-row-${p.id}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-snug">{p.name}</p>
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                          <span className="text-[11px] font-mono font-bold text-blue-600 dark:text-blue-400">{p.erpCode}</span>
                          {p.barcode && (
                            <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-0.5">
                              <BarcodeIcon className="h-2.5 w-2.5 shrink-0" />{p.barcode}
                            </span>
                          )}
                          {p.manufacturer && <span className="text-[10px] text-muted-foreground">{p.manufacturer}</span>}
                        </div>
                      </div>
                      <div className={cn(
                        "shrink-0 flex flex-col items-center rounded-lg px-2.5 py-1 min-w-[52px]",
                        hasStock
                          ? "bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800"
                          : "bg-muted border border-border/50",
                      )}>
                        <span className={cn(
                          "text-[9px] font-bold uppercase tracking-wide leading-none mb-0.5",
                          hasStock ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
                        )}>Estoque</span>
                        <span className={cn(
                          "font-mono font-extrabold text-base leading-none",
                          hasStock ? "text-green-700 dark:text-green-300" : "text-muted-foreground",
                        )}>{real.toLocaleString("pt-BR")}</span>
                        {p.unit && <span className="text-[9px] text-muted-foreground/70 leading-none mt-0.5">{p.unit}</span>}
                      </div>
                    </div>

                    {p.addresses && p.addresses.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mt-1.5">
                        <MapPinIcon className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                        {p.addresses.map((addr, i) => (
                          <span key={i} className="inline-flex items-center gap-1 bg-muted/60 rounded px-1.5 py-0.5 text-[10px] font-mono border border-border/30">
                            <span className="font-bold text-foreground">{addr.code}</span>
                            <span className="text-muted-foreground/50">·</span>
                            <span className="font-bold text-primary">{Number(addr.quantity).toLocaleString("pt-BR")}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
