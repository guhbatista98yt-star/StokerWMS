import { useState, useRef, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, MapPin, Search, Keyboard } from "lucide-react";
import { AddressPicker } from "./address-picker";
import { useToast } from "@/hooks/use-toast";

interface PalletFinderProps {
  onPalletSelected: (pallet: any) => void;
  statusFilter?: string;
  showAddressMode?: boolean;
  defaultMode?: "code" | "address";
  label?: string;
}

export function PalletFinder({
  onPalletSelected,
  statusFilter,
  showAddressMode = true,
  defaultMode = "code",
  label = "Localizar Pallet",
}: PalletFinderProps) {
  const { companyId } = useAuth();
  const { toast } = useToast();

  const [searchMode, setSearchMode] = useState<"code" | "address">(defaultMode);
  const [codeInput, setCodeInput] = useState("");
  const [addressId, setAddressId] = useState("");
  const [loading, setLoading] = useState(false);
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: allAddresses = [] } = useQuery({
    queryKey: ["all-addresses", companyId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/wms-addresses");
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: addressPallets = [], isLoading: addressPalletsLoading } = useQuery({
    queryKey: ["pallets-by-address", addressId, companyId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pallets/by-address/${addressId}`);
      return res.json();
    },
    enabled: !!addressId && searchMode === "address",
  });

  const searchByCode = useCallback(async () => {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setLoading(true);
    try {
      const url = statusFilter
        ? `/api/pallets/by-code/${encodeURIComponent(code)}?status=${statusFilter}`
        : `/api/pallets/by-code/${encodeURIComponent(code)}`;
      const res = await apiRequest("GET", url);
      if (!res.ok) {
        toast({ title: "Pallet não encontrado", description: "Verifique o código", variant: "destructive" });
        return;
      }
      const pallet = await res.json();
      setCodeInput("");
      onPalletSelected(pallet);
    } catch {
      toast({ title: "Erro ao buscar pallet", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [codeInput, statusFilter, onPalletSelected, toast]);

  const selectPalletFromAddress = useCallback(async (palletId: string) => {
    setLoading(true);
    try {
      const res = await apiRequest("GET", `/api/pallets/${palletId}`);
      if (!res.ok) {
        toast({ title: "Erro ao carregar pallet", variant: "destructive" });
        return;
      }
      const pallet = await res.json();
      onPalletSelected(pallet);
    } catch {
      toast({ title: "Erro ao carregar pallet", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [onPalletSelected, toast]);

  const toggleKeyboard = () => {
    setKeyboardEnabled(v => !v);
    if (inputRef.current) {
      inputRef.current.blur();
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  };

  const filteredPallets = statusFilter
    ? addressPallets.filter((p: any) => p.status === statusFilter)
    : addressPallets;

  return (
    <div className="space-y-3">
      {showAddressMode && (
        <div className="flex gap-2">
          <Button
            variant={searchMode === "code" ? "default" : "outline"}
            size="sm"
            className="flex-1 h-9 rounded-xl text-xs"
            onClick={() => setSearchMode("code")}
            data-testid="button-search-by-code"
          >
            <Search className="h-3.5 w-3.5 mr-1.5" /> Por Código
          </Button>
          <Button
            variant={searchMode === "address" ? "default" : "outline"}
            size="sm"
            className="flex-1 h-9 rounded-xl text-xs"
            onClick={() => setSearchMode("address")}
            data-testid="button-search-by-address"
          >
            <MapPin className="h-3.5 w-3.5 mr-1.5" /> Por Endereço
          </Button>
        </div>
      )}

      {searchMode === "code" ? (
        <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Package className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
              <Input
                ref={inputRef}
                placeholder="Código do pallet (ex: P1-ABC123)"
                value={codeInput}
                onChange={e => setCodeInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && searchByCode()}
                className="pl-10 pr-12 h-12 rounded-xl text-sm font-mono"
                inputMode={keyboardEnabled ? "text" : "none"}
                autoFocus
                data-testid="input-pallet-code"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <Button
                  variant={keyboardEnabled ? "default" : "ghost"}
                  size="sm"
                  className="h-8 w-8 p-0 rounded-lg"
                  onClick={toggleKeyboard}
                  data-testid="button-keyboard-toggle"
                >
                  <Keyboard className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <Button className="h-12 px-4 rounded-xl shrink-0" onClick={searchByCode} disabled={loading || !codeInput.trim()} data-testid="button-search-pallet">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          {!keyboardEnabled && (
            <p className="text-[10px] text-muted-foreground text-center">
              Bipe o pallet ou toque <Keyboard className="h-3 w-3 inline" /> para digitar
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Endereço</p>
            <AddressPicker
              availableAddresses={allAddresses}
              onAddressSelect={setAddressId}
              onClear={() => setAddressId("")}
              value={addressId}
            />
          </div>

          {addressId && (
            <div className="rounded-2xl border border-border/50 bg-card overflow-hidden animate-slide-up">
              <div className="px-4 py-2.5 border-b border-border/30">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Pallets no Endereço</p>
              </div>
              {addressPalletsLoading || loading ? (
                <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
              ) : filteredPallets.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Nenhum pallet neste endereço</p>
              ) : (
                <div className="divide-y divide-border/30 max-h-[40vh] overflow-y-auto">
                  {filteredPallets.map((p: any) => (
                    <button
                      key={p.id}
                      className="w-full flex items-center gap-3 px-4 py-3 active:bg-muted/50 transition-colors text-left"
                      onClick={() => selectPalletFromAddress(p.id)}
                      data-testid={`button-select-pallet-${p.id}`}
                    >
                      <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center shrink-0">
                        <Package className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-mono font-semibold text-sm truncate">{p.code}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {p.itemCount ?? p.items?.length ?? 0} produto(s)
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{p.status}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
