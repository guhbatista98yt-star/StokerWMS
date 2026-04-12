import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Loader2,
  ShieldAlert,
  CheckCircle,
  Package,
  Users,
  Warehouse,
  BarChart3,
  PackagePlus,
  ScrollText,
  ClipboardList,
  Barcode,
  CheckSquare,
  Square,
} from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";

interface ModuleGroup {
  id: string;
  label: string;
  description: string;
  icon: any;
  iconColor: string;
  tables: { name: string; label: string }[];
  includesModules?: string[];
  danger?: boolean;
}

const MODULE_GROUPS: ModuleGroup[] = [
  {
    id: "pedidos",
    label: "Pedidos & Separação",
    description: "Remove todos os pedidos importados, work units, sessões de picking, exceções e volumes.",
    icon: Package,
    iconColor: "text-blue-500",
    tables: [
      { name: "orders", label: "Pedidos" },
      { name: "order_items", label: "Itens de pedido" },
      { name: "work_units", label: "Work units" },
      { name: "exceptions", label: "Exceções" },
      { name: "picking_sessions", label: "Sessões de separação" },
      { name: "order_volumes", label: "Volumes de pedidos" },
      { name: "cache_orcamentos", label: "Cache de orçamentos" },
    ],
  },
  {
    id: "recebimento",
    label: "Recebimento & NFs",
    description: "Remove o cache de notas fiscais e todos os dados de recebimento importados.",
    icon: PackagePlus,
    iconColor: "text-violet-500",
    tables: [
      { name: "nf_cache", label: "Notas fiscais (cache)" },
      { name: "nf_items", label: "Itens das NFs" },
    ],
  },
  {
    id: "pallets",
    label: "Pallets & Movimentações",
    description: "Remove pallets criados, seus itens e o histórico completo de movimentações.",
    icon: ScrollText,
    iconColor: "text-orange-500",
    tables: [
      { name: "pallets", label: "Pallets" },
      { name: "pallet_items", label: "Itens dos pallets" },
      { name: "pallet_movements", label: "Movimentações" },
    ],
  },
  {
    id: "contagens",
    label: "Ciclos de Contagem",
    description: "Remove todos os ciclos de inventário e seus itens.",
    icon: BarChart3,
    iconColor: "text-amber-500",
    tables: [
      { name: "counting_cycles", label: "Ciclos de contagem" },
      { name: "counting_cycle_items", label: "Itens dos ciclos" },
    ],
  },
  {
    id: "enderecos",
    label: "Endereços WMS",
    description: "Remove todos os endereços de armazenagem. Inclui automaticamente pallets, contagens e estoque.",
    icon: Warehouse,
    iconColor: "text-red-500",
    tables: [
      { name: "wms_addresses", label: "Endereços WMS" },
      { name: "product_company_stock", label: "Estoque por endereço" },
    ],
    includesModules: ["pallets", "contagens"],
    danger: true,
  },
  {
    id: "barcodes",
    label: "Códigos de Barras",
    description: "Remove todos os EANs vinculados e o histórico de alterações de códigos de barras.",
    icon: Barcode,
    iconColor: "text-teal-500",
    tables: [
      { name: "product_barcodes", label: "EANs vinculados" },
      { name: "barcode_change_history", label: "Histórico de alterações" },
    ],
  },
  {
    id: "usuarios",
    label: "Usuários sem movimentações",
    description: "Remove apenas usuários que não possuem nenhum registro vinculado a pedidos, separação, conferência, pallets ou contagens.",
    icon: Users,
    iconColor: "text-cyan-500",
    tables: [
      { name: "users", label: "Usuários sem registros" },
    ],
  },
  {
    id: "logs",
    label: "Logs & Auditoria",
    description: "Remove o histórico de operações e logs de auditoria do sistema.",
    icon: ClipboardList,
    iconColor: "text-slate-500",
    tables: [
      { name: "audit_logs", label: "Logs de auditoria" },
    ],
  },
];

type CountsData = {
  pedidos: Record<string, number>;
  recebimento: Record<string, number>;
  pallets: Record<string, number>;
  contagens: Record<string, number>;
  enderecos: Record<string, number>;
  barcodes: Record<string, number>;
  usuarios: Record<string, number>;
  logs: Record<string, number>;
};

const TABLE_LABELS: Record<string, string> = {
  orders: "Pedidos",
  order_items: "Itens de pedido",
  work_units: "Work units",
  exceptions: "Exceções",
  picking_sessions: "Sessões de separação",
  order_volumes: "Volumes",
  cache_orcamentos: "Cache orçamentos",
  nf_cache: "NFs (cache)",
  nf_items: "Itens NF",
  pallets: "Pallets",
  pallet_items: "Itens pallet",
  pallet_movements: "Movimentações",
  counting_cycles: "Ciclos contagem",
  counting_cycle_items: "Itens ciclo",
  wms_addresses: "Endereços WMS",
  product_company_stock: "Estoque",
  product_barcodes: "EANs vinculados",
  barcode_change_history: "Histórico EAN",
  audit_logs: "Logs auditoria",
  users: "Usuários",
};

