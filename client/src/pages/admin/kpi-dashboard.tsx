import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import {
  ArrowLeft, Clock, Package, AlertTriangle, CheckCircle2,
  TrendingUp, BarChart3, Trophy, ChevronDown, ChevronUp,
  RefreshCw, Boxes, Timer, Zap, SlidersHorizontal,
  Search, X, ChevronsUp,
} from "lucide-react";
import { format, subDays, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DatePickerWithRange } from "@/components/ui/date-range-picker";
import { DateRange } from "react-day-picker";
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Line,
} from "recharts";

interface WorkUnitDetalhe {
  orderId: string;
  type: "separacao" | "conferencia";
  section: string | null;
  completedAt: string;
  duracaoMin: number | null;
}

interface DiarioItem {
  dia: string;
  sep: number;
  conf: number;
  tempoMedioSep: number | null;
}

interface OperatorKPI {
  userId: string;
  userName: string;
  username: string;
  role: string;
  secoesSeparadas: number;
  pedidosUnicosSep: number;
  pedidosSeparados: number;
  pedidosAndamento: number;
  tempoMedioSepMin: number | null;
  tempoMinSepMin: number | null;
  tempoMaxSepMin: number | null;
  tempoP50SepMin: number | null;
  pedidosConferidos: number;
  tempoMedioConfMin: number | null;
  tempoMinConfMin: number | null;
  tempoMaxConfMin: number | null;
  totalItens: number;
  totalQtyPicked: number;
  totalQtyEsperada: number;
  itensExcedidos: number;
  totalExcecoes: number;
  taxaExcecao: number;
  excNaoEncontrado: number;
  excAvariado: number;
  excVencido: number;
  pedidosComVolume: number;
  totalVolumes: number;
  diario: DiarioItem[];
  workUnitsDetalhe: WorkUnitDetalhe[];
}

interface KPIResponse {
  operators: OperatorKPI[];
  from: string;
  to: string;
  companyId: number;
  dailyGlobal: { dia: string; sep: number; conf: number; tempoMedioSep: number | null }[];
}

interface SectionTimeItem {
  section: string;
  sectionName: string | null;
  sepCount: number;
  avgSepMin: number | null;
  minSepMin: number | null;
  maxSepMin: number | null;
  confCount: number;
  avgConfMin: number | null;
  minConfMin: number | null;
  maxConfMin: number | null;
}

interface SectionTimesResponse {
  sections: SectionTimeItem[];
  from: string;
  to: string;
}

interface OrderSectionWU {
  type: "separacao" | "conferencia";
  status: string;
  operatorName: string | null;
  startedAt: string | null;
  completedAt: string | null;
  duracaoMin: number | null;
}

interface OrderSectionGroup {
  section: string;
  wus: OrderSectionWU[];
}

interface OrderSectionTimesResponse {
  order: { erpOrderId: string; customerName: string; status: string };
  sections: OrderSectionGroup[];
  conferencia: OrderSectionWU[];
}

const ROLE_LABELS: Record<string, string> = {
  separacao: "Separação", conferencia: "Conferência", supervisor: "Supervisor",
  administrador: "Admin", balcao: "Balcão", recebedor: "Recebedor",
  empilhador: "Empilhador", conferente_wms: "WMS",
};

