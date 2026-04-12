import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import { IncomingMessage } from "http";
import { log, getErrorMessage, getDbError } from "./log";
import { getUserFromToken } from "./auth";
import { storage } from "./storage";
import { broadcastSSE } from "./sse";
import { parse as parseCookie } from "cookie";

interface ScanningClient {
  ws: WebSocket;
  userId: string;
  companyId: number | undefined;
  userRole: string;
  userName: string;
  userSections: string[];
}

const clients = new Map<WebSocket, ScanningClient>();
const messageChains = new Map<WebSocket, Promise<void>>();

const processedMsgIds = new Map<string, { timestamp: number; response: object }>();
const MSG_DEDUP_TTL = 5 * 60 * 1000;

function cleanupProcessedMsgIds() {
  const now = Date.now();
  for (const [id, entry] of processedMsgIds) {
    if (now - entry.timestamp > MSG_DEDUP_TTL) {
      processedMsgIds.delete(id);
    }
  }
}

setInterval(cleanupProcessedMsgIds, 60_000);

function sendMsg(ws: WebSocket, msg: object) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  } catch {}
}

function sendAndCache(ws: WebSocket, client: ScanningClient, msg: any) {
  sendMsg(ws, msg);
  if (msg.msgId) {
    processedMsgIds.set(makeDedupKey(client, msg.msgId), { timestamp: Date.now(), response: msg });
  }
}

async function authenticateWS(request: IncomingMessage): Promise<{ userId: string; companyId?: number; role: string; name: string; sections: string[] } | null> {
  let token: string | null = null;

  const url = new URL(request.url || "/", "http://localhost");
  token = url.searchParams.get("token");

  if (!token && request.headers.cookie) {
    const cookies = parseCookie(request.headers.cookie);
    token = cookies.authToken || null;
  }

  if (!token) return null;

  const result = await getUserFromToken(token);
  if (!result) return null;

  return {
    userId: result.user.id,
    companyId: result.companyId ?? undefined,
    role: result.user.role || "separacao",
    name: result.user.name || result.user.username,
    sections: (result.user as any).sections || [],
  };
}

function authorizeWorkUnitWS(wu: { companyId: number; section: string | null }, client: ScanningClient): { allowed: boolean; reason?: string } {
  if (client.companyId && wu.companyId !== client.companyId) {
    return { allowed: false, reason: "Acesso negado: empresa diferente" };
  }
  if (client.userRole === "separacao") {
    if (client.userSections.length === 0) {
      return { allowed: false, reason: "Acesso negado: sem seções atribuídas" };
    }
    if (wu.section && !client.userSections.includes(wu.section)) {
      return { allowed: false, reason: "Acesso negado: seção não permitida" };
    }
  }
  return { allowed: true };
}

function assertLockOwnershipWS(wu: { lockedBy: string | null; lockExpiresAt: string | null }, client: ScanningClient): { allowed: boolean; reason?: string } {
  if (client.userRole === "supervisor" || client.userRole === "administrador") {
    return { allowed: true };
  }
  if (!wu.lockedBy) {
    return { allowed: false, reason: "Unidade não está bloqueada" };
  }
  if (wu.lockedBy !== client.userId) {
    return { allowed: false, reason: "Unidade bloqueada por outro operador" };
  }
  if (wu.lockExpiresAt && new Date(wu.lockExpiresAt) < new Date()) {
    return { allowed: false, reason: "Lock expirado. Bloqueie novamente." };
  }
  return { allowed: true };
}

function makeDedupKey(client: ScanningClient, msgId: string): string {
  return `${client.companyId ?? "0"}:${client.userId}:${msgId}`;
}

