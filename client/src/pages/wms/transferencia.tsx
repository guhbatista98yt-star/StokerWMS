import { useState } from "react";
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
import { ArrowLeft, ArrowRightLeft, MapPin, Loader2, Ban, Package, ArrowRight, RotateCcw } from "lucide-react";
import { useLocation } from "wouter";
import { AddressPicker } from "@/components/wms/address-picker";
import { PalletFinder } from "@/components/wms/pallet-finder";
import { PalletItemList } from "@/components/wms/pallet-item-list";
import { useProductStockBatch } from "@/hooks/use-product-stock";

export default function TransferenciaPage() {
  const [, navigate] = useLocation();
  const { user, companyId, companiesData } = useAuth();
  const { toast } = useToast();

  const [palletDetail, setPalletDetail] = useState<any>(null);
  const [toAddressId, setToAddressId] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [showTransferConfirm, setShowTransferConfirm] = useState(false);
  const [transferMode, setTransferMode] = useState<"full" | "partial">("full");
  const [selectedItems, setSelectedItems] = useState<Map<string, number>>(new Map());

  const { data: availableAddresses = [] } = useQuery({
    queryKey: ["available-addresses", companyId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/wms-addresses/available");
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

  const detailProductIds = palletDetail?.items?.map((i: any) => i.productId || i.product?.id).filter(Boolean) || [];
  const { data: stockInfoMap = {} } = useProductStockBatch(detailProductIds);

  const handlePartialQtyChange = (key: string, value: number, max: number) => {
    setSelectedItems(prev => {
      const next = new Map(prev);
      const clamped = Math.max(0, Math.min(max, value));
      if (clamped === 0) next.delete(key);
      else next.set(key, clamped);
      return next;
    });
  };

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (transferMode === "full") {
        const res = await apiRequest("POST", `/api/pallets/${palletDetail.id}/transfer`, { toAddressId });
        if (!res.ok) { const data = await res.json(); throw new Error(data.error || "Erro"); }
        return res.json();
      } else {
        const items = Array.from(selectedItems.entries())
          .filter(([, qty]) => qty > 0)
          .map(([productId, quantity]) => ({ productId, quantity }));
        if (items.length === 0) throw new Error("Selecione ao menos um item");
        const res = await apiRequest("POST", `/api/pallets/${palletDetail.id}/partial-transfer`, { items, toAddressId });
        if (!res.ok) { const data = await res.json(); throw new Error(data.error || "Erro"); }
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pallets"] });
      queryClient.invalidateQueries({ queryKey: ["available-addresses"] });
      queryClient.invalidateQueries({ queryKey: ["pallets-by-address"] });
      queryClient.invalidateQueries({ queryKey: ["all-addresses"] });
      toast({ title: "Transferência realizada!" });
      handleReset();
      setShowTransferConfirm(false);
    },
    onError: (e: Error) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
      setShowTransferConfirm(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/pallets/${palletDetail.id}/cancel`, { reason: cancelReason });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Erro ao cancelar" }));
        throw new Error(data.error || "Erro ao cancelar pallet");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pallets"] });
      queryClient.invalidateQueries({ queryKey: ["pallets-by-address"] });
      toast({ title: "Pallet cancelado" });
      handleReset();
    },
    onError: (e: Error) => toast({ title: "Erro ao cancelar", description: e.message, variant: "destructive" }),
  });

  const handleReset = () => {
    setPalletDetail(null);
    setToAddressId("");
    setCancelReason("");
    setShowCancel(false);
    setTransferMode("full");
    setSelectedItems(new Map());
  };

  const isSupervisor = user?.role === "supervisor" || user?.role === "administrador";

  const sourceAddress = palletDetail?.address || (palletDetail?.addressId ? allAddresses.find((a: any) => a.id === palletDetail.addressId) : null);
  const destinationAddress = toAddressId ? availableAddresses.find((a: any) => a.id === toAddressId) : null;
  const totalSelected = Array.from(selectedItems.values()).reduce((acc, v) => acc + v, 0);
  const canTransfer = !!toAddressId && (transferMode === "full" || totalSelected > 0);

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-base font-semibold text-foreground leading-tight">Transferência</h1>
          <p className="text-xs text-muted-foreground">{companyId ? (companiesData?.find(c => c.id === companyId)?.name || "WMS") : "WMS"}</p>
        </div>
        {palletDetail && (
          <Button variant="ghost" size="sm" className="h-8 text-xs rounded-lg" onClick={handleReset} data-testid="button-reset">
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Trocar
          </Button>
        )}
      </div>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-3 safe-bottom">
        {!palletDetail ? (
          <PalletFinder
            onPalletSelected={(pallet) => {
              setPalletDetail(pallet);
              setTransferMode("full");
              setSelectedItems(new Map());
            }}
            statusFilter="alocado"
            showAddressMode={true}
            defaultMode="address"
            label="Localizar pallet para transferir"
          />
        ) : (
          <div className="space-y-3 animate-slide-up">
            <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <span className="font-mono font-bold text-sm">{palletDetail.code}</span>
                </div>
                <Badge variant="outline" className="text-[10px]">{palletDetail.status}</Badge>
              </div>

              {sourceAddress && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/20 border-b border-border/30">
                  <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-xs text-muted-foreground">Origem:</span>
                  <span className="font-mono font-bold text-xs text-primary">{sourceAddress.code}</span>
                </div>
              )}

              {palletDetail.items && palletDetail.items.length > 0 && palletDetail.status === "alocado" && (
                <>
                  <div className="flex mx-3 mt-3 rounded-xl border bg-muted/30 p-1 gap-1">
                    <button
                      onClick={() => { setTransferMode("full"); setSelectedItems(new Map(palletDetail.items.map((i: any) => [i.productId, i.quantity]))); }}
                      className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${transferMode === "full" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
                      data-testid="tab-full-transfer"
                    >
                      Tudo
                    </button>
                    <button
                      onClick={() => { setTransferMode("partial"); setSelectedItems(new Map()); }}
                      className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${transferMode === "partial" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
                      data-testid="tab-partial-transfer"
                    >
                      Parcial
                    </button>
                  </div>

                  <PalletItemList
                    items={palletDetail.items}
                    mode={transferMode === "partial" ? "partial" : "view"}
                    quantities={selectedItems}
                    onQuantityChange={handlePartialQtyChange}
                    stockInfoMap={stockInfoMap}
                    showStockLegend
                    quantityKeyField="productId"
                  />

                  {transferMode === "partial" && totalSelected > 0 && (
                    <div className="px-4 py-2 bg-primary/5 border-t border-border/30">
                      <p className="text-xs text-primary font-semibold text-right">{totalSelected} un selecionadas</p>
                    </div>
                  )}
                </>
              )}

              {palletDetail.status === "sem_endereco" && (
                <div className="p-4 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">
                  Este pallet não foi alocado. Use o Check-in primeiro.
                </div>
              )}
            </div>

            {palletDetail.status === "alocado" && (
              <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Destino</p>
                <AddressPicker
                  availableAddresses={availableAddresses}
                  onAddressSelect={setToAddressId}
                  onClear={() => setToAddressId("")}
                />

                {toAddressId && destinationAddress && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40">
                    <ArrowRight className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="text-sm text-blue-700 dark:text-blue-300">Transferir para</span>
                    <span className="font-mono font-bold text-blue-700 dark:text-blue-300">{destinationAddress.code}</span>
                  </div>
                )}

                <Button
                  className="w-full h-14 text-sm font-semibold rounded-xl shadow-lg shadow-primary/15 active:scale-[0.98] transition-all"
                  onClick={() => setShowTransferConfirm(true)}
                  disabled={!canTransfer || transferMutation.isPending}
                  data-testid="button-transfer"
                >
                  {transferMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRightLeft className="h-4 w-4 mr-2" />}
                  {transferMode === "partial" ? `Transferir ${totalSelected} un` : "Transferir Pallet"}
                </Button>
              </div>
            )}

            {isSupervisor && palletDetail.status !== "cancelado" && (
              <>
                <Button
                  variant="destructive"
                  className="w-full h-11 rounded-xl"
                  onClick={() => { setShowCancel(!showCancel); setCancelReason(""); }}
                  data-testid="button-show-cancel"
                >
                  <Ban className="h-4 w-4 mr-1.5" /> Cancelar Pallet
                </Button>

                {showCancel && (
                  <div className="space-y-2 p-4 rounded-2xl border border-destructive/20 bg-destructive/5">
                    <Input
                      placeholder="Motivo (min. 3 caracteres)"
                      value={cancelReason}
                      onChange={e => setCancelReason(e.target.value)}
                      className="h-11 rounded-xl"
                      data-testid="input-cancel-reason"
                    />
                    <Button
                      variant="destructive"
                      className="w-full h-11 rounded-xl"
                      onClick={() => cancelMutation.mutate()}
                      disabled={cancelMutation.isPending || cancelReason.trim().length < 3}
                      data-testid="button-confirm-cancel"
                    >
                      {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Ban className="h-4 w-4 mr-2" />}
                      Confirmar Cancelamento
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      <Dialog open={showTransferConfirm} onOpenChange={setShowTransferConfirm}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Confirmar Transferência</DialogTitle>
            <DialogDescription>
              {transferMode === "full"
                ? <>Transferir pallet <span className="font-mono font-semibold">{palletDetail?.code}</span></>
                : <>Transferir <span className="font-semibold">{totalSelected} un</span> do pallet <span className="font-mono font-semibold">{palletDetail?.code}</span></>
              }
              {sourceAddress && <> de <span className="font-mono font-semibold">{sourceAddress.code}</span></>}
              {destinationAddress && <> para <span className="font-mono font-semibold">{destinationAddress.code}</span></>}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowTransferConfirm(false)} className="rounded-xl" data-testid="button-cancel-transfer">Cancelar</Button>
            <Button onClick={() => transferMutation.mutate()} disabled={transferMutation.isPending} className="rounded-xl" data-testid="button-confirm-transfer">
              {transferMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRightLeft className="h-4 w-4 mr-2" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
