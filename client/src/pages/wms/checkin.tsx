import { useState, useRef } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, MapPin, Loader2, Package, CheckCircle, Trash2, Ban, Search, X, Clock, Save, Keyboard, PackagePlus } from "lucide-react";
import { useLocation } from "wouter";
import { AddressPicker } from "@/components/wms/address-picker";
import { PalletItemList } from "@/components/wms/pallet-item-list";
import { useProductStockBatch } from "@/hooks/use-product-stock";

export default function CheckinPage() {
  const [, navigate] = useLocation();
  const { companyId, companiesData } = useAuth();
  const { toast } = useToast();
  const [scanInput, setScanInput] = useState("");
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const [selectedPallet, setSelectedPallet] = useState<any>(null);
  const [editableItems, setEditableItems] = useState<any[]>([]);
  const [itemsChanged, setItemsChanged] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [filterText, setFilterText] = useState("");
  const [showAllocateConfirm, setShowAllocateConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState<string | null>(null);

  const { data: palletsWithoutAddress = [] } = useQuery({
    queryKey: ["pallets-no-address", companyId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/pallets?status=sem_endereco");
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: allAddresses = [] } = useQuery({
    queryKey: ["all-addresses", companyId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/wms-addresses");
      return res.json();
    },
    enabled: !!companyId,
  });

  const { data: addressOccupants = [] } = useQuery({
    queryKey: ["pallets-by-address", selectedAddress],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/pallets/by-address/${selectedAddress}`);
      return res.json();
    },
    enabled: !!selectedAddress,
  });

  const loadPallet = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    const pallet = palletsWithoutAddress.find((p: any) => p.code === trimmed || p.id === trimmed);
    if (pallet) {
      const res = await apiRequest("GET", `/api/pallets/${pallet.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedPallet(data);
        setEditableItems(data.items?.map((i: any) => ({ ...i })) || []);
        setItemsChanged(false);
        setScanInput("");
        setSelectedAddress("");
      }
    } else {
      toast({ title: "Pallet nao encontrado", description: "Verifique se o pallet esta pendente", variant: "destructive" });
    }
  };

  const updateItemQty = (idx: number, delta: number) => {
    setEditableItems(prev => prev.map((item, i) => i === idx ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item));
    setItemsChanged(true);
  };

  const removeItemFromPallet = (idx: number) => {
    setEditableItems(prev => prev.filter((_, i) => i !== idx));
    setItemsChanged(true);
  };

  const saveItemsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/pallets/${selectedPallet.id}`, {
        items: editableItems.map(i => ({
          productId: i.productId || i.product?.id,
          quantity: i.quantity,
          lot: i.lot,
          expiryDate: i.expiryDate,
        })),
      });
      return res.json();
    },
    onSuccess: async () => {
      setItemsChanged(false);
      const res = await apiRequest("GET", `/api/pallets/${selectedPallet.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedPallet(data);
        setEditableItems(data.items?.map((i: any) => ({ ...i })) || []);
      }
      queryClient.invalidateQueries({ queryKey: ["pallets"] });
      toast({ title: "Itens atualizados" });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const allocateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPallet || !selectedAddress) throw new Error("Selecione pallet e endereco");
      const res = await apiRequest("POST", `/api/pallets/${selectedPallet.id}/allocate`, { addressId: selectedAddress });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao alocar");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pallets"] });
      queryClient.invalidateQueries({ queryKey: ["pallets-by-address"] });
      queryClient.invalidateQueries({ queryKey: ["all-addresses"] });
      queryClient.invalidateQueries({ queryKey: ["pallets-no-address"] });
      toast({ title: addressOccupied ? "Produtos transferidos com sucesso!" : "Pallet alocado com sucesso!" });
      setSelectedPallet(null);
      setEditableItems([]);
      setSelectedAddress("");
      setShowAllocateConfirm(false);
    },
    onError: (e: Error) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
      setShowAllocateConfirm(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (palletId: string) => {
      const res = await apiRequest("POST", `/api/pallets/${palletId}/cancel-unaddressed`, { reason: "Cancelado pelo operador no Check-in" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao cancelar");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pallets-no-address"] });
      toast({ title: "Pallet cancelado" });
      setSelectedPallet(null);
      setEditableItems([]);
      setShowCancelConfirm(null);
    },
    onError: (e: Error) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
      setShowCancelConfirm(null);
    },
  });

  const toggleKeyboard = () => {
    setKeyboardEnabled(v => !v);
    if (scanInputRef.current) {
      scanInputRef.current.blur();
      setTimeout(() => scanInputRef.current?.focus(), 100);
    }
  };

  const itemProductIds = editableItems.map((i: any) => i.productId || i.product?.id).filter(Boolean);
  const { data: stockInfoMap = {} } = useProductStockBatch(itemProductIds);

  const selectedAddressObj = selectedAddress ? allAddresses.find((a: any) => a.id === selectedAddress) : null;
  const occupantPallet = addressOccupants.find((p: any) => p.id !== selectedPallet?.id) || null;
  const addressOccupied = !!occupantPallet;
  const filteredPallets = filterText
    ? palletsWithoutAddress.filter((p: any) => p.code?.toLowerCase().includes(filterText.toLowerCase()))
    : palletsWithoutAddress;

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Check-in</h1>
            <p className="text-xs text-muted-foreground">{companyId ? (companiesData?.find(c => c.id === companyId)?.name || "WMS") : "WMS"}</p>
          </div>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-3 safe-bottom">
        <div className="rounded-2xl border border-border/50 bg-card p-4 animate-fade-in">
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <PackagePlus className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                <Input
                  ref={scanInputRef}
                  placeholder="Escanear pallet..."
                  value={scanInput}
                  onChange={e => setScanInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && loadPallet(scanInput)}
                  className="pl-10 pr-12 h-12 rounded-xl text-sm font-mono"
                  inputMode={keyboardEnabled ? "text" : "none"}
                  autoFocus
                  data-testid="input-scan-checkin"
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
              <Button className="h-12 px-4 rounded-xl shrink-0" onClick={() => loadPallet(scanInput)} disabled={!scanInput.trim()} data-testid="button-search-checkin">
                <Search className="h-4 w-4" />
              </Button>
            </div>
            {!keyboardEnabled && (
              <p className="text-[10px] text-muted-foreground text-center mt-1">
                Bipe o pallet ou toque <Keyboard className="h-3 w-3 inline" /> para digitar
              </p>
            )}
          </div>
        </div>

        {!selectedPallet && palletsWithoutAddress.length > 0 && (
          <div className="rounded-2xl border border-border/50 bg-card overflow-hidden animate-slide-up">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Pendentes</span>
                <Badge variant="secondary" className="text-[10px] font-bold h-5 px-1.5">{palletsWithoutAddress.length}</Badge>
              </div>
              {palletsWithoutAddress.length > 5 && (
                <div className="relative w-32">
                  <Input placeholder="Filtrar..." value={filterText} onChange={e => setFilterText(e.target.value)} className="h-7 text-xs rounded-lg pl-2 pr-6" data-testid="input-filter-checkin" />
                  {filterText && (
                    <button className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setFilterText("")} data-testid="button-clear-filter">
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="divide-y divide-border/30 max-h-[50vh] overflow-y-auto">
              {filteredPallets.map((p: any) => (
                <button
                  key={p.id}
                  className="w-full flex items-center gap-3 px-4 py-3 active:bg-muted/50 transition-colors text-left"
                  onClick={() => loadPallet(p.code)}
                  data-testid={`checkin-pallet-${p.id}`}
                >
                  <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center shrink-0">
                    <Package className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono font-semibold text-sm truncate">{p.code}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                      <span>{p.items?.length || 0} itens</span>
                      <span className="flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        {new Date(p.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0 border-amber-200 text-amber-600 dark:border-amber-800 dark:text-amber-400">Aguardando</Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedPallet && (
          <div className="space-y-3 animate-slide-up">
            <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <span className="font-mono font-bold text-sm">{selectedPallet.code}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {itemsChanged && (
                    <Button size="sm" variant="outline" className="h-7 text-[11px] rounded-lg" onClick={() => saveItemsMutation.mutate()} disabled={saveItemsMutation.isPending} data-testid="button-save-items">
                      {saveItemsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                      Salvar
                    </Button>
                  )}
                  <Badge variant="outline" className="text-[10px]">Sem Endereco</Badge>
                </div>
              </div>

              <PalletItemList
                items={editableItems}
                mode="edit"
                onEditDelta={updateItemQty}
                onRemoveItem={removeItemFromPallet}
                stockInfoMap={stockInfoMap}
                showStockLegend
              />
            </div>

            <div className="rounded-2xl border border-border/50 bg-card p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-3 tracking-wider">Endereco de destino</p>
              <AddressPicker
                availableAddresses={allAddresses}
                onAddressSelect={setSelectedAddress}
                onClear={() => setSelectedAddress("")}
                occupiedWarning={addressOccupied ? `Endereço ocupado pelo pallet ${occupantPallet?.code || ""}. Os produtos serão transferidos para o pallet existente.` : undefined}
              />

              {selectedAddress && selectedAddressObj && (
                <div className="flex items-center gap-2 mt-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40">
                  <MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-sm text-emerald-700 dark:text-emerald-300">Alocar em</span>
                  <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">{selectedAddressObj.code}</span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => { setSelectedPallet(null); setEditableItems([]); }} data-testid="button-back-checkin">
                Voltar
              </Button>
              <Button variant="destructive" className="h-12 rounded-xl px-4" onClick={() => setShowCancelConfirm(selectedPallet.id)} disabled={cancelMutation.isPending} data-testid="button-cancel-pallet">
                <Ban className="h-4 w-4" />
              </Button>
            </div>

            <Button
              className={`w-full h-14 text-sm font-semibold rounded-xl shadow-lg active:scale-[0.98] transition-all ${addressOccupied ? "bg-amber-600 hover:bg-amber-700 shadow-amber-600/15" : "shadow-primary/15"}`}
              onClick={() => setShowAllocateConfirm(true)}
              disabled={!selectedAddress || allocateMutation.isPending || itemsChanged}
              data-testid="button-allocate"
            >
              {allocateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
              {itemsChanged ? "Salve as alteracoes primeiro" : addressOccupied ? "Transferir Produtos" : "Alocar Pallet"}
            </Button>
          </div>
        )}
      </main>

      <Dialog open={showAllocateConfirm} onOpenChange={setShowAllocateConfirm}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{addressOccupied ? "Transferir Produtos" : "Confirmar Alocação"}</DialogTitle>
            <DialogDescription>
              {addressOccupied ? (
                <>
                  O endereço <span className="font-mono font-semibold">{selectedAddressObj?.code}</span> já possui o pallet <span className="font-mono font-semibold">{occupantPallet?.code}</span>.
                  Os produtos do pallet <span className="font-mono font-semibold">{selectedPallet?.code}</span> serão transferidos para o pallet existente.
                </>
              ) : (
                <>
                  Alocar <span className="font-mono font-semibold">{selectedPallet?.code}</span>
                  {selectedAddressObj && <> em <span className="font-mono font-semibold">{selectedAddressObj.code}</span></>}?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAllocateConfirm(false)} className="rounded-xl" data-testid="button-cancel-allocate">Cancelar</Button>
            <Button onClick={() => allocateMutation.mutate()} disabled={allocateMutation.isPending} className={`rounded-xl ${addressOccupied ? "bg-amber-600 hover:bg-amber-700" : ""}`} data-testid="button-confirm-allocate">
              {allocateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
              {addressOccupied ? "Transferir" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showCancelConfirm} onOpenChange={open => !open && setShowCancelConfirm(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Cancelar Pallet</DialogTitle>
            <DialogDescription>Tem certeza que deseja cancelar este pallet?</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCancelConfirm(null)} className="rounded-xl" data-testid="button-cancel-cancel">Voltar</Button>
            <Button variant="destructive" onClick={() => showCancelConfirm && cancelMutation.mutate(showCancelConfirm)} disabled={cancelMutation.isPending} className="rounded-xl" data-testid="button-confirm-cancel-pallet">
              {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