async function handleScanItem(client: ScanningClient, msg: any) {
  const { msgId, workUnitId, barcode, quantity } = msg;

  if (msgId) {
    // Fast path: in-memory cache (cobre reconexão sem reinício, sem round-trip ao banco)
    const cached = processedMsgIds.get(makeDedupKey(client, msgId));
    if (cached) {
      sendMsg(client.ws, cached.response);
      return;
    }
    // Persistent path: DB dedup acontece DENTRO da transação de atomicScanSeparatedQty (S1-04).
    // O INSERT ON CONFLICT no scan_log e o UPDATE de separated_qty são atômicos juntos.
  }

  try {
    const workUnit = await storage.getWorkUnitById(workUnitId);
    if (!workUnit) {
      return sendMsg(client.ws, { type: "scan_ack", msgId, status: "error", message: "Unidade não encontrada" });
    }

    const authCheck = authorizeWorkUnitWS(workUnit, client);
    if (!authCheck.allowed) {
      return sendMsg(client.ws, { type: "scan_ack", msgId, status: "error", message: authCheck.reason });
    }
    const lockCheck = assertLockOwnershipWS(workUnit, client);
    if (!lockCheck.allowed) {
      return sendMsg(client.ws, { type: "scan_ack", msgId, status: "error", message: lockCheck.reason });
    }

    if (workUnit.status === "concluido") {
      return sendMsg(client.ws, { type: "scan_ack", msgId, status: "error", message: "Esta unidade de trabalho já foi concluída" });
    }

    const product = await storage.getProductByBarcode(barcode);
    if (!product) {
      return sendMsg(client.ws, { type: "scan_ack", msgId, status: "not_found", message: "Produto não encontrado" });
    }

    const matchingItems = workUnit.items.filter(i => i.productId === product.id);
    if (matchingItems.length === 0) {
      return sendMsg(client.ws, { type: "scan_ack", msgId, status: "not_found", message: "Produto não pertence a esta unidade" });
    }

    const item = matchingItems.length === 1
      ? matchingItems[0]
      : matchingItems.find(i => {
          const sep = Number(i.separatedQty);
          const tgt = Number(i.quantity) - Number(i.exceptionQty || 0);
          return sep < tgt;
        }) || matchingItems[0];

    const exceptionQty = Number(item.exceptionQty || 0);
    const adjustedTarget = Number(item.quantity) - exceptionQty;

    const multiplier = await storage.getBarcodeMultiplier(barcode, product);

    const requestedQty = (quantity !== undefined && quantity !== null) ? Number(quantity) : multiplier;

    const scanResult = await storage.atomicScanSeparatedQty(
      item.id, requestedQty, adjustedTarget, workUnitId, workUnit.orderId,
      msgId, client.userId, client.companyId
    );

    // S1-04: msgId já processado nesta transação (dedup atômico com scan_log)
    if (scanResult.result === "duplicate") {
      sendAndCache(client.ws, client, {
        type: "scan_ack",
        msgId,
        status: "success",
        quantity: requestedQty,
      });
      return;
    }

    if (scanResult.result === "already_complete") {
      return sendAndCache(client.ws, client, {
        type: "scan_ack",
        msgId,
        status: "already_complete",
        message: `Item já totalmente separado (${scanResult.adjustedTarget} unidades).`,
        quantity: requestedQty,
      });
    }

    if (scanResult.result === "over_quantity") {
      const msgText = exceptionQty > 0
        ? `Item com ${exceptionQty} exceção(ões). Disponível: ${scanResult.availableQty} de ${scanResult.adjustedTarget}.`
        : `Quantidade excedida! Disponível: ${scanResult.availableQty} de ${scanResult.adjustedTarget}.`;
      return sendAndCache(client.ws, client, {
        type: "scan_ack",
        msgId,
        status: exceptionQty > 0 ? "over_quantity_with_exception" : "over_quantity",
        message: msgText,
        quantity: requestedQty,
        exceptionQty,
        availableQty: scanResult.availableQty,
      });
    }

    broadcastSSE("item_picked", { workUnitId, orderId: workUnit.orderId, productId: product.id, userId: client.userId }, client.companyId);

    sendAndCache(client.ws, client, {
      type: "scan_ack",
      msgId,
      status: "success",
      quantity: requestedQty,
    });

    storage.createAuditLog({
      action: "scan_separacao",
      entityType: "order_item",
      entityId: item.id,
      userId: client.userId,
      details: `Bipagem: ${(product as any).erpCode || barcode}, qty=${requestedQty}, pedido=${workUnit.orderId}, WU=${workUnitId}`,
    }).catch(() => {});

    if (workUnit.lockedBy && workUnit.lockedBy !== client.userId &&
        (client.userRole === "supervisor" || client.userRole === "administrador")) {
      storage.createAuditLog({
        action: "supervisor_scan_override",
        entityType: "work_unit",
        entityId: workUnitId,
        userId: client.userId,
        details: `Supervisor ${client.userName} bipou WU bloqueada por operador ${workUnit.lockedBy}`,
      }).catch(() => {});
    }
  } catch (error) {
    const { code: errCode, message: errMsg } = getDbError(error);
    console.error(`[ws-scanning] handleScanItem error — code=${errCode} msg=${errMsg}`, error);
    const detail = errCode === "23505" ? "Conflito de dados. Atualize a tela."
      : errCode === "40P01" ? "Conflito temporário. Tente novamente."
      : "Erro interno ao processar leitura.";
    sendMsg(client.ws, { type: "scan_ack", msgId, status: "error", message: detail });
  }
}

