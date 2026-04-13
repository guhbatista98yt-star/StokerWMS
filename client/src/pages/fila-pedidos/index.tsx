import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSessionQueryKey } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSSE } from "@/hooks/use-sse";
import {
  ClipboardList,
  LogOut,
  RefreshCw,
  CheckCircle2,
  PlayCircle,
  Hourglass,
  Eye,
  EyeOff,
  Timer,
  Volume2,
  VolumeX,
} from "lucide-react";
import { beep, getSoundEnabled, setSoundEnabled as persistSoundEnabled } from "@/lib/audio-feedback";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

interface QueueOrder {
  orderId: string;
  erpOrderId: string;
  customerCode: string | null;
  customerName: string;
  totalProducts: number;
  financialStatus: string | null;
  status: string;
  isLaunched: boolean;
  operatorName: string | null;
  lockedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  queuedAt: string | null;
  launchedAt: string | null;
}

const FINANCIAL_MAP: Record<string, { label: string; bg: string; text: string; border: string }> = {
  faturado:  { label: "Liberado",  bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300" },
  liberado:  { label: "Liberado",  bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300" },
  pago:      { label: "Pago",      bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300" },
  pendente:  { label: "Pendente",  bg: "bg-amber-100",   text: "text-amber-700",   border: "border-amber-300"   },
  bloqueado: { label: "Bloqueado", bg: "bg-red-100",     text: "text-red-700",     border: "border-red-300"     },
};

function getFinancial(raw: string | null) {
  const key = (raw || "").toLowerCase().trim();
  return FINANCIAL_MAP[key] ?? {
    label: raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : "—",
    bg: "bg-slate-100", text: "text-slate-600", border: "border-slate-300",
  };
}

function FinancialBadge({ raw, large }: { raw: string | null; large?: boolean }) {
  const f = getFinancial(raw);
  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold ${f.bg} ${f.text} ${f.border} ${large ? "text-sm px-3 py-1" : "text-xs px-2.5 py-0.5"}`}
      data-testid="badge-financial-status"
    >
      {f.label}
    </span>
  );
}

function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState("00:00:00");

  useEffect(() => {
    const startMs = new Date(startedAt).getTime();
    const tick = () => {
      const diff = Math.max(0, Date.now() - startMs);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setElapsed(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return <span className="font-mono tabular-nums">{elapsed}</span>;
}

function StaticDuration({ from, to }: { from: string; to: string }) {
  const diff = Math.max(0, new Date(to).getTime() - new Date(from).getTime());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return (
    <span className="font-mono tabular-nums">
      {`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`}
    </span>
  );
}

function SeparandoCard({ order }: { order: QueueOrder }) {
  const timerStart = order.lockedAt || order.startedAt;

  return (
    <div
      data-testid={`card-order-${order.orderId}`}
      className="bg-white dark:bg-slate-800 rounded-2xl border-2 border-amber-400 dark:border-amber-500 shadow-xl overflow-hidden"
    >
      <div className="bg-amber-500 px-5 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-white animate-pulse shrink-0" />
          <span className="text-white font-bold text-sm uppercase tracking-wider">Em Separação</span>
        </div>
        {order.operatorName && (
          <span className="text-amber-100 text-xs font-medium truncate max-w-[120px]" data-testid="text-operator-name">
            {order.operatorName}
          </span>
        )}
      </div>

      <div className="px-5 pt-5 pb-3">
        <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-widest mb-1">Pedido</p>
        <p
          className="text-6xl font-black text-slate-900 dark:text-white leading-none tracking-tight"
          data-testid="text-order-number"
        >
          #{order.erpOrderId}
        </p>
      </div>

      <div className="px-5 pb-4">
        {order.customerCode && (
          <p className="text-sm font-mono text-slate-400 mb-0.5" data-testid="text-customer-code">
            {order.customerCode}
          </p>
        )}
        <p className="text-xl font-bold text-slate-800 dark:text-slate-100 leading-snug" data-testid="text-customer-name">
          {order.customerName}
        </p>
      </div>

      <div className="mx-5 mb-5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Timer className="h-5 w-5 text-amber-600 shrink-0" />
          <div>
            <p className="text-[10px] text-amber-600 uppercase font-bold tracking-wide">Separando há</p>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-300">
              {timerStart ? <ElapsedTimer startedAt={timerStart} /> : "--:--:--"}
            </div>
          </div>
        </div>
        <FinancialBadge raw={order.financialStatus} large />
      </div>
    </div>
  );
}

function AguardandoCard({ order }: { order: QueueOrder }) {
  const isInQueue = order.status === "em_fila";

  return (
    <div
      data-testid={`card-order-${order.orderId}`}
      className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden"
    >
      <div className="bg-slate-100 dark:bg-slate-700/60 px-4 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Hourglass className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-slate-600 dark:text-slate-300 font-semibold text-xs uppercase tracking-wide">
            {isInQueue ? "Na fila" : "Aguardando"}
          </span>
        </div>
        <FinancialBadge raw={order.financialStatus} />
      </div>

      <div className="px-4 pt-4 pb-5">
        <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest mb-1">Pedido</p>
        <p
          className="text-4xl font-black text-slate-900 dark:text-white leading-none mb-3"
          data-testid="text-order-number"
        >
          #{order.erpOrderId}
        </p>
        {order.customerCode && (
          <p className="text-xs font-mono text-slate-400 mb-0.5" data-testid="text-customer-code">
            {order.customerCode}
          </p>
        )}
        <p className="text-base font-bold text-slate-700 dark:text-slate-200 leading-snug" data-testid="text-customer-name">
          {order.customerName}
        </p>
      </div>
    </div>
  );
}

function FinalizadoCard({ order }: { order: QueueOrder }) {
  const timerStart = order.lockedAt || order.startedAt;

  return (
    <div
      data-testid={`card-order-${order.orderId}`}
      className="bg-white dark:bg-slate-800 rounded-2xl border-2 border-green-400 dark:border-green-500 shadow-md overflow-hidden"
    >
      <div className="bg-green-500 px-4 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-white" />
          <span className="text-white font-bold text-sm uppercase tracking-wide">Separado</span>
        </div>
        <FinancialBadge raw={order.financialStatus} />
      </div>

      <div className="px-4 pt-4 pb-4">
        <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-widest mb-1">Pedido</p>
        <p
          className="text-4xl font-black text-green-700 dark:text-green-400 leading-none mb-2"
          data-testid="text-order-number"
        >
          #{order.erpOrderId}
        </p>
        {order.customerCode && (
          <p className="text-xs font-mono text-slate-400 mb-0.5" data-testid="text-customer-code">
            {order.customerCode}
          </p>
        )}
        <p className="text-base font-bold text-slate-700 dark:text-slate-200 leading-snug mb-3" data-testid="text-customer-name">
          {order.customerName}
        </p>
        {timerStart && order.completedAt && (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
            <Timer className="h-3.5 w-3.5 shrink-0" />
            <span>Separado em <StaticDuration from={timerStart} to={order.completedAt} /></span>
          </div>
        )}
      </div>
    </div>
  );
}

function OcultoCard({ order }: { order: QueueOrder }) {
  return (
    <div
      data-testid={`card-order-${order.orderId}`}
      className="bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 shadow-none overflow-hidden"
    >
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-black text-slate-500 dark:text-slate-400 leading-none" data-testid="text-order-number">
            #{order.erpOrderId}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5" data-testid="text-customer-name">
            {order.customerName}
          </p>
        </div>
        <FinancialBadge raw={order.financialStatus} />
      </div>
    </div>
  );
}

function SectionTitle({ label, count, colorClass }: { label: string; count: number; colorClass: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest">{label}</h2>
      <span className={`text-xs font-bold rounded-full px-2.5 py-0.5 border ${colorClass}`}>{count}</span>
      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
    </div>
  );
}

export default function FilaPedidosPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [showHidden, setShowHidden] = useState(false);
  const [tick, setTick] = useState(0);
  const [soundOn, setSoundOn] = useState(() => getSoundEnabled());

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    persistSoundEnabled(next);
  };

  // Track previous queue state to detect arrivals and completions
  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const prevCompletedIdsRef = useRef<Set<string>>(new Set());
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const queueQueryKey = useSessionQueryKey(["/api/queue/balcao"]);

  const { data: rawOrders, isLoading } = useQuery<QueueOrder[]>({
    queryKey: queueQueryKey,
    refetchInterval: 5000,
  });

  // Sound alerts: new orders + completions
  useEffect(() => {
    if (!rawOrders) return;

    const currentIds = new Set(rawOrders.map(o => o.orderId));
    const completedIds = new Set(rawOrders.filter(o => o.status === "concluido").map(o => o.orderId));

    if (!initialLoadDoneRef.current) {
      // First load — set baseline without playing sounds
      prevOrderIdsRef.current = currentIds;
      prevCompletedIdsRef.current = completedIds;
      initialLoadDoneRef.current = true;
      return;
    }

    if (soundOn) {
      // New orders that weren't in the previous snapshot
      const hasNew = [...currentIds].some(id => !prevOrderIdsRef.current.has(id));
      if (hasNew) beep("warning");

      // Orders that are newly completed
      const hasNewCompleted = [...completedIds].some(id => !prevCompletedIdsRef.current.has(id));
      if (hasNewCompleted) beep("complete");
    }

    prevOrderIdsRef.current = currentIds;
    prevCompletedIdsRef.current = completedIds;
  }, [rawOrders, soundOn]);

  const handleSSEMessage = useCallback(
    (_type: string, _data: any) => {
      queryClient.invalidateQueries({ queryKey: queueQueryKey });
    },
    [queryClient, queueQueryKey]
  );

  useSSE("/api/sse", [
    "picking_update", "lock_acquired", "lock_released", "picking_finished",
    "exception_created", "orders_launched", "orders_relaunched",
    "work_units_unlocked", "orders_launch_cancelled", "picking_started",
    "conference_started", "conference_finished", "work_unit_created", "item_picked",
  ], handleSSEMessage);

  const { separando, aguardando, finalizados, ocultos } = useMemo(() => {
    const now = Date.now();
    const orders = rawOrders || [];
    const separando: QueueOrder[] = [];
    const aguardando: QueueOrder[] = [];
    const finalizados: QueueOrder[] = [];
    const ocultos: QueueOrder[] = [];

    for (const o of orders) {
      if (o.status === "em_andamento") {
        separando.push(o);
      } else if (o.status === "concluido") {
        if (!o.completedAt) continue;
        const age = now - new Date(o.completedAt).getTime();
        if (age <= FIVE_MIN_MS) finalizados.push(o);
      } else {
        const entryTime = o.launchedAt || o.queuedAt;
        const age = entryTime ? now - new Date(entryTime).getTime() : 0;
        if (age > TWO_DAYS_MS) {
          ocultos.push(o);
        } else {
          aguardando.push(o);
        }
      }
    }

    separando.sort((a, b) => {
      const aT = new Date(a.lockedAt || a.startedAt || 0).getTime();
      const bT = new Date(b.lockedAt || b.startedAt || 0).getTime();
      return aT - bT;
    });

    aguardando.sort((a, b) => {
      const aT = new Date(a.launchedAt || a.queuedAt || 0).getTime();
      const bT = new Date(b.launchedAt || b.queuedAt || 0).getTime();
      return bT - aT;
    });

    finalizados.sort((a, b) => {
      const aT = new Date(a.completedAt || 0).getTime();
      const bT = new Date(b.completedAt || 0).getTime();
      return bT - aT;
    });

    ocultos.sort((a, b) => {
      const aT = new Date(a.launchedAt || a.queuedAt || 0).getTime();
      const bT = new Date(b.launchedAt || b.queuedAt || 0).getTime();
      return bT - aT;
    });

    return { separando, aguardando, finalizados, ocultos };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawOrders, tick]);

  const totalVisible = separando.length + aguardando.length + finalizados.length;
  const isEmpty = totalVisible === 0 && ocultos.length === 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <ClipboardList className="h-5 w-5 text-amber-500 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-900 dark:text-white leading-tight truncate">
              Fila de Pedidos — Balcão
            </h1>
            <p className="text-xs text-slate-500 hidden sm:block">Acompanhamento em tempo real</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {separando.length > 0 && (
            <Badge className="bg-amber-500 text-white border-0 gap-1 text-xs" data-testid="badge-count-separando">
              <PlayCircle className="h-3 w-3" />
              {separando.length} em separação
            </Badge>
          )}
          {aguardando.length > 0 && (
            <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-300 gap-1 text-xs hidden sm:flex" data-testid="badge-count-aguardando">
              <Hourglass className="h-3 w-3" />
              {aguardando.length} aguardando
            </Badge>
          )}
          {finalizados.length > 0 && (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300 gap-1 text-xs hidden md:flex" data-testid="badge-count-finalizados">
              <CheckCircle2 className="h-3 w-3" />
              {finalizados.length} separados
            </Badge>
          )}

          {ocultos.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHidden(v => !v)}
              className="gap-1.5 text-slate-500 border-slate-300 h-8 px-3 text-xs hidden sm:flex"
              data-testid="button-toggle-hidden"
            >
              {showHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {ocultos.length}
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => queryClient.invalidateQueries({ queryKey: queueQueryKey })}
            data-testid="button-refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleSound}
            title={soundOn ? "Silenciar alertas" : "Ativar alertas sonoros"}
            data-testid="button-toggle-sound"
          >
            {soundOn ? <Volume2 className="h-4 w-4 text-amber-500" /> : <VolumeX className="h-4 w-4 text-slate-400" />}
          </Button>

          <span className="text-xs text-slate-500 hidden lg:block">{user?.name}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={logout} data-testid="button-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-10">
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-56 rounded-2xl" />
            ))}
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <ClipboardList className="h-24 w-24 mx-auto mb-6 text-slate-200 dark:text-slate-700" />
            <h3 className="text-3xl font-bold text-slate-400 dark:text-slate-500">Nenhum pedido na fila</h3>
            <p className="text-lg text-slate-400 dark:text-slate-600 mt-2 max-w-sm">
              Os pedidos de balcão aparecerão aqui conforme chegarem no sistema
            </p>
          </div>
        ) : (
          <>
            {separando.length > 0 && (
              <section data-testid="section-separando">
                <SectionTitle
                  label="Em Separação Agora"
                  count={separando.length}
                  colorClass="bg-amber-50 text-amber-700 border-amber-300"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {separando.map(o => <SeparandoCard key={o.orderId} order={o} />)}
                </div>
              </section>
            )}

            {aguardando.length > 0 && (
              <section data-testid="section-aguardando">
                <SectionTitle
                  label="Aguardando Início"
                  count={aguardando.length}
                  colorClass="bg-slate-100 text-slate-600 border-slate-300"
                />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {aguardando.map(o => <AguardandoCard key={o.orderId} order={o} />)}
                </div>
              </section>
            )}

            {finalizados.length > 0 && (
              <section data-testid="section-finalizados">
                <SectionTitle
                  label="Separados Recentemente"
                  count={finalizados.length}
                  colorClass="bg-green-50 text-green-700 border-green-300"
                />
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {finalizados.map(o => <FinalizadoCard key={o.orderId} order={o} />)}
                </div>
              </section>
            )}

            {ocultos.length > 0 && (
              <section data-testid="section-ocultos">
                <button
                  className="flex items-center gap-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors text-sm mb-4 group"
                  onClick={() => setShowHidden(v => !v)}
                  data-testid="button-toggle-hidden-section"
                >
                  {showHidden
                    ? <EyeOff className="h-4 w-4 group-hover:text-slate-600" />
                    : <Eye className="h-4 w-4 group-hover:text-slate-600" />
                  }
                  <span className="font-medium">
                    {showHidden ? "Ocultar" : "Mostrar"} fila escondida
                    <span className="ml-1 text-slate-400">
                      ({ocultos.length} pedido{ocultos.length !== 1 ? "s" : ""} com mais de 2 dias)
                    </span>
                  </span>
                </button>
                {showHidden && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {ocultos.map(o => <OcultoCard key={o.orderId} order={o} />)}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
