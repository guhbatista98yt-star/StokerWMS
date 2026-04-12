import { useEffect, useRef, useCallback, useState } from "react";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting" | "error";

export type ScanAckHandler = (ack: any) => void;

interface PendingMessage {
  id: string;
  data: string;
  timestamp: number;
}

export function generateMsgId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const LS_KEY_PREFIX = "ws_scan_pending_queue";
const LS_EXPIRED_PREFIX = "ws_scan_expired_queue";

function getLsKey(ns?: string): string {
  return ns ? `${LS_KEY_PREFIX}_${ns}` : LS_KEY_PREFIX;
}

function getExpiredLsKey(ns?: string): string {
  return ns ? `${LS_EXPIRED_PREFIX}_${ns}` : LS_EXPIRED_PREFIX;
}

function loadPendingQueue(ns?: string): PendingMessage[] {
  try {
    const raw = localStorage.getItem(getLsKey(ns));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadExpiredQueue(ns?: string): PendingMessage[] {
  try {
    const raw = localStorage.getItem(getExpiredLsKey(ns));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePendingQueue(queue: PendingMessage[], ns?: string) {
  try {
    localStorage.setItem(getLsKey(ns), JSON.stringify(queue));
  } catch {}
}

function saveExpiredQueue(queue: PendingMessage[], ns?: string) {
  try {
    localStorage.setItem(getExpiredLsKey(ns), JSON.stringify(queue));
  } catch {}
}

function clearPendingQueue(ns?: string) {
  try {
    localStorage.removeItem(getLsKey(ns));
  } catch {}
}

export function clearExpiredScanQueue(ns?: string) {
  try {
    localStorage.removeItem(getExpiredLsKey(ns));
  } catch {}
}

export function getExpiredScanCount(ns?: string): number {
  return loadExpiredQueue(ns).length;
}

const MAX_PENDING_QUEUE = 100;

export function useScanWebSocket(
  enabled: boolean,
  onAck?: ScanAckHandler,
  namespace?: string,
) {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [expiredQueue, setExpiredQueue] = useState<PendingMessage[]>(() => loadExpiredQueue(namespace));
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const enabledRef = useRef(enabled);
  const onAckRef = useRef(onAck);
  const nsRef = useRef(namespace);
  nsRef.current = namespace;
  const pendingQueueRef = useRef<PendingMessage[]>(loadPendingQueue(namespace));
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  enabledRef.current = enabled;
  onAckRef.current = onAck;

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
  }, []);

  const flushPendingQueue = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const queue = [...pendingQueueRef.current];
    if (queue.length === 0) return;

    const now = Date.now();
    const maxAge = 5 * 60 * 1000;
    const valid = queue.filter(m => now - m.timestamp < maxAge);
    const expired = queue.filter(m => now - m.timestamp >= maxAge);

    if (expired.length > 0) {
      // Move expired scans to persistent expired queue (S1-03)
      // so the UI can show a reconciliation modal instead of silently dropping them.
      const existing = loadExpiredQueue(nsRef.current);
      const existingIds = new Set(existing.map(m => m.id));
      const toAdd = expired.filter(m => !existingIds.has(m.id));
      const merged = [...existing, ...toAdd];
      saveExpiredQueue(merged, nsRef.current);
      setExpiredQueue(merged);

      pendingQueueRef.current = pendingQueueRef.current.filter(m => now - m.timestamp < maxAge);
      savePendingQueue(pendingQueueRef.current, nsRef.current);
    }

    for (const msg of valid) {
      try {
        ws.send(msg.data);
      } catch {}
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabledRef.current || !mountedRef.current) return;
    cleanup();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws/scanning`;

    setStatus("connecting");

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      reconnectAttemptRef.current = 0;
      setStatus("connected");

      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
        }
      }, 30_000);

      flushPendingQueue();
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "pong" || msg.type === "auth_ok") return;

        if (msg.type === "auth_error") {
          console.warn("[ws-scanning] Auth failed:", msg.message);
          cleanup();
          setStatus("disconnected");
          return;
        }

        if (msg.type === "scan_ack" || msg.type === "check_ack") {
          if (msg.msgId) {
            pendingQueueRef.current = pendingQueueRef.current.filter(m => {
              try {
                const parsed = JSON.parse(m.data);
                return parsed.msgId !== msg.msgId;
              } catch { return true; }
            });
            savePendingQueue(pendingQueueRef.current, nsRef.current);
          }
          onAckRef.current?.(msg);
        }
      } catch {}
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      wsRef.current = null;

      if (enabledRef.current) {
        const attempt = reconnectAttemptRef.current;
        const delay = Math.min(1000 * Math.pow(1.5, attempt), 10_000);
        reconnectAttemptRef.current = attempt + 1;
        setStatus("reconnecting");
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current && enabledRef.current) connect();
        }, delay);
      } else {
        setStatus("disconnected");
      }
    };

    ws.onerror = (event) => {
      if (!mountedRef.current) return;
      setStatus("error");
    };
  }, [cleanup, flushPendingQueue]);

  const enqueuePending = useCallback((msgId: string, payload: string) => {
    pendingQueueRef.current.push({ id: msgId, data: payload, timestamp: Date.now() });
    if (pendingQueueRef.current.length > MAX_PENDING_QUEUE) {
      pendingQueueRef.current = pendingQueueRef.current.slice(-MAX_PENDING_QUEUE);
    }
    savePendingQueue(pendingQueueRef.current, nsRef.current);
  }, []);

  const sendScan = useCallback((workUnitId: string, barcode: string, quantity?: number, externalMsgId?: string) => {
    const msgId = externalMsgId || generateMsgId();
    const payload = JSON.stringify({
      type: "scan",
      msgId,
      workUnitId,
      barcode,
      quantity: quantity ?? undefined,
    });

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload);
        // Enfileira apenas quando offline para evitar reenvio duplicado na reconexão
      } catch {
        enqueuePending(msgId, payload);
      }
    } else {
      // Offline: enfileira para reenvio quando reconectar
      enqueuePending(msgId, payload);
    }
    return msgId;
  }, [enqueuePending]);

  const sendCheck = useCallback((workUnitId: string, barcode: string, quantity?: number, externalMsgId?: string) => {
    const msgId = externalMsgId || generateMsgId();
    const payload = JSON.stringify({
      type: "check",
      msgId,
      workUnitId,
      barcode,
      quantity: quantity ?? undefined,
    });

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload);
        // Enfileira apenas quando offline para evitar reenvio duplicado na reconexão
      } catch {
        enqueuePending(msgId, payload);
      }
    } else {
      // Offline: enfileira para reenvio quando reconectar
      enqueuePending(msgId, payload);
    }
    return msgId;
  }, [enqueuePending]);

  const clearQueue = useCallback(() => {
    pendingQueueRef.current = [];
    clearPendingQueue(nsRef.current);
  }, []);

  const dismissExpiredQueue = useCallback(() => {
    clearExpiredScanQueue(nsRef.current);
    setExpiredQueue([]);
  }, []);

  const dismissExpiredItem = useCallback((id: string) => {
    const updated = loadExpiredQueue(nsRef.current).filter(m => m.id !== id);
    saveExpiredQueue(updated, nsRef.current);
    setExpiredQueue(updated);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) {
      connect();
    } else {
      cleanup();
      setStatus("disconnected");
    }
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [enabled, connect, cleanup]);

  return {
    status,
    sendScan,
    sendCheck,
    clearQueue,
    dismissExpiredQueue,
    dismissExpiredItem,
    expiredQueue,
    expiredCount: expiredQueue.length,
    isConnected: status === "connected",
    hasError: status === "error",
  };
}