async function handleCheckItem(client: ScanningClient, msg: any) {
  const { msgId, workUnitId, barcode, quantity } = msg;

  if (msgId) {
    const cached = processedMsgIds.get(makeDedupKey(client, msgId));
    if (cached) {
      sendMsg(client.ws, cached.response);
      return;
    }
  }

  try {
    const workUnit = await storage.getWorkUnitById(workUnitId);
    if (!workUnit) {
      return sendMsg(client.ws, { type: "check_ack", msgId, status: "error", message: "Unidade não encontrada" });
    }

    const authCheck = authorizeWorkUnitWS(workUnit, client);
    if (!authCheck.allowed) {
      return sendMsg(client.ws, { type: "check_ack", msgId, status: "error", message: authCheck.reason });
    }
    const lockCheck = assertLockOwnershipWS(workUnit, client);
    if (!lockCheck.allowed) {
      return sendMsg(client.ws, { type: "check_ack", msgId, status: "error", message: lockCheck.reason });
    }

    const product = await storage.getProductByBarcode(barcode);
    if (!product) {
      return sendMsg(client.ws, { type: "check_ack", msgId, status: "not_found", message: "Produto não encontrado" });
    }

    const matchingItems = workUnit.items.filter(i => i.productId === product.id);
    if (matchingItems.length === 0) {
      return sendMsg(client.ws, { type: "check_ack", msgId, status: "not_found", message: "Produto não pertence a esta unidade" });
    }

    const item = matchingItems.length === 1
      ? matchingItems[0]
      : matchingItems.find(i => {
          const chk = Number(i.checkedQty);
          const iSep = Number(i.separatedQty);
          const iExc = Number(i.exceptionQty || 0);
          const tgt = iSep > 0 ? iSep : (iExc > 0 ? 0 : Number(i.quantity));
          return chk < tgt;
        }) || matchingItems[0];

    const itemExcQty = Number(item.exceptionQty || 0);
    const iSep = Number(item.separatedQty);
    const targetQty = iSep > 0 ? iSep : (itemExcQty > 0 ? 0 : Number(item.quantity));

    if (targetQty <= 0) {
      return sendMsg(client.ws, { type: "check_ack", msgId, status: "not_found", message: "Item totalmente em exceção" });
    }

    const multiplier = await storage.getBarcodeMultiplier(barcode, product);

    const requestedQty = (quantity !== undefined && quantity !== null) ? Number(quantity) : multiplier;

    const checkResult = await storage.atomicScanCheckedQty(item.id, requestedQty, targetQty);

    if (checkResult.result === "already_complete") {
      return sendMsg(client.ws, {
        type: "check_ack",
        msgId,
        status: "over_quantity",
        quantity: requestedQty,
        message: `Item já totalmente conferido (${checkResult.targetQty}/${checkResult.targetQty}). O extra foi recusado.`,
      });
    }

    if (checkResult.result === "over_quantity") {
      const statusLabel = itemExcQty > 0 ? "over_quantity_with_exception" : "over_quantity";
      const msgText = itemExcQty > 0
        ? `Excede o disponível (${checkResult.availableQty}). ${itemExcQty} exceções. Conferido (${checkResult.currentQty}) mantido.`
        : `Excede o disponível (${checkResult.availableQty}). Quantidade (${checkResult.currentQty}) mantida.`;
      return sendMsg(client.ws, {
        type: "check_ack",
        msgId,
        status: statusLabel,
        quantity: requestedQty,
        exceptionQty: itemExcQty,
        message: msgText,
      });
    }

    sendAndCache(client.ws, client, {
      type: "check_ack",
      msgId,
      status: "success",
      quantity: checkResult.appliedQty,
    });

    storage.createAuditLog({
      action: "scan_conferencia",
      entityType: "order_item",
      entityId: item.id,
      userId: client.userId,
      details: `Conferência: ${(product as any).erpCode || barcode}, qty=${checkResult.appliedQty}, pedido=${workUnit.orderId}, WU=${workUnitId}`,
    }).catch(() => {});

    if (workUnit.lockedBy && workUnit.lockedBy !== client.userId &&
        (client.userRole === "supervisor" || client.userRole === "administrador")) {
      storage.createAuditLog({
        action: "supervisor_scan_override",
        entityType: "work_unit",
        entityId: workUnitId,
        userId: client.userId,
        details: `Supervisor ${client.userName} conferiu WU bloqueada por operador ${workUnit.lockedBy}`,
      }).catch(() => {});
    }
  } catch (error) {
    const { code: errCode } = getDbError(error);
    const detail = errCode === "40P01" ? "Conflito temporário. Tente novamente."
      : "Erro interno ao processar conferência.";
    sendMsg(client.ws, { type: "check_ack", msgId, status: "error", message: detail });
  }
}

