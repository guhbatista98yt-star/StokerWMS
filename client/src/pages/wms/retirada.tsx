import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, PackageMinus, MapPin, Loader2, Package,
  CheckCircle2, AlertTriangle, RotateCcw,
} from "lucide-react";
import { useLocation } from "wouter";
import { PalletFinder } from "@/components/wms/pallet-finder";
import { PalletItemList } from "@/components/wms/pallet-item-list";

type WithdrawReason = "abastecimento_pick" | "saida_avulsa" | "outro";

const REASON_LABELS: Record<WithdrawReason, string> = {
  abastecimento_pick: "Abastecimento Pick",
  saida_avulsa: "Saída Avulsa",
  outro: "Outro motivo",
};

export default function RetiradaPage() {
  const [, navigate] = useLocation();
  const { companyId } = useAuth();
  const { toast } = useToast();

  const [palletDetail, setPalletDetail] = useState<any>(null);
  const [withdrawQtys, setWithdrawQtys] = useState<Map<string, number>>(new Map());
  const [reason, setReason] = useState<WithdrawReason>("abastecimento_pick");
  const [notes, setNotes] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [done, setDone] = useState(false);

  const handleQtyChange = (key: string, value: number, max: number) => {
    setWithdrawQtys(prev => {
      const next = new Map(prev);
      next.set(key, Math.max(0, Math.min(value, max)));
      return next;
    });
  };

  const itemsToWithdraw = palletDetail?.items?.filter((item: any) =>
    (withdrawQtys.get(item.id) ?? 0) > 0
  ) ?? [];

  const withdrawMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        items: itemsToWithdraw.map((item: any) => ({
          palletItemId: item.id,
          quantity: withdrawQtys.get(item.id)!,
        })),
        reason,
        notes: notes.trim() || undefined,
      };
      const res = await apiRequest("POST", `/api/pallets/${palletDetail.id}/withdraw`, payload);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao registrar retirada");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pallets-by-address"] });
      setShowConfirm(false);
      setDone(true);
    },
    onError: (err: Error) => {
      toast({ title: err.message, variant: "destructive" });
      setShowConfirm(false);
    },
  });

  const handleReset = () => {
    setPalletDetail(null);
    setWithdrawQtys(new Map());
    setNotes("");
    setReason("abastecimento_pick");
    setDone(false);
  };

  const addressObj = palletDetail?.address || null;

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-base font-semibold text-foreground leading-tight flex items-center gap-2">
            <PackageMinus className="h-4 w-4 text-amber-500" />
            Retirada de Produto
          </h1>
          <p className="text-xs text-muted-foreground">Remova itens de um pallet endereçado</p>
        </div>
        {palletDetail && !done && (
          <Button variant="ghost" size="sm" className="h-8 text-xs rounded-lg" onClick={handleReset} data-testid="button-reset">
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Trocar
          </Button>
        )}
      </div>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-3 safe-bottom">
        {done ? (
          <div className="rounded-2xl border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/30 p-6 text-center animate-scale-in space-y-3">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400 mx-auto" />
            <p className="text-base font-semibold text-emerald-700 dark:text-emerald-300">Retirada realizada!</p>
            <Button onClick={handleReset} className="h-12 rounded-xl px-6" data-testid="button-new-withdrawal">
              Nova Retirada
            </Button>
          </div>
        ) : !palletDetail ? (
          <PalletFinder
            onPalletSelected={(pallet) => {
              setPalletDetail(pallet);
              setWithdrawQtys(new Map());
            }}
            statusFilter="alocado"
            showAddressMode={true}
            defaultMode="address"
            label="Localizar pallet"
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
              {addressObj && (
                <div className="flex items-center gap-2 px-4 py-2 bg-muted/20 border-b border-border/30">
                  <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-xs text-muted-foreground">Endereço:</span>
                  <span className="font-mono font-bold text-xs text-primary">{addressObj.code}</span>
                </div>
              )}
              <PalletItemList
                items={palletDetail.items || []}
                mode="withdraw"
                quantities={withdrawQtys}
                onQuantityChange={handleQtyChange}
              />
            </div>

            {itemsToWithdraw.length > 0 && (
              <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Motivo da Retirada</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(REASON_LABELS) as WithdrawReason[]).map(r => (
                    <Button
                      key={r}
                      variant={reason === r ? "default" : "outline"}
                      size="sm"
                      className="h-8 text-xs rounded-lg"
                      onClick={() => setReason(r)}
                      data-testid={`button-reason-${r}`}
                    >
                      {REASON_LABELS[r]}
                    </Button>
                  ))}
                </div>
                <Textarea
                  placeholder="Observações (opcional)..."
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="rounded-xl resize-none text-sm"
                  rows={2}
                  data-testid="input-notes"
                />
                <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    <strong>{itemsToWithdraw.length}</strong> item(ns) selecionado(s) para retirada
                  </p>
                </div>
                <Button
                  className="w-full h-14 text-sm font-semibold rounded-xl shadow-lg shadow-primary/15 active:scale-[0.98] transition-all"
                  onClick={() => setShowConfirm(true)}
                  data-testid="button-confirm-withdraw"
                >
                  <PackageMinus className="h-4 w-4 mr-2" /> Confirmar Retirada
                </Button>
              </div>
            )}
          </div>
        )}
      </main>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirmar Retirada
            </AlertDialogTitle>
            <AlertDialogDescription>
              Retirar <strong>{itemsToWithdraw.length} item(ns)</strong> do pallet <strong className="font-mono">{palletDetail?.code}</strong>?
              <br />
              Motivo: <strong>{REASON_LABELS[reason]}</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {itemsToWithdraw.map((item: any) => (
              <div key={item.id} className="flex justify-between text-sm px-1">
                <span className="truncate">{item.product?.name || "Produto"}</span>
                <span className="font-mono font-bold text-amber-600 shrink-0 ml-2">-{withdrawQtys.get(item.id)}</span>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl" data-testid="button-cancel-confirm">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => withdrawMutation.mutate()} disabled={withdrawMutation.isPending} className="rounded-xl" data-testid="button-execute-withdraw">
              {withdrawMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PackageMinus className="h-4 w-4 mr-2" />}
              Retirar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
