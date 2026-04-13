import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useSessionQueryKey } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSSE } from "@/hooks/use-sse";
import {
  ClipboardList,
  LogOut,
  User,
  Package,
  Timer,
  DollarSign,
  RefreshCw,
  Clock,
  CheckCircle2,
  Hourglass,
  PlayCircle,
} from "lucide-react";

interface QueueOrder {
  orderId: string;
  erpOrderId: string;
  customerCode: string | null;
  customerName: string;
  vendedor: string | null;
  totalProducts: number;
  financialStatus: string;
  status: string;
  isLaunched: boolean;
  operatorName: string | null;
  startedAt: string | null;
  lockedAt: string | null;
  completedAt: string | null;
  queuedAt: string | null;
  launchedAt: string | null;
}

function ElapsedTimer({ startedAt, stopped, label }: { startedAt: string | null; stopped?: boolean; label?: string }) {
  const [elapsed, setElapsed] = useState("00:00:00");

  useEffect(() => {
    if (!startedAt) {
      setElapsed("--:--:--");
      return;
    }

    const startTime = new Date(startedAt).getTime();

    const update = () => {
      const diff = Math.max(0, Date.now() - startTime);
      const hours = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setElapsed(
        `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      );
    };

    update();
    if (stopped) return;
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt, stopped]);

  return (
    <div className="flex flex-col items-center">
      {label && <span className="text-[10px] text-muted-foreground mb-0.5">{label}</span>}
      <span className="font-mono text-lg font-bold tabular-nums">{elapsed}</span>
    </div>
  );
}

function StaticDuration({ from, to }: { from: string | null; to: string | null }) {
  if (!from || !to) return <span className="font-mono text-lg font-bold tabular-nums">--:--:--</span>;
  const diff = Math.max(0, new Date(to).getTime() - new Date(from).getTime());
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const str = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] text-muted-foreground mb-0.5">Separação concluída em</span>
      <span className="font-mono text-lg font-bold tabular-nums">{str}</span>
    </div>
  );
}

const STATUS_CONFIG: Record<string, {
  label: string;
  headerBg: string;
  timerBg: string;
  timerText: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeCn: string;
}> = {
  aguardando: {
    label: "Aguardando Lançamento",
    headerBg: "bg-slate-400",
    timerBg: "bg-slate-50 dark:bg-slate-700/50",
    timerText: "text-slate-500",
    icon: Hourglass,
    badgeCn: "bg-slate-100 text-slate-600 border-slate-300",
  },
  em_fila: {
    label: "Na Fila",
    headerBg: "bg-blue-500",
    timerBg: "bg-blue-50 dark:bg-blue-900/30",
    timerText: "text-blue-500",
    icon: Clock,
    badgeCn: "bg-blue-100 text-blue-700 border-blue-300",
  },
  em_andamento: {
    label: "Em Separação",
    headerBg: "bg-amber-500",
    timerBg: "bg-amber-50 dark:bg-amber-900/20",
    timerText: "text-amber-500",
    icon: PlayCircle,
    badgeCn: "bg-amber-100 text-amber-700 border-amber-300",
  },
  concluido: {
    label: "Concluído",
    headerBg: "bg-green-500",
    timerBg: "bg-green-50 dark:bg-green-900/20",
    timerText: "text-green-500",
    icon: CheckCircle2,
    badgeCn: "bg-green-100 text-green-700 border-green-300",
  },
};

function getTimerProps(order: QueueOrder): { startedAt: string | null; label: string; stopped?: boolean; staticFrom?: string | null; staticTo?: string | null } {
  switch (order.status) {
    case "aguardando":
      return { startedAt: order.queuedAt, label: "Na fila há" };
    case "em_fila":
      return { startedAt: order.launchedAt || order.queuedAt, label: "Aguardando operador há" };
    case "em_andamento":
      return { startedAt: order.lockedAt || order.startedAt, label: "Separando há" };
    case "concluido":
      return { startedAt: null, label: "", staticFrom: order.lockedAt || order.startedAt, staticTo: order.completedAt, stopped: true };
    default:
      return { startedAt: null, label: "" };
  }
}

export default function FilaPedidosPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [hideCompleted, setHideCompleted] = useState(false);

  const queueQueryKey = useSessionQueryKey(["/api/queue/balcao"]);

  const { data: queueOrders, isLoading } = useQuery<QueueOrder[]>({
    queryKey: queueQueryKey,
    refetchInterval: 5000,
  });

  const handleSSEMessage = useCallback(
    (_type: string, _data: any) => {
      queryClient.invalidateQueries({ queryKey: queueQueryKey });
    },
    [queryClient, queueQueryKey]
  );

  useSSE("/api/sse", [
    "picking_update",
    "lock_acquired",
    "lock_released",
    "picking_finished",
    "exception_created",
    "orders_launched",
    "orders_relaunched",
    "work_units_unlocked",
    "orders_launch_cancelled",
    "picking_started",
    "conference_started",
    "conference_finished",
    "work_unit_created",
    "item_picked",
  ], handleSSEMessage);

  const filteredOrders = hideCompleted
    ? (queueOrders || []).filter(o => o.status !== "concluido")
    : (queueOrders || []);

  const counts = {
    aguardando: queueOrders?.filter(o => o.status === "aguardando").length || 0,
    em_fila: queueOrders?.filter(o => o.status === "em_fila").length || 0,
    em_andamento: queueOrders?.filter(o => o.status === "em_andamento").length || 0,
    concluido: queueOrders?.filter(o => o.status === "concluido").length || 0,
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-5 w-5 text-amber-500 shrink-0" />
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Fila de Pedidos — Balcão</h1>
            <p className="text-xs text-muted-foreground">Acompanhamento em tempo real</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{user?.name}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={logout} data-testid="button-logout">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
          <div className="flex flex-wrap items-center gap-2">
            {counts.em_andamento > 0 && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                <PlayCircle className="h-3 w-3 mr-1" />
                {counts.em_andamento} em separação
              </Badge>
            )}
            {counts.em_fila > 0 && (
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                <Clock className="h-3 w-3 mr-1" />
                {counts.em_fila} na fila
              </Badge>
            )}
            {counts.aguardando > 0 && (
              <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">
                <Hourglass className="h-3 w-3 mr-1" />
                {counts.aguardando} aguardando
              </Badge>
            )}
            {counts.concluido > 0 && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {counts.concluido} concluídos
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {counts.concluido > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHideCompleted(v => !v)}
                data-testid="button-toggle-completed"
              >
                {hideCompleted ? "Mostrar concluídos" : "Ocultar concluídos"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: queueQueryKey })}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Atualizar
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-52 rounded-xl" />
            ))}
          </div>
        ) : filteredOrders.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredOrders.map((order) => {
              const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.aguardando;
              const StatusIcon = cfg.icon;
              const timerProps = getTimerProps(order);

              return (
                <div
                  key={order.orderId}
                  data-testid={`card-order-${order.orderId}`}
                  className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden"
                >
                  <div className={`${cfg.headerBg} px-4 py-2 flex items-center justify-between`}>
                    <span className="font-mono font-bold text-white text-sm">
                      #{order.erpOrderId}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="secondary"
                        className={`text-[10px] font-semibold ${
                          order.financialStatus === "pago"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        <DollarSign className="h-3 w-3 mr-0.5" />
                        {order.financialStatus === "pago" ? "Pago" : "Não Pago"}
                      </Badge>
                      <Badge variant="secondary" className={`text-[10px] font-semibold border ${cfg.badgeCn}`}>
                        <StatusIcon className="h-3 w-3 mr-0.5" />
                        {cfg.label}
                      </Badge>
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-xs text-slate-500">Cliente</span>
                      </div>
                      <div>
                        {order.customerCode && (
                          <span className="text-xs font-mono text-slate-400 mr-1.5">{order.customerCode}</span>
                        )}
                        <span className="text-sm font-medium text-slate-900 dark:text-white">{order.customerName}</span>
                      </div>
                    </div>

                    {order.vendedor && (
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>Vendedor:</span>
                        <span className="font-medium text-slate-700 dark:text-slate-300">{order.vendedor}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-sm font-medium">
                          {order.totalProducts > 0 ? `${order.totalProducts} produto(s)` : "—"}
                        </span>
                      </div>
                      {order.operatorName && (
                        <span className="text-xs text-amber-600 font-medium">
                          {order.operatorName}
                        </span>
                      )}
                    </div>

                    <div className={`flex items-center justify-center gap-2 py-2 ${cfg.timerBg} rounded-lg`}>
                      <Timer className={`h-4 w-4 ${cfg.timerText}`} />
                      {order.status === "concluido" ? (
                        <StaticDuration from={timerProps.staticFrom || null} to={timerProps.staticTo || null} />
                      ) : (
                        <ElapsedTimer startedAt={timerProps.startedAt} label={timerProps.label} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20">
            <ClipboardList className="h-16 w-16 mx-auto mb-4 text-slate-300" />
            <h3 className="text-lg font-medium text-slate-500">Nenhum pedido na fila</h3>
            <p className="text-sm text-slate-400 mt-1">
              Os pedidos de balcão aparecerão aqui conforme chegarem no sistema
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
