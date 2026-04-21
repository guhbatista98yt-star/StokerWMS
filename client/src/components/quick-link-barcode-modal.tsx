import { useState, useEffect, useCallback, useRef } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScanInput } from "@/components/ui/scan-input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Loader2, Link2, Package, Check, X, Eraser } from "lucide-react";

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
  /** Quando false, bloqueia digitação manual e teclado virtual. */
  manualInputAllowed?: boolean;
  /**
   * Callback chamado após o vínculo ser salvo no servidor com sucesso.
   * O modal aguarda (await) a resolução antes de mostrar o toast de sucesso,
   * permitindo que o pai refaça fetch dos seus próprios caches (work-units,
   * picking lists, etc.) para que o EAN recém-criado seja reconhecido
   * imediatamente na próxima leitura. Erros são engolidos: o vínculo já está
   * salvo no servidor, a UI do pai apenas pode demorar um pouco mais a refletir.
   */
  onLinked?: () => void | Promise<void>;
}

export function QuickLinkBarcodeModal({ open, onClose, prefilledProduct, manualInputAllowed = true, onLinked }: QuickLinkBarcodeModalProps) {
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
  const [scanMessage, setScanMessage] = useState<string>("");
  const [scanStatus, setScanStatus] = useState<"idle" | "success" | "error">("idle");

  // Rastreia a transição de fechado→aberto para evitar resetar estado enquanto o modal
  // já está aberto. O pai cria um novo objeto `prefilledProduct` a cada render, o que
  // dispararia o effect sem querer e apagaria o que o usuário já digitou.
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;

    setPackageBarcode("");
    setCustomQty("");
    setLastSaved(null);
    setScanMessage("");
    setScanStatus("idle");
    if (prefilledProduct?.barcode) {
      setUnitBarcode(prefilledProduct.barcode);
      setResolvedProduct({ name: prefilledProduct.name, erpCode: prefilledProduct.erpCode });
      setPhase("package");
    } else {
      setUnitBarcode("");
      setResolvedProduct(null);
      setPhase("unit");
    }
  // prefilledProduct é lido pela closure no momento em que o modal abre (open true→true
  // nunca dispara, só false→true). Dependência intencional apenas em `open`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lookupUnit = useCallback(async (code: string) => {
    if (!code.trim()) return;
    setLooking(true);
    try {
      const res = await apiRequest("GET", `/api/barcodes/lookup/${encodeURIComponent(code.trim())}`);
      const data = await res.json();
      if (data?.id) {
        setResolvedProduct({ name: data.name, erpCode: data.erpCode });
        setUnitBarcode(code.trim());
        setPhase("package");
      } else {
        toast({ variant: "destructive", title: "Produto não encontrado", description: "Código unitário não reconhecido." });
      }
    } catch {
      toast({ variant: "destructive", title: "Erro", description: "Falha ao buscar produto." });
    } finally {
      setLooking(false);
    }
  }, [toast]);

  // Recebe scan/digit do ScanInput de embalagem — apenas preenche campo, NÃO salva.
  const handlePackageScan = useCallback((value: string) => {
    setPackageBarcode(value.trim());
    setScanStatus("success");
    setScanMessage("Código capturado. Confira a quantidade e clique em Vincular.");
  }, []);

  const clearPackage = () => {
    setPackageBarcode("");
    setScanMessage("");
    setScanStatus("idle");
  };

  const save = useCallback(async () => {
    if (!packageBarcode.trim() || qty <= 0 || !unitBarcode) return;

    // Validação extra: não permitir embalagem == unitário
    if (packageBarcode.trim() === unitBarcode.trim()) {
      toast({ variant: "destructive", title: "Códigos iguais", description: "O código da embalagem não pode ser igual ao unitário." });
      return;
    }

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
      setScanStatus("idle");
      setScanMessage("");

      // Invalidar caches globais de catálogo para que o novo código seja reconhecido
      // imediatamente em outras telas (cadastros, busca, etc.).
      queryClient.invalidateQueries({ queryKey: ["/api/barcodes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products/search"] });

      // Aguarda o pai refazer fetch dos seus caches específicos (ex.: work-units do
      // módulo de coleta), garantindo que a próxima leitura do EAN recém-criado já
      // encontre o produto. Sem isso, o cache local da página de coleta fica defasado
      // e o operador vê "Produto não encontrado nos seus pedidos em aberto".
      if (onLinked) {
        try {
          await onLinked();
        } catch (cbErr) {
          // Não bloquear o sucesso por erro no refetch do pai — o vínculo já foi salvo.
          console.warn("[QuickLink] onLinked callback falhou:", cbErr);
        }
      }

      toast({ title: "Código vinculado!", description: `${saved} → ${resolvedProduct?.name ?? ""} (${qty} un)` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha ao vincular";
      toast({ variant: "destructive", title: "Erro ao vincular", description: msg });
      setScanStatus("error");
      setScanMessage(msg);
    } finally {
      setSaving(false);
    }
  }, [packageBarcode, qty, unitBarcode, resolvedProduct, toast, onLinked]);

  const handleQtyChange = useCallback((val: string) => {
    const v = val.replace(/\D/g, "");
    setCustomQty(v);
    const n = parseInt(v);
    if (n > 0) setQty(n);
  }, []);

  const canSave = !!packageBarcode.trim() && !saving && qty > 0;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col" data-scan-exclude="true">
        <SheetHeader className="px-4 py-3 border-b border-border/50 shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 shrink-0 text-primary" />
            Vínculo Rápido de Embalagem
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {/* Produto identificado */}
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
                  data-scan-exclude="true"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium">
                Código de barras unitário do produto
              </label>
              <ScanInput
                placeholder="Bipar ou digitar código unitário..."
                onScan={lookupUnit}
                status={looking ? "warning" : "idle"}
                statusMessage={looking ? "Buscando produto..." : undefined}
                showKeyboardToggle
                manualInputAllowed={manualInputAllowed}
                autoFocus
                className="[&_input]:h-11 [&_input]:text-base"
              />
            </div>
          )}

          {phase === "package" && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">
                  Código de barras da embalagem (múltiplo)
                </label>
                {lastSaved && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    Último vinculado: <span className="font-mono">{lastSaved}</span>
                  </div>
                )}

                <ScanInput
                  placeholder="Bipar ou digitar código da embalagem..."
                  value={packageBarcode}
                  onChange={(v) => { setPackageBarcode(v); setScanStatus("idle"); setScanMessage(""); }}
                  onScan={handlePackageScan}
                  status={scanStatus}
                  statusMessage={scanMessage}
                  showKeyboardToggle
                  manualInputAllowed={manualInputAllowed}
                  autoFocus={!resolvedProduct ? false : true}
                  className="[&_input]:h-11 [&_input]:text-base"
                />

                {packageBarcode && (
                  <button
                    type="button"
                    onClick={clearPackage}
                    className="self-start text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
                    data-scan-exclude="true"
                  >
                    <Eraser className="h-3 w-3" />
                    Limpar código antes de vincular
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Quantidade por embalagem</label>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_QTY.map((q) => (
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
                      data-scan-exclude="true"
                    >
                      {q}
                    </button>
                  ))}
                  <input
                    value={customQty}
                    onChange={(e) => handleQtyChange(e.target.value)}
                    placeholder="outro"
                    className="w-16 h-7 text-xs font-mono px-2 rounded-md border border-border bg-background"
                    inputMode="numeric"
                    data-testid="input-custom-qty-quicklink"
                    data-scan-exclude="true"
                  />
                </div>
              </div>

              <div className="bg-muted/40 border border-border/50 rounded-md px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
                Confira o código capturado e a quantidade. <span className="font-semibold text-foreground">Nada é salvo automaticamente</span> — clique em <span className="font-semibold text-foreground">Vincular</span> para confirmar. O novo código será reconhecido imediatamente nos módulos de coleta.
              </div>
            </>
          )}
        </div>

        {phase === "package" && (
          <div className="border-t border-border/50 px-4 py-3 shrink-0 flex gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={saving}
              data-scan-exclude="true"
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={save}
              disabled={!canSave}
              className="flex-1"
              data-testid="button-save-quicklink"
              data-scan-exclude="true"
            >
              {saving
                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                : <Link2 className="h-4 w-4 mr-2" />}
              Vincular ({qty} un)
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
