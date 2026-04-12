/**
 * Print Agent WebSocket Server
 * Manages connections from local print agents running on Windows machines.
 * Agents connect outbound (no firewall issues) and receive print jobs.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import crypto from "crypto";
import { db } from "./db";
import { printAgents } from "@shared/schema";
import { eq } from "drizzle-orm";
import { log, getErrorMessage, getDbError } from "./log";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentPrinter {
  name: string;
  isDefault: boolean;
}

interface ConnectedAgent {
  ws: WebSocket;
  agentId: string;
  companyId: number;
  machineId: string;
  name: string;
  printers: AgentPrinter[];
  connectedAt: Date;
  lastPing: Date;
}

interface AgentMessage {
  type: string;
  [key: string]: unknown;
}

interface PrintJobResult {
  resolve: (result: { success: boolean; error?: string }) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  agentId: string;
}

// ─── In-memory registry ────────────────────────────────────────────────────────

const agents = new Map<string, ConnectedAgent>();
const pendingJobs = new Map<string, PrintJobResult>();

/** Derive a stable token hash (SHA-256) */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

/** Returns all printers available across all connected agents for a company.
 *  Format: `MACHINEID\\PRINTERNAME` (backslash-separated) */
export function getAgentPrinters(companyId: number): Array<{ name: string; isDefault: boolean; agentName: string; machineId: string }> {
  const result: Array<{ name: string; isDefault: boolean; agentName: string; machineId: string }> = [];
  for (const agent of agents.values()) {
    if (agent.companyId !== companyId) continue;
    for (const p of agent.printers) {
      result.push({
        name: `${agent.machineId}\\${p.name}`,
        isDefault: false,
        agentName: agent.name,
        machineId: agent.machineId,
      });
    }
  }
  return result;
}

/** Check if a printer name is an agent printer (contains backslash) */
export function isAgentPrinter(printerName: string): boolean {
  return printerName.includes("\\");
}

/** Parse an agent printer name into machineId and local printer name */
export function parseAgentPrinter(printerName: string): { machineId: string; printer: string } | null {
  const idx = printerName.indexOf("\\");
  if (idx < 0) return null;
  return {
    machineId: printerName.slice(0, idx),
    printer: printerName.slice(idx + 1),
  };
}

/** Send a print job to an agent. Supports template+data (ReportLab) or html (legacy). */
export async function printViaAgent(
  companyId: number,
  machineId: string,
  printer: string,
  copies: number,
  user: string,
  payload: { html?: string; template?: string; data?: Record<string, unknown> }
): Promise<{ success: boolean; error?: string }> {
  try {
    const agent = [...agents.values()].find(
      a => a.companyId === companyId && a.machineId.toLowerCase() === machineId.toLowerCase()
    );

    if (!agent) {
      return { success: false, error: `Agente da máquina "${machineId}" não está conectado.` };
    }

    if (agent.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: `Conexão com agente "${machineId}" não está disponível.` };
    }

    const jobId = crypto.randomUUID().slice(0, 8);
    const label = payload.template || "html";
    log(`[agent] Job #${jobId} → ${machineId}\\${printer} x${copies} [${label}] (${user})`, "print");

    return await new Promise<{ success: boolean; error?: string }>((resolve) => {
      const timeoutId = setTimeout(() => {
        pendingJobs.delete(jobId);
        log(`[agent] Job #${jobId} TIMEOUT (${machineId}\\${printer})`, "print");
        resolve({ success: false, error: "Timeout: agente não respondeu em 60s." });
      }, 60_000);

      pendingJobs.set(jobId, { resolve, timeoutId, agentId: agent.agentId });

      try {
        agent.ws.send(JSON.stringify({
          type: "print",
          jobId,
          printer,
          copies: Math.max(1, Math.min(copies, 99)),
          user,
          ...payload,
        }));
      } catch (sendErr) {
        clearTimeout(timeoutId);
        pendingJobs.delete(jobId);
        resolve({ success: false, error: `Erro ao enviar job: ${getErrorMessage(sendErr)}` });
      }
    });
  } catch (err) {
    const errMsg = getErrorMessage(err);
    log(`[agent] printViaAgent erro inesperado: ${errMsg}`, "print");
    return { success: false, error: `Erro interno no agente: ${errMsg}` };
  }
}

