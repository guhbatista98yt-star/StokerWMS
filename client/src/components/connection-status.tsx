import type { ConnectionStatus } from "@/hooks/use-scan-websocket";

const statusConfig: Record<ConnectionStatus, { color: string; label: string }> = {
  connected: { color: "bg-green-500", label: "Conectado" },
  connecting: { color: "bg-yellow-500 animate-pulse", label: "Conectando..." },
  reconnecting: { color: "bg-yellow-500 animate-pulse", label: "Reconectando..." },
  disconnected: { color: "bg-red-500", label: "Sem conexão" },
  error: { color: "bg-red-600 animate-pulse", label: "Erro de conexão" },
};

export function ConnectionStatusIndicator({ status }: { status: ConnectionStatus }) {
  const cfg = statusConfig[status];
  return (
    <div className="flex items-center gap-1.5" data-testid="connection-status">
      <div className={`w-2.5 h-2.5 rounded-full ${cfg.color}`} />
      <span className="text-xs text-muted-foreground">{cfg.label}</span>
    </div>
  );
}
