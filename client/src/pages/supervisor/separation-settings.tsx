import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SectionCard } from "@/components/ui/section-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { ArrowLeft, Settings, Package, Layers, AlertTriangle, CheckCircle2, RefreshCcw, Link2, ToggleLeft, ToggleRight } from "lucide-react";

type SeparationMode = "by_order" | "by_section";

interface SeparationModeData {
  separationMode: SeparationMode;
  updatedAt: string;
  updatedBy: string | null;
}

interface ConflictData {
  error: string;
  conflicts: {
    activeSessions: number;
    activeWorkUnits: number;
    affectedSections: string[];
    activeUsers: string[];
  };
  message: string;
}

export default function SeparationSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [targetMode, setTargetMode] = useState<SeparationMode | null>(null);
  const [conflictData, setConflictData] = useState<ConflictData | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showForceDialog, setShowForceDialog] = useState(false);

  const { data: settings, isLoading } = useQuery<SeparationModeData>({
    queryKey: ["/api/system-settings/separation-mode"],
  });

  const { data: featureSettings, isLoading: featuresLoading } = useQuery<{ quickLinkEnabled: boolean }>({
    queryKey: ["/api/system-settings/features"],
  });

  const featureMutation = useMutation({
    mutationFn: async (quickLinkEnabled: boolean) => {
      const res = await apiRequest("PATCH", "/api/system-settings/features", { quickLinkEnabled });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao alterar configuração");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-settings/features"] });
      toast({ description: "Configuração de funcionalidades atualizada." });
    },
    onError: (e: Error) => {
      toast({ variant: "destructive", description: e.message });
    },
  });

  const changeMutation = useMutation({
    mutationFn: async ({ mode, force }: { mode: SeparationMode; force?: boolean }) => {
      const res = await apiRequest("PATCH", "/api/system-settings/separation-mode", { mode, force });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          throw { status: 409, data };
        }
        throw new Error(data.error || "Erro ao alterar modo");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-settings/separation-mode"] });
      setShowConfirmDialog(false);
      setShowForceDialog(false);
      setConflictData(null);
      setTargetMode(null);
      toast({
        title: "Modo de separação alterado",
        description: "O modo foi atualizado com sucesso.",
      });
    },
    onError: (error: any) => {
      if (error?.status === 409 && error?.data) {
        setConflictData(error.data);
        setShowConfirmDialog(false);
        setShowForceDialog(true);
        return;
      }
      toast({
        title: "Erro",
        description: error instanceof Error ? error.message : "Erro ao alterar modo de separação",
        variant: "destructive",
      });
    },
  });

  const handleModeSelect = (mode: SeparationMode) => {
    if (mode === settings?.separationMode) return;
    setTargetMode(mode);
    setConflictData(null);
    setShowConfirmDialog(true);
  };

  const handleConfirm = () => {
    if (!targetMode) return;
    changeMutation.mutate({ mode: targetMode });
  };

  const handleForce = () => {
    if (!targetMode) return;
    changeMutation.mutate({ mode: targetMode, force: true });
  };

  const modeLabel = (mode: SeparationMode) => mode === "by_order" ? "Por Pedido/Rota" : "Por Seção";

  const currentMode = settings?.separationMode ?? "by_order";

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Modo de Separação</h1>
            <p className="text-xs text-muted-foreground">Configurar como os itens são separados</p>
          </div>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <SectionCard title="Modo Ativo" icon={<Settings className="h-4 w-4 text-primary" />}>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <RefreshCcw className="h-4 w-4 animate-spin" />
              Carregando configurações...
            </div>
          ) : (
            <div className="flex items-center gap-3 py-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <div>
                <span className="font-semibold text-lg" data-testid="text-current-mode">
                  {modeLabel(currentMode)}
                </span>
                {settings?.updatedAt && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Atualizado em {new Date(settings.updatedAt).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>
              <Badge
                variant="outline"
                className={currentMode === "by_order" ? "bg-blue-100 text-blue-700 border-0 ml-auto" : "bg-purple-100 text-purple-700 border-0 ml-auto"}
              >
                {currentMode === "by_order" ? "Por Pedido" : "Por Seção"}
              </Badge>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Alterar Modo" icon={<Layers className="h-4 w-4 text-primary" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            <button
              className={`rounded-xl border-2 p-5 text-left transition-all cursor-pointer hover:shadow-md ${
                currentMode === "by_order"
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                  : "border-border hover:border-blue-300"
              }`}
              onClick={() => handleModeSelect("by_order")}
              data-testid="button-mode-by-order"
              disabled={changeMutation.isPending}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Package className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold">Por Pedido / Rota</p>
                  {currentMode === "by_order" && (
                    <Badge variant="outline" className="bg-blue-100 text-blue-700 border-0 text-xs mt-0.5">Ativo</Badge>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                O separador vê o pedido inteiro com todos os produtos. Apenas um operador por pedido — exclusivo.
              </p>
            </button>

            <button
              className={`rounded-xl border-2 p-5 text-left transition-all cursor-pointer hover:shadow-md ${
                currentMode === "by_section"
                  ? "border-purple-500 bg-purple-50 dark:bg-purple-950/20"
                  : "border-border hover:border-purple-300"
              }`}
              onClick={() => handleModeSelect("by_section")}
              data-testid="button-mode-by-section"
              disabled={changeMutation.isPending}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <Layers className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="font-semibold">Por Seção</p>
                  {currentMode === "by_section" && (
                    <Badge variant="outline" className="bg-purple-100 text-purple-700 border-0 text-xs mt-0.5">Ativo</Badge>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                O separador vê todos os pedidos, mas coleta apenas os produtos das suas seções. Vários operadores podem entrar no mesmo pedido simultaneamente.
              </p>
            </button>
          </div>

          <div className="mt-4 rounded-lg bg-muted/40 border border-border p-3">
            <p className="text-xs text-muted-foreground">
              <strong>Atenção:</strong> A troca de modo será verificada antes de ser aplicada.
              Se houver separações em andamento, o sistema irá notificar e solicitar confirmação para forçar a troca.
            </p>
          </div>
        </SectionCard>

        <SectionCard title="Funcionalidades" icon={<Link2 className="h-4 w-4 text-primary" />}>
          {featuresLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <RefreshCcw className="h-4 w-4 animate-spin" />
              Carregando configurações...
            </div>
          ) : (
            <div className="py-2">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Link2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Vínculo Rápido de Embalagem</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Exibe o botão de vínculo rápido (ícone de corrente) nos módulos de separação, conferência e balcão.
                    </p>
                  </div>
                </div>
                <button
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  onClick={() => featureMutation.mutate(!(featureSettings?.quickLinkEnabled ?? true))}
                  disabled={featureMutation.isPending}
                  data-testid="button-toggle-quick-link"
                  title={featureSettings?.quickLinkEnabled ? "Desativar vínculo rápido" : "Ativar vínculo rápido"}
                >
                  {(featureSettings?.quickLinkEnabled ?? true)
                    ? <ToggleRight className="h-8 w-8 text-green-600" />
                    : <ToggleLeft className="h-8 w-8" />
                  }
                </button>
              </div>
            </div>
          )}
        </SectionCard>
      </main>

      {/* Confirm dialog (no conflicts) */}
      <Dialog open={showConfirmDialog} onOpenChange={(open) => { if (!open) { setShowConfirmDialog(false); setTargetMode(null); } }}>
        <DialogContent data-testid="dialog-confirm-mode">
          <DialogHeader>
            <DialogTitle>Confirmar troca de modo</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja alterar o modo de separação para{" "}
              <strong>{targetMode ? modeLabel(targetMode) : ""}</strong>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowConfirmDialog(false); setTargetMode(null); }} data-testid="button-cancel-mode-change">
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={changeMutation.isPending} data-testid="button-confirm-mode-change">
              {changeMutation.isPending ? "Aplicando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force dialog (conflicts detected) */}
      <Dialog open={showForceDialog} onOpenChange={(open) => { if (!open) { setShowForceDialog(false); setTargetMode(null); setConflictData(null); } }}>
        <DialogContent data-testid="dialog-force-mode">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Separações em andamento detectadas
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Foram detectadas atividades em andamento que podem ser afetadas pela troca de modo.
                </p>
                {conflictData?.conflicts && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3 space-y-2">
                    {conflictData.conflicts.activeSessions > 0 && (
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200" data-testid="text-active-sessions">
                        • {conflictData.conflicts.activeSessions} sessão(ões) de picking ativa(s)
                      </p>
                    )}
                    {conflictData.conflicts.activeWorkUnits > 0 && (
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200" data-testid="text-active-work-units">
                        • {conflictData.conflicts.activeWorkUnits} unidade(s) de trabalho em andamento
                      </p>
                    )}
                    {conflictData.conflicts.affectedSections?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">Seções afetadas:</p>
                        <div className="flex flex-wrap gap-1" data-testid="list-affected-sections">
                          {conflictData.conflicts.affectedSections.map(s => (
                            <span key={s} className="inline-block bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 text-xs rounded px-1.5 py-0.5">{s}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {conflictData.conflicts.activeUsers?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">Separadores em andamento:</p>
                        <div className="flex flex-wrap gap-1" data-testid="list-active-users">
                          {conflictData.conflicts.activeUsers.map(u => (
                            <span key={u} className="inline-block bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 text-xs rounded px-1.5 py-0.5">{u}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-sm">
                  Você pode aguardar as separações concluírem ou <strong>forçar a troca agora</strong>, o que cancelará todas as sessões ativas e resetará as unidades de trabalho em andamento para "pendente". Esta ação será registrada no log de auditoria.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => { setShowForceDialog(false); setTargetMode(null); setConflictData(null); }} data-testid="button-wait-sessions">
              Aguardar conclusão
            </Button>
            <Button variant="destructive" onClick={handleForce} disabled={changeMutation.isPending} data-testid="button-force-mode-change">
              {changeMutation.isPending ? "Forçando troca..." : "Forçar troca agora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
