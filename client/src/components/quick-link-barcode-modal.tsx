import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Loader2, Link2, Package, Barcode, Check, X } from "lucide-react";

const QUICK_QTY = [2, 3, 4, 6, 8, 10, 12, 15, 20, 24, 30, 36, 48, 50, 100];

export interface QuickLinkPrefilledProduct {
  barcode: string | null | undefined;
  name: string;
  erpCode: string;
}

interface QuickLinkBarcodeModalProps {
  open: boolean;
  onClose: () => void;
  prefilledProduct?: QuickLinkPrefilledProduct;
}

export function QuickLinkBarcodeModal({ open, onClose, prefilledProduct }: QuickLinkBarcodeModalProps) {
  const { toast } = useToast();

  const [phase, setPhase] = useState<"unit" | "package">("unit");
  const [unitBarcode, setUnitBarcode] = useState("");
  const [resolvedProduct, setResolvedProduct] = useState<{ name: string; erpCode: string } | null>(null);
  const [packageBarcode, setPackageBarcode] = useState("");
  const [qty, setQty] = useState(12);
  const [customQty, setCustomQty] = useState("");
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const unitInputRef = useRef<HTMLInputElement>(null);
  const packageInputRef = useRef<HTMLInputElement>(null);

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false;
      return;
    }
    if (prevOpenRef.current) return;
    prevOpenRef.current = true;
    setPackageBarcode("");
    setCustomQty("");
    setLastSaved(null);
    if (prefilledProduct?.barcode) {
      setUnitBarcode(prefilledProduct.barcode);
      setResolvedProduct({ name: prefilledProduct.name, erpCode: prefilledProduct.erpCode });
      setPhase("package");
    } else {
      setUnitBarcode("");
      setResolvedProduct(null);
      setPhase("unit");
    }
  }, [open, prefilledProduct]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (phase === "unit") unitInputRef.current?.focus();
      else packageInputRef.current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [phase, open]);

  const lookupUnit = useCallback(async (code: string) => {
    if (!code.trim()) return;
    setLooking(true);
    try {
      const res = await apiRequest("GET", `/api/barcodes/lookup/${encodeURIComponent(code.trim())}`);
      const data = await res.json();
      if (data?.id) {
        setResolvedProduct({ name: data.name, erpCode: data.erpCode });
        setPhase("package");
      } else {
        toast({ variant: "destructive", title: "Produto não encontrado", description: "Código unitário não reconhecido." });
        unitInputRef.current?.select();
      }
    } catch {
      toast({ variant: "destructive", title: "Erro", description: "Falha ao buscar produto." });
    } finally {
      setLooking(false);
    }
  }, [toast]);

  const save = useCallback(async () => {
    if (!packageBarcode.trim() || qty <= 0 || !unitBarcode) return;
    setSaving(true);
    try {
      const res = await apiRequest("POST", "/api/barcodes/quick-link", {
        productBarcode: unitBarcode.trim(),
        packageBarcode: packageBarcode.trim(),
        packagingQty: qty,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(err.error || "Falha ao vincular");
      }
      const saved = packageBarcode.trim();
      setLastSaved(saved);
      setPackageBarcode("");
      toast({ title: "Código vinculado!", description: `${saved} → ${resolvedProduct?.name ?? ""} (${qty} un)` });
      setTimeout(() => packageInputRef.current?.focus(), 60);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao vincular";
      toast({ variant: "destructive", title: "Erro ao vincular", description: msg });
    } finally {
      setSaving(false);
    }
  }, [packageBarcode, qty, unitBarcode, resolvedProduct, toast]);

  const handleQtyChange = useCallback((val: string) => {
    const v = val.replace(/\D/g, "");
    setCustomQty(v);
    const n = parseInt(v);
    if (n > 0) setQty(n);
  }, []);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 shrink-0" />
            Vínculo Rápido de Embalagem
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-1">
          {resolvedProduct ? (
            <div className="rounded-lg border bg-muted/40 px-3 py-2.5 flex items-start gap-2">
              <Package className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Produto identificado</p>
                <p className="text-sm font-semibold leading-tight break-words">{resolvedProduct.name}</p>
                <p className="text-xs font-mono text-muted-foreground mt-0.5">Cód.: {resolvedProduct.erpCode}</p>
                {unitBarcode && (
                  <p className="text-[11px] font-mono text-muted-foreground/60 mt-0.5">Unitário: {unitBarcode}</p>
                )}
              </div>
              {!prefilledProduct?.barcode && (
                <button
                  className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => { setResolvedProduct(null); setUnitBarcode(""); setPhase("unit"); }}
                  data-testid="button-clear-unit-product"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Barcode className="h-3.5 w-3.5" />
                Código de barras unitário
              </label>
              <div className="flex gap-2">
                <Input
                  ref={unitInputRef}
                  value={unitBarcode}
                  onChange={e => setUnitBarcode(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && unitBarcode.trim()) lookupUnit(unitBarcode); }}
                  placeholder="Bipar ou digitar código unitário..."
                  disabled={looking}
                  inputMode="none"
                  className="font-mono text-sm"
                  data-testid="input-unit-barcode-quicklink"
                />
                <Button
                  size="sm"
                  onClick={() => lookupUnit(unitBarcode)}
                  disabled={!unitBarcode.trim() || looking}
                  data-testid="button-lookup-unit-quicklink"
                >
                  {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : "OK"}
                </Button>
              </div>
            </div>
          )}

          {phase === "package" && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5" />
                  Código de barras da embalagem
                </label>
                {lastSaved && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    Último vinculado: <span className="font-mono">{lastSaved}</span>
                  </div>
                )}
                <Input
                  ref={packageInputRef}
                  value={packageBarcode}
                  onChange={e => setPackageBarcode(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && packageBarcode.trim()) save(); }}
                  placeholder="Bipar ou digitar código da embalagem..."
                  disabled={saving}
                  inputMode="none"
                  className="font-mono text-sm"
                  data-testid="input-package-barcode-quicklink"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Quantidade por embalagem</label>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_QTY.map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => { setQty(q); setCustomQty(""); }}
                      className={cn(
                        "text-xs px-2.5 py-1 rounded-md border font-mono transition-colors",
                        qty === q && customQty === ""
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:border-primary/50 text-muted-foreground hover:text-foreground"
                      )}
                      data-testid={`button-qty-${q}-quicklink`}
                    >
                      {q}
                    </button>
                  ))}
                  <Input
                    value={customQty}
                    onChange={e => handleQtyChange(e.target.value)}
                    placeholder="outro"
                    className="w-16 h-7 text-xs font-mono px-2"
                    inputMode="numeric"
                    data-testid="input-custom-qty-quicklink"
                  />
                </div>
              </div>

              <Button
                onClick={save}
                disabled={!packageBarcode.trim() || saving || qty <= 0}
                className="w-full"
                data-testid="button-save-quicklink"
              >
                {saving
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <Link2 className="h-4 w-4 mr-2" />}
                Vincular ({qty} un)
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