export function setupScanningWS(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("error", (err) => {
    log(`[scanning-ws] Server error (não-fatal): ${err.message}`, "express");
  });

  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url?.startsWith("/ws/scanning")) {
      socket.on("error", (err: NodeJS.ErrnoException) => {
        const normal = ["ECONNRESET", "EPIPE", "ECONNABORTED"];
        if (!normal.includes(err.code ?? "")) {
          log(`[scanning-ws] Socket upgrade error: ${err.message}`, "express");
        }
      });
      wss.handleUpgrade(request, socket as any, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", async (ws: WebSocket, request: IncomingMessage) => {
    const authResult = await authenticateWS(request);
    if (!authResult) {
      sendMsg(ws, { type: "auth_error", message: "Não autenticado" });
      ws.close(4001, "authentication failed");
      return;
    }

    const client: ScanningClient = {
      ws,
      userId: authResult.userId,
      companyId: authResult.companyId,
      userRole: authResult.role,
      userName: authResult.name,
      userSections: authResult.sections,
    };
    clients.set(ws, client);

    sendMsg(ws, { type: "auth_ok", userId: authResult.userId });
    log(`[scanning-ws] ${authResult.name} conectado`, "express");

    ws.on("message", (data: Buffer) => {
      if (data.length > 64 * 1024) return;

      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        sendMsg(ws, { type: "error", message: "JSON inválido" });
        return;
      }

      if (msg.type === "ping") {
        sendMsg(ws, { type: "pong" });
        return;
      }

      const prev = messageChains.get(ws) || Promise.resolve();
      const next = prev.then(async () => {
        try {
          switch (msg.type) {
            case "scan":
              await handleScanItem(client, msg);
              break;
            case "check":
              await handleCheckItem(client, msg);
              break;
            default:
              sendMsg(ws, { type: "error", message: `Tipo desconhecido: ${msg.type}` });
          }
        } catch (err) {
          log(`[scanning-ws] Message handler error: ${getErrorMessage(err)}`, "express");
        }
      });
      messageChains.set(ws, next);
    });

    ws.on("close", () => {
      clients.delete(ws);
      messageChains.delete(ws);
      log(`[scanning-ws] ${authResult.name} desconectado`, "express");
    });

    ws.on("error", () => {
      clients.delete(ws);
      messageChains.delete(ws);
    });
  });

  log("[scanning-ws] WebSocket scanning server iniciado em /ws/scanning", "express");
}