/** Get list of connected agents (for admin UI) */
export function getConnectedAgents(companyId?: number): Array<{
  agentId: string;
  machineId: string;
  name: string;
  companyId: number;
  printers: AgentPrinter[];
  connectedAt: string;
  lastPing: string;
}> {
  const result = [];
  for (const agent of agents.values()) {
    if (companyId !== undefined && agent.companyId !== companyId) continue;
    result.push({
      agentId: agent.agentId,
      machineId: agent.machineId,
      name: agent.name,
      companyId: agent.companyId,
      printers: agent.printers,
      connectedAt: agent.connectedAt.toISOString(),
      lastPing: agent.lastPing.toISOString(),
    });
  }
  return result;
}

// ─── WebSocket Server Setup ────────────────────────────────────────────────────

export function setupPrintAgentWS(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  // ── Guarda de erros no servidor WSS ───────────────────────────────────────────
  // Sem este handler, qualquer erro emitido pelo WSS seria uma exceção não capturada
  // e derrubaria o processo principal do Node.js.
  wss.on("error", (err) => {
    log(`[agent] WebSocket server erro (não-fatal): ${err.message}`, "print");
  });

  // ── Upgrade HTTP → WebSocket (apenas no path correto) ─────────────────────────
  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws/print-agent") return;
    // Guarda de erro no socket bruto — evita crash por ECONNRESET/EPIPE.
    // ECONNRESET e EPIPE são eventos normais de rede (cliente desconectou durante handshake)
    // e não indicam falha — silenciamos para não poluir o log.
    socket.on("error", (err: NodeJS.ErrnoException) => {
      const normal = ["ECONNRESET", "EPIPE", "ECONNABORTED"];
      if (!normal.includes(err.code ?? "")) {
        log(`[agent] Socket upgrade erro inesperado: ${err.message}`, "print");
      }
    });
    wss.handleUpgrade(request, socket as any, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  // ── Conexão de um agente ──────────────────────────────────────────────────────
  wss.on("connection", (ws: WebSocket) => {
    let registeredAgentId: string | null = null;

    // Timeout de autenticação: o agente deve se registrar em 10s
    const authTimeout = setTimeout(() => {
      if (!registeredAgentId) {
        log("[agent] Conexão sem autenticação — fechando", "print");
        try { ws.close(4001, "authentication timeout"); } catch {}
      }
    }, 10_000);

    // ── Mensagens recebidas do agente ─────────────────────────────────────────
    // O try/catch externo garante que nenhuma rejeição não capturada
    // vaze para o processo principal, independente do que aconteça.
    ws.on("message", async (data: Buffer) => {
      try {
        // Limite de tamanho de mensagem: 512 KB para evitar ataques de memória
        if (data.length > 512 * 1024) {
          log("[agent] Mensagem muito grande — descartada", "print");
          return;
        }

        let msg: AgentMessage;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          try { ws.send(JSON.stringify({ type: "error", message: "JSON inválido" })); } catch {}
          return;
        }

        // ── Register ────────────────────────────────────────────────────────
        if (msg.type === "register") {
          try {
            clearTimeout(authTimeout);

            const token = String(msg.token ?? "");
            const machineId = String(msg.machineId ?? "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 64);
            const printers: AgentPrinter[] = Array.isArray(msg.printers)
              ? (msg.printers as any[])
                  .slice(0, 100)
                  .map(p => ({
                    name: String(p.name ?? p).trim().slice(0, 200),
                    isDefault: Boolean(p.isDefault),
                  }))
                  .filter(p => p.name)
              : [];

            if (!token || !machineId) {
              try { ws.send(JSON.stringify({ type: "register_error", message: "token e machineId obrigatórios" })); } catch {}
              try { ws.close(4002, "missing fields"); } catch {}
              return;
            }

            const tokenHash = hashToken(token);

            const [agentRecord] = await db
              .select()
              .from(printAgents)
              .where(eq(printAgents.tokenHash, tokenHash))
              .limit(1);

            if (!agentRecord || !agentRecord.active) {
              log(`[agent] Token inválido de ${machineId}`, "print");
              try { ws.send(JSON.stringify({ type: "register_error", message: "Token inválido ou agente desativado" })); } catch {}
              try { ws.close(4003, "invalid token"); } catch {}
              return;
            }

            // Desconecta conexão anterior do mesmo agente (reconexão)
            const existing = agents.get(agentRecord.id);
            if (existing && existing.ws.readyState === WebSocket.OPEN) {
              try { existing.ws.close(4004, "nova conexão para mesmo agente"); } catch {}
            }

            registeredAgentId = agentRecord.id;

            agents.set(agentRecord.id, {
              ws,
              agentId: agentRecord.id,
              companyId: agentRecord.companyId,
              machineId,
              name: agentRecord.name,
              printers,
              connectedAt: new Date(),
              lastPing: new Date(),
            });

            // Persiste last_seen_at, machineId e lista de impressoras no banco
            db.update(printAgents)
              .set({
                lastSeenAt: new Date().toISOString(),
                machineId,
                printers: JSON.stringify(printers),
              })
              .where(eq(printAgents.id, agentRecord.id))
              .catch(() => {});

            log(`[agent] "${agentRecord.name}" (${machineId}) conectado — ${printers.length} impressora(s)`, "print");

            try {
              ws.send(JSON.stringify({
                type: "registered",
                agentId: agentRecord.id,
                name: agentRecord.name,
                machineId,
              }));
            } catch {}
          } catch (err) {
            log(`[agent] Erro no registro: ${getErrorMessage(err)}`, "print");
            try { ws.send(JSON.stringify({ type: "register_error", message: "Erro interno no servidor" })); } catch {}
            try { ws.close(4005, "server error"); } catch {}
          }
          return;
        }

        // Mensagens abaixo exigem autenticação prévia
        if (!registeredAgentId) {
          try { ws.send(JSON.stringify({ type: "error", message: "não autenticado" })); } catch {}
          return;
        }

        const agent = agents.get(registeredAgentId);
        if (!agent) return;

        // ── Ping / Pong ─────────────────────────────────────────────────────
        if (msg.type === "ping") {
          agent.lastPing = new Date();
          try { ws.send(JSON.stringify({ type: "pong", ts: Date.now() })); } catch {}
          return;
        }

        // ── Atualização da lista de impressoras ──────────────────────────────
        if (msg.type === "printers_update") {
          const printers: AgentPrinter[] = Array.isArray(msg.printers)
            ? (msg.printers as any[])
                .slice(0, 100)
                .map(p => ({
                  name: String(p.name ?? p).trim().slice(0, 200),
                  isDefault: Boolean(p.isDefault),
                }))
                .filter(p => p.name)
            : [];
          agent.printers = printers;
          // Persiste lista de impressoras no banco (usa referência local para evitar race condition)
          const agentIdForUpdate = registeredAgentId;
          if (agentIdForUpdate) {
            db.update(printAgents)
              .set({ printers: JSON.stringify(printers) })
              .where(eq(printAgents.id, agentIdForUpdate))
              .catch(() => {});
          }
          log(`[agent] "${agent.name}" atualizou impressoras: ${printers.map(p => p.name).join(", ")}`, "print");
          return;
        }

        // ── Resultado de job de impressão ────────────────────────────────────
        if (msg.type === "print_result") {
          const jobId = String(msg.jobId ?? "");
          const pending = pendingJobs.get(jobId);
          if (pending) {
            clearTimeout(pending.timeoutId);
            pendingJobs.delete(jobId);
            const success = Boolean(msg.success);
            const error = msg.error ? String(msg.error) : undefined;
            log(`[agent] Job #${jobId} ${success ? "✓" : "ERRO: " + error} ${agent.machineId}`, "print");
            pending.resolve({ success, error });
          }
          return;
        }

      } catch (err) {
        // Guarda final — nunca propaga para o processo
        log(`[agent] Erro inesperado no handler de mensagem: ${getErrorMessage(err)}`, "print");
      }
    });

    // ── Desconexão do agente ───────────────────────────────────────────────────
    ws.on("close", () => {
      clearTimeout(authTimeout);
      if (registeredAgentId) {
        const agent = agents.get(registeredAgentId);
        if (agent) {
          log(`[agent] "${agent.name}" (${agent.machineId}) desconectado`, "print");

          // Resolve apenas os jobs pendentes DESTE agente como erro
          for (const [jobId, pending] of pendingJobs.entries()) {
            if (pending.agentId === registeredAgentId) {
              clearTimeout(pending.timeoutId);
              pendingJobs.delete(jobId);
              pending.resolve({ success: false, error: `Agente "${agent.name}" desconectou durante impressão.` });
            }
          }

          agents.delete(registeredAgentId);
        }
      }
    });

    // ── Erros de socket do agente ─────────────────────────────────────────────
    // Sem este handler, um ECONNRESET ou EPIPE ao fechar o agente derrubaria
    // o servidor principal (exceção não capturada no EventEmitter).
    // ECONNRESET/EPIPE/ECONNABORTED = cliente desconectou normalmente — não loga.
    ws.on("error", (err: NodeJS.ErrnoException) => {
      const normal = ["ECONNRESET", "EPIPE", "ECONNABORTED"];
      if (!normal.includes(err.code ?? "")) {
        log(`[agent] WebSocket erro inesperado: ${err.message}`, "print");
      }
    });
  });

  log("[agent] WebSocket server iniciado em /ws/print-agent", "print");
}
