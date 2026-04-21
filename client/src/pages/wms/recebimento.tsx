import { useState, useRef, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { apiRequest } from "@/lib/queryClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Search, Plus, Package, Loader2, Trash2, Printer, QrCode,
  PackagePlus, CheckCircle, AlertCircle, ChevronDown, ChevronUp,
  FileText, ArrowRight, Calendar, Tag, Box, Minus, Keyboard,
  Pencil, X, ScanBarcode, Store,
} from "lucide-react";
import { useLocation } from "wouter";
import { ProductStockInfo, StockLegend } from "@/components/wms/product-stock-info";
import { useProductStockBatch } from "@/hooks/use-product-stock";
import { usePrint } from "@/hooks/use-print";

interface PalletItemDraft {
  productId: string;
  productName: string;
  erpCode: string;
  barcode: string;
  erpNfId?: string;
  quantity: number;
  lot?: string;
  expiryDate?: string;
  unit: string;
}

type ActiveTab = "scan" | "nf";

const DRAFT_KEY = (cid: number) => `wms:pallet_draft_${cid}`;

interface PalletDraft {
  items: PalletItemDraft[];
  lotInput: string;
  expiryInput: string;
  nfData: any | null;
  savedAt: string;
}

function loadDraft(companyId: number): PalletDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(companyId));
    if (!raw) return null;
    return JSON.parse(raw) as PalletDraft;
  } catch {
    return null;
  }
}

function saveDraft(companyId: number, draft: PalletDraft) {
  try {
    localStorage.setItem(DRAFT_KEY(companyId), JSON.stringify(draft));
  } catch {}
}

function clearDraft(companyId: number) {
  try {
    localStorage.removeItem(DRAFT_KEY(companyId));
  } catch {}
}

