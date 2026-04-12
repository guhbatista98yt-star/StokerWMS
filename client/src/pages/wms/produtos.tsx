import { useState, useRef, useCallback, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Search, Loader2, Package, Barcode, Hash, Type, X, MapPin, Clock, AlertTriangle, TrendingUp, TrendingDown, Keyboard } from "lucide-react";
import { useLocation } from "wouter";
import { ProductStockInfo, StockLegend } from "@/components/wms/product-stock-info";

export default function ProdutosPage() {
  const [, navigate] = useLocation();
  const { companyId, companiesData } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchType, setSearchType] = useState("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 350);
  }, []);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const clearSearch = () => {
    setSearchQuery("");
    setDebouncedQuery("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setDebouncedQuery(searchQuery);
    }
  };

  const minLength = searchType === "code" ? 1 : 2;

  const { data: products = [], isLoading, isFetching, isError } = useQuery({
    queryKey: ["products-search", debouncedQuery, companyId, searchType],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/products/search?q=${encodeURIComponent(debouncedQuery)}&type=${searchType}`);
      return res.json();
    },
    enabled: !!companyId && debouncedQuery.length >= minLength,
    retry: 1,
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
    } catch { return null; }
  };

  const searchTypes = [
    { value: "all", label: "Tudo", icon: Search },
    { value: "code", label: "Codigo", icon: Hash },
    { value: "description", label: "Descricao", icon: Type },
  ];

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Produtos</h1>
            <p className="text-xs text-muted-foreground">{companyId ? (companiesData?.find(c => c.id === companyId)?.name || "WMS") : "WMS"}</p>
          </div>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-3 safe-bottom">
        <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-3 animate-fade-in">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
            <Input
              ref={inputRef}
              placeholder={
                searchType === "code" ? "Codigo ERP exato..." :
                searchType === "description" ? "Buscar por descricao..." :
                "Nome, codigo ou barras..."
              }
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-10 pr-20 h-12 rounded-xl text-sm"
              inputMode={keyboardEnabled ? "text" : "none"}
              autoFocus
              data-testid="input-product-search"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchQuery && (
                <button onClick={clearSearch} data-testid="button-clear-search">
                  {isFetching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <X className="h-4 w-4 text-muted-foreground" />}
                </button>
              )}
              <Button
                variant={keyboardEnabled ? "default" : "ghost"}
                size="sm"
                className="h-8 w-8 p-0 rounded-lg"
                onClick={() => {
                  setKeyboardEnabled(v => !v);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                data-testid="button-keyboard-toggle"
              >
                <Keyboard className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {!keyboardEnabled && (
            <p className="text-[10px] text-muted-foreground text-center">
              Bipe o produto ou toque <Keyboard className="h-3 w-3 inline" /> para digitar
            </p>
          )}

          <div className="flex rounded-xl border bg-muted/30 p-1 gap-1">
            {searchTypes.map(st => {
              const Icon = st.icon;
              return (
                <button
                  key={st.value}
                  onClick={() => { setSearchType(st.value); setSearchQuery(""); setDebouncedQuery(""); inputRef.current?.focus(); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                    searchType === st.value ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
                  }`}
                  data-testid={`tab-search-${st.value}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {st.label}
                </button>
              );
            })}
          </div>

          {searchType === "code" && (
            <p className="text-[11px] text-muted-foreground text-center bg-blue-50 dark:bg-blue-950/30 rounded-xl px-3 py-2">
              Busca pelo codigo ERP <strong>exato</strong>
            </p>
          )}
        </div>

        {searchQuery.length > 0 && searchQuery.length < minLength && (
          <p className="text-xs text-muted-foreground text-center py-2">
            {searchType === "code" ? "Digite o codigo ERP" : "Min. 2 caracteres"}
          </p>
        )}

        {isLoading && debouncedQuery.length >= minLength && (
          <div className="flex items-center justify-center py-10 animate-fade-in">
            <Loader2 className="h-6 w-6 animate-spin text-primary/50" />
          </div>
        )}

        {isError && debouncedQuery.length >= minLength && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/40 animate-fade-in">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400">Erro ao buscar produtos. Verifique a conexão.</p>
          </div>
        )}

        {!isLoading && !isError && debouncedQuery.length >= minLength && products.length === 0 && (
          <div className="text-center py-12 text-muted-foreground animate-fade-in">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-muted flex items-center justify-center">
              <Package className="h-7 w-7 opacity-30" />
            </div>
            <p className="text-sm font-medium">Nenhum produto</p>
            <p className="text-xs mt-0.5 opacity-70">"{debouncedQuery}"</p>
          </div>
        )}

        {products.length > 0 && (
          <div className="space-y-2 animate-slide-up">
            <div className="flex items-center justify-between px-1">
              <p className="text-xs text-muted-foreground">
                {products.length} resultado{products.length !== 1 ? "s" : ""}
              </p>
              <StockLegend />
            </div>
            <div className="rounded-2xl border border-border/50 bg-card overflow-hidden divide-y divide-border/30">
              {products.map((p: any) => (
                <div key={p.id} className={`px-4 py-3 ${p.hasNoAddress ? "border-l-[3px] border-l-amber-400" : ""}`} data-testid={`row-product-${p.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm leading-tight">{p.name}</h3>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-0.5 text-primary font-semibold">
                          <Package className="h-2.5 w-2.5" />
                          <span className="font-mono">{p.erpCode}</span>
                        </span>
                        {p.barcode && (
                          <span className="flex items-center gap-0.5">
                            <Barcode className="h-2.5 w-2.5" />
                            <span className="font-mono">{p.barcode}</span>
                          </span>
                        )}
                        <span>S: {p.section}</span>
                        {p.manufacturer && <span>F: {p.manufacturer}</span>}
                        {p.lastMovementDate && (
                          <span className="flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" />
                            {formatDate(p.lastMovementDate)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 text-right space-y-1">
                      {p.hasNoAddress && (
                        <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-2 w-2 mr-0.5" />Sem end.
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Blocos Real / Pallet / Pick */}
                  {(() => {
                    const pal = Number(p.palletizedStock || 0);
                    const pick = Number(p.pickingStock || 0);
                    const real = Number(p.totalStock || 0);
                    const diff = (pal + pick) - real;
                    return (
                      <div className="mt-2 space-y-1.5">
                        <div className="grid grid-cols-3 gap-1.5">
                          <div className="flex flex-col items-center rounded-lg bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-2 py-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-none mb-0.5">Real</span>
                            <span className="font-mono font-bold text-base leading-none text-slate-800 dark:text-slate-100" data-testid={`text-real-${p.id}`}>{real.toLocaleString("pt-BR")}</span>
                          </div>
                          <div className="flex flex-col items-center rounded-lg bg-violet-100 dark:bg-violet-900/40 border border-violet-200 dark:border-violet-800 px-2 py-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400 leading-none mb-0.5">Pallet</span>
                            <span className="font-mono font-bold text-base leading-none text-violet-700 dark:text-violet-300" data-testid={`text-pallet-${p.id}`}>{pal.toLocaleString("pt-BR")}</span>
                          </div>
                          <div className="flex flex-col items-center rounded-lg bg-orange-100 dark:bg-orange-900/40 border border-orange-200 dark:border-orange-800 px-2 py-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 leading-none mb-0.5">Pick</span>
                            <span className="font-mono font-bold text-base leading-none text-orange-700 dark:text-orange-300" data-testid={`text-pick-${p.id}`}>{pick.toLocaleString("pt-BR")}</span>
                          </div>
                        </div>
                        {diff !== 0 && (
                          <div className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                            diff > 0
                              ? "bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/40 text-red-700 dark:text-red-400"
                              : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-amber-700 dark:text-amber-400"
                          }`} data-testid={`badge-diff-${p.id}`}>
                            {diff > 0 ? <TrendingUp className="h-3 w-3 shrink-0" /> : <TrendingDown className="h-3 w-3 shrink-0" />}
                            {diff > 0
                              ? `Excesso: Real ${real} | PAL ${pal} + PICK ${pick} = ${pal + pick} (+${diff} ${p.unit})`
                              : `Falta: Real ${real} | PAL ${pal} + PICK ${pick} = ${pal + pick} (${diff} ${p.unit})`
                            }
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {p.addresses && p.addresses.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-dashed border-border/30">
                      <p className="text-[9px] font-bold text-muted-foreground uppercase mb-1.5 flex items-center gap-0.5">
                        <MapPin className="h-2.5 w-2.5" /> Endereços ({p.addresses.length})
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {p.addresses.map((addr: any, i: number) => (
                          <div key={i} className="flex items-center gap-1 bg-muted/40 rounded-lg px-2 py-1 text-[11px] border border-border/30">
                            <span className="font-bold">{addr.code}</span>
                            <span className="text-border">|</span>
                            <span className="font-mono font-bold text-primary">{Number(addr.quantity).toLocaleString("pt-BR")}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {debouncedQuery.length < minLength && products.length === 0 && !isLoading && (
          <div className="text-center py-16 text-muted-foreground animate-fade-in">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted flex items-center justify-center">
              <Search className="h-8 w-8 opacity-20" />
            </div>
            <p className="text-sm font-medium">Buscar Produtos</p>
            <p className="text-xs mt-1 opacity-70">
              {searchType === "code" ? "Digite o codigo ERP exato" : "Nome, codigo ou barras"}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