const ROLE_COLORS: Record<string, string> = {
  separacao:    "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  conferencia:  "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  supervisor:   "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  administrador:"bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

function fmtTime(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${min.toFixed(0)}min`;
  return `${(min / 60).toFixed(1)}h`;
}

function fmtDate(iso: string): string {
  try { return format(parseISO(iso.slice(0, 10) + "T12:00:00"), "dd/MM", { locale: ptBR }); }
  catch { return iso.slice(5, 10); }
}

function fmtDateTime(iso: string): string {
  try { return format(parseISO(iso.replace(" ", "T").slice(0, 19)), "dd/MM HH:mm", { locale: ptBR }); }
  catch { return iso.slice(0, 16); }
}

const PRESET_DAYS = [
  { label: "7d", days: 7 },
  { label: "15d", days: 15 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function StatRow({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-semibold tabular-nums ${accent ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function OperatorCard({ op, rank }: { op: OperatorKPI; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const [showAllWu, setShowAllWu] = useState(false);
  const wus = showAllWu ? op.workUnitsDetalhe : op.workUnitsDetalhe.slice(0, 8);

  const medalLabel = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;

  return (
    <div className="rounded-2xl border border-border/50 bg-card overflow-hidden" data-testid={`card-kpi-${op.userId}`}>

      {/* Linha principal */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(p => !p)}
      >
        {/* Rank */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-extrabold shrink-0
          ${rank <= 3 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
          {medalLabel}
        </div>

        {/* Nome + cargo */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate leading-tight">{op.userName}</p>
          <Badge className={`text-[9px] px-1.5 py-0 h-4 mt-0.5 ${ROLE_COLORS[op.role] ?? "bg-muted text-muted-foreground"}`}>
            {ROLE_LABELS[op.role] ?? op.role}
          </Badge>
        </div>

        {/* Métricas inline */}
        <div className="flex items-center gap-3 shrink-0">
          {op.secoesSeparadas > 0 && (
            <div className="text-center">
              <p className="text-base font-extrabold tabular-nums text-blue-600 dark:text-blue-400 leading-none">{op.secoesSeparadas}</p>
              <p className="text-[9px] text-muted-foreground leading-tight">seções</p>
            </div>
          )}
          {op.pedidosConferidos > 0 && (
            <div className="text-center">
              <p className="text-base font-extrabold tabular-nums text-green-600 dark:text-green-400 leading-none">{op.pedidosConferidos}</p>
              <p className="text-[9px] text-muted-foreground leading-tight">conf</p>
            </div>
          )}
          <div className="text-center">
            <p className="text-base font-extrabold tabular-nums text-amber-600 dark:text-amber-400 leading-none">
              {op.secoesSeparadas > 0 ? fmtTime(op.tempoMedioSepMin) : fmtTime(op.tempoMedioConfMin)}
            </p>
            <p className="text-[9px] text-muted-foreground leading-tight">t.méd</p>
          </div>
          {op.totalExcecoes > 0 ? (
            <div className="text-center">
              <p className="text-base font-extrabold tabular-nums text-red-600 dark:text-red-400 leading-none">{op.totalExcecoes}</p>
              <p className="text-[9px] text-muted-foreground leading-tight">exc</p>
            </div>
          ) : (
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          )}
        </div>

        {/* Toggle */}
        <div className="text-muted-foreground ml-1 shrink-0">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {/* Detalhe expandido */}
      {expanded && (
        <div className="border-t border-border/40 bg-muted/20 px-4 py-4 space-y-4">

          {/* Separação */}
          {op.secoesSeparadas > 0 && (
            <section className="space-y-0.5">
              <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-2">Separação</p>
              <StatRow label="Seções separadas" value={op.secoesSeparadas} />
              <StatRow label="Pedidos únicos" value={op.pedidosUnicosSep} />
              {op.pedidosAndamento > 0 && <StatRow label="Em andamento" value={op.pedidosAndamento} />}
              <StatRow label="Tempo médio por seção" value={fmtTime(op.tempoMedioSepMin)} />
              {op.tempoMinSepMin !== null && <StatRow label="Mais rápido / mais lento" value={`${fmtTime(op.tempoMinSepMin)} / ${fmtTime(op.tempoMaxSepMin)}`} />}
              {op.tempoP50SepMin !== null && <StatRow label="Mediana (50%)" value={fmtTime(op.tempoP50SepMin)} />}
              <StatRow label="Itens coletados" value={op.totalItens} />
              <StatRow label="Qtd coletada" value={op.totalQtyPicked.toFixed(0)} />
              {op.itensExcedidos > 0 && <StatRow label="Itens com excesso" value={op.itensExcedidos} accent />}
            </section>
          )}

          {/* Conferência */}
          {op.pedidosConferidos > 0 && (
            <section className="space-y-0.5">
              <p className="text-[10px] font-bold text-green-600 dark:text-green-400 uppercase tracking-widest mb-2">Conferência</p>
              <StatRow label="Pedidos conferidos" value={op.pedidosConferidos} />
              <StatRow label="Tempo médio" value={fmtTime(op.tempoMedioConfMin)} />
              {op.tempoMinConfMin !== null && <StatRow label="Mais rápido / mais lento" value={`${fmtTime(op.tempoMinConfMin)} / ${fmtTime(op.tempoMaxConfMin)}`} />}
              <StatRow label="Volumes gerados" value={op.totalVolumes} />
            </section>
          )}

          {/* Exceções */}
          {op.totalExcecoes > 0 && (
            <section className="space-y-0.5">
              <p className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-widest mb-2">Exceções</p>
              <StatRow label="Total" value={op.totalExcecoes} accent />
              <StatRow label="Taxa" value={`${op.taxaExcecao}%`} accent />
              {op.excNaoEncontrado > 0 && <StatRow label="Não encontrado" value={op.excNaoEncontrado} accent />}
              {op.excAvariado > 0 && <StatRow label="Avariado" value={op.excAvariado} accent />}
              {op.excVencido > 0 && <StatRow label="Vencido" value={op.excVencido} accent />}
            </section>
          )}

          {/* Gráfico diário compacto */}
          {op.diario.length > 0 && (
            <section>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Atividade diária</p>
              <div className="h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={op.diario.slice(-14)} margin={{ top: 0, right: 0, left: -32, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis dataKey="dia" tickFormatter={fmtDate} tick={{ fontSize: 8 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 8 }} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={fmtDate}
                      formatter={(v: any, k: string) => [v, k === "sep" ? "Sep" : k === "conf" ? "Conf" : "T.méd (min)"]}
                      contentStyle={{ fontSize: 10, borderRadius: 8 }}
                    />
                    <Bar dataKey="sep" stackId="a" fill="#3b82f6" opacity={0.85} />
                    <Bar dataKey="conf" stackId="a" fill="#22c55e" opacity={0.85} radius={[2, 2, 0, 0]} />
                    {op.diario.some(d => d.tempoMedioSep !== null) && (
                      <Line type="monotone" dataKey="tempoMedioSep" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Registros individuais */}
          {op.workUnitsDetalhe.length > 0 && (
            <section>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                Registros individuais
              </p>
              <div className="rounded-xl overflow-hidden border border-border/40">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-muted/50 text-muted-foreground">
                      <th className="px-2 py-1.5 text-left font-medium">Tipo</th>
                      <th className="px-2 py-1.5 text-left font-medium">Seção</th>
                      <th className="px-2 py-1.5 text-right font-medium">Duração</th>
                      <th className="px-2 py-1.5 text-right font-medium">Concluído</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wus.map((wu, i) => (
                      <tr key={i} className="border-t border-border/20 hover:bg-muted/30">
                        <td className="px-2 py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold
                            ${wu.type === "separacao"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                              : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"}`}>
                            {wu.type === "separacao" ? "Sep" : "Conf"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{wu.section || "—"}</td>
                        <td className="px-2 py-1.5 text-right">
                          {wu.duracaoMin !== null ? (
                            <span className={`font-semibold
                              ${wu.duracaoMin < 5 ? "text-green-600 dark:text-green-400"
                                : wu.duracaoMin > 20 ? "text-red-600 dark:text-red-400"
                                : "text-foreground"}`}>
                              {fmtTime(wu.duracaoMin)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground">{fmtDateTime(wu.completedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {op.workUnitsDetalhe.length > 8 && (
                <button
                  onClick={() => setShowAllWu(p => !p)}
                  className="mt-1.5 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {showAllWu ? "Mostrar menos" : `Ver todos (${op.workUnitsDetalhe.length})`}
                </button>
              )}
            </section>
          )}

          {/* Botão Recolher no final */}
          <button
            onClick={() => setExpanded(false)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-xl transition-colors border border-border/40"
            data-testid={`btn-kpi-collapse-${op.userId}`}
          >
            <ChevronsUp className="h-3.5 w-3.5" />
            Recolher
          </button>
        </div>
      )}
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-popover shadow px-3 py-2 text-[11px] space-y-1">
      <p className="font-semibold">{fmtDate(label)}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-sm inline-block" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.dataKey === "sep" ? "Sep" : p.dataKey === "conf" ? "Conf" : "T.méd"}:</span>
          <span className="font-semibold">{p.dataKey === "tempoMedioSep" ? fmtTime(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function KpiDashboardPage() {
  const [, navigate] = useLocation();
  const { companyId } = useAuth();
  const [appliedRange, setAppliedRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 29),
    to: new Date(),
  });
  const [tempRange, setTempRange] = useState<DateRange | undefined>(appliedRange);

  const from = appliedRange?.from ? format(appliedRange.from, "yyyy-MM-dd") : format(subDays(new Date(), 29), "yyyy-MM-dd");
  const to   = appliedRange?.to   ? format(appliedRange.to,   "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
  const [showFilters, setShowFilters] = useState(true);

  // Busca por pedido
  const [orderInput, setOrderInput]           = useState("");
  const [orderSearchId, setOrderSearchId]     = useState<string | null>(null);
  const [showOrderSearch, setShowOrderSearch] = useState(true);
  const [showSecTimes, setShowSecTimes]       = useState(true);

  const kpiUrl      = companyId ? `/api/kpi/operators?companyId=${companyId}&from=${from}&to=${to}` : null;
  const secTimesUrl = companyId ? `/api/kpi/section-times?companyId=${companyId}&from=${from}&to=${to}` : null;
  const orderTimesUrl = companyId && orderSearchId
    ? `/api/kpi/order-section-times?companyId=${companyId}&erpOrderId=${encodeURIComponent(orderSearchId)}`
    : null;

  const { data, isLoading, isError, refetch, isFetching } = useQuery<KPIResponse>({
    queryKey: [kpiUrl],
    enabled: !!kpiUrl,
  });

  const { data: secTimesData } = useQuery<SectionTimesResponse>({
    queryKey: [secTimesUrl],
    enabled: !!secTimesUrl,
  });

  const { data: orderTimesData, isLoading: orderTimesLoading, isError: orderTimesError } =
    useQuery<OrderSectionTimesResponse>({
      queryKey: [orderTimesUrl],
      enabled: !!orderTimesUrl,
      retry: false,
    });

  const applyFilter = () => { setAppliedRange(tempRange); };

  const searchOrder = () => {
    const trimmed = orderInput.trim();
    if (trimmed) setOrderSearchId(trimmed);
  };

  const setPreset = (days: number) => {
    const range: DateRange = { from: subDays(new Date(), days - 1), to: new Date() };
    setTempRange(range);
    setAppliedRange(range);
  };

  const ops = data?.operators ?? [];
  const dailyGlobal = data?.dailyGlobal ?? [];
  const totalSep   = ops.reduce((s, o) => s + o.pedidosSeparados, 0);
  const totalConf  = ops.reduce((s, o) => s + o.pedidosConferidos, 0);
  const totalExc   = ops.reduce((s, o) => s + o.totalExcecoes, 0);
  const tempos     = ops.filter(o => o.tempoMedioSepMin !== null).map(o => o.tempoMedioSepMin as number);
  const avgTempo   = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;
  const maisRapido = [...ops].filter(o => o.tempoMedioSepMin !== null).sort((a, b) => (a.tempoMedioSepMin ?? 999) - (b.tempoMedioSepMin ?? 999))[0];
  const picoGlobal = [...dailyGlobal].sort((a, b) => (b.sep + b.conf) - (a.sep + a.conf))[0];

  return (
    <div className="min-h-[100dvh] bg-background pb-safe">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">KPIs de Operadores</h1>
            <p className="text-xs text-muted-foreground">Análise de desempenho</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => refetch()}
          data-testid="btn-kpi-refresh"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">

        {/* Filtro */}
        <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
          {/* Header — sempre visível, clique para colapsar */}
          <button
            className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
            onClick={() => setShowFilters(v => !v)}
            data-testid="btn-kpi-toggle-filters"
          >
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-semibold flex-1">Filtros</span>
            <span className="text-[11px] text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded-lg shrink-0">
              {format(parseISO(from), "dd/MM", { locale: ptBR })} – {format(parseISO(to), "dd/MM", { locale: ptBR })}
            </span>
            {showFilters
              ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
          </button>

          {/* Conteúdo colapsável */}
          {showFilters && (
            <div className="px-4 pb-4 space-y-3 border-t border-border/40">
              {/* Seletor de período (padrão do app) */}
              <div className="pt-3">
                <DatePickerWithRange
                  date={tempRange}
                  onDateChange={setTempRange}
                  className="w-full"
                />
              </div>

              {/* Botão aplicar — largura total */}
              <Button
                onClick={applyFilter}
                disabled={isFetching}
                className="w-full h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white"
                data-testid="btn-kpi-filter"
              >
                {isFetching
                  ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Carregando...</>
                  : <><BarChart3 className="h-4 w-4 mr-2" />Aplicar</>}
              </Button>

              {/* Atalhos de período */}
              <div className="flex gap-2">
                {PRESET_DAYS.map(({ label, days }) => (
                  <Button
                    key={days}
                    variant="outline"
                    size="sm"
                    onClick={() => setPreset(days)}
                    className="h-8 flex-1 rounded-lg text-xs"
                    data-testid={`btn-kpi-preset-${days}`}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
            {[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-2xl" />)}
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
            <Trophy className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma atividade no período.</p>
          </div>
        )}

        {!isLoading && !isError && ops.length > 0 && (
          <>
            {/* Totais */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: Package,       label: "Separados",  value: totalSep,            color: "text-blue-600 dark:text-blue-400",   bg: "bg-blue-50 dark:bg-blue-950/30" },
                { icon: CheckCircle2,  label: "Conferidos", value: totalConf,            color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/30" },
                { icon: Clock,         label: "T.Médio sep", value: fmtTime(avgTempo),   color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30" },
              ].map(({ icon: Icon, label, value, color, bg }) => (
                <div key={label} className={`rounded-2xl ${bg} px-3 py-3 flex flex-col items-center gap-0.5`}>
                  <Icon className={`h-4 w-4 ${color} opacity-70`} />
                  <p className={`text-xl font-extrabold tabular-nums ${color}`}>{value}</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: Boxes,         label: "Volumes",    value: ops.reduce((s,o) => s+o.totalVolumes, 0), color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-950/30" },
                { icon: AlertTriangle, label: "Exceções",   value: totalExc,            color: totalExc > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground", bg: totalExc > 0 ? "bg-red-50 dark:bg-red-950/30" : "bg-muted" },
              ].map(({ icon: Icon, label, value, color, bg }) => (
                <div key={label} className={`rounded-2xl ${bg} px-3 py-3 flex items-center gap-3`}>
                  <Icon className={`h-4 w-4 ${color} opacity-70 shrink-0`} />
                  <div>
                    <p className={`text-xl font-extrabold tabular-nums ${color}`}>{value}</p>
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Insights compactos */}
            {(maisRapido || picoGlobal) && (
              <div className="rounded-2xl border border-border/50 bg-card divide-y divide-border/40">
                <p className="px-4 pt-3 pb-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                  <Zap className="h-3 w-3 text-amber-500" />Destaques
                </p>
                {maisRapido && (
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <Timer className="h-4 w-4 text-green-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">{maisRapido.userName}</p>
                      <p className="text-[10px] text-muted-foreground">Mais rápido · {fmtTime(maisRapido.tempoMedioSepMin)} por pedido</p>
                    </div>
                  </div>
                )}
                {picoGlobal && (
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    <TrendingUp className="h-4 w-4 text-violet-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold">{fmtDate(picoGlobal.dia)}</p>
                      <p className="text-[10px] text-muted-foreground">Dia mais movimentado · {picoGlobal.sep + picoGlobal.conf} pedidos</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Busca por Pedido */}
            <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
              {/* Header colapsável */}
              <button
                className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                onClick={() => setShowOrderSearch(v => !v)}
                data-testid="btn-order-search-toggle"
              >
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-semibold flex-1">Tempo por Pedido</span>
                {orderSearchId && (
                  <span className="text-[11px] text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded-lg shrink-0">
                    {orderSearchId}
                  </span>
                )}
                {showOrderSearch
                  ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                  : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
              </button>

              {showOrderSearch && (
                <div className="px-4 pb-4 space-y-3 border-t border-border/40">
                  {/* Input de busca */}
                  <div className="flex gap-2 pt-3">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={orderInput}
                        onChange={e => setOrderInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && searchOrder()}
                        placeholder="Número do pedido (ex: 12345)"
                        className="w-full h-9 rounded-xl border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        data-testid="input-order-search"
                      />
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
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

                  {/* Resultado */}
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
                      {/* Cabeçalho do pedido */}
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

                      {/* Sem registros */}
                      {orderTimesData.sections.length === 0 && (!orderTimesData.conferencia || orderTimesData.conferencia.length === 0) && (
                        <p className="text-[12px] text-muted-foreground text-center py-2">Sem registros de execução</p>
                      )}

                      {/* SEPARAÇÃO — agrupado por seção */}
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

                      {/* CONFERÊNCIA — exibida separadamente das seções */}
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

            {/* Tempo por Seção */}
            {secTimesData && secTimesData.sections.length > 0 && (
              <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
                <button
                  className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setShowSecTimes(v => !v)}
                  data-testid="btn-sec-times-toggle"
                >
                  <Timer className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="text-sm font-semibold flex-1">Tempo por Seção</span>
                  <span className="text-[10px] text-muted-foreground mr-1">{secTimesData.sections.length} seções</span>
                  {showSecTimes
                    ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>

                {showSecTimes && (() => {
                  const maxSep  = Math.max(0, ...secTimesData.sections.map(s => s.avgSepMin  ?? 0));
                  const maxConf = Math.max(0, ...secTimesData.sections.map(s => s.avgConfMin ?? 0));
                  return (
                    <div className="divide-y divide-border/20 border-t border-border/40">
                      {secTimesData.sections.map(s => {
                        const label = s.section === "Sem Seção"
                          ? "Sem Seção"
                          : s.sectionName ?? `Seção ${s.section}`;
                        const showId = !!s.sectionName && s.section !== "Sem Seção";
                        return (
                          <div key={s.section} className="px-3 py-2.5">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-xs font-bold truncate">{label}</span>
                                {showId && (
                                  <span className="text-[10px] text-muted-foreground font-mono shrink-0">#{s.section}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] shrink-0 ml-2">
                                {s.sepCount > 0 && (
                                  <span className="text-blue-600 dark:text-blue-400 tabular-nums font-semibold">{s.sepCount} sep</span>
                                )}
                                {s.confCount > 0 && (
                                  <span className="text-green-600 dark:text-green-400 tabular-nums font-semibold">{s.confCount} conf</span>
                                )}
                              </div>
                            </div>

                            {s.sepCount > 0 && (
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-[10px] text-blue-500 font-semibold w-7 shrink-0">Sep</span>
                                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-blue-500 rounded-full transition-all"
                                    style={{ width: maxSep > 0 ? `${((s.avgSepMin ?? 0) / maxSep) * 100}%` : "0%" }}
                                  />
                                </div>
                                <div className="text-right shrink-0 min-w-[4.5rem]">
                                  <span className="text-xs font-bold tabular-nums">{fmtTime(s.avgSepMin)}</span>
                                  {s.minSepMin !== null && (
                                    <span className="text-[10px] text-muted-foreground tabular-nums"> {fmtTime(s.minSepMin)}–{fmtTime(s.maxSepMin)}</span>
                                  )}
                                </div>
                              </div>
                            )}

                            {s.confCount > 0 && (
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-green-500 font-semibold w-7 shrink-0">Conf</span>
                                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-green-500 rounded-full transition-all"
                                    style={{ width: maxConf > 0 ? `${((s.avgConfMin ?? 0) / maxConf) * 100}%` : "0%" }}
                                  />
                                </div>
                                <div className="text-right shrink-0 min-w-[4.5rem]">
                                  <span className="text-xs font-bold tabular-nums">{fmtTime(s.avgConfMin)}</span>
                                  {s.minConfMin !== null && (
                                    <span className="text-[10px] text-muted-foreground tabular-nums"> {fmtTime(s.minConfMin)}–{fmtTime(s.maxConfMin)}</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Gráfico diário global */}
            {dailyGlobal.length > 0 && (
              <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Produção diária</p>
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" />Sep</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500 inline-block" />Conf</span>
                    <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-amber-500 inline-block" />T.méd</span>
                  </div>
                </div>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={dailyGlobal} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis
                        dataKey="dia"
                        tickFormatter={fmtDate}
                        tick={{ fontSize: 9 }}
                        interval={dailyGlobal.length > 14 ? Math.floor(dailyGlobal.length / 8) : 0}
                      />
                      <YAxis yAxisId="qty" tick={{ fontSize: 9 }} allowDecimals={false} />
                      <YAxis yAxisId="tempo" orientation="right" tick={{ fontSize: 9 }} tickFormatter={v => `${v}m`} width={28} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar yAxisId="qty" dataKey="sep" stackId="a" fill="#3b82f6" opacity={0.85} />
                      <Bar yAxisId="qty" dataKey="conf" stackId="a" fill="#22c55e" opacity={0.85} radius={[2, 2, 0, 0]} />
                      {dailyGlobal.some(d => d.tempoMedioSep !== null) && (
                        <Line yAxisId="tempo" type="monotone" dataKey="tempoMedioSep" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Ranking */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Trophy className="h-4 w-4 text-amber-500 shrink-0" />
                <p className="text-sm font-semibold">Ranking</p>
                <Badge variant="outline" className="ml-auto text-[10px] h-5">{ops.length} operadores</Badge>
              </div>
              {ops.map((op, i) => <OperatorCard key={op.userId} op={op} rank={i + 1} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