export default function RecebimentoPage() {
  const [, navigate] = useLocation();
  const { user, companyId, companiesData } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<ActiveTab>("scan");
  const [palletItems, setPalletItems] = useState<PalletItemDraft[]>([]);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [lotInput, setLotInput] = useState("");
  const [expiryInput, setExpiryInput] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [lastScanned, setLastScanned] = useState<{ product: any; qty: number; isBox: boolean } | null>(null);
  const [scanError, setScanError] = useState("");
  const [showItemList, setShowItemList] = useState(true);
  const [keyboardEnabled, setKeyboardEnabled] = useState(false);
  const [draftRestoredAt, setDraftRestoredAt] = useState<string | null>(null);

  const [nfSearch, setNfSearch] = useState("");
  const [nfData, setNfData] = useState<any>(null);
  const [nfLoading, setNfLoading] = useState(false);
  const [selectedNfItems, setSelectedNfItems] = useState<Set<number>>(new Set());
  const [nfList, setNfList] = useState<any[]>([]);
  const [nfListLoading, setNfListLoading] = useState(false);
  const [nfImportProgress, setNfImportProgress] = useState<{ current: number; total: number } | null>(null);

  const { printing: palletPrinting, cooldownSeconds: palletCooldown, print: printPallet } = usePrint();
  const [labelDialog, setLabelDialog] = useState<any>(null);
  const [labelLoading, setLabelLoading] = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [editingQtyIdx, setEditingQtyIdx] = useState<number | null>(null);
  const [editingQtyValue, setEditingQtyValue] = useState("");

  const [editPalletDialog, setEditPalletDialog] = useState<any>(null);
  const [editPalletItems, setEditPalletItems] = useState<any[]>([]);
  const [editPalletLoading, setEditPalletLoading] = useState(false);
  const [editScanInput, setEditScanInput] = useState("");
  const [editScanLoading, setEditScanLoading] = useState(false);
  const [editScanError, setEditScanError] = useState("");
  const [cancelPalletTarget, setCancelPalletTarget] = useState<any>(null);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const draftLoadedRef = useRef(false);

  // ── Restaurar rascunho ao carregar (uma única vez por sessão) ─────────
  useEffect(() => {
    if (!companyId || draftLoadedRef.current) return;
    draftLoadedRef.current = true;
    const draft = loadDraft(companyId);
    if (draft && draft.items.length > 0) {
      setPalletItems(draft.items);
      setLotInput(draft.lotInput || "");
      setExpiryInput(draft.expiryInput || "");
      if (draft.nfData) setNfData(draft.nfData);
      setDraftRestoredAt(draft.savedAt);
      toast({
        title: `Rascunho recuperado — ${draft.items.length} item(ns)`,
        description: "Seus itens foram restaurados automaticamente.",
      });
    }
  }, [companyId]);

  // ── Salvar rascunho automaticamente a cada alteração ─────────────────
  useEffect(() => {
    if (!companyId) return;
    saveDraft(companyId, {
      items: palletItems,
      lotInput,
      expiryInput,
      nfData,
      savedAt: new Date().toISOString(),
    });
  }, [companyId, palletItems, lotInput, expiryInput, nfData]);

  const discardDraft = () => {
    if (!companyId) return;
    clearDraft(companyId);
    setPalletItems([]);
    setLotInput("");
    setExpiryInput("");
    setNfData(null);
    setDraftRestoredAt(null);
  };

  useEffect(() => {
    if (activeTab === "scan" && keyboardEnabled) {
      const t = setTimeout(() => scanInputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [activeTab, keyboardEnabled]);

  useEffect(() => {
    if (lastScanned) {
      const timer = setTimeout(() => setLastScanned(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [lastScanned]);

  useEffect(() => {
    if (scanError) {
      const timer = setTimeout(() => setScanError(""), 3000);
      return () => clearTimeout(timer);
    }
  }, [scanError]);

  const { data: pallets = [], isLoading: palletsLoading, refetch: refetchPallets } = useQuery({
    queryKey: ["pallets", companyId, "sem_endereco"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/pallets?status=sem_endereco");
      return res.json();
    },
    enabled: !!companyId,
  });

  const addItemToPallet = useCallback((product: any, qty: number, isBox: boolean) => {
    const existing = palletItems.find(i => i.productId === product.id);
    if (existing) {
      setPalletItems(prev => prev.map(i =>
        i.productId === product.id ? { ...i, quantity: i.quantity + qty } : i
      ));
    } else {
      setPalletItems(prev => [...prev, {
        productId: product.id,
        productName: product.name,
        erpCode: product.erpCode,
        barcode: product.barcode || "",
        erpNfId: nfData?.nfNumber || undefined,
        quantity: qty,
        lot: lotInput || undefined,
        expiryDate: expiryInput || undefined,
        unit: product.unit || "UN",
      }]);
    }
    setLastScanned({ product, qty, isBox });
    setScanError("");
  }, [palletItems, lotInput, expiryInput, nfData]);

  const handleScan = async () => {
    const code = barcodeInput.trim();
    if (!code) return;
    setScanLoading(true);
    setScanError("");
    try {
      const res = await apiRequest("GET", `/api/products/by-barcode/${encodeURIComponent(code)}`);
      if (res.ok) {
        const product = await res.json();
        const qty = product.boxQty || 1;
        const isBox = !!product.boxQty;
        addItemToPallet(product, qty, isBox);
        setBarcodeInput("");
        if (keyboardEnabled) setTimeout(() => scanInputRef.current?.focus(), 50);
      } else {
        setScanError("Produto nao encontrado para este codigo");
      }
    } catch {
      setScanError("Erro de conexao ao buscar produto");
    } finally {
      setScanLoading(false);
    }
  };

  const updateItemQty = (idx: number, delta: number) => {
    setPalletItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      return { ...item, quantity: Math.max(1, item.quantity + delta) };
    }));
  };

  const startEditQty = (idx: number) => {
    setEditingQtyIdx(idx);
    setEditingQtyValue(String(palletItems[idx].quantity));
  };

  const commitEditQty = () => {
    if (editingQtyIdx === null) return;
    const val = parseInt(editingQtyValue, 10);
    if (!isNaN(val) && val > 0) {
      setPalletItems(prev => prev.map((item, i) =>
        i === editingQtyIdx ? { ...item, quantity: val } : item
      ));
    }
    setEditingQtyIdx(null);
    setEditingQtyValue("");
  };

  const removeItem = (idx: number) => {
    setPalletItems(prev => prev.filter((_, i) => i !== idx));
  };

  const searchNfList = async () => {
    setNfListLoading(true);
    try {
      const q = nfSearch.trim();
      const res = await apiRequest("GET", `/api/nf/list${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      setNfList(await res.json());
    } catch {
      toast({ title: "Erro", description: "Falha ao listar NFs", variant: "destructive" });
    } finally {
      setNfListLoading(false);
    }
  };

  const loadNfDetail = async (nfNumber: string) => {
    setNfLoading(true);
    try {
      const res = await apiRequest("GET", `/api/nf/${nfNumber}`);
      if (res.ok) {
        const data = await res.json();
        setNfData(data);
        setSelectedNfItems(new Set());
      } else {
        const err = await res.json();
        toast({ title: "NF nao encontrada", description: err.error, variant: "destructive" });
        setNfData(null);
      }
    } catch {
      toast({ title: "Erro", description: "Falha na busca", variant: "destructive" });
    } finally {
      setNfLoading(false);
    }
  };

  const toggleNfItem = (idx: number) => {
    setSelectedNfItems(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const mergeNfItemsIntoPallet = (itemsToAdd: any[]) => {
    setNfImportProgress({ current: 0, total: itemsToAdd.length });
    setPalletItems(prev => {
      const merged = [...prev];
      itemsToAdd.forEach((nfItem, i) => {
        const pid = nfItem.productId || nfItem.id;
        const existingIdx = merged.findIndex(it => it.productId === pid);
        if (existingIdx >= 0) {
          merged[existingIdx] = { 
            ...merged[existingIdx], 
            quantity: Number(merged[existingIdx].quantity) + (Number(nfItem.quantity) || 1) 
          };
        } else {
          merged.push({
            productId: pid,
            productName: nfItem.productName || nfItem.name || "Produto",
            erpCode: nfItem.erpCode || "",
            barcode: nfItem.barcode || "",
            erpNfId: nfData.nfNumber,
            quantity: Number(nfItem.quantity) || 1,
            lot: nfItem.lot || undefined,
            expiryDate: nfItem.expiryDate || undefined,
            unit: nfItem.unit || "UN",
          });
        }
        setNfImportProgress({ current: i + 1, total: itemsToAdd.length });
      });
      return merged;
    });
    setTimeout(() => setNfImportProgress(null), 1500);
  };

  const addSelectedNfItems = () => {
    if (!nfData?.items || selectedNfItems.size === 0) return;
    const items = Array.from(selectedNfItems).map(idx => nfData.items[idx]).filter(Boolean);
    mergeNfItemsIntoPallet(items);
    setSelectedNfItems(new Set());
    toast({ title: `${items.length} item(ns) adicionado(s)` });
  };

  const addAllNfItems = () => {
    if (!nfData?.items || nfData.items.length === 0) return;
    mergeNfItemsIntoPallet(nfData.items);
    toast({ title: `${nfData.items.length} itens adicionados` });
  };

  const createPalletMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/pallets", {
        items: palletItems.map(i => ({
          productId: i.productId,
          erpNfId: i.erpNfId,
          quantity: i.quantity,
          lot: i.lot,
          expiryDate: i.expiryDate,
        })),
        nfIds: nfData ? [nfData.nfNumber] : [],
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pallets"] });
      if (companyId) clearDraft(companyId);
      setPalletItems([]);
      setNfData(null);
      setLotInput("");
      setExpiryInput("");
      setLastScanned(null);
      setDraftRestoredAt(null);
      setShowCreateConfirm(false);
      toast({ title: "Pallet criado!", description: `Codigo: ${data.code}` });
      fetchLabel(data.id);
    },
    onError: (e: Error) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
      setShowCreateConfirm(false);
    },
  });

  const cancelPalletMutation = useMutation({
    mutationFn: async (palletId: string) => {
      const res = await apiRequest("POST", `/api/pallets/${palletId}/cancel-unaddressed`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pallets"] });
      setCancelPalletTarget(null);
      toast({ title: "Pallet cancelado" });
    },
    onError: (e: Error) => {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
      setCancelPalletTarget(null);
    },
  });

  const openEditPallet = async (pallet: any) => {
    setEditPalletLoading(true);
    setEditPalletDialog(pallet);
    try {
      const res = await apiRequest("GET", `/api/pallets/${pallet.id}`);
      if (res.ok) {
        const data = await res.json();
        setEditPalletItems(data.items?.map((item: any) => ({ ...item, quantity: item.quantity })) || []);
      }
    } catch {
      toast({ title: "Erro ao carregar pallet", variant: "destructive" });
    } finally {
      setEditPalletLoading(false);
    }
  };

  const handleEditScan = async () => {
    const code = editScanInput.trim();
    if (!code) return;
    setEditScanLoading(true);
    setEditScanError("");
    try {
      const res = await apiRequest("GET", `/api/products/by-barcode/${encodeURIComponent(code)}`);
      if (res.ok) {
        const product = await res.json();
        const qty = product.boxQty || 1;
        setEditPalletItems(prev => {
          const existingIdx = prev.findIndex(it => (it.productId || it.product?.id) === product.id);
          if (existingIdx >= 0) {
            return prev.map((it, i) => i === existingIdx ? { ...it, quantity: it.quantity + qty } : it);
          }
          return [...prev, {
            productId: product.id,
            product: { name: product.name, erpCode: product.erpCode },
            quantity: qty,
            lot: undefined,
            expiryDate: undefined,
          }];
        });
        setEditScanInput("");
      } else {
        setEditScanError("Produto não encontrado para este código");
      }
    } catch {
      setEditScanError("Erro de conexão ao buscar produto");
    } finally {
      setEditScanLoading(false);
    }
  };

  const savePalletEdit = async () => {
    if (!editPalletDialog) return;
    setEditPalletLoading(true);
    try {
      await apiRequest("PATCH", `/api/pallets/${editPalletDialog.id}`, {
        items: editPalletItems.map(i => ({
          productId: i.productId || i.product?.id,
          quantity: i.quantity,
          lot: i.lot,
          expiryDate: i.expiryDate,
        })),
      });
      queryClient.invalidateQueries({ queryKey: ["pallets"] });
      setEditPalletDialog(null);
      toast({ title: "Pallet atualizado" });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha ao atualizar pallet", variant: "destructive" });
    } finally {
      setEditPalletLoading(false);
    }
  };

  const fetchLabel = async (palletId: string) => {
    setLabelLoading(true);
    try {
      const res = await apiRequest("GET", `/api/pallets/${palletId}/print-label`);
      if (res.ok) setLabelDialog(await res.json());
    } catch {
      toast({ title: "Erro ao carregar etiqueta", variant: "destructive" });
    } finally {
      setLabelLoading(false);
    }
  };

  const printLabel = async () => {
    if (!labelDialog) return;

    const palletData = {
      palletCode: labelDialog.palletCode,
      address: labelDialog.address,
      createdAt: new Date(labelDialog.createdAt).toLocaleString("pt-BR"),
      createdBy: labelDialog.createdBy || "—",
      printedBy: user?.name || user?.username || "—",
      qrData: labelDialog.qrData || labelDialog.palletCode,
      items: labelDialog.items.map((i: any) => ({
        product: i.product,
        erpCode: i.erpCode,
        quantity: String(i.quantity),
        unit: i.unit,
        lot: i.lot || "",
        expiryDate: i.expiryDate || "",
      })),
      nfIds: labelDialog.nfIds || [],
    };

    printPallet(null, "pallet_label", { template: "pallet_label", data: palletData });
  };

  const totalItems = palletItems.reduce((sum, i) => sum + i.quantity, 0);
  const palletProductIds = palletItems.map(i => i.productId).filter(Boolean);
  const { data: stockInfoMap = {} } = useProductStockBatch(palletProductIds);

  return (
    <>
    <div className="min-h-[100dvh] bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Recebimento</h1>
            <p className="text-xs text-muted-foreground">{companyId ? (companiesData?.find(c => c.id === companyId)?.name || "WMS") : "WMS"}</p>
          </div>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-3 safe-bottom">
        <div className="flex rounded-xl border border-border/50 bg-muted/30 p-1 gap-1 animate-fade-in">
          <button
            onClick={() => setActiveTab("scan")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${activeTab === "scan" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
            data-testid="tab-scan"
          >
            <ScanBarcode className="h-3.5 w-3.5 shrink-0" />
            Leitura
          </button>
          <button
            onClick={() => setActiveTab("nf")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${activeTab === "nf" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"}`}
            data-testid="tab-nf"
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            Importar NF
          </button>
        </div>

        {activeTab === "scan" && (
          <div className="rounded-2xl border-2 border-primary/20 bg-card p-4 space-y-3 animate-slide-up">
            <div className="relative">
              <PackagePlus className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
              <Input
                ref={scanInputRef}
                placeholder="Bipe o codigo de barras..."
                value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleScan()}
                className="pl-10 pr-20 h-12 rounded-xl text-sm font-mono"
                inputMode={keyboardEnabled ? "text" : "none"}
                autoFocus
                disabled={scanLoading}
                data-testid="input-barcode-scan"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {scanLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                <Button
                  variant={keyboardEnabled ? "default" : "ghost"}
                  size="sm"
                  className="h-8 w-8 p-0 rounded-lg"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    flushSync(() => setKeyboardEnabled(v => !v));
                    scanInputRef.current?.blur();
                    scanInputRef.current?.focus();
                  }}
                  data-testid="button-toggle-keyboard-scan"
                >
                  <Keyboard className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {!keyboardEnabled && (
              <p className="text-[11px] text-muted-foreground text-center">
                Bipe o codigo ou toque <Keyboard className="h-3 w-3 inline" /> para digitar
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold flex items-center gap-0.5 mb-0.5">
                  <Tag className="h-2.5 w-2.5" />Lote
                </label>
                <Input placeholder="Lote" value={lotInput} onChange={e => setLotInput(e.target.value)} className="h-9 rounded-lg text-xs" inputMode={keyboardEnabled ? "text" : "none"} readOnly={!keyboardEnabled} data-testid="input-lot" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground uppercase font-bold flex items-center gap-0.5 mb-0.5">
                  <Calendar className="h-2.5 w-2.5" />Validade
                </label>
                <Input type="date" value={expiryInput} onChange={e => setExpiryInput(e.target.value)} className="h-9 rounded-lg text-xs" readOnly={!keyboardEnabled} data-testid="input-expiry" />
              </div>
            </div>

            {lastScanned && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 animate-scale-in" data-testid="scan-success-feedback">
                <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-xs text-emerald-800 dark:text-emerald-200 truncate">{lastScanned.product.name}</p>
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                    {lastScanned.product.erpCode}
                    {lastScanned.isBox ? <span className="ml-1 font-semibold">Cx: +{Number(lastScanned.qty).toString()}</span> : <span className="ml-1">+{Number(lastScanned.qty).toString()} {lastScanned.product.unit || "UN"}</span>}
                  </p>
                </div>
              </div>
            )}

            {scanError && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-800/40" data-testid="scan-error-feedback">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-300">{scanError}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "nf" && (
          <div className="space-y-3 animate-slide-up">
            <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-primary" /> Notas Fiscais
                </p>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                    <Input
                      placeholder="Buscar NF..."
                      value={nfSearch}
                      onChange={e => setNfSearch(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && searchNfList()}
                      className="pl-10 h-10 rounded-xl text-sm"
                      data-testid="input-nf-search"
                    />
                  </div>
                  <Button className="h-10 rounded-xl px-4" onClick={searchNfList} disabled={nfListLoading} data-testid="button-search-nf-list">
                    {nfListLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {nfListLoading ? (
                <div className="text-center py-8"><Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" /></div>
              ) : nfList.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">Nenhuma NF encontrada</p>
              ) : (
                <div className="divide-y divide-border/30 max-h-60 overflow-y-auto">
                  {nfList.map((nf: any) => (
                    <button
                      key={nf.id}
                      onClick={() => loadNfDetail(nf.nfNumber)}
                      className={`w-full flex items-center justify-between px-4 py-3 text-left transition-all active:bg-muted/50 ${nfData?.nfNumber === nf.nfNumber ? "bg-primary/5" : ""}`}
                      data-testid={`nf-list-${nf.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-mono font-semibold text-sm">NF {nf.nfNumber}</span>
                        {nf.nfSeries && <span className="text-[10px] text-muted-foreground ml-1">S{nf.nfSeries}</span>}
                        {nf.supplierName && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{nf.supplierName}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="outline" className="text-[10px]">{nf.status}</Badge>
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {nfLoading && <div className="text-center py-6"><Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" /></div>}

            {nfData && !nfLoading && (
              <div className="rounded-2xl border-2 border-blue-200/60 dark:border-blue-800/40 bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
                  <div className="min-w-0">
                    <span className="font-mono font-bold text-sm">NF {nfData.nfNumber}</span>
                    {nfData.supplierName && (
                      <p className="text-[10px] text-muted-foreground truncate">{nfData.supplierName}</p>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0 rounded-lg" onClick={() => { setNfData(null); setSelectedNfItems(new Set()); }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="p-4 space-y-3">
                  {nfImportProgress && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>Importando...</span><span>{nfImportProgress.current}/{nfImportProgress.total}</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                        <div className="bg-primary h-1.5 rounded-full transition-all duration-300" style={{ width: `${(nfImportProgress.current / nfImportProgress.total) * 100}%` }} />
                      </div>
                    </div>
                  )}

                  {nfData.items?.length > 0 ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          {selectedNfItems.size > 0 ? `${selectedNfItems.size} selecionado(s)` : `${nfData.items.length} itens`}
                        </p>
                        <div className="flex gap-1.5 shrink-0">
                          <Button variant="outline" size="sm" className="h-8 text-[11px] rounded-lg" onClick={addAllNfItems} disabled={!!nfImportProgress} data-testid="button-add-all-nf">
                            Todos
                          </Button>
                          {selectedNfItems.size > 0 && (
                            <Button size="sm" className="h-8 text-[11px] rounded-lg" onClick={addSelectedNfItems} disabled={!!nfImportProgress} data-testid="button-add-selected-nf">
                              <Plus className="h-3 w-3 mr-0.5" />{selectedNfItems.size}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="divide-y divide-border/30 max-h-60 overflow-y-auto rounded-xl border border-border/30 overflow-hidden">
                        {nfData.items.map((item: any, idx: number) => (
                          <button
                            key={idx}
                            onClick={() => toggleNfItem(idx)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all ${selectedNfItems.has(idx) ? "bg-primary/5" : ""}`}
                            data-testid={`nf-item-${idx}`}
                          >
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${selectedNfItems.has(idx) ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/25"}`}>
                              {selectedNfItems.has(idx) && <CheckCircle className="h-2.5 w-2.5" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{item.productName || item.name || "Produto"}</p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {item.erpCode && <span className="font-mono mr-1.5">{item.erpCode}</span>}
                                {item.lot && <span>L:{item.lot}</span>}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <Badge variant="outline" className="font-mono text-[10px]">
                                NF: {Number(item.quantity || 1).toString()} {item.unit || "UN"}
                              </Badge>
                              {(item.currentStock !== undefined || item.alocadoStock !== undefined) && (
                                <div className="flex gap-1.5 text-[9px] font-medium text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded border border-border/50">
                                  <span className="flex items-center gap-0.5" title="Sobra Pick">
                                    <Store className="h-2.5 w-2.5" /> {Number(item.currentStock || 0).toString()}
                                  </span>
                                  <span className="flex items-center gap-0.5 text-blue-600" title="Alocado">
                                    <Package className="h-2.5 w-2.5" /> {Number(item.alocadoStock || 0).toString()}
                                  </span>
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-4">NF sem itens. Use leitura de codigo.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
            <div className="flex items-center gap-2 min-w-0">
              <Package className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-semibold">Itens do Pallet</span>
              {palletItems.length > 0 && (
                <Badge variant="secondary" className="text-[10px] font-bold h-5 px-1.5 shrink-0">{palletItems.length}p · {totalItems}un</Badge>
              )}
              {palletItems.length > 0 && (
                <span className="text-[10px] text-muted-foreground hidden sm:inline truncate">· rascunho salvo</span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {palletItems.length > 0 && (
                <button
                  onClick={() => setShowDiscardConfirm(true)}
                  className="text-red-400 hover:text-red-600 p-1 rounded"
                  title="Limpar rascunho"
                  data-testid="button-discard-draft"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {palletItems.length > 0 && (
                <button onClick={() => setShowItemList(!showItemList)} className="text-muted-foreground/50 p-1" data-testid="button-toggle-items">
                  {showItemList ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>

          {palletItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <div className="w-12 h-12 mx-auto mb-2 rounded-2xl bg-muted flex items-center justify-center">
                <Box className="h-6 w-6 opacity-30" />
              </div>
              <p className="text-xs font-medium">Nenhum item adicionado</p>
            </div>
          ) : (
            <>
              {showItemList && (
                <div className="divide-y divide-border/30">
                  <div className="px-4 py-2"><StockLegend /></div>
                  {palletItems.map((item, idx) => {
                    const si = item.productId ? stockInfoMap[item.productId] : null;
                    return (
                      <div key={idx} className="px-4 py-2.5 space-y-1.5" data-testid={`pallet-item-${idx}`}>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.productName}</p>
                            <p className="text-[10px] text-muted-foreground font-mono truncate">{item.erpCode}</p>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg" onClick={() => updateItemQty(idx, -1)} data-testid={`button-dec-${idx}`}>
                              <Minus className="h-3.5 w-3.5" />
                            </Button>
                            {editingQtyIdx === idx ? (
                              <Input
                                value={editingQtyValue}
                                onChange={e => setEditingQtyValue(e.target.value.replace(/\D/g, ""))}
                                onBlur={commitEditQty}
                                onKeyDown={e => e.key === "Enter" && commitEditQty()}
                                className="h-8 w-12 text-center font-mono font-bold text-sm p-0 rounded-lg"
                                autoFocus
                                data-testid={`input-qty-${idx}`}
                              />
                            ) : (
                              <span
                                className="font-mono font-bold text-sm w-9 text-center cursor-pointer hover:bg-muted rounded-lg px-1 py-0.5"
                                onClick={() => startEditQty(idx)}
                                data-testid={`qty-display-${idx}`}
                              >
                                {Number(item.quantity).toString()}
                              </span>
                            )}
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg" onClick={() => updateItemQty(idx, 1)} data-testid={`button-inc-${idx}`}>
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-destructive" onClick={() => removeItem(idx)} data-testid={`button-remove-${idx}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {si && (
                          <ProductStockInfo totalStock={si.totalStock} palletizedStock={si.palletizedStock} pickingStock={si.pickingStock} unit={si.unit} compact />
                        )}
                        <div className="grid grid-cols-2 gap-1.5">
                          <Input
                            placeholder="Lote"
                            value={item.lot || ""}
                            onChange={e => setPalletItems(prev => prev.map((it, i) => i === idx ? { ...it, lot: e.target.value || undefined } : it))}
                            className="h-7 text-[10px] rounded-lg"
                            data-testid={`input-item-lot-${idx}`}
                          />
                          <Input
                            type="date"
                            value={item.expiryDate || ""}
                            onChange={e => setPalletItems(prev => prev.map((it, i) => i === idx ? { ...it, expiryDate: e.target.value || undefined } : it))}
                            className="h-7 text-[10px] rounded-lg"
                            data-testid={`input-item-expiry-${idx}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center justify-between px-4 py-3 border-t border-border/30 bg-muted/10">
                <div className="text-xs">
                  <span className="text-muted-foreground">Total:</span>
                  <span className="font-bold ml-1">{palletItems.length}p · {totalItems}un</span>
                </div>
                <Button
                  onClick={() => setShowCreateConfirm(true)}
                  disabled={createPalletMutation.isPending || palletItems.length === 0}
                  className="h-11 rounded-xl text-xs font-semibold px-4 shadow-lg shadow-primary/15 active:scale-[0.98] transition-all"
                  data-testid="button-create-pallet"
                >
                  {createPalletMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Package className="h-4 w-4 mr-1.5" />}
                  Gerar Pallet
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
            <QrCode className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Aguardando Endereco</span>
            {pallets.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-bold h-5 px-1.5">{pallets.length}</Badge>
            )}
          </div>

          {palletsLoading ? (
            <div className="text-center py-8"><Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground" /></div>
          ) : pallets.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">Nenhum pallet pendente</p>
          ) : (
            <div className="divide-y divide-border/30">
              {pallets.map((p: any) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3" data-testid={`pallet-row-${p.id}`}>
                  <div className="w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center shrink-0">
                    <QrCode className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono font-semibold text-sm truncate">{p.code}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {p.items?.length || 0} itens · {new Date(p.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg" onClick={() => openEditPallet(p)} data-testid={`button-edit-${p.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg" onClick={() => fetchLabel(p.id)} disabled={labelLoading} data-testid={`button-print-${p.id}`}>
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 rounded-lg text-destructive hover:bg-destructive/10" onClick={() => setCancelPalletTarget(p)} data-testid={`button-cancel-${p.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <Dialog open={showCreateConfirm} onOpenChange={setShowCreateConfirm}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Confirmar Pallet</DialogTitle>
            <DialogDescription>
              {palletItems.length} produto{palletItems.length !== 1 ? "s" : ""} · {totalItems} un
              {nfData && <span className="block mt-1">NF: {nfData.nfNumber}</span>}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-40 overflow-y-auto divide-y divide-border/30 rounded-xl border border-border/30">
            {palletItems.map((item, idx) => (
              <div key={idx} className="flex justify-between text-xs px-3 py-2">
                <span className="truncate mr-2">{item.productName}</span>
                <span className="font-mono shrink-0">{Number(item.quantity).toString()} {item.unit}</span>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateConfirm(false)} className="rounded-xl">Cancelar</Button>
            <Button onClick={() => createPalletMutation.mutate()} disabled={createPalletMutation.isPending} className="rounded-xl" data-testid="button-confirm-create-pallet">
              {createPalletMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Package className="h-4 w-4 mr-1.5" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelPalletTarget} onOpenChange={open => !open && setCancelPalletTarget(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Cancelar Pallet</DialogTitle>
            <DialogDescription>
              Cancelar pallet <span className="font-mono font-semibold">{cancelPalletTarget?.code}</span>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelPalletTarget(null)} className="rounded-xl">Voltar</Button>
            <Button variant="destructive" onClick={() => cancelPalletTarget && cancelPalletMutation.mutate(cancelPalletTarget.id)} disabled={cancelPalletMutation.isPending} className="rounded-xl" data-testid="button-confirm-cancel-pallet">
              {cancelPalletMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editPalletDialog} onOpenChange={open => { if (!open) { setEditPalletDialog(null); setEditScanInput(""); setEditScanError(""); } }}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">Editar {editPalletDialog?.code}</DialogTitle>
            <DialogDescription>Adicione ou remova produtos do pallet</DialogDescription>
          </DialogHeader>
          {editPalletLoading ? (
            <div className="text-center py-8"><Loader2 className="h-5 w-5 mx-auto animate-spin" /></div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wide">Adicionar produto</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <ScanBarcode className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                    <Input
                      placeholder="Bipe ou digite o código..."
                      value={editScanInput}
                      onChange={e => { setEditScanInput(e.target.value); setEditScanError(""); }}
                      onKeyDown={e => e.key === "Enter" && handleEditScan()}
                      className="pl-8 h-9 rounded-xl text-xs font-mono"
                      disabled={editScanLoading}
                      autoFocus
                      data-testid="input-edit-pallet-scan"
                    />
                  </div>
                  <Button size="sm" className="h-9 rounded-xl px-3" onClick={handleEditScan} disabled={editScanLoading || !editScanInput.trim()} data-testid="button-edit-pallet-add">
                    {editScanLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {editScanError && (
                  <p className="text-[11px] text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />{editScanError}
                  </p>
                )}
              </div>

              <div className="divide-y divide-border/30 max-h-52 overflow-y-auto rounded-xl border border-border/30">
                {editPalletItems.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-3 py-2.5" data-testid={`edit-pallet-item-${idx}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{item.product?.name || "Produto"}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{item.product?.erpCode || ""}</p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" onClick={() => {
                        setEditPalletItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: Math.max(1, it.quantity - 1) } : it));
                      }} data-testid={`button-edit-dec-${idx}`}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        value={Number(item.quantity).toString()}
                        onChange={e => {
                          const v = parseInt(e.target.value.replace(/\D/g, "")) || 1;
                          setEditPalletItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: v } : it));
                        }}
                        className="h-7 w-12 text-center font-mono font-bold text-sm p-0 rounded-lg"
                        data-testid={`input-edit-qty-${idx}`}
                      />
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg" onClick={() => {
                        setEditPalletItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: it.quantity + 1 } : it));
                      }} data-testid={`button-edit-inc-${idx}`}>
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 rounded-lg text-destructive" onClick={() => {
                        setEditPalletItems(prev => prev.filter((_, i) => i !== idx));
                      }} data-testid={`button-edit-remove-${idx}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
                {editPalletItems.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">Nenhum item</p>
                )}
              </div>
              {editPalletItems.length > 0 && (
                <p className="text-[10px] text-muted-foreground text-right">{editPalletItems.length} produto(s) · {editPalletItems.reduce((s, i) => s + i.quantity, 0)} un</p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setEditPalletDialog(null); setEditScanInput(""); setEditScanError(""); }} className="rounded-xl">Cancelar</Button>
            <Button onClick={savePalletEdit} disabled={editPalletLoading} className="rounded-xl" data-testid="button-save-pallet-edit">
              {editPalletLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!labelDialog} onOpenChange={open => !open && setLabelDialog(null)}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-sm">
              <Printer className="h-4 w-4" />Etiqueta
            </DialogTitle>
          </DialogHeader>
          {labelDialog && (
            <div className="space-y-3">
              <div className="text-center p-4 border-2 border-dashed rounded-xl bg-muted/20">
                <p className="font-mono text-2xl font-bold">{labelDialog.palletCode}</p>
                <p className="font-semibold text-base mt-1">{labelDialog.address}</p>
                <p className="text-[10px] text-muted-foreground mt-2">{new Date(labelDialog.createdAt).toLocaleString("pt-BR")}</p>
              </div>
              <div className="divide-y divide-border/30 max-h-32 overflow-y-auto rounded-xl border border-border/30 text-xs">
                {labelDialog.items?.map((i: any, idx: number) => (
                  <div key={idx} className="flex justify-between px-3 py-1.5">
                    <span className="truncate mr-2">{i.product}</span>
                    <span className="font-mono shrink-0">{Number(i.quantity).toString()} {i.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLabelDialog(null)} className="rounded-xl">Fechar</Button>
            <Button
              onClick={printLabel}
              className="rounded-xl min-w-[110px]"
              disabled={palletPrinting || palletCooldown > 0}
              data-testid="button-print-label"
              title={palletCooldown > 0 ? `Aguarde ${palletCooldown}s` : "Imprimir etiqueta"}
            >
              {palletPrinting
                ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Enviando...</>
                : palletCooldown > 0
                  ? <><Printer className="h-4 w-4 mr-1.5 opacity-50" /><span className="font-mono tabular-nums">{palletCooldown}s</span></>
                  : <><Printer className="h-4 w-4 mr-1.5" />Imprimir</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: confirmar descarte do rascunho */}
      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar rascunho</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover todos os itens do rascunho?
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                discardDraft();
                setShowDiscardConfirm(false);
              }}
              data-testid="btn-confirm-discard-draft"
            >
              Limpar tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </>
  );
}
