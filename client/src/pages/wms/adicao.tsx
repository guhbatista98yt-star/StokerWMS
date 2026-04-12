import { useState, useRef } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, PackagePlus, MapPin, Loader2, Package, Plus,
  CheckCircle2, Search, ScanBarcode, Keyboard, Trash2, RotateCcw,
} from "lucide-react";
import { useLocation } from "wouter";
import { PalletFinder } from "@/components/wms/pallet-finder";

interface AddItem {
  productId: string;
  productName: string;
  erpCode: string;
  barcode: string;
  quantity: number;
  lot: string;
  expiryDate: string;
}

export default function AdicaoPage() {
  const [, navigate] = useLocation();
  const { companyId } = useAuth();
  const { toast } = useToast();

  const [palletDetail, setPalletDetail] = useState<any>(null);
  const [itemsToAdd, setItemsToAdd] = useState<AddItem[]>([]);
  const [scanInput, setScanInput] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [qtyInput, setQtyInput] = useState("");
  const [lotInput, setLotInput] = useState("");
  const [expiryInput, setExpiryInput] = useState("");
  const [scannedProduct, setScannedProduct] = useState<any>(null);
  const [notes, setNotes] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const handleScan = async () => {
    const code = scanInput.trim();
    if (!code) return;
    setScanLoading(true);
    try {
      let prod = null;
      const res = await apiRequest("GET", `/api/products/by-barcode/${encodeURIComponent(code)}`);
      if (res.ok) {
        prod = await res.json();
      } else {
        const res2 = await apiRequest("GET", `/api/products/by-erp-code/${encodeURIComponent(code)}`);
        if (res2.ok) prod = await res2.json();
      }
      if (!prod) {
        toast({ title: "Produto não encontrado", description: "Verifique o código escaneado", variant: "destructive" });
        return;
      }
      setScannedProduct(prod);
      setScanInput("");
      setTimeout(() => document.getElementById("qty-input")?.focus(), 100);
    } catch {
      toast({ title: "Erro ao buscar produto", variant: "destructive" });
    } finally {
      setScanLoading(false);
    }
  };

  const addScannedItem = () => {
    if (!scannedProduct) return;
    const qty = parseFloat(qtyInput);
    if (isNaN(qty) || qty <= 0) {
      toast({ title: "Quantidade inválida", variant: "destructive" });
      return;
    }

    const existing = itemsToAdd.find(i => i.productId === scannedProduct.id);
    if (existing) {
      setItemsToAdd(prev => prev.map(i =>
        i.productId === scannedProduct.id
          ? { ...i, quantity: i.quantity + qty, lot: lotInput || i.lot, expiryDate: expiryInput || i.expiryDate }
          : i
      ));
    } else {
      setItemsToAdd(prev => [...prev, {
        productId: scannedProduct.id,
        productName: scannedProduct.name,
        erpCode: scannedProduct.erpCode || scannedProduct.erp_code || "",
        barcode: scannedProduct.barcode || "",
        quantity: qty,
        lot: lotInput,
        expiryDate: expiryInput,
      }]);
    }

    setScannedProduct(null);
    setQtyInput("");
    setLotInput("");
    setExpiryInput("");
    toast({ title: `${scannedProduct.name} adicionado à lista` });
    setTimeout(() => scanRef.current?.focus(), 100);
  };

  const addItemsMutation = useMutation({
    mutationFn: async () => {
      if (!palletDetail) throw new Error("Nenhum pallet selecionado");
      const payload = {
        items: itemsToAdd.map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          lot: i.lot || undefined,
          expiryDate: i.expiryDate || undefined,
        })),
        notes: notes || undefined,
      };
      const res = await apiRequest("POST", `/api/pallets/${palletDetail.id}/add-items`, payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro");
      }
      return res.json();
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["pallets"] });
      queryClient.invalidateQueries({ queryKey: ["pallets-by-address"] });
      toast({ title: "Itens adicionados com sucesso!" });
      setItemsToAdd([]);
      setNotes("");
      setShowConfirm(false);
      const res = await apiRequest("GET", `/api/pallets/${palletDetail.id}`);
      if (res.ok) setPalletDetail(await res.json());
    },
    onError: (e: Error) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
      setShowConfirm(false);
    },
  });

  const reset = () => {
    setPalletDetail(null);
    setItemsToAdd([]);
    setNotes("");
    setScannedProduct(null);
    setScanInput("");
    setQtyInput("");
  };

  const toggleKeyboard = () => {
    setKeyboardEnabled(v => !v);
    if (scanRef.current) {
      scanRef.current.blur();
      setTimeout(() => scanRef.current?.focus(), 100);
    }
  };

  const addressObj = palletDetail?.address || null;

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-foreground leading-tight flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-emerald-500" />
            Adição
          </h1>
          <p className="text-xs text-muted-foreground">Adicionar produtos a pallet existente</p>
        </div>
        {palletDetail && (
          <Button variant="ghost" size="sm" className="h-8 text-xs rounded-lg" onClick={reset} data-testid="button-reset">
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Trocar
          </Button>
        )}
      </div>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-3 safe-bottom">
        {!palletDetail ? (
          <PalletFinder
            onPalletSelected={(pallet) => {
              setPalletDetail(pallet);
              setItemsToAdd([]);
            }}
            showAddressMode={true}
            defaultMode="code"
            label="Localizar pallet"
          />
        ) : (
          <div className="space-y-3 animate-slide-up">
            <div className="rounded-2xl border border-border/50 bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <span className="font-mono font-bold text-sm">{palletDetail.code}</span>
                </div>
                <Badge variant="outline" className="text-[10px]">{palletDetail.status}</Badge>
              </div>
              {addressObj && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  <span className="font-mono">{addressObj.code}</span>
                </div>
              )}
              {palletDetail.items && (
                <p className="text-[10px] text-muted-foreground mt-1">{palletDetail.items.length} produto(s) no pallet</p>
              )}
            </div>

            <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Escanear Produto</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                  <Input
                    ref={scanRef}
                    placeholder="Bipe o código de barras ou ERP..."
                    value={scanInput}
                    onChange={e => setScanInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleScan()}
                    className="pl-10 pr-12 h-11 rounded-xl text-sm font-mono"
                    inputMode={keyboardEnabled ? "text" : "none"}
                    autoFocus
                    data-testid="input-scan-product"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <Button variant={keyboardEnabled ? "default" : "ghost"} size="sm" className="h-8 w-8 p-0 rounded-lg"
                      onClick={toggleKeyboard}
                      data-testid="button-keyboard-toggle">
                      <Keyboard className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <Button className="h-11 px-4 rounded-xl" onClick={handleScan} disabled={!scanInput.trim() || scanLoading} data-testid="button-scan">
                  {scanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              {!keyboardEnabled && (
                <p className="text-[10px] text-muted-foreground text-center">
                  Bipe o produto ou toque <Keyboard className="h-3 w-3 inline" /> para digitar
                </p>
              )}
            </div>

            {scannedProduct && (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3 animate-scale-in">
                <div>
                  <p className="font-semibold text-sm">{scannedProduct.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono">Cód: {scannedProduct.erpCode || scannedProduct.erp_code} | CB: {scannedProduct.barcode || "—"}</p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[9px] text-muted-foreground uppercase font-bold mb-0.5 block">Quantidade</label>
                    <Input id="qty-input" type="number" inputMode="decimal" placeholder="Qtd" value={qtyInput} onChange={e => setQtyInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addScannedItem()}
                      className="h-9 text-sm font-mono rounded-lg" data-testid="input-qty" />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground uppercase font-bold mb-0.5 block">Lote</label>
                    <Input placeholder="Lote" value={lotInput} onChange={e => setLotInput(e.target.value)} className="h-9 text-xs rounded-lg" data-testid="input-lot" />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground uppercase font-bold mb-0.5 block">Validade</label>
                    <Input type="date" value={expiryInput} onChange={e => setExpiryInput(e.target.value)} className="h-9 text-xs rounded-lg" data-testid="input-expiry" />
                  </div>
                </div>
                <Button className="w-full h-10 rounded-xl" onClick={addScannedItem} disabled={!qtyInput || parseFloat(qtyInput) <= 0} data-testid="button-add-to-list">
                  <Plus className="h-4 w-4 mr-2" /> Adicionar à Lista
                </Button>
              </div>
            )}

            {itemsToAdd.length > 0 && (
              <div className="rounded-2xl border border-border/50 bg-card overflow-hidden animate-slide-up">
                <div className="px-4 py-2.5 border-b border-border/30 flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Itens para Adicionar ({itemsToAdd.length})</p>
                </div>
                <div className="divide-y divide-border/30">
                  {itemsToAdd.map(item => (
                    <div key={item.productId} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{item.productName}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">Cód: {item.erpCode}{item.lot ? ` | Lote: ${item.lot}` : ""}</p>
                      </div>
                      <span className="font-mono font-bold text-sm text-primary shrink-0">+{item.quantity}</span>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => setItemsToAdd(prev => prev.filter(i => i.productId !== item.productId))} data-testid={`button-remove-${item.productId}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="p-4 border-t border-border/30 space-y-3">
                  <Textarea placeholder="Observações (opcional)..." value={notes} onChange={e => setNotes(e.target.value)}
                    className="rounded-xl resize-none text-sm" rows={2} data-testid="input-notes" />
                  <Button className="w-full h-14 text-sm font-semibold rounded-xl shadow-lg shadow-primary/15 active:scale-[0.98] transition-all"
                    onClick={() => setShowConfirm(true)} disabled={itemsToAdd.length === 0} data-testid="button-confirm-add">
                    <PackagePlus className="h-4 w-4 mr-2" /> Confirmar Adição
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Confirmar Adição
            </AlertDialogTitle>
            <AlertDialogDescription>
              Adicionar <strong>{itemsToAdd.length} produto(s)</strong> ao pallet <strong className="font-mono">{palletDetail?.code}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {itemsToAdd.map(item => (
              <div key={item.productId} className="flex justify-between text-sm px-1">
                <span className="truncate">{item.productName}</span>
                <span className="font-mono font-bold text-primary shrink-0 ml-2">+{item.quantity}</span>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" data-testid="button-cancel-confirm">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => addItemsMutation.mutate()} disabled={addItemsMutation.isPending} className="rounded-xl" data-testid="button-execute-add">
              {addItemsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PackagePlus className="h-4 w-4 mr-2" />}
              Adicionar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