function sumModule(counts: CountsData, moduleId: string): number {
  const moduleData = (counts as any)[moduleId];
  if (!moduleData) return 0;
  return Object.values(moduleData).reduce((sum: number, v: any) => sum + Number(v), 0);
}

function totalForSelection(counts: CountsData, selected: string[]): number {
  const effModules = new Set(selected);
  selected.forEach(m => {
    const grp = MODULE_GROUPS.find(g => g.id === m);
    grp?.includesModules?.forEach(im => effModules.add(im));
  });
  let total = 0;
  effModules.forEach(m => { total += sumModule(counts, m); });
  return total;
}

export default function LimpezaPage() {
  const { companyId } = useAuth();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [lastResult, setLastResult] = useState<{ deleted: Record<string, number>; modulesProcessed: string[] } | null>(null);

  const { data: counts, isLoading: countsLoading, refetch: refetchCounts } = useQuery<CountsData>({
    queryKey: ["/api/admin/cleanup/counts", companyId],
    enabled: !!companyId,
    staleTime: 10_000,
  });

  const cleanupMutation = useMutation({
    mutationFn: async (modules: string[]) => {
      const res = await apiRequest("POST", "/api/admin/cleanup", { modules, confirmation: "LIMPAR DADOS" });
      return res.json();
    },
    onSuccess: (data) => {
      setLastResult(data);
      setConfirmOpen(false);
      setConfirmText("");
      setSelected(new Set());
      refetchCounts();
      toast({ title: "Limpeza concluída", description: "Os dados selecionados foram removidos com sucesso." });
    },
    onError: (err: any) => {
      toast({ title: "Erro na limpeza", description: err?.message || "Tente novamente.", variant: "destructive" });
    },
  });

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const effectiveModules = () => {
    const eff = new Set(selected);
    selected.forEach(m => {
      MODULE_GROUPS.find(g => g.id === m)?.includesModules?.forEach(im => eff.add(im));
    });
    return Array.from(eff);
  };

  const selectAll = () => setSelected(new Set(MODULE_GROUPS.map(g => g.id)));
  const clearAll  = () => setSelected(new Set());

  const allSelected = selected.size === MODULE_GROUPS.length;
  const totalRecords = counts ? totalForSelection(counts, Array.from(selected)) : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <Link href="/">
          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-base font-semibold text-foreground leading-tight">Limpeza de Dados</h1>
          <p className="text-xs text-muted-foreground">Remover dados de teste ou resetar módulos</p>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* Warning banner */}
        <div className="flex gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/30">
          <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-destructive">Ação irreversível</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Os dados removidos não poderão ser recuperados. Use este recurso apenas em ambientes de teste.
              A limpeza aplica-se apenas à empresa atual e respeita as dependências entre módulos.
            </p>
          </div>
        </div>

        {/* Last result */}
        {lastResult && (
          <div className="flex gap-3 p-4 rounded-xl bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
            <CheckCircle className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-green-800 dark:text-green-400">Limpeza realizada com sucesso</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.entries(lastResult.deleted)
                  .filter(([, v]) => v > 0)
                  .map(([table, count]) => (
                    <Badge key={table} variant="outline" className="text-[10px] text-green-700 border-green-300">
                      {TABLE_LABELS[table] || table}: {count.toLocaleString("pt-BR")}
                    </Badge>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={allSelected ? clearAll : selectAll}
              className="h-8 gap-1.5 text-xs"
              data-testid="button-select-all"
            >
              {allSelected
                ? <><CheckSquare className="h-3.5 w-3.5" /> Desmarcar todos</>
                : <><Square className="h-3.5 w-3.5" /> Selecionar todos</>
              }
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchCounts()}
            disabled={countsLoading}
            className="h-8"
            data-testid="button-refresh-counts"
          >
            {countsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="ml-1.5 hidden sm:inline text-xs">Atualizar contagens</span>
          </Button>
        </div>

        {/* Module cards */}
        <div className="space-y-2">
          {MODULE_GROUPS.map((group) => {
            const Icon = group.icon;
            const isSelected = selected.has(group.id);
            const moduleTotal = counts ? sumModule(counts, group.id) : null;
            const includedTotal = counts && group.includesModules
              ? group.includesModules.reduce((s, im) => s + sumModule(counts, im), 0)
              : 0;
            const displayTotal = moduleTotal !== null ? moduleTotal + includedTotal : null;
            const isEmpty = displayTotal !== null && displayTotal === 0;

            return (
              <div
                key={group.id}
                className={`rounded-xl border p-4 transition-all cursor-pointer select-none ${
                  isSelected
                    ? "border-destructive/50 bg-destructive/5"
                    : isEmpty
                    ? "border-border/50 bg-card/60 opacity-60"
                    : "border-border bg-card hover:border-muted-foreground/30"
                }`}
                onClick={() => toggle(group.id)}
                data-testid={`module-card-${group.id}`}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggle(group.id)}
                    onClick={e => e.stopPropagation()}
                    className="mt-0.5 shrink-0"
                    data-testid={`checkbox-${group.id}`}
                  />
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Icon className={`h-4 w-4 ${group.iconColor}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold">{group.label}</h3>
                      {group.danger && (
                        <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-[10px] px-1.5">
                          <AlertTriangle className="h-2.5 w-2.5 mr-1" />Alto impacto
                        </Badge>
                      )}
                      {group.includesModules && (
                        <Badge variant="outline" className="text-[10px] px-1.5">
                          Inclui: {group.includesModules.map(im => MODULE_GROUPS.find(g => g.id === im)?.label).join(", ")}
                        </Badge>
                      )}
                      <span className="ml-auto" />
                      {displayTotal !== null && (
                        <Badge
                          variant="secondary"
                          className={`text-[11px] tabular-nums ${
                            isEmpty
                              ? "text-muted-foreground"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                          }`}
                          data-testid={`count-${group.id}`}
                        >
                          {countsLoading ? "..." : isEmpty ? "vazio" : `${displayTotal.toLocaleString("pt-BR")} reg.`}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{group.description}</p>
                    {isSelected && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {group.tables.map(t => (
                          <Badge key={t.name} variant="outline" className="text-[10px] text-destructive/70 border-destructive/30">
                            {t.label}
                          </Badge>
                        ))}
                        {group.includesModules?.map(im => {
                          const dep = MODULE_GROUPS.find(g => g.id === im);
                          return dep?.tables.map(t => (
                            <Badge key={`${im}-${t.name}`} variant="outline" className="text-[10px] text-destructive/50 border-destructive/20">
                              {t.label}
                            </Badge>
                          ));
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Execute button */}
        <div className="flex items-center justify-between pt-3 border-t gap-3">
          <p className="text-sm text-muted-foreground">
            {selected.size === 0
              ? "Nenhum módulo selecionado"
              : `${selected.size} módulo${selected.size !== 1 ? "s" : ""} — ${totalRecords.toLocaleString("pt-BR")} registros a remover`}
          </p>
          <Button
            variant="destructive"
            disabled={selected.size === 0}
            onClick={() => { setConfirmText(""); setConfirmOpen(true); }}
            data-testid="button-open-confirm"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Limpar selecionados
          </Button>
        </div>
      </main>

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!cleanupMutation.isPending) setConfirmOpen(open); }}>
        <DialogContent className="max-w-md" aria-describedby="cleanup-desc" data-testid="dialog-confirm-cleanup">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Confirmar limpeza de dados
            </DialogTitle>
            <DialogDescription id="cleanup-desc">
              Esta ação é permanente e não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Summary */}
            <div className="rounded-lg bg-muted/40 p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Módulos a limpar</p>
              <div className="flex flex-wrap gap-1">
                {effectiveModules().map(m => {
                  const grp = MODULE_GROUPS.find(g => g.id === m);
                  return (
                    <Badge key={m} variant="outline" className="text-xs text-destructive border-destructive/40">
                      {grp?.label || m}
                    </Badge>
                  );
                })}
              </div>
              {counts && (
                <p className="text-sm font-semibold text-destructive pt-1">
                  {totalRecords.toLocaleString("pt-BR")} registros serão excluídos permanentemente
                </p>
              )}
            </div>

            {/* Confirmation input */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Digite <span className="font-mono font-bold bg-muted px-1 py-0.5 rounded text-xs">LIMPAR DADOS</span> para confirmar
              </label>
              <Input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="LIMPAR DADOS"
                className="font-mono"
                data-testid="input-confirm-text"
                autoComplete="off"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmOpen(false)}
                disabled={cleanupMutation.isPending}
                data-testid="button-cancel-cleanup"
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={confirmText !== "LIMPAR DADOS" || cleanupMutation.isPending}
                onClick={() => cleanupMutation.mutate(effectiveModules())}
                data-testid="button-execute-cleanup"
              >
                {cleanupMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Limpando...</>
                  : <><Trash2 className="h-4 w-4 mr-2" />Confirmar limpeza</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
