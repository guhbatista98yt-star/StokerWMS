import { useState, useRef, useEffect, useCallback } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScanInput } from "@/components/ui/scan-input";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import {
  ArrowLeft, Barcode, Check, Loader2, Package, ScanLine,
  Volume2, VolumeX, Trash2, RotateCcw, ShieldCheck, AlertTriangle,
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { playBeep, getSoundEnabled, setSoundEnabled as persistSoundEnabled } from "@/lib/audio-feedback";

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

interface ProductInfo {
  id: string;
  name: string;
  erpCode: string;
}

interface FeedEntry {
  id: string;
  unitBarcode: string;
  packageBarcode: string;
  productName: string;
  erpCode: string;
  qty: number;
  timestamp: string;
  status: "saving" | "saved" | "error" | "pending";
  errorMsg?: string;
}

interface SessionState {
  feed: FeedEntry[];
  phase: "idle" | "waitPkg";
  currentUnit: string;
  currentProduct: ProductInfo | null;
  presetQty: number;
  soundOn: boolean;
  sessionCount: number;
  savedAt: number;
}

const STORAGE_KEY = "stoker_vinculo_rapido_session";
const QUICK_QTY = [2, 3, 4, 6, 8, 10, 12, 15, 20, 24, 30, 36, 48, 50, 100];

function saveSession(state: SessionState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch {}
}

function loadSession(): SessionState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionState;
    const age = Date.now() - (parsed.savedAt || 0);
    if (age > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export default function CodigosBarrasPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const restored = useRef<SessionState | null>(null);
  if (!restored.current) {
    restored.current = loadSession();
  }
  const initial = restored.current;

  const [presetQty, setPresetQty] = useState(initial?.presetQty ?? 12);
  const [customQty, setCustomQty] = useState("");
  const [showQtyPicker, setShowQtyPicker] = useState(false);

  const [phase, setPhase] = useState<"idle" | "waitPkg">(initial?.phase ?? "idle");
  const [currentUnit, setCurrentUnit] = useState(initial?.currentUnit ?? "");
  const [currentProduct, setCurrentProduct] = useState<ProductInfo | null>(initial?.currentProduct ?? null);

  const initialFeed = (initial?.feed ?? []).map(e => ({
    ...e,
    status: (e.status === "saving" ? "pending" : e.status) as FeedEntry["status"],
  }));
  const [feed, setFeed] = useState<FeedEntry[]>(initialFeed);
  const [flash, setFlash] = useState<"success" | "error" | null>(null);
  const [soundOn, setSoundOn] = useState(initial?.soundOn ?? getSoundEnabled());
  const [sessionCount, setSessionCount] = useState(initial?.sessionCount ?? 0);
  const [processing, setProcessing] = useState(false);
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(
    initial !== null && initial.feed.length > 0
  );
  const [retrying, setRetrying] = useState(false);

  const processingRef = useRef(false);
  const phaseRef = useRef<"idle" | "waitPkg">(phase);
  const currentUnitRef = useRef(currentUnit);
  const currentProductRef = useRef<ProductInfo | null>(currentProduct);
  const presetQtyRef = useRef(presetQty);
  const soundOnRef = useRef(soundOn);
  const feedRef = useRef(feed);
  const sessionCountRef = useRef(sessionCount);

  const customQtyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { currentUnitRef.current = currentUnit; }, [currentUnit]);
  useEffect(() => { currentProductRef.current = currentProduct; }, [currentProduct]);
  useEffect(() => { presetQtyRef.current = presetQty; }, [presetQty]);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
  useEffect(() => { feedRef.current = feed; }, [feed]);
  useEffect(() => { sessionCountRef.current = sessionCount; }, [sessionCount]);

  useEffect(() => {
    const persist = () => {
      saveSession({
        feed: feedRef.current,
        phase: phaseRef.current,
        currentUnit: currentUnitRef.current,
        currentProduct: currentProductRef.current,
        presetQty: presetQtyRef.current,
        soundOn: soundOnRef.current,
        sessionCount: sessionCountRef.current,
        savedAt: Date.now(),
      });
    };

    const saveInterval = setInterval(persist, 2000);

    const handleBeforeUnload = () => persist();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") persist();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(saveInterval);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      persist();
    };
  }, []);

  useEffect(() => {
    if (flash) {
      const t = setTimeout(() => setFlash(null), 600);
      return () => clearTimeout(t);
    }
  }, [flash]);

  const doLookup = useCallback(async (barcode: string) => {
    const res = await apiRequest("GET", `/api/barcodes/lookup/${encodeURIComponent(barcode)}`);
    return res.json();
  }, []);

  const doQuickLink = useCallback(async (body: { productBarcode: string; packageBarcode: string; packagingQty: number }) => {
    const res = await apiRequest("POST", "/api/barcodes/quick-link", body);
    return res.json();
  }, []);

  const doSave = useCallback(async (unitCode: string, pkgCode: string, qty: number, product: ProductInfo) => {
    const entryId = generateUUID();
    const entry: FeedEntry = {
      id: entryId,
      unitBarcode: unitCode,
      packageBarcode: pkgCode,
      productName: product.name,
      erpCode: product.erpCode,
      qty,
      timestamp: new Date().toISOString(),
      status: "saving",
    };

    setFeed(prev => [entry, ...prev]);

    try {
      await doQuickLink({
        productBarcode: unitCode,
        packageBarcode: pkgCode,
        packagingQty: qty,
      });

      setFeed(prev => prev.map(e => e.id === entryId ? { ...e, status: "saved" as const } : e));
      setSessionCount(c => c + 1);
      setFlash("success");
      if (soundOnRef.current) playBeep("success");
      queryClient.invalidateQueries({ queryKey: ["/api/barcodes"] });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Erro";
      setFeed(prev => prev.map(e => e.id === entryId ? { ...e, status: "error" as const, errorMsg: errMsg } : e));
      setFlash("error");
      if (soundOnRef.current) playBeep("error");
      toast({ variant: "destructive", title: "Erro ao salvar", description: errMsg || "Falha ao vincular" });
    }
  }, [doQuickLink, toast]);

  const retryPending = useCallback(async () => {
    const pendingEntries = feedRef.current.filter(e => e.status === "pending" || e.status === "error");
    if (pendingEntries.length === 0) return;

    setRetrying(true);
    let successCount = 0;

    for (const entry of pendingEntries) {
      setFeed(prev => prev.map(e => e.id === entry.id ? { ...e, status: "saving" as const, errorMsg: undefined } : e));

      try {
        await doQuickLink({
          productBarcode: entry.unitBarcode,
          packageBarcode: entry.packageBarcode,
          packagingQty: entry.qty,
        });

        setFeed(prev => prev.map(e => e.id === entry.id ? { ...e, status: "saved" as const } : e));
        successCount++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Erro";
        setFeed(prev => prev.map(e => e.id === entry.id ? { ...e, status: "error" as const, errorMsg: errMsg } : e));
      }
    }

    if (successCount > 0) {
      setSessionCount(c => c + successCount);
      if (soundOnRef.current) playBeep("success");
      queryClient.invalidateQueries({ queryKey: ["/api/barcodes"] });
    }

    setRetrying(false);
    setShowRecoveryBanner(false);
  }, [doQuickLink]);

  const processScan = useCallback(async (code: string) => {
    if (!code || processingRef.current) return;

    processingRef.current = true;
    setProcessing(true);

    try {
      if (phaseRef.current === "idle") {
        if (soundOnRef.current) playBeep("scan");

        const data = await doLookup(code);
        if (data.found && data.product) {
          setCurrentUnit(code);
          setCurrentProduct(data.product);
          setPhase("waitPkg");
        } else {
          setFlash("error");
          if (soundOnRef.current) playBeep("error");
          toast({ variant: "destructive", title: "Produto não encontrado", description: `Código "${code}" não corresponde a nenhum produto` });
        }
      } else if (phaseRef.current === "waitPkg" && currentProductRef.current) {
        const unit = currentUnitRef.current;
        const product = currentProductRef.current;

        if (code === unit) {
          if (soundOnRef.current) playBeep("error");
          toast({ variant: "destructive", title: "Mesmo código", description: "O código da embalagem deve ser diferente do unitário" });
        } else {
          let isOtherProduct = false;
          try {
            const lookupPkg = await doLookup(code);
            if (lookupPkg?.found && lookupPkg.product && lookupPkg.product.id !== product.id) {
              isOtherProduct = true;
              setCurrentUnit(code);
              setCurrentProduct(lookupPkg.product);
              if (soundOnRef.current) playBeep("scan");
              toast({ variant: "destructive", title: "Produto diferente detectado", description: `Trocou para: ${lookupPkg.product.erpCode} — ${lookupPkg.product.name}` });
            }
          } catch {}

          if (!isOtherProduct) {
            if (soundOnRef.current) playBeep("scan");
            doSave(unit, code, presetQtyRef.current, product);
            setPhase("idle");
            setCurrentUnit("");
            setCurrentProduct(null);
          }
        }
      }
    } catch {
      setFlash("error");
      if (soundOnRef.current) playBeep("error");
      toast({ variant: "destructive", title: "Erro", description: "Falha ao processar leitura" });
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  }, [doLookup, doSave, toast]);

  useBarcodeScanner(processScan, !processing);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target === customQtyInputRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (phaseRef.current === "waitPkg") {
          setPhase("idle");
          setCurrentUnit("");
          setCurrentProduct(null);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const removeFeedEntry = (id: string) => {
    setFeed(prev => prev.filter(e => e.id !== id));
  };

  const handleSetQty = (q: number) => {
    setPresetQty(q);
    setShowQtyPicker(false);
    setCustomQty("");
  };

  const handleCustomQty = () => {
    const q = Number(customQty);
    if (q >= 1 && Number.isInteger(q)) {
      handleSetQty(q);
    }
  };

  const cancelCurrent = () => {
    setPhase("idle");
    setCurrentUnit("");
    setCurrentProduct(null);
  };

  const clearAll = () => {
    setFeed([]);
    setSessionCount(0);
    setPhase("idle");
    setCurrentUnit("");
    setCurrentProduct(null);
    setShowRecoveryBanner(false);
    clearSession();
  };

  const dismissRecovery = () => {
    setFeed(prev => prev.filter(e => e.status !== "pending"));
    setShowRecoveryBanner(false);
  };

  const pendingCount = feed.filter(e => e.status === "pending" || e.status === "error").length;

  const borderColor = flash === "success" ? "border-green-500" : flash === "error" ? "border-red-500" : "border-border/50";

  return (
    <div className={cn(
      "min-h-screen bg-background transition-colors duration-300",
      flash === "success" && "bg-green-500/5",
      flash === "error" && "bg-red-500/5",
    )}>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Vínculo Rápido</h1>
            <p className="text-xs text-muted-foreground">Códigos de barras EAN</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sessionCount > 0 && (
            <Badge variant="outline" className="text-xs border-green-400/50 text-green-400" data-testid="badge-session-count">
              {sessionCount} salvo{sessionCount !== 1 ? "s" : ""}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => { setSoundOn(s => { const next = !s; persistSoundEnabled(next); return next; }); }}
            data-testid="button-toggle-sound"
          >
            {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
          </Button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-3 space-y-3 safe-bottom">

        {showRecoveryBanner && pendingCount > 0 && (
          <div className="rounded-2xl border-2 border-amber-500/50 bg-amber-500/10 p-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300" data-testid="recovery-banner">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-amber-400">Sessão recuperada</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {pendingCount} vínculo{pendingCount !== 1 ? "s" : ""} pendente{pendingCount !== 1 ? "s" : ""} da sessão anterior.
                  {feed.filter(e => e.status === "saved").length > 0 && (
                    <span> {feed.filter(e => e.status === "saved").length} já salvo{feed.filter(e => e.status === "saved").length !== 1 ? "s" : ""}.</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 h-9 rounded-xl font-semibold text-xs"
                onClick={retryPending}
                disabled={retrying}
                data-testid="button-retry-pending"
              >
                {retrying ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Reenviando...</>
                ) : (
                  <><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Reenviar {pendingCount} pendente{pendingCount !== 1 ? "s" : ""}</>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 rounded-xl text-xs"
                onClick={dismissRecovery}
                disabled={retrying}
                data-testid="button-dismiss-recovery"
              >
                Descartar
              </Button>
            </div>
          </div>
        )}

        <div className={cn(
          "rounded-2xl border-2 bg-card p-4 space-y-3 transition-all duration-300",
          borderColor,
          phase === "waitPkg" && !flash && "border-amber-500/60 bg-amber-500/5",
        )}>
          {phase === "idle" ? (
            <>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center shrink-0">
                  <Barcode className="h-5 w-5 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">Bipe o código UNITÁRIO</p>
                  <p className="text-xs text-muted-foreground">Escaneie o código de barras do produto</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-muted-foreground">Qtd/emb</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-8 px-3 rounded-xl font-bold text-base min-w-[44px] transition-all",
                      !showQtyPicker && "border-primary/50 text-primary bg-primary/5"
                    )}
                    onClick={() => setShowQtyPicker(!showQtyPicker)}
                    data-testid="button-qty-display"
                  >
                    {presetQty}
                  </Button>
                </div>
                {processing && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />}
              </div>
              {showQtyPicker && (
                <div className="flex flex-wrap gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                  {QUICK_QTY.map(q => (
                    <Button
                      key={q}
                      variant={q === presetQty ? "default" : "outline"}
                      size="sm"
                      className="h-8 px-2.5 rounded-lg text-xs font-semibold"
                      onClick={() => handleSetQty(q)}
                      data-testid={`button-qty-${q}`}
                    >
                      {q}
                    </Button>
                  ))}
                  <div className="flex items-center gap-1">
                    <Input
                      ref={customQtyInputRef}
                      type="number"
                      min="1"
                      value={customQty}
                      onChange={e => setCustomQty(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); handleCustomQty(); } }}
                      placeholder="..."
                      className="h-8 w-14 text-xs text-center rounded-lg px-1"
                      data-testid="input-custom-qty"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2 rounded-lg"
                      onClick={handleCustomQty}
                      disabled={!customQty || Number(customQty) < 1}
                      data-testid="button-custom-qty-ok"
                    >
                      OK
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0 animate-pulse">
                  <Package className="h-5 w-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">Agora bipe a EMBALAGEM</p>
                  <p className="text-xs text-muted-foreground">
                    Escaneie a caixa/fardo → salva com <span className="font-bold text-foreground">{presetQty}</span> un
                  </p>
                </div>
                {processing ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground shrink-0" />
                ) : (
                  <Button variant="ghost" size="sm" className="h-8 px-2 rounded-lg text-xs" onClick={cancelCurrent} data-testid="button-cancel-current">
                    ESC
                  </Button>
                )}
              </div>
              {currentProduct && (
                <div className="flex items-center gap-2 pl-[52px]">
                  <Badge variant="outline" className="text-[10px] border-green-400/50 text-green-400 max-w-full">
                    <span className="truncate">{currentProduct.erpCode} — {currentProduct.name}</span>
                  </Badge>
                </div>
              )}
            </div>
          )}

          <ScanInput
            placeholder={phase === "idle" ? "Leia o código unitário..." : "Leia o código da embalagem..."}
            onScan={processScan}
            disabled={processing}
            autoFocus
            showKeyboardToggle
            className={cn(
              phase === "waitPkg" && "[&_input]:border-amber-400/60 [&_input]:bg-amber-500/5"
            )}
            data-testid="input-scan-vinculo"
          />
        </div>

        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-muted-foreground">
            {phase === "idle" ? (
              <>Fluxo: <span className="text-blue-400">Unitário</span> → <span className="text-amber-400">Embalagem</span> → auto-salva</>
            ) : (
              <span className="text-amber-400 font-medium animate-pulse">Aguardando código da embalagem...</span>
            )}
          </p>
          {feed.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
              onClick={clearAll}
              data-testid="button-clear-feed"
            >
              Limpar tudo
            </Button>
          )}
        </div>

        {feed.length > 0 && (
          <div className="space-y-1.5 max-h-[calc(100vh-340px)] overflow-y-auto">
            {feed.map((entry, i) => (
              <div
                key={entry.id}
                className={cn(
                  "rounded-xl border p-3 transition-all duration-300",
                  i === 0 && entry.status === "saved" && "animate-in slide-in-from-top-2 fade-in duration-300",
                  entry.status === "saving" && "border-blue-400/30 bg-blue-500/5",
                  entry.status === "saved" && "border-green-500/30 bg-green-500/5",
                  entry.status === "error" && "border-red-500/30 bg-red-500/5",
                  entry.status === "pending" && "border-amber-400/30 bg-amber-500/5",
                )}
                data-testid={`feed-entry-${entry.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      {entry.status === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400 shrink-0" />}
                      {entry.status === "saved" && <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />}
                      {entry.status === "error" && <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                      {entry.status === "pending" && <RotateCcw className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                      <span className="text-sm font-medium truncate">{entry.erpCode} — {entry.productName}</span>
                    </div>
                    <div className="flex items-center gap-1.5 pl-5">
                      <span className="font-mono text-[11px] text-blue-400">{entry.unitBarcode}</span>
                      <span className="text-muted-foreground text-[10px]">→</span>
                      <span className="font-mono text-[11px] text-amber-400">{entry.packageBarcode}</span>
                      <span className="text-[10px] text-muted-foreground">=</span>
                      <span className="font-bold text-xs">{entry.qty}un</span>
                    </div>
                    {entry.status === "error" && entry.errorMsg && (
                      <p className="text-[10px] text-red-400 pl-5">{entry.errorMsg}</p>
                    )}
                    {entry.status === "pending" && (
                      <p className="text-[10px] text-amber-400 pl-5">Pendente — não foi enviado ao servidor</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(entry.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-md"
                      onClick={() => removeFeedEntry(entry.id)}
                      data-testid={`button-remove-${entry.id}`}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {feed.length === 0 && phase === "idle" && (
          <div className="rounded-2xl border border-dashed border-border/40 p-6 text-center space-y-2">
            <ScanLine className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">Comece escaneando o código unitário</p>
            <div className="text-xs text-muted-foreground/60 space-y-0.5">
              <p>1. Defina a quantidade por embalagem acima</p>
              <p>2. Escaneie o código <span className="text-blue-400">unitário</span> do produto</p>
              <p>3. Escaneie o código da <span className="text-amber-400">embalagem</span></p>
              <p>4. Salva automaticamente e passa pro próximo</p>
            </div>
            <div className="mt-3 pt-3 border-t border-border/20 flex items-center justify-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-green-400/60" />
              <p className="text-[10px] text-muted-foreground/40">Sessão protegida — dados recuperados se a página fechar</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
