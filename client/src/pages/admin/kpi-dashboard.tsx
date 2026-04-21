import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, AlertTriangle, BarChart3, ChevronDown, ChevronUp, ChevronRight,
  RefreshCw, Search, X, Users, Package, Clock, Activity, CalendarClock,
  Filter, SlidersHorizontal,
} from "lucide-react";
import { format, subDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";

// ─────────────────────────── Tipos ───────────────────────────

interface DiarioItem {
  dia: string; sep: number; conf: number; tempoMedioSep: number | null;
}

interface OperatorKPI {
  userId: string;
  userName: string;
  username: string;
  role: string;
  primaryModule: "separacao" | "conferencia" | "balcao" | null;
  // Pedidos
  pedidosUnicosTotal: number;
  pedidosUnicosSep: number;
  pedidosUnicosConf: number;
  pedidosUnicosBalcao: number;
  // Separação
  secoesSeparadas: number;
  pedidosSeparados: number;
  pedidosAndamento: number;
  tempoMedioSepMin: number | null;
  // Conferência
  pedidosConferidos: number;
  tempoMedioConfMin: number | null;
  // Balcão
  pedidosBalcao: number;
  tempoMedioBalcaoMin: number | null;
  // Itens
  itensSep: number;
  itensConf: number;
  itensBalcao: number;
  totalItens: number;
  // Exceções
  totalExcecoes: number;
  taxaExcecao: number;
  // Tempo
  tempoTotalMin: number;
  tempoMedioMin: number | null;
  ultimoMovimento: string | null;
  diario: DiarioItem[];
}

interface KPIResponse {
  operators: OperatorKPI[];
  from: string;
  to: string;
  companyId: number;
  dailyGlobal: { dia: string; sep: number; conf: number; tempoMedioSep: number | null }[];
}

interface OrderSectionWU {
  type: "separacao" | "conferencia";
  status: string;
  operatorName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  duracaoMin: number | null;
}

interface OrderSectionGroup { section: string; wus: OrderSectionWU[]; }

interface OrderSectionTimesResponse {
  order: { erpOrderId: string; customerName: string; status: string };
  sections: OrderSectionGroup[];
  conferencia: OrderSectionWU[];
}

interface OperatorDetailUnit {
  section: string | null;
  sectionName: string | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMin: number | null;
}

interface OperatorDetailOrder {
  orderId: string;
  erpOrderId: string;
  customerName: string;
  orderStatus: string;
  type: "separacao" | "conferencia" | "balcao";
  startedAt: string | null;
  completedAt: string | null;
  durationMin: number;
  unitsCount: number;
  unitsDone: number;
  units: OperatorDetailUnit[];
  itemsCount: number;
  qtyPicked: number;
  qtyChecked: number;
  qtyExpected: number;
}

interface OperatorDetailResponse {
  user: { id: string; name: string; username: string; role: string };
  period: { from: string; to: string };
  summary: {
    totalPedidos: number;
    totalUnits: number;
    totalSep: number;
    totalConf: number;
    totalBalcao: number;
    tempoTotalMin: number;
    tempoMedioMin: number | null;
    ultimoMovimento: string | null;
  };
  orders: OperatorDetailOrder[];
}

// ─────────────────────────── Constantes ───────────────────────────

const ROLE_LABELS: Record<string, string> = {
  separacao: "Separação", conferencia: "Conferência", supervisor: "Supervisor",
  administrador: "Admin", balcao: "Balcão", fila_pedidos: "Fila",
  recebedor: "Recebedor", empilhador: "Empilhador", conferente_wms: "WMS",
};

const MODULE_LABELS: Record<string, string> = {
  separacao: "Separação", conferencia: "Conferência", balcao: "Balcão",
};

const MODULE_COLORS: Record<string, string> = {
  separacao:   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  conferencia: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  balcao:      "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

const PRESET_DAYS = [
  { label: "Hoje", days: 0 },
  { label: "7d", days: 7 },
  { label: "15d", days: 15 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

// ─────────────────────────── Helpers ───────────────────────────

function fmtTime(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${min.toFixed(0)}min`;
  return `${(min / 60).toFixed(1)}h`;
}

function fmtDateTime(iso: string): string {
  try { return format(parseISO(iso.replace(" ", "T").slice(0, 19)), "dd/MM HH:mm", { locale: ptBR }); }
  catch { return iso.slice(0, 16); }
}

function fmtDateOnly(iso: string): string {
  try { return format(parseISO(iso.replace(" ", "T").slice(0, 19)), "dd/MM/yyyy", { locale: ptBR }); }
  catch { return iso.slice(0, 10); }
}

// ─────────────────────────── Sub-componentes ───────────────────────────

function StatBox({
  icon: Icon, label, value, hint, accent,
}: {
  icon: any; label: string; value: string | number; hint?: string; accent?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/50 bg-card flex-1 min-w-[140px]">
      <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${accent ?? "bg-muted text-muted-foreground"}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
        <p className="text-base font-extrabold tabular-nums leading-tight truncate">{value}</p>
        {hint && <p className="text-[10px] text-muted-foreground leading-tight truncate">{hint}</p>}
      </div>
    </div>
  );
}

function ModuleBadge({ module }: { module: string | null }) {
  if (!module) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge className={`text-[10px] h-5 ${MODULE_COLORS[module] ?? "bg-muted text-muted-foreground"}`}>
      {MODULE_LABELS[module] ?? module}
    </Badge>
  );
}

// ─────────────────────────── Modal de Detalhe ───────────────────────────

function OperatorDetailModal({
  userId, operatorRow, from, to, onClose,
}: {
  userId: string | null;
  operatorRow: OperatorKPI | null;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"all" | "separacao" | "conferencia" | "balcao">("all");

  const { data, isLoading, isError } = useQuery<OperatorDetailResponse>({
    queryKey: ["/api/kpi/operator-detail", userId, from, to],
    queryFn: async () => {
      const url = `/api/kpi/operator-detail?userId=${encodeURIComponent(userId!)}&from=${from}&to=${to}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("Erro ao buscar detalhe");
      return r.json();
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.orders.filter(o => {
      if (typeFilter !== "all" && o.type !== typeFilter) return false;
      if (!q) return true;
      return (
        (o.erpOrderId   ?? "").toLowerCase().includes(q) ||
        (o.customerName ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, search, typeFilter]);

  return (
    <Dialog open={!!userId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0" data-testid="dialog-operator-detail">
        <DialogHeader className="px-5 py-4 border-b border-border/40">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            {operatorRow?.userName ?? data?.user.name ?? "Operador"}
            {operatorRow?.role && (
              <Badge variant="outline" className="text-[10px] h-5 ml-1">
                {ROLE_LABELS[operatorRow.role] ?? operatorRow.role}
              </Badge>
            )}
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            {from} → {to}
          </p>
        </DialogHeader>

        {/* Resumo */}
        {data && !isLoading && (
          <div className="px-5 py-3 border-b border-border/30 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Pedidos</p>
              <p className="text-sm font-extrabold tabular-nums">{data.summary.totalPedidos}</p>
              <p className="text-[10px] text-muted-foreground tabular-nums">
                S {data.summary.totalSep} · C {data.summary.totalConf} · B {data.summary.totalBalcao}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Tempo total</p>
              <p className="text-sm font-extrabold tabular-nums">{fmtTime(data.summary.tempoTotalMin)}</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">T. médio/ped.</p>
              <p className="text-sm font-extrabold tabular-nums">{fmtTime(data.summary.tempoMedioMin)}</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Último mov.</p>
              <p className="text-xs font-bold tabular-nums">{data.summary.ultimoMovimento ? fmtDateTime(data.summary.ultimoMovimento) : "—"}</p>
            </div>
          </div>
        )}

        {/* Busca + filtro tipo */}
        <div className="px-5 py-3 border-b border-border/30 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar pedido ou cliente..."
              className="pl-9 h-9"
              data-testid="input-detail-search"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
            <SelectTrigger className="h-9 w-[150px]" data-testid="select-detail-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="separacao">Separação</SelectItem>
              <SelectItem value="conferencia">Conferência</SelectItem>
              <SelectItem value="balcao">Balcão</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Lista de pedidos */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
          {isLoading && [1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}

          {isError && (
            <div className="text-center py-8">
              <AlertTriangle className="h-6 w-6 text-destructive/60 mx-auto mb-2" />
              <p className="text-sm text-destructive">Erro ao carregar detalhes</p>
            </div>
          )}

          {!isLoading && !isError && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              {search ? "Nenhum pedido encontrado" : "Sem pedidos no período"}
            </p>
          )}

          {filtered.map(o => {
            const open = openOrderId === o.orderId;
            const qty = o.type === "conferencia" ? o.qtyChecked : o.qtyPicked;
            return (
              <div key={o.orderId + o.type} className="rounded-lg border border-border/40 overflow-hidden" data-testid={`row-detail-order-${o.orderId}`}>
                <button
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors text-left"
                  onClick={() => setOpenOrderId(open ? null : o.orderId)}
                  data-testid={`btn-detail-order-${o.orderId}`}
                >
                  <ModuleBadge module={o.type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">
                      #{o.erpOrderId} · {o.customerName}
                    </p>
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      {o.completedAt ? fmtDateTime(o.completedAt) : "Em andamento"}
                      {" · "}{o.itemsCount} itens · {qty.toFixed(0)} un
                      {o.unitsCount > 1 && ` · ${o.unitsDone}/${o.unitsCount} unidades`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular-nums">{fmtTime(o.durationMin)}</p>
                  </div>
                  {o.unitsCount > 1
                    ? (open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />)
                    : <div className="w-3.5" />}
                </button>

                {open && o.unitsCount > 1 && (
                  <div className="px-3 py-2 bg-muted/20 space-y-1">
                    {o.units.map((u, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px]">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${u.status === "concluido" ? "bg-green-500" : u.status === "em_andamento" ? "bg-blue-500" : "bg-muted-foreground/30"}`} />
                        <span className="flex-1 truncate text-muted-foreground">
                          {u.sectionName ?? u.section ?? "Sem seção"}
                        </span>
                        <span className="font-semibold tabular-nums shrink-0">{fmtTime(u.durationMin)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────── Página principal ───────────────────────────

export default function KpiDashboard() {
  const [, setLocation] = useLocation();

  // Filtros
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [moduleFilter, setModuleFilter] = useState<"all" | "separacao" | "conferencia" | "balcao">("all");
  const [opSearch, setOpSearch] = useState("");
  const [includeAdmin, setIncludeAdmin] = useState(false);
  const [showFilters, setShowFilters] = useState(true);

  // Modal
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [detailRow, setDetailRow]       = useState<OperatorKPI | null>(null);

  // Tempo por pedido
  const [showOrderSearch, setShowOrderSearch] = useState(false);
  const [orderInput, setOrderInput] = useState("");
  const [orderSearchId, setOrderSearchId] = useState<string | null>(null);

  const fromIso = (dateRange?.from ?? subDays(new Date(), 30)).toISOString().slice(0, 10);
  const toIso   = (dateRange?.to   ?? new Date()).toISOString().slice(0, 10);

  // Query principal
  const { data, isLoading, isError, refetch, isFetching } = useQuery<KPIResponse>({
    queryKey: ["/api/kpi/operators", fromIso, toIso, moduleFilter, opSearch, includeAdmin],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: fromIso, to: toIso,
        module: moduleFilter,
        includeAdmin: String(includeAdmin),
      });
      if (opSearch.trim()) params.set("q", opSearch.trim());
      const r = await fetch(`/api/kpi/operators?${params.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error("Erro ao buscar KPIs");
      return r.json();
    },
    staleTime: 30_000,
  });

  // Tempo por pedido
  const {
    data: orderTimesData,
    isLoading: orderTimesLoading,
    isError: orderTimesError,
  } = useQuery<OrderSectionTimesResponse>({
    queryKey: ["/api/kpi/order-section-times", orderSearchId],
    queryFn: async () => {
      const r = await fetch(`/api/kpi/order-section-times?erpOrderId=${encodeURIComponent(orderSearchId!)}`, { credentials: "include" });
      if (!r.ok) throw new Error("Pedido não encontrado");
      return r.json();
    },
    enabled: !!orderSearchId,
  });

  function searchOrder() {
    const v = orderInput.trim();
    if (!v) return;
    setOrderSearchId(v);
  }

  // Resumo executivo (calculado dos operadores filtrados)
  const ops = data?.operators ?? [];
  const resumo = useMemo(() => {
    const totalOperadores = ops.length;
    const totalPedidos = ops.reduce((s, o) => s + (o.pedidosUnicosTotal ?? 0), 0);
    const totalItens   = ops.reduce((s, o) => s + (o.totalItens ?? 0), 0);
    const tempoTotal   = ops.reduce((s, o) => s + (o.tempoTotalMin ?? 0), 0);
    const tempoMedio   = totalPedidos > 0 ? tempoTotal / totalPedidos : null;
    const ultimoMov = ops.reduce<string | null>((mx, o) => {
      const c = o.ultimoMovimento;
      if (!c) return mx;
      return mx === null || c > mx ? c : mx;
    }, null);
    return { totalOperadores, totalPedidos, totalItens, tempoMedio, ultimoMov };
  }, [ops]);

  const openDetail = (op: OperatorKPI) => {
    setDetailRow(op);
    setDetailUserId(op.userId);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border/40 bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-[1280px] mx-auto px-4 py-3 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl shrink-0"
            onClick={() => setLocation("/admin")}
            data-testid="btn-back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold leading-tight">KPIs de Operadores</h1>
            <p className="text-[11px] text-muted-foreground leading-tight">
              {fromIso} → {toIso} · {ops.length} operador{ops.length === 1 ? "" : "es"}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-xl shrink-0"
            onClick={() => setShowFilters(v => !v)}
            data-testid="btn-toggle-filters"
            title="Filtros"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-xl shrink-0"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="btn-refresh"
            title="Atualizar"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto p-4 space-y-4">

        {/* Filtros */}
        {showFilters && (
          <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              {/* Período */}
              <div className="space-y-1.5 flex-1 min-w-[260px]">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Período</Label>
                <DatePickerWithRange
                  date={dateRange}
                  onDateChange={setDateRange}
                />
              </div>
              {/* Presets */}
              <div className="flex gap-1">
                {PRESET_DAYS.map(p => (
                  <Button
                    key={p.label}
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 text-xs rounded-lg"
                    onClick={() => setDateRange({
                      from: p.days === 0 ? new Date() : subDays(new Date(), p.days),
                      to: new Date(),
                    })}
                    data-testid={`btn-preset-${p.label}`}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              {/* Módulo */}
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Módulo</Label>
                <Select value={moduleFilter} onValueChange={(v) => setModuleFilter(v as any)}>
                  <SelectTrigger className="h-9 w-[170px]" data-testid="select-module">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="separacao">Separação</SelectItem>
                    <SelectItem value="conferencia">Conferência</SelectItem>
                    <SelectItem value="balcao">Balcão</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Busca */}
              <div className="space-y-1.5 flex-1 min-w-[220px]">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Buscar operador</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={opSearch}
                    onChange={e => setOpSearch(e.target.value)}
                    placeholder="Nome ou usuário"
                    className="pl-9 h-9"
                    data-testid="input-op-search"
                  />
                </div>
              </div>

              {/* Toggle admin */}
              <div className="flex items-center gap-2 h-9">
                <Switch
                  id="include-admin"
                  checked={includeAdmin}
                  onCheckedChange={setIncludeAdmin}
                  data-testid="switch-include-admin"
                />
                <Label htmlFor="include-admin" className="text-xs cursor-pointer">
                  Incluir admin/supervisor
                </Label>
              </div>
            </div>
          </div>
        )}

        {/* Resumo Executivo */}
        {!isLoading && !isError && (
          <div className="flex flex-wrap gap-2">
            <StatBox icon={Users}        label="Operadores" value={resumo.totalOperadores}
              accent="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" />
            <StatBox icon={Package}      label="Pedidos"    value={resumo.totalPedidos}
              accent="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" />
            <StatBox icon={Activity}     label="Itens"      value={resumo.totalItens}
              accent="bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" />
            <StatBox icon={Clock}        label="T. médio/pedido" value={fmtTime(resumo.tempoMedio)}
              accent="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" />
            <StatBox icon={CalendarClock} label="Último mov."
              value={resumo.ultimoMov ? fmtDateTime(resumo.ultimoMov) : "—"}
              accent="bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" />
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-2">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-14 rounded-2xl" />)}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
            <AlertTriangle className="h-7 w-7 text-destructive/60 mx-auto mb-2" />
            <p className="text-sm font-medium text-destructive">Falha ao carregar KPIs</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3">Tentar novamente</Button>
          </div>
        )}

        {/* Sem dados */}
        {!isLoading && !isError && ops.length === 0 && (
          <div className="rounded-2xl border border-border/50 bg-card p-10 text-center">
            <BarChart3 className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma atividade no período.</p>
            <p className="text-[11px] text-muted-foreground mt-1">Tente ampliar o período ou ajustar os filtros.</p>
          </div>
        )}

        {/* Tabela de operadores */}
        {!isLoading && !isError && ops.length > 0 && (
          <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold flex-1">Operadores</span>
              <Badge variant="outline" className="text-[10px] h-5">{ops.length}</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="table-kpi-operators">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">Operador</th>
                    <th className="text-left font-semibold px-3 py-2">Módulo</th>
                    <th className="text-right font-semibold px-3 py-2">Pedidos</th>
                    <th className="text-right font-semibold px-3 py-2">Sep.</th>
                    <th className="text-right font-semibold px-3 py-2">Conf.</th>
                    <th className="text-right font-semibold px-3 py-2">Balcão</th>
                    <th className="text-right font-semibold px-3 py-2">Itens</th>
                    <th className="text-right font-semibold px-3 py-2">T. total</th>
                    <th className="text-right font-semibold px-3 py-2">T. médio</th>
                    <th className="text-left font-semibold px-3 py-2">Último</th>
                    <th className="w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map(op => (
                    <tr
                      key={op.userId}
                      className="border-t border-border/30 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => openDetail(op)}
                      data-testid={`row-kpi-${op.userId}`}
                    >
                      <td className="px-3 py-2 font-medium" data-testid={`text-kpi-name-${op.userId}`}>
                        {op.userName}
                        <div className="text-[10px] text-muted-foreground font-normal">{op.username}</div>
                      </td>
                      <td className="px-3 py-2">
                        <ModuleBadge module={op.primaryModule} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{op.pedidosUnicosTotal}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-600 dark:text-blue-400">{op.pedidosSeparados || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-green-600 dark:text-green-400">{op.pedidosConferidos || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-purple-600 dark:text-purple-400">{op.pedidosBalcao || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{op.totalItens || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtTime(op.tempoTotalMin)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtTime(op.tempoMedioMin)}</td>
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">
                        {op.ultimoMovimento ? fmtDateTime(op.ultimoMovimento) : "—"}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Buscar por Pedido (utilitário, recolhido por padrão) */}
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          <button
            className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
            onClick={() => setShowOrderSearch(v => !v)}
            data-testid="btn-order-search-toggle"
          >
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-semibold flex-1">Buscar tempo por pedido</span>
            {orderSearchId && (
              <span className="text-[11px] text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded-lg shrink-0">
                #{orderSearchId}
              </span>
            )}
            {showOrderSearch
              ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
          </button>

          {showOrderSearch && (
            <div className="px-4 pb-4 space-y-3 border-t border-border/40">
              <div className="flex gap-2 pt-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="text"
                    value={orderInput}
                    onChange={e => setOrderInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && searchOrder()}
                    placeholder="Número do pedido (ex: 12345)"
                    className="pl-9 h-9"
                    data-testid="input-order-search"
                  />
                </div>
                <Button
                  onClick={searchOrder}
                  disabled={!orderInput.trim() || orderTimesLoading}
                  className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shrink-0"
                  data-testid="btn-order-search"
                >
                  {orderTimesLoading
                    ? <RefreshCw className="h-4 w-4 animate-spin" />
                    : <Search className="h-4 w-4" />}
                </Button>
                {orderSearchId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-xl shrink-0"
                    onClick={() => { setOrderSearchId(null); setOrderInput(""); }}
                    data-testid="btn-order-search-clear"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {orderTimesLoading && (
                <div className="space-y-2">
                  {[1,2].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
                </div>
              )}

              {orderTimesError && !orderTimesLoading && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-center">
                  <p className="text-sm text-destructive font-medium">Pedido não encontrado</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Verifique o número e tente novamente</p>
                </div>
              )}

              {orderTimesData && !orderTimesLoading && (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2 px-1">
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{orderTimesData.order.customerName}</p>
                      <p className="text-[11px] text-muted-foreground">Pedido #{orderTimesData.order.erpOrderId}</p>
                    </div>
                    <Badge className={`shrink-0 text-[10px] h-5 ${
                      orderTimesData.order.status === "concluido"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                        : orderTimesData.order.status === "separando"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {orderTimesData.order.status}
                    </Badge>
                  </div>

                  {orderTimesData.sections.length === 0 && (!orderTimesData.conferencia || orderTimesData.conferencia.length === 0) && (
                    <p className="text-[12px] text-muted-foreground text-center py-2">Sem registros de execução</p>
                  )}

                  {orderTimesData.sections.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest px-1 mb-1">
                        Separação por Seção
                      </p>
                      <div className="rounded-xl overflow-hidden border border-border/40 divide-y divide-border/30">
                        {orderTimesData.sections.map((sec, si) => {
                          const total = sec.wus.reduce((s, w) => s + (w.duracaoMin ?? 0), 0);
                          const done = sec.wus.filter(w => w.status === "concluido").length;
                          return (
                            <div key={si} className="px-3 py-2.5">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-xs font-bold text-blue-700 dark:text-blue-400">{sec.section}</span>
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                  <span>{done}/{sec.wus.length} concluídos</span>
                                  {total > 0 && <span className="font-semibold text-foreground">{fmtTime(total)} total</span>}
                                </div>
                              </div>
                              <div className="space-y-1">
                                {sec.wus.map((wu, wi) => (
                                  <div key={wi} className="flex items-center gap-2 text-[11px]">
                                    <span className="flex-1 truncate text-muted-foreground font-medium">{wu.operatorName || "—"}</span>
                                    <span className={`font-semibold tabular-nums shrink-0 ${wu.duracaoMin === null ? "text-muted-foreground" : wu.duracaoMin < 5 ? "text-green-600 dark:text-green-400" : wu.duracaoMin > 20 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
                                      {fmtTime(wu.duracaoMin)}
                                    </span>
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${wu.status === "concluido" ? "bg-green-500" : wu.status === "em_andamento" ? "bg-blue-500" : "bg-muted-foreground/30"}`} />
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {orderTimesData.conferencia && orderTimesData.conferencia.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold text-green-600 dark:text-green-400 uppercase tracking-widest px-1 mb-1">
                        Conferência
                      </p>
                      <div className="rounded-xl overflow-hidden border border-green-200 dark:border-green-900/40 divide-y divide-border/30">
                        {orderTimesData.conferencia.map((wu, ci) => (
                          <div key={ci} className="px-3 py-2 flex items-center gap-2 text-[11px]">
                            <span className="flex-1 truncate text-muted-foreground font-medium">{wu.operatorName || "—"}</span>
                            <span className={`font-semibold tabular-nums shrink-0 ${wu.duracaoMin === null ? "text-muted-foreground" : wu.duracaoMin < 5 ? "text-green-600 dark:text-green-400" : wu.duracaoMin > 30 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
                              {fmtTime(wu.duracaoMin)}
                            </span>
                            <span className={`w-2 h-2 rounded-full shrink-0 ${wu.status === "concluido" ? "bg-green-500" : wu.status === "em_andamento" ? "bg-blue-500" : "bg-muted-foreground/30"}`} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal de detalhe do operador */}
      <OperatorDetailModal
        userId={detailUserId}
        operatorRow={detailRow}
        from={fromIso}
        to={toIso}
        onClose={() => { setDetailUserId(null); setDetailRow(null); }}
      />
    </div>
  );
}

