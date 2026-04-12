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
  operatorName: string | null;
  startedAt: string | null;
  lockedAt: string | null;
}

function ElapsedTimer({ startedAt }: { startedAt: string | null }) {
  const [elapsed, setElapsed] = useState("00:00:00");

  useEffect(() => {
    if (!startedAt) {
      setElapsed("00:00:00");
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
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <span className="font-mono text-lg font-bold tabular-nums">{elapsed}</span>
  );
}

export default function FilaPedidosPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();

  const queueQueryKey = useSessionQueryKey(["/api/queue/balcao"]);

  const { data: queueOrders, isLoading } = useQuery<QueueOrder[]>({
    queryKey: queueQueryKey,
    refetchInterval: 3000,
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

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-5 w-5 text-amber-500 shrink-0" />
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">Fila de Pedidos</h1>
            <p className="text-xs text-muted-foreground">Acompanhamento em tempo real</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{user?.name}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={logout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              {queueOrders?.length || 0} pedido(s) em separação
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: queueQueryKey })}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Atualizar
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        ) : queueOrders && queueOrders.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {queueOrders.map((order) => (
              <div
                key={order.orderId}
                className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden"
              >
                <div className="bg-amber-500 px-4 py-2 flex items-center justify-between">
                  <span className="font-mono font-bold text-white text-sm">
                    #{order.erpOrderId}
                  </span>
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
                      <span className="text-sm font-medium">{order.totalProducts} produtos</span>
                    </div>
                    {order.operatorName && (
                      <span className="text-xs text-amber-600 font-medium">
                        {order.operatorName}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-center gap-2 py-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                    <Timer className="h-4 w-4 text-amber-500" />
                    <ElapsedTimer startedAt={order.startedAt || order.lockedAt} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <ClipboardList className="h-16 w-16 mx-auto mb-4 text-slate-300" />
            <h3 className="text-lg font-medium text-slate-500">Nenhum pedido em separação</h3>
            <p className="text-sm text-slate-400 mt-1">
              Os pedidos aparecerão aqui quando um operador do balcão iniciar a separação
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
