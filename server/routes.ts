import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import cookieParser from "cookie-parser";
import { storage } from "./storage";
import { hashPassword, verifyPassword, createAuthSession, isAuthenticated, requireRole, requireCompany, getTokenFromRequest, getUserFromToken, generateBadgeCode } from "./auth";
import { loginSchema, insertRouteSchema, orderItems, workUnits, pickingSessions, pickupPoints, type MappingField, datasetEnum, type User, type OrderItem, type Product, type WorkUnit, type Exception, type PickingSession, type ExceptionType, type UserSettings, BatchSyncPayload, batchSyncPayloadSchema } from "@shared/schema";


import { registerWmsRoutes } from "./wms-routes";
import { registerPrintRoutes, refreshPrinterCache } from "./print-routes";
import { getConnectedAgents } from "./print-agent";
import { z } from "zod";
import { spawn } from "child_process";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { fileURLToPath } from "url";
import { setupSSE, broadcastSSE } from "./sse";
import { db } from "./db";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { getDataContract, getAvailableDatasets } from "./data-contracts";
import { log, getErrorMessage, getDbError } from "./log";

const LOCK_TTL_MINUTES = 60;

function getClientIp(req: Request): string | undefined {
  const ip = req.ip;
  if (Array.isArray(ip)) return ip[0];
  return ip;
}

function getUserAgent(req: Request): string | undefined {
  const ua = req.headers["user-agent"];
  if (Array.isArray(ua)) return ua[0];
  return ua;
}

function authorizeWorkUnit(wu: { companyId: number; section: string | null }, req: Request): { allowed: boolean; reason?: string } {
  const companyId = req.companyId;
  const user = req.user;
  if (companyId && wu.companyId !== companyId) {
    return { allowed: false, reason: "Acesso negado: empresa diferente" };
  }
  if (user?.role === "separacao") {
    const userSections: string[] = (user.sections as string[]) || [];
    if (userSections.length === 0) {
      return { allowed: false, reason: "Acesso negado: sem seções atribuídas" };
    }
    if (wu.section && !userSections.includes(wu.section)) {
      return { allowed: false, reason: "Acesso negado: seção não permitida" };
    }
  }
  return { allowed: true };
}

function assertLockOwnership(wu: { lockedBy: string | null; lockExpiresAt: string | null }, req: Request): { allowed: boolean; reason?: string } {
  const user = req.user;
  if (user?.role === "supervisor" || user?.role === "administrador") {
    return { allowed: true };
  }
  if (!wu.lockedBy) {
    return { allowed: false, reason: "Unidade não está bloqueada" };
  }
  if (wu.lockedBy !== user?.id) {
    return { allowed: false, reason: "Unidade bloqueada por outro operador" };
  }
  if (wu.lockExpiresAt && new Date(wu.lockExpiresAt) < new Date()) {
    return { allowed: false, reason: "Lock expirado. Bloqueie novamente." };
  }
  return { allowed: true };
}

function authorizeOrder(order: { companyId: number | null }, req: Request): { allowed: boolean; reason?: string } {
  const companyId = req.companyId;
  if (companyId && order.companyId !== companyId) {
    return { allowed: false, reason: "Acesso negado: empresa diferente" };
  }
  return { allowed: true };
}

// Estado de sincronização em escopo de módulo — persiste entre chamadas de rota
let syncRunning = false;
let lastSyncAt: string | null = null;
let lastSyncError: string | null = null;

// Usa spawn (array de args) em vez de exec (string interpolada no shell)
function runSync(callback?: (error: Error | null, success: boolean) => void): void {
  const scriptPath = path.resolve(process.cwd(), "sync_db2.py");
  if (!fs.existsSync(scriptPath)) {
    if (callback) callback(null, false);
    return;
  }
  log("[Auto-Sync] Triggering DB sync...");
  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  const child = spawn(pythonCmd, [scriptPath, "--quiet"], { windowsHide: true });

  const stderrChunks: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk.toString()));

  child.on("close", (code) => {
    if (stderrChunks.length > 0) {
      log(`[Sync] stderr: ${stderrChunks.join("").trim()}`);
    }
    if (code !== 0) {
      const err = new Error(`Script encerrou com código ${code}`);
      if (callback) callback(err, false);
      return;
    }
    log("[Sync] Sincronização concluída.");
    if (callback) callback(null, true);
  });

  child.on("error", (err) => {
    if (callback) callback(err, false);
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  log("[Routes] Registering routes...");
  app.use(cookieParser());

  // Setup SSE
  setupSSE(app);

  // Non-blocking sync trigger: starts sync in background, returns immediately
  const triggerSyncAsync = (): boolean => {
    if (syncRunning) return false; // already running
    syncRunning = true;
    lastSyncError = null;
    runSync((error, success) => {
      syncRunning = false;
      lastSyncAt = new Date().toISOString();
      if (error) {
        lastSyncError = error.message || "Erro desconhecido";
        log(`[Sync] Erro: ${lastSyncError}`);
        broadcastSSE("sync_finished", { success: false, error: lastSyncError, finishedAt: lastSyncAt });
      } else {
        lastSyncError = null;
        refreshPrinterCache().catch(() => {});
        broadcastSSE("sync_finished", { success: true, finishedAt: lastSyncAt });
      }
    });
    return true;
  };

  // Pré-carregar cache de impressoras na inicialização (sem bloquear o servidor)
  refreshPrinterCache().catch(() => {});

  // Schedule auto-sync every 10 minutes (600,000 ms)
  setInterval(() => {
    runSync(() => { refreshPrinterCache().catch(() => {}); });
  }, 10 * 60 * 1000);

  // Initial sync on startup
  setTimeout(() => {
    runSync(() => { refreshPrinterCache().catch(() => {}); });
  }, 5000);

  // Limpeza de sessões expiradas — executa a cada hora
  setInterval(async () => {
    try {
      const removed = await storage.deleteExpiredSessions();
      if (removed > 0) log(`[Sessions] ${removed} sessão(ões) expirada(s) removida(s)`);
    } catch (err) {
      log(`[Sessions] Erro ao limpar sessões: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 60 * 60 * 1000);

  // System Sync Route — non-blocking: starts sync in background and returns immediately
  app.post("/api/sync", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      if (syncRunning) {
        return res.status(202).json({ running: true, message: "Sincronização já em andamento" });
      }
      const started = triggerSyncAsync();
      if (!started) {
        return res.status(202).json({ running: true, message: "Sincronização já em andamento" });
      }
      return res.status(202).json({ running: true, message: "Sincronização iniciada em segundo plano" });
    } catch (error) {
      return res.status(500).json({ error: "Erro interno ao iniciar sincronização" });
    }
  });

  // Sync Status Route — returns current sync state
  app.get("/api/sync/status", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    return res.json({
      running: syncRunning,
      lastSyncAt,
      lastSyncError,
    });
  });

  // Handheld: Picking Submit
  app.post("/api/picking/submit", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { orderId, sectionId, items } = req.body;
      const userId = req.user!.id;

      // 1. Verify Lock
      const lock = await storage.getPickingSession(orderId, sectionId);
      if (!lock || lock.userId !== userId) {
        return res.status(409).json({ error: "Sessão expirada ou inválida. Bloqueie novamente." });
      }

      // 2. Process Items in a single atomic transaction
      const allOrderItems = await storage.getOrderItemsByOrderId(orderId);
      // Index for O(1) lookup instead of O(n*m)
      const orderItemMap = new Map(allOrderItems.map(i => [i.id, i]));

      const updates: Array<{ id: string; qtyPicked: number; status: string }> = [];

      await db.transaction(async (tx) => {
        // Refresh heartbeat inside transaction to keep it current
        await storage.updatePickingSessionHeartbeat(lock.id);

        for (const item of items) {
          const orderItem = orderItemMap.get(item.id);
          if (!orderItem) continue;

          const newQty = Number(item.qtyPicked);
          const targetQty = Number(orderItem.quantity);
          const validStatus: "separado" | "pendente" = newQty >= targetQty ? "separado" : "pendente";

          await tx.update(orderItems)
            .set({ qtyPicked: newQty, status: validStatus })
            .where(eq(orderItems.id, item.id));

          updates.push({ id: item.id, qtyPicked: newQty, status: validStatus });
        }
      });

      // Broadcast update
      const reqCompanyId = req.companyId;
      broadcastSSE("picking_update", {
        orderId,
        sectionId,
        userId,
        items: updates
      }, reqCompanyId);

      // Check if order is fully picked and update status
      const conferenceUnit = await storage.checkAndUpdateOrderStatus(orderId);

      if (conferenceUnit) {
        broadcastSSE("work_unit_created", conferenceUnit, reqCompanyId);
      }

      res.json({ success: true });
    } catch (error) {
      log(`[Routes] Picking submit error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao salvar separação" });
    }
  });

  // Handheld: Locking Routes
  app.post("/api/lock", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { orderId, sectionId } = req.body;
      const userId = req.user!.id;

      // 1. Check if locked by someone else
      const existing = await storage.getPickingSession(orderId, sectionId);
      if (existing) {
        if (existing.userId !== userId) {
          // Check if expired
          const minutesSinceHeartbeat = (Date.now() - new Date(existing.lastHeartbeat).getTime()) / 1000 / 60;
          if (minutesSinceHeartbeat < 2) { // 2 mins TTL for heartbeat
            return res.status(409).json({
              error: "Bloqueado",
              lockedBy: existing.userId,
              message: "Seção sendo separada por outro usuário"
            });
          } else {
            // Expired, steal lock
            await storage.deletePickingSession(orderId, sectionId);
          }
        } else {
          // Self-lock, just refresh
          await storage.updatePickingSessionHeartbeat(existing.id);
          return res.json({ success: true, sessionId: existing.id });
        }
      }

      // 2. Create lock
      const session = await storage.createPickingSession({
        userId,
        orderId,
        sectionId,
      });

      broadcastSSE("lock_acquired", { orderId, sectionId, userId }, req.companyId);

      res.json({ success: true, sessionId: session.id });
    } catch (error) {
      log(`[Routes] Lock error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao bloquear seção" });
    }
  });

  app.post("/api/heartbeat", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.body;
      const userId = req.user?.id;

      const updated = await storage.updatePickingSessionHeartbeat(sessionId, userId);
      if (updated === 0) {
        return res.status(403).json({ error: "Sessão não encontrada ou não pertence a este usuário" });
      }

      res.json({ success: true });
    } catch (error) {
      log(`[Heartbeat] Erro: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro no heartbeat" });
    }
  });

  app.post("/api/unlock", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { orderId, sectionId } = req.body;
      const user = req.user;

      const isSupervisor = user?.role === "supervisor" || user?.role === "administrador";

      if (!isSupervisor) {
        const session = await storage.getPickingSession(orderId, sectionId);
        if (session && session.userId !== user?.id) {
          return res.status(403).json({ error: "Apenas supervisores podem desbloquear sessões de outros usuários" });
        }
      }

      await storage.deletePickingSession(orderId, sectionId);
      broadcastSSE("lock_released", { orderId, sectionId }, req.companyId);

      res.json({ success: true });
    } catch (error) {
      log(`[Unlock] Erro: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao desbloquear" });
    }
  });

  // Auth routes
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const data = loginSchema.parse(req.body);
      const user = await storage.getUserByUsername(data.username);

      if (!user || !await verifyPassword(data.password, user.password)) {
        await storage.createAuditLog({
          userId: user?.id || null,
          action: "login_failed",
          entityType: "user",
          details: `Tentativa de login falhou - Usuário: ${data.username}`,
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
        });
        return res.status(401).json({ error: "Credenciais inválidas" });
      }

      if (!user.active) {
        return res.status(401).json({ error: "Usuário inativo" });
      }

      const allowedCompanies: number[] = (user.allowedCompanies ?? []);
      let companyId = data.companyId;

      if (allowedCompanies.length === 1) {
        companyId = allowedCompanies[0];
      }

      if (companyId && !allowedCompanies.includes(companyId)) {
        return res.status(403).json({ error: "Empresa não permitida para este usuário" });
      }

      const { token, sessionKey } = await createAuthSession(user.id, companyId);

      res.cookie("authToken", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 12 * 60 * 60 * 1000,
      });

      await storage.createAuditLog({
        userId: user.id,
        action: "login",
        entityType: "user",
        entityId: user.id,
        details: `Login realizado - Empresa: ${companyId || 'não selecionada'}`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
        companyId: companyId ?? undefined,
      });

      const companiesData = allowedCompanies.length > 0 ? await storage.getCompaniesByIds(allowedCompanies) : [];

      const { password: _, ...safeUser } = user;
      res.json({
        user: safeUser,
        sessionKey,
        companyId: companyId || null,
        allowedCompanies,
        companiesData,
        requireCompanySelection: !companyId && allowedCompanies.length > 1,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Dados inválidos" });
      }
      log(`[Routes] Login error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const token = getTokenFromRequest(req);
    if (token) {
      try {
        const result = await getUserFromToken(token);
        if (result) {
          await storage.createAuditLog({
            userId: result.user.id,
            action: "logout",
            entityType: "user",
            entityId: result.user.id,
            details: "Logout realizado",
            ipAddress: getClientIp(req),
            userAgent: getUserAgent(req),
          });
          req.user = result.user;
        }
        await storage.deleteSession(token);
      } catch (logoutErr) {
        log(`[Auth] Erro no logout (sessão pode já ter expirado): ${(logoutErr instanceof Error ? logoutErr : new Error("erro desconhecido")).message ?? "erro desconhecido"}`);
      }
    }
    res.clearCookie("authToken");
    res.json({ success: true });
  });

  app.get("/api/auth/me", isAuthenticated, async (req: Request, res: Response) => {
    const user = req.user;
    const sessionKey = req.sessionKey;
    const companyId = req.companyId;
    const { password: _, ...safeUser } = user;
    const allowedCompanies: number[] = (user.allowedCompanies ?? []);
    const companiesData = allowedCompanies.length > 0 ? await storage.getCompaniesByIds(allowedCompanies) : [];
    res.json({ user: safeUser, sessionKey, companyId, allowedCompanies, companiesData });
  });

  app.post("/api/auth/select-company", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const { companyId } = req.body;
      const user = req.user;
      const token = getTokenFromRequest(req);

      if (!companyId || typeof companyId !== "number") {
        return res.status(400).json({ error: "ID da empresa inválido" });
      }

      const allowedCompanies: number[] = (user.allowedCompanies ?? []);
      if (allowedCompanies.length > 0 && !allowedCompanies.includes(companyId)) {
        return res.status(403).json({ error: "Empresa não permitida" });
      }

      if (token) {
        await storage.updateSessionCompany(token, companyId);
      }

      await storage.createAuditLog({
        userId: user.id,
        action: "select_company",
        entityType: "session",
        entityId: user.id,
        details: `Empresa selecionada: ${companyId}`,
        companyId,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true, companyId });
    } catch (error) {
      log(`[Routes] Select company error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Users routes
  app.get("/api/users", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      const safeUsers = users.map(({ password: _, ...u }) => u);
      res.json(safeUsers);
    } catch (error) {
      log(`[Routes] Get users error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  const createUserBodySchema = z.object({
    username: z.string().min(3).max(50),
    password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres"),
    name: z.string().min(1).max(100),
    role: z.enum(["separacao", "conferencia", "balcao", "supervisor", "administrador", "wms"]),
    sections: z.array(z.string()).optional(),
    settings: z.record(z.unknown()).optional(),
    active: z.boolean().optional(),
    allowedCompanies: z.array(z.number()).optional(),
    allowedModules: z.array(z.string()).optional(),
    allowedReports: z.array(z.string()).optional(),
    defaultCompanyId: z.number().optional(),
  });

  app.post("/api/users", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const parsed = createUserBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
      }
      const { username, password, name, role, sections, settings, active } = parsed.data;

      // Somente administrador pode criar outros administradores
      if (role === "administrador" && req.user!.role !== "administrador") {
        return res.status(403).json({ error: "Apenas administradores podem criar usuários com perfil administrador" });
      }

      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ error: "Usuário já existe" });
      }

      const hashedPassword = await hashPassword(password);

      let userSections = sections || [];
      if (role === "conferencia" || role === "balcao") {
        const allSections = await storage.getAllSections();
        userSections = allSections.map((s: any) => String(s.id));
      }

      const badgeCode = generateBadgeCode();

      const user = await storage.createUser({
        username,
        password: hashedPassword,
        name,
        role,
        sections: userSections,
        settings: settings || {},
        active: active !== undefined ? active : true,
        badgeCode,
      });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create_user",
        entityType: "user",
        entityId: user.id,
        details: `Usuário ${username} criado`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      log(`[Routes] Create user error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  const updateUserBodySchema = z.object({
    username: z.string().min(3).max(50).optional(),
    password: z.string().min(6).or(z.literal("")).optional(),
    name: z.string().min(1).max(100).optional(),
    role: z.enum(["separacao", "conferencia", "balcao", "supervisor", "administrador", "wms"]).optional(),
    sections: z.array(z.string()).optional(),
    settings: z.record(z.unknown()).optional(),
    active: z.boolean().optional(),
    allowedCompanies: z.array(z.number()).optional(),
    allowedModules: z.array(z.string()).optional(),
    allowedReports: z.array(z.string()).optional(),
    defaultCompanyId: z.number().optional().nullable(),
  });

  app.patch("/api/users/:id", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const parsed = updateUserBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
      }
      const id = req.params.id as string;
      const { password, ...updates } = parsed.data;

      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado" });
      }

      // Somente administrador pode promover para ou editar administradores
      if (req.user!.role !== "administrador") {
        if (updates.role === "administrador") {
          return res.status(403).json({ error: "Apenas administradores podem atribuir o perfil administrador" });
        }
        if (user.role === "administrador") {
          return res.status(403).json({ error: "Apenas administradores podem editar outros administradores" });
        }
      }

      const updateData: Partial<typeof user> = { ...updates };

      if (password && password.trim() !== "") {
        updateData.password = await hashPassword(password);
        // Badge code é independente da senha — não regenerar automaticamente.
        // Use o endpoint /api/users/:id/reset-badge para rotacionar o badge.
      }

      const targetRole = updateData.role || user.role;
      if (targetRole === "conferencia" || targetRole === "balcao") {
        const allSections = await storage.getAllSections();
        updateData.sections = allSections.map((s: any) => String(s.id));
      }

      const updatedUser = await storage.updateUser(id, updateData);

      if (updatedUser) {
        await storage.createAuditLog({
          userId: req.user!.id,
          action: "update_user",
          entityType: "user",
          entityId: updatedUser.id,
          details: `Usuário ${updatedUser.username} atualizado`,
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
        });

        const { password: _, ...safeUser } = updatedUser;
        res.json(safeUser);
      } else {
        res.status(500).json({ error: "Falha ao atualizar usuário - retorno vazio do banco" });
      }
    } catch (error) {
      log(`[Routes] Update user error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/queue/balcao", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const companyId = req.companyId;
      const wus = await storage.getWorkUnits("balcao", companyId);
      const activeOrders = new Map<string, {
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
      }>();

      for (const wu of wus) {
        if (!wu.lockedBy || wu.status === "concluido") continue;
        if (wu.order.status === "finalizado") continue;

        const existing = activeOrders.get(wu.orderId);
        if (!existing) {
          activeOrders.set(wu.orderId, {
            orderId: wu.orderId,
            erpOrderId: wu.order.erpOrderId,
            customerCode: wu.order.customerCode,
            customerName: wu.order.customerName,
            vendedor: wu.order.observation || null,
            totalProducts: wu.items.length,
            financialStatus: wu.order.financialStatus || "pendente",
            status: wu.order.status,
            operatorName: wu.lockedByName || null,
            startedAt: wu.startedAt || wu.lockedAt || null,
            lockedAt: wu.lockedAt || null,
          });
        } else {
          existing.totalProducts += wu.items.length;
        }
      }

      res.json(Array.from(activeOrders.values()));
    } catch (error) {
      log(`[Routes] Get balcao queue error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/pickup-points", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const result = await db.select().from(pickupPoints).where(eq(pickupPoints.active, true)).orderBy(pickupPoints.id);
      res.json(result);
    } catch (error) {
      log(`[Routes] Get pickup points error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // System Settings routes
  app.get("/api/system-settings/separation-mode", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const settings = await storage.getSystemSettings();
      res.json({ separationMode: settings.separationMode, updatedAt: settings.updatedAt, updatedBy: settings.updatedBy });
    } catch (error) {
      log(`[Routes] Get separation mode error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/system-settings/features", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const settings = await storage.getSystemSettings();
      res.json({ quickLinkEnabled: settings.quickLinkEnabled ?? true });
    } catch (error) {
      log(`[Routes] Get features error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.patch("/api/system-settings/features", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { quickLinkEnabled } = req.body;
      if (typeof quickLinkEnabled !== "boolean") {
        return res.status(400).json({ error: "quickLinkEnabled deve ser boolean" });
      }
      const updated = await storage.updateQuickLinkEnabled(quickLinkEnabled, req.user?.id ?? "unknown");
      res.json({ quickLinkEnabled: updated.quickLinkEnabled ?? true });
    } catch (error) {
      log(`[Routes] Update features error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.patch("/api/system-settings/separation-mode", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { mode, force } = req.body;
      const user = req.user;

      if (!["by_order", "by_section"].includes(mode)) {
        return res.status(400).json({ error: "Modo inválido. Use 'by_order' ou 'by_section'." });
      }

      const currentSettings = await storage.getSystemSettings();
      if (currentSettings.separationMode === mode) {
        return res.json({ separationMode: currentSettings.separationMode, message: "Modo já ativo." });
      }

      // Check for active conflicts
      const conflictsData = await storage.getActiveSeparationConflicts();
      const hasConflicts = conflictsData.activeSessions > 0 || conflictsData.activeWorkUnits > 0;

      if (hasConflicts && !force) {
        return res.status(409).json({
          error: "Há separações em andamento",
          conflicts: {
            activeSessions: conflictsData.activeSessions,
            activeWorkUnits: conflictsData.activeWorkUnits,
            affectedSections: conflictsData.affectedSections,
            activeUsers: conflictsData.activeUsers,
          },
          message: `Existem ${conflictsData.activeSessions} sessão(ões) de picking ativa(s) e ${conflictsData.activeWorkUnits} unidade(s) de trabalho em andamento. Envie force: true para forçar a troca.`
        });
      }

      if (force && hasConflicts) {
        await storage.cancelAllPickingSessions();
        const resetCount = await storage.resetActiveWorkUnits();
        await storage.createAuditLog({
          userId: user.id,
          action: "force_separation_mode_change",
          entityType: "system_settings",
          entityId: "global",
          details: `Troca forçada de modo de separação de '${currentSettings.separationMode}' para '${mode}'. Sessões canceladas: ${conflictsData.activeSessions}. Work units resetados para pendente: ${resetCount}. Seções afetadas: ${conflictsData.affectedSections.join(", ")}. Usuários afetados: ${conflictsData.activeUsers.join(", ")}.`,
          previousValue: currentSettings.separationMode,
          newValue: mode,
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
        });
      }

      const updated = await storage.updateSeparationMode(mode as any, user.id);

      await storage.createAuditLog({
        userId: user.id,
        action: "change_separation_mode",
        entityType: "system_settings",
        entityId: "global",
        details: `Modo de separação alterado de '${currentSettings.separationMode}' para '${mode}'.`,
        previousValue: currentSettings.separationMode,
        newValue: mode,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ separationMode: updated.separationMode, updatedAt: updated.updatedAt });
    } catch (error) {
      log(`[Routes] Update separation mode error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/sections", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const sections = await storage.getAllSections();
      res.json(sections);
    } catch (error) {
      log(`[Routes] Get sections error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Section Groups endpoints
  app.get("/api/sections/groups", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const groups = await storage.getAllSectionGroups();
      res.json(groups);
    } catch (error) {
      log(`[Routes] Get section groups error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar grupos de seções" });
    }
  });

  app.post("/api/sections/groups", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {

      const { name, sections } = req.body;

      if (!name || !sections || !Array.isArray(sections)) {

        return res.status(400).json({ error: "Nome e seções são obrigatórios" });
      }

      const newGroup = await storage.createSectionGroup({ name, sections });

      res.json(newGroup);
    } catch (error) {
      log(`[Routes] Create section group error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao criar grupo de seções", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.put("/api/sections/groups/:id", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { name, sections } = req.body;

      const updates: Partial<{ name: string; sections: string[] }> = {};
      if (name) updates.name = name;
      if (sections && Array.isArray(sections)) updates.sections = sections;

      const updated = await storage.updateSectionGroup(id, updates);
      if (!updated) {
        return res.status(404).json({ error: "Grupo não encontrado" });
      }
      res.json(updated);
    } catch (error) {
      log(`[Routes] Update section group error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao atualizar grupo de seções" });
    }
  });

  app.delete("/api/sections/groups/:id", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      await storage.deleteSectionGroup(id);
      res.json({ success: true });
    } catch (error) {
      log(`[Routes] Delete section group error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao excluir grupo de seções" });
    }
  });


  // Routes (delivery routes)
  app.get("/api/routes", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const routes = await storage.getAllRoutes();
      res.json(routes);
    } catch (error) {
      log(`[Routes] Get routes error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/routes", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const data = insertRouteSchema.parse(req.body);
      const route = await storage.createRoute(data);
      res.json(route);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Dados inválidos", details: error.errors });
      }
      log(`[Routes] Create route error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch("/api/routes/:id", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const data = insertRouteSchema.partial().parse(req.body);
      const route = await storage.updateRoute(id, data);

      if (!route) return res.status(404).json({ error: "Rota não encontrada" });
      broadcastSSE("route_updated", { routeId: id, active: route.active }, req.companyId);
      res.json(route);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Dados inválidos", details: error.errors });
      }
      log(`[Routes] Update route error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.delete("/api/routes/:id", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      const route = await storage.toggleRouteActive(id, false);
      if (!route) return res.status(404).json({ error: "Rota não encontrada" });

      res.json({ success: true });
    } catch (error) {
      log(`[Routes] Delete route error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Orders routes
  app.get("/api/orders", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const companyId = req.companyId;
      const requestingUser = req.user;
      const isReport = req.query.type === "report";
      let orders = await storage.getAllOrders(companyId, isReport);

      // In by_section mode, separacao users only see orders that have items in their sections
      if (requestingUser?.role === "separacao") {
        const systemSettingsData = await storage.getSystemSettings();
        if (systemSettingsData.separationMode === "by_section") {
          const userSections: string[] = (requestingUser.sections as string[]) || [];
          if (userSections.length === 0) {
            return res.json([]);
          }
          // Filter orders to only those that have at least one order item in the user's sections
          const filteredOrders = [];
          for (const order of orders) {
            const items = await storage.getOrderItemsByOrderId(order.id);
            const hasMatchingSection = items.some(item => userSections.includes(item.section));
            if (hasMatchingSection) {
              filteredOrders.push(order);
            }
          }
          return res.json(filteredOrders);
        }
      }

      res.json(orders);
    } catch (error) {
      log(`[Routes] Get orders error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/orders/by-erp/:erpOrderId", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { db: database } = await import("./db");
      const { orders: ordersTable } = await import("@shared/schema");
      const { eq: eqFn } = await import("drizzle-orm");
      const [order] = await database.select().from(ordersTable)
        .where(eqFn(ordersTable.erpOrderId, (req.params.erpOrderId as string).trim()));
      if (!order) return res.status(404).json({ error: "Pedido não encontrado" });
      const authO = authorizeOrder(order, req);
      if (!authO.allowed) return res.status(403).json({ error: authO.reason });
      res.json(order);
    } catch (error) {
      log(`[Routes] Order by ERP ID error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar pedido" });
    }
  });

  app.get("/api/orders/:id", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const order = await storage.getOrderWithItems(req.params.id as string);
      if (!order) {
        return res.status(404).json({ error: "Pedido não encontrado" });
      }
      const authO = authorizeOrder(order, req);
      if (!authO.allowed) return res.status(403).json({ error: authO.reason });
      res.json(order);
    } catch (error) {
      log(`[Routes] Get order error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/orders/assign-route", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { orderIds, routeId } = req.body;

      if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: "Selecione pelo menos um pedido" });
      }

      // routeId is UUID string or null/undefined
      const targetRouteId = routeId || null;

      if (routeId && typeof routeId !== 'string') {
        return res.status(400).json({ error: "ID da rota inválido" });
      }

      // Validate if route exists
      if (targetRouteId) {
        const routes = await storage.getAllRoutes();
        const routeExists = routes.find(r => r.id === targetRouteId);
        if (!routeExists) {
          return res.status(400).json({ error: "Rota não encontrada", details: `Rota ID ${targetRouteId} não existe.` });
        }
      }

      await storage.assignRouteToOrders(orderIds, targetRouteId);

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "assign_route",
        entityType: "order",
        details: `Rota ${routeId} atribuída a ${orderIds.length} pedidos`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true });
    } catch (error) {
      log(`[Routes] Assign route error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/orders/relaunch", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { orderIds } = req.body;

      if (!Array.isArray(orderIds)) {
        return res.status(400).json({ error: "IDs inválidos" });
      }

      const snapshots: string[] = [];
      for (const id of orderIds) {
        const order = await storage.getOrderById(id);
        if (!order) continue;
        if (order.companyId !== req.companyId) continue;
        snapshots.push(`${order.erpOrderId || id}:status=${order.status}`);
        await storage.relaunchOrder(id);
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "relaunch_orders",
        entityType: "order",
        details: `Recontagem autorizada para ${orderIds.length} pedido(s). Estado anterior: [${snapshots.join(", ")}]`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      broadcastSSE("orders_relaunched", { orderIds }, req.companyId);

      res.json({ success: true });
    } catch (error) {
      log(`[Routes] Relaunch order error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/orders/set-priority", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { orderIds, priority } = req.body;
      await storage.setOrderPriority(orderIds, priority);

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "set_priority",
        entityType: "order",
        details: `Prioridade ${priority} definida para ${orderIds.length} pedidos`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true });
    } catch (error) {
      log(`[Routes] Set priority error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/orders/launch", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { orderIds, loadCode: requestedLoadCode } = req.body;

      // Auto-generate a 4-digit load code if not provided
      const loadCode = requestedLoadCode || Math.floor(1000 + Math.random() * 9000).toString();

      const toLaunch: string[] = [];
      const toRelaunch: string[] = [];

      // Verify orders
      for (const orderId of orderIds) {
        const order = await storage.getOrderById(orderId);
        if (!order) continue;

        if (!order.routeId) {
          // Skip orders without routes
          return res.status(400).json({
            error: "Ação bloqueada",
            details: `O pedido ${order.erpOrderId} não possui rota atribuída. Por favor, atribua uma rota antes de lançar.`
          });
        }

        if (order.isLaunched) {
          // Allow relaunch only if finished
          const allowedStatuses = ["separado", "conferido", "finalizado", "cancelado"];

          if (allowedStatuses.includes(order.status)) {
            // Can relaunch - add to relaunch list
            toRelaunch.push(orderId);
          } else {
            // Error if trying to launch an in-progress order
            return res.status(400).json({
              error: "Ação bloqueada",
              details: `O pedido ${order.erpOrderId} já foi lançado e está em processo de separação.`
            });
          }
        } else {
          // Launch the order (force status update even if inconsistent)
          log(`[Launch] Preparing to launch order ${orderId}, current status: ${order.status}`);
          toLaunch.push(orderId);
        }
      }

      if (toLaunch.length > 0) {
        await storage.launchOrders(toLaunch, loadCode);
        broadcastSSE("orders_launched", { orderIds: toLaunch }, req.companyId);
      }

      const relaunchSnapshots: string[] = [];
      for (const id of toRelaunch) {
        const orderSnap = await storage.getOrderById(id);
        if (orderSnap) relaunchSnapshots.push(`${orderSnap.erpOrderId || id}:status=${orderSnap.status}`);
        await storage.relaunchOrder(id);
      }
      if (toRelaunch.length > 0) {
        broadcastSSE("orders_relaunched", { orderIds: toRelaunch }, req.companyId);
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "launch_orders",
        entityType: "order",
        details: `Lançados ${orderIds.length} pedidos sob Carga/Pacote ${loadCode}`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true, loadCode });
    } catch (error) {
      log(`[Routes] Launch orders error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/orders/cancel-launch", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { orderIds } = req.body;

      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: "IDs de pedidos inválidos" });
      }

      // Process each order
      for (const orderId of orderIds) {
        const order = await storage.getOrderById(orderId);
        if (!order) {
          return res.status(404).json({
            error: "Pedido não encontrado",
            details: `Pedido ${orderId} não existe.`
          });
        }

        // Check if order was launched
        if (!order.isLaunched) {
          return res.status(400).json({
            error: "Ação bloqueada",
            details: `O pedido ${order.erpOrderId} não foi lançado para separação.`
          });
        }

        // Check order status - only allow cancellation for specific statuses
        // "conferido" incluído: é a única ação permitida para pedidos já conferidos
        const allowedStatuses = ["pendente", "em_separacao", "separado", "conferido"];

        if (!allowedStatuses.includes(order.status)) {
          return res.status(400).json({
            error: "Ação bloqueada",
            details: `O pedido ${order.erpOrderId} está com status '${order.status}' e não pode ter o lançamento cancelado. Apenas pedidos com status 'Pendente a Separar', 'Em Separação', 'Separado' ou 'Conferido' podem ser cancelados.`
          });
        }

        // Check for active picking sessions
        const activeSessions = await storage.getPickingSessionsByOrder(orderId);

        if (activeSessions.length > 0) {
          // Get operator name from first session
          const session = activeSessions[0];
          const operator = await storage.getUser(session.userId);
          const operatorName = operator ? operator.name : "Operador desconhecido";

          return res.status(400).json({
            error: "Ação bloqueada",
            details: `Pedido não pode ser cancelado pois o operador '${operatorName}' está com o pedido em aberto.`
          });
        }

        // Cancel the launch
        await storage.cancelOrderLaunch(orderId);

        // Create audit log
        await storage.createAuditLog({
          userId: req.user!.id,
          action: "cancel_launch",
          entityType: "order",
          entityId: orderId,
          details: `Lançamento cancelado para pedido ${order.erpOrderId}`,
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
        });
      }

      // Broadcast SSE notification
      broadcastSSE("orders_launch_cancelled", { orderIds }, req.companyId);

      res.json({ success: true, message: "Lançamento cancelado com sucesso" });
    } catch (error) {
      log(`[Routes] Cancel launch error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno ao cancelar lançamento" });
    }
  });

  // POST /api/orders/force-status — admin only: force order status (e.g. 'separado', 'conferido')
  app.post("/api/orders/force-status", isAuthenticated, requireCompany, requireRole("administrador"), async (req: Request, res: Response) => {
    try {
      const { orderIds, status } = req.body;
      const allowedStatuses = ["separado", "conferido"];
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: "IDs de pedidos inválidos" });
      }
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: `Status '${status}' não permitido. Use: ${allowedStatuses.join(", ")}` });
      }

      const skipped: string[] = [];
      const updated: string[] = [];

      for (const orderId of orderIds) {
        const order = await storage.getOrderById(orderId);
        if (!order) {
          skipped.push(`${orderId} (não encontrado)`);
          continue;
        }
        // Must be launched first
        if (!order.isLaunched) {
          skipped.push(`${order.erpOrderId} (não lançado)`);
          continue;
        }
        // Already at target status
        if (order.status === status) {
          const label = status === "separado" ? "Separado" : "Conferido";
          skipped.push(`${order.erpOrderId} (já está como ${label})`);
          continue;
        }
        // Bug 3/6: Block invalid transitions to "separado"
        // Cannot go back from "conferido" or "em_conferencia" to "separado"
        if (status === "separado" && (order.status === "conferido" || order.status === "em_conferencia")) {
          const label = order.status === "conferido" ? "Conferido" : "Em Conferência";
          skipped.push(`${order.erpOrderId} (status '${label}' — não é possível retornar para Separado)`);
          continue;
        }

        await storage.updateOrder(orderId, { status });

        // Fill progress: update orderItems quantities so progress bars reflect 100%
        if (status === "separado") {
          await db.execute(drizzleSql`
            UPDATE order_items
            SET separated_qty = quantity, status = 'separado'
            WHERE order_id = ${orderId}
          `);
        } else if (status === "conferido") {
          await db.execute(drizzleSql`
            UPDATE order_items
            SET separated_qty = quantity, checked_qty = quantity, status = 'conferido'
            WHERE order_id = ${orderId}
          `);
          // Mark all work units for this order as concluido
          await db.execute(drizzleSql`
            UPDATE work_units SET status = 'concluido', completed_at = NOW()::text
            WHERE order_id = ${orderId} AND status != 'concluido'
          `);
        }

        // When forcing to "separado", ensure a conferencia WU exists.
        if (status === "separado") {
          const { db: database } = await import("./db");
          const { workUnits: workUnitsTable } = await import("@shared/schema");
          const { eq: eqFn, and: andFn } = await import("drizzle-orm");

          const existingConf = await database
            .select()
            .from(workUnitsTable)
            .where(andFn(
              eqFn(workUnitsTable.orderId, orderId),
              eqFn(workUnitsTable.type, "conferencia")
            ))
            .limit(1);

          if (existingConf.length === 0) {
            const order = await storage.getOrderById(orderId);
            await database.insert(workUnitsTable).values({
              orderId,
              type: "conferencia",
              status: "pendente",
              pickupPoint: 0,
              companyId: order?.companyId || undefined,
            });
          }
        }

        await storage.createAuditLog({
          userId: req.user!.id,
          action: "force_status",
          entityType: "order",
          entityId: orderId,
          details: `Status forçado para '${status}' pelo administrador`,
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
        });
        updated.push(orderId);
      }

      if (updated.length > 0) {
        broadcastSSE("orders_status_forced", { orderIds: updated, status }, req.companyId);
      }

      if (skipped.length > 0 && updated.length === 0) {
        return res.status(400).json({
          error: "Nenhum pedido atualizado",
          details: skipped.join("; "),
        });
      }

      res.json({
        success: true,
        updated: updated.length,
        skipped: skipped.length > 0 ? skipped : undefined,
      });
    } catch (error) {
      log(`[Routes] Force status error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno ao alterar status" });
    }
  });

  // Bug 7: Get order IDs that have at least one item matching the given pickup points
  app.get("/api/orders/ids-by-pickup-points", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const ppParam = req.query.pp;
      const ppList = Array.isArray(ppParam) ? ppParam : ppParam ? [ppParam] : [];
      const ppInts = ppList.map(p => parseInt(p as string)).filter(p => !isNaN(p));
      const companyId = req.companyId;

      if (ppInts.length === 0) {
        return res.json({ orderIds: [] });
      }

      const { db: database } = await import("./db");
      const { orderItems: orderItemsTable, orders: ordersTable } = await import("@shared/schema");
      const { inArray: inArrayFn, sql: sqlFn, eq: eqFn, and: andFn } = await import("drizzle-orm");

      const conditions: any[] = [inArrayFn(orderItemsTable.pickupPoint, ppInts)];
      if (companyId) {
        conditions.push(eqFn(ordersTable.companyId, companyId));
      }

      const rows = await database
        .select({
          orderId: orderItemsTable.orderId,
          itemCount: sqlFn<number>`count(distinct ${orderItemsTable.productId})`
        })
        .from(orderItemsTable)
        .innerJoin(ordersTable, eqFn(ordersTable.id, orderItemsTable.orderId))
        .where(andFn(...conditions))
        .groupBy(orderItemsTable.orderId);

      res.json({ orderIds: rows.map(r => r.orderId), counts: rows });
    } catch (error) {
      log(`[Routes] ids-by-pickup-points error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Stats
  app.get("/api/stats", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const stats = await storage.getOrderStats();
      res.json(stats);
    } catch (error) {
      log(`[Routes] Get stats error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Reports
  app.post("/api/reports/picking-list", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { orderIds, pickupPoints, sections } = req.body;
      const companyId = req.companyId;
      const data = await storage.getPickingListReportData({ orderIds, pickupPoints, sections }, companyId);
      res.json(data);
    } catch (error) {
      log(`[Routes] Get picking list report error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/reports/loading-map/:loadCode", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const loadCode = req.params.loadCode;
      if (!loadCode) {
        return res.status(400).json({ error: "Missing loadCode parameter" });
      }
      const data = await storage.getLoadingMapReportData(loadCode as string);
      res.json(data);
    } catch (error) {
      const errMsg = getErrorMessage(error);
      log(`[Routes] Error generating loading map: ${errMsg}`);
      res.status(500).json({ error: errMsg });
    }
  });

  // Work Units routes
  app.get("/api/work-units", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const type = req.query.type as string | undefined;
      const companyId = req.companyId;
      const requestingUser = req.user;
      const allWorkUnits = await storage.getWorkUnits(type, companyId);

      // Filter: only return work units belonging to launched orders
      let launched = allWorkUnits.filter(wu => wu.order?.isLaunched === true);

      if (requestingUser?.role === "separacao") {
        const userSections: string[] = (requestingUser.sections as string[]) || [];
        if (userSections.length === 0) {
          launched = [];
        } else {
          launched = launched.filter(wu => wu.section != null && userSections.includes(wu.section));
          launched = launched.map(wu => ({
            ...wu,
            items: wu.items.filter(item => userSections.includes(item.section))
          }));
        }
      }

      // Explicit stringify to catch circular/non-serializable objects early
      const json = JSON.stringify(launched);
      res.setHeader("Content-Type", "application/json");
      res.send(json);
    } catch (error) {
      log(`[Routes] Get work units error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/unlock", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { workUnitIds, reset } = req.body;
      const userId = req.user!.id;

      const affectedOrderIds = new Set<string>();
      let isConferenciaUnlock = false;
      
      for (const wuId of workUnitIds) {
        const wu = await storage.getWorkUnitById(wuId);
        if (!wu) continue;
        const authWU = authorizeWorkUnit(wu, req);
        if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
        if (reset && wu.status === "concluido") continue;
        if (wu.orderId) affectedOrderIds.add(wu.orderId);
      }

      await storage.unlockWorkUnits(workUnitIds);

      for (const wuId of workUnitIds) {
        const wu = await storage.getWorkUnitById(wuId);
        if (wu) {
          const sessionConds: any[] = [eq(pickingSessions.orderId, wu.orderId)];
          if (wu.section) sessionConds.push(eq(pickingSessions.sectionId, wu.section));
          await db.delete(pickingSessions).where(and(...sessionConds));
        }
      }

      if (reset) {
        for (const id of workUnitIds) {
          const wu = await storage.getWorkUnitById(id);
          if (wu?.status === "concluido") continue; // skip actually resetting progress
          
          if (wu?.type === "conferencia") {
            isConferenciaUnlock = true;
            await storage.resetConferenciaProgress(id);
          } else if (wu) {
            await storage.resetWorkUnitProgress(id);
          }
        }
        for (const orderId of affectedOrderIds) {
          // Apenas reverter pedido para separado se tivermos resetado uma conferência válida
          if (isConferenciaUnlock) {
            await storage.updateOrder(orderId, { status: "separado" });
          } else {
            await storage.updateOrder(orderId, { status: "pendente" });
          }
        }
      }

      if (!isConferenciaUnlock) {
        for (const orderId of affectedOrderIds) {
          await storage.recalculateOrderStatus(orderId);
        }
      }

      await storage.createAuditLog({
        userId,
        action: "unlock_work_units",
        entityType: "work_unit",
        details: `${workUnitIds.length} unidades desbloqueadas${reset ? ' e resetadas' : ''}`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      broadcastSSE("work_units_unlocked", { workUnitIds, affectedOrderIds: [...affectedOrderIds] }, req.companyId);

      res.json({ success: true });
    } catch (error) {
      const { message: errMsg, code: errCode } = getDbError(error);
      log(`[Routes] Unlock work units error: ${errMsg}`);
      const detail = errCode === "LOCK_CONFLICT" ? "Conflito ao desbloquear — unidade já foi desbloqueada por outro operador."
        : errCode === "23503" ? "Erro de referência no banco de dados. Contate o suporte."
        : "Erro interno ao desbloquear unidades. Tente novamente.";
      res.status(500).json({ error: detail });
    }
  });

  app.post("/api/work-units/lock", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { workUnitIds } = req.body;
      const userId = req.user!.id;
      const expiresAt = new Date(Date.now() + LOCK_TTL_MINUTES * 60 * 1000);

      for (const wuId of workUnitIds) {
        const wu = await storage.getWorkUnitById(wuId);
        if (!wu) return res.status(404).json({ error: "Unidade não encontrada" });
        const authWU = authorizeWorkUnit(wu, req);
        if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
      }

      const lockedCount = await storage.lockWorkUnits(workUnitIds, userId, expiresAt);

      await storage.createAuditLog({
        userId,
        action: "lock_work_units",
        entityType: "work_unit",
        details: `${lockedCount} unidades bloqueadas`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true, expiresAt });
    } catch (error) {
      const errMsg = getErrorMessage(error);
      if (errMsg === "LOCK_CONFLICT") {
        return res.status(409).json({ error: "Uma ou mais unidades já estão em uso por outro operador" });
      }
      log(`[Routes] Lock work units error: ${errMsg}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/batch/scan-cart", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { workUnitIds, qrCode } = req.body;

      if (!Array.isArray(workUnitIds) || workUnitIds.length === 0) {
        return res.status(400).json({ error: "IDs das unidades de trabalho são obrigatórios" });
      }

      const results = [];
      const orderIdsToUpdate = new Set<string>();

      for (const id of workUnitIds) {
        const workUnit = await storage.getWorkUnitById(id);
        if (!workUnit) continue;
        const authWU = authorizeWorkUnit(workUnit, req);
        if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
        const lockCheck = assertLockOwnership(workUnit, req);
        if (!lockCheck.allowed) return res.status(403).json({ error: lockCheck.reason });

        if (workUnit.status === "concluido") continue;

        await storage.updateWorkUnit(id, {
          cartQrCode: qrCode,
          status: "em_andamento",
          startedAt: workUnit.startedAt || new Date().toISOString()
        });

        if (workUnit.orderId) {
          orderIdsToUpdate.add(workUnit.orderId);
        }

        results.push(id);
      }

      for (const orderId of orderIdsToUpdate) {
        const order = await storage.getOrderById(orderId);
        if (order && order.status === "pendente") {
          await storage.updateOrder(orderId, {
            status: "em_separacao",
            updatedAt: new Date().toISOString()
          });
        }
        // Broadcast genérico por pedido para evitar spam de SSE
        broadcastSSE("picking_started", { orderId, userId: req.user!.id }, req.companyId);
      }



      res.json({ success: true, updatedCount: results.length });
    } catch (error) {
      log(`[Routes] Batch scan cart error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });


  app.post("/api/orders/batch/start-conference", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { workUnitIds } = req.body;

      if (!Array.isArray(workUnitIds) || workUnitIds.length === 0) {
        return res.status(400).json({ error: "IDs das unidades de trabalho são obrigatórios" });
      }

      const results = [];
      const orderIdsToUpdate = new Set<string>();

      for (const id of workUnitIds) {
        const workUnit = await storage.getWorkUnitById(id);
        if (!workUnit) continue;
        const authWU = authorizeWorkUnit(workUnit, req);
        if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
        const lockCheck = assertLockOwnership(workUnit, req);
        if (!lockCheck.allowed) return res.status(403).json({ error: lockCheck.reason });

        if (workUnit.status === "concluido") continue;

        await storage.updateWorkUnit(id, {
          status: "em_andamento",
          startedAt: workUnit.startedAt || new Date().toISOString()
        });

        if (workUnit.orderId) {
          orderIdsToUpdate.add(workUnit.orderId);
        }

        results.push(id);
      }

      for (const orderId of orderIdsToUpdate) {
        const order = await storage.getOrderById(orderId);
        if (order && (order.status === "separado" || order.status === "pendente")) {
          await storage.updateOrder(orderId, {
            status: "em_conferencia",
            updatedAt: new Date().toISOString()
          });
        }
        // Broadcast generic event
        broadcastSSE("conference_started", { orderId, userId: req.user!.id }, req.companyId);
      }

      res.json({ success: true, updatedCount: results.length });
    } catch (error) {
      log(`[Routes] Batch start conference error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/scan-cart", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { qrCode } = req.body;
      const workUnit = await storage.getWorkUnitById(req.params.id as string);

      if (!workUnit) {
        return res.status(404).json({ error: "Unidade não encontrada" });
      }
      const authWU = authorizeWorkUnit(workUnit, req);
      if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });

      if (workUnit.status === "concluido") {
        return res.status(409).json({ error: "Unidade já foi concluída" });
      }

      await storage.updateWorkUnit(req.params.id as string, {
        cartQrCode: qrCode,
        status: "em_andamento",
        startedAt: workUnit.startedAt || new Date().toISOString()
      });

      // Update Order Status to "em_separacao" if it's "pendente"
      if (workUnit.orderId) {
        const order = await storage.getOrderById(workUnit.orderId);
        if (order && order.status === "pendente") {
          await storage.updateOrder(workUnit.orderId, {
            status: "em_separacao",
            updatedAt: new Date().toISOString()
          });
        }
      }

      broadcastSSE("picking_started", { workUnitId: req.params.id, orderId: workUnit.orderId, userId: req.user!.id }, req.companyId);

      const updated = await storage.getWorkUnitById(req.params.id as string);

      res.json({ workUnit: updated });
    } catch (error) {
      log(`[Routes] Scan cart error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/scan-pallet", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { qrCode } = req.body;
      const workUnit = await storage.getWorkUnitById(req.params.id as string);

      if (!workUnit) {
        return res.status(404).json({ error: "Unidade não encontrada" });
      }
      const authWU = authorizeWorkUnit(workUnit, req);
      if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });

      if (workUnit.status === "concluido") {
        return res.status(409).json({ error: "Unidade já foi concluída" });
      }

      await storage.updateWorkUnit(req.params.id as string, { palletQrCode: qrCode, status: "em_andamento", startedAt: workUnit.startedAt || new Date().toISOString() });

      if (workUnit.orderId) {
        const order = await storage.getOrderById(workUnit.orderId);
        if (order && order.status === "separado") {
          await storage.updateOrder(workUnit.orderId, { status: "em_conferencia", updatedAt: new Date().toISOString() });
        }
      }

      broadcastSSE("conference_started", { workUnitId: req.params.id, orderId: workUnit.orderId, userId: req.user!.id }, req.companyId);

      const updated = await storage.getWorkUnitById(req.params.id as string);

      res.json({ workUnit: updated });
    } catch (error) {
      log(`[Routes] Scan pallet error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/scan-item", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { barcode } = req.body;
      const workUnit = await storage.getWorkUnitById(req.params.id as string);

      if (!workUnit) {
        return res.status(404).json({ error: "Unidade não encontrada" });
      }
      const authWU = authorizeWorkUnit(workUnit, req);
      if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
      const lockCheck = assertLockOwnership(workUnit, req);
      if (!lockCheck.allowed) return res.status(403).json({ error: lockCheck.reason });

      const product = await storage.getProductByBarcode(barcode);
      if (!product) {
        return res.json({ status: "not_found" });
      }

      const matchingItems = workUnit.items.filter(i => i.productId === product.id);
      if (matchingItems.length === 0) {
        return res.json({ status: "not_found" });
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

      const rawQty = req.body.quantity !== undefined && req.body.quantity !== null
        ? Number(req.body.quantity)
        : 1;
      if (isNaN(rawQty) || rawQty < 0) {
        return res.status(400).json({ error: "Quantidade inválida" });
      }
      const requestedQty = rawQty === 1 ? multiplier : rawQty;

      const scanResult = await storage.atomicScanSeparatedQty(
        item.id, requestedQty, adjustedTarget, req.params.id as string, workUnit.orderId
      );

      if (scanResult.result === "already_complete") {
        return res.json({
          status: "already_complete",
          product,
          quantity: requestedQty,
          message: `Item já totalmente separado (${scanResult.adjustedTarget} unidades).`,
        });
      }

      if (scanResult.result === "over_quantity") {
        const msg = exceptionQty > 0
          ? `Item com ${exceptionQty} exceção(ões). Disponível: ${scanResult.availableQty} de ${scanResult.adjustedTarget}.`
          : `Quantidade excedida! Disponível: ${scanResult.availableQty} de ${scanResult.adjustedTarget}.`;
        return res.json({
          status: exceptionQty > 0 ? "over_quantity_with_exception" : "over_quantity",
          product,
          quantity: requestedQty,
          exceptionQty,
          availableQty: scanResult.availableQty,
          message: msg,
        });
      }

      broadcastSSE("item_picked", { workUnitId: req.params.id, orderId: workUnit.orderId, productId: product.id, userId: req.user!.id }, req.companyId);

      await storage.checkAndCompleteWorkUnit(req.params.id as string, false);

      const finalWorkUnit = await storage.getWorkUnitById(req.params.id as string);

      res.json({
        status: "success",
        product,
        quantity: requestedQty,
        workUnit: finalWorkUnit,
      });
    } catch (error) {
      const { message: errMsg, code: errCode } = getDbError(error);
      log(`[Routes] Scan item error: ${errMsg}`);
      const detail = errCode === "23505" ? "Conflito de dados. Atualize a tela e tente novamente."
        : errCode === "55P03" ? "Outro operador está bipando este item. Aguarde um instante e tente novamente."
        : errMsg === "LOCK_CONFLICT" ? "Bloqueio expirado. Reabra a unidade de trabalho."
        : "Erro interno ao processar leitura. Tente novamente.";
      res.status(500).json({ error: detail });
    }
  });

  app.post("/api/work-units/:id/check-item", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { barcode } = req.body;
      const workUnit = await storage.getWorkUnitById(req.params.id as string);

      if (!workUnit) {
        return res.status(404).json({ error: "Unidade não encontrada" });
      }
      const authWU = authorizeWorkUnit(workUnit, req);
      if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
      const lockCheck = assertLockOwnership(workUnit, req);
      if (!lockCheck.allowed) return res.status(403).json({ error: lockCheck.reason });

      const product = await storage.getProductByBarcode(barcode);
      if (!product) {
        return res.json({ status: "not_found" });
      }

      const matchingItems = workUnit.items.filter(i => i.productId === product.id);
      if (matchingItems.length === 0) {
        return res.json({ status: "not_found" });
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

      const currentQty = Number(item.checkedQty);
      const separatedQty = Number(item.separatedQty);
      const itemExcQty = Number(item.exceptionQty || 0);

      const targetQty = separatedQty > 0 ? separatedQty : (itemExcQty > 0 ? 0 : Number(item.quantity));

      if (targetQty <= 0) {
        return res.json({ status: "not_found" });
      }

      const multiplier = await storage.getBarcodeMultiplier(barcode, product);

      const rawQty = req.body.quantity !== undefined && req.body.quantity !== null
        ? Number(req.body.quantity)
        : 1;
      if (isNaN(rawQty) || rawQty < 0) {
        return res.status(400).json({ error: "Quantidade inválida" });
      }
      const requestedQty = rawQty === 1 ? multiplier : rawQty;

      if (currentQty >= targetQty) {
        return res.json({ 
          status: "over_quantity", 
          product, 
          quantity: requestedQty,
          workUnit,
          message: `O item já está totalmente conferido (${targetQty} de ${targetQty}). O item extra foi recusado para preservar o status.`
        });
      }

      const availableQty = targetQty - currentQty;

      if (requestedQty > availableQty) {
        if (itemExcQty > 0) {
          return res.json({
            status: "over_quantity_with_exception",
            workUnit,
            product,
            quantity: requestedQty,
            exceptionQty: itemExcQty,
            message: `Tentativa excede o disponível (${availableQty}). O item tem ${itemExcQty} exceções informadas. Total conferido até aqui (${currentQty}) foi mantido.`
          });
        }

        return res.json({
          status: "over_quantity",
          product,
          quantity: requestedQty,
          workUnit,
          message: `Tentativa de conferir excede o disponível (${availableQty}). Última quantidade válida (${currentQty}) mantida com segurança.`
        });
      }

      const newQty = currentQty + requestedQty;
      const newStatus = newQty >= targetQty ? "conferido" : "separado";
      await storage.atomicIncrementCheckedQty(item.id, requestedQty, newStatus);

      // BUGFIX: Automatic completion removed.
      // The conference unit will only be marked as "concluido" when the user
      // explicitly clicks the "Concluir" button on the UI, which calls /complete-conference.

      const finalWorkUnit = await storage.getWorkUnitById(req.params.id as string);

      res.json({
        status: "success",
        product,
        quantity: requestedQty,
        workUnit: finalWorkUnit,
      });
    } catch (error) {
      log(`[Routes] Check item error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/reset-item-check", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { itemIds } = req.body;
      const workUnit = await storage.getWorkUnitById(req.params.id as string);

      if (!workUnit) {
        return res.status(404).json({ error: "Unidade não encontrada" });
      }
      const authWU = authorizeWorkUnit(workUnit, req);
      if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });

      if (workUnit.lockedBy !== req.user?.id) {
        return res.status(403).json({ error: "Você não tem permissão para resetar itens desta unidade." });
      }

      if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return res.status(400).json({ error: "Nenhum item informado para reset" });
      }

      await db.transaction(async (tx) => {
        for (const id of itemIds) {
          const itemBelongsToWu = workUnit.items.some(i => i.id === id);
          if (itemBelongsToWu) {
            await tx.update(orderItems)
              .set({
                checkedQty: 0,
                status: "pendente"
              })
              .where(eq(orderItems.id, id));
          }
        }
        await tx.update(workUnits)
          .set({ status: "em_andamento" })
          .where(eq(workUnits.id, req.params.id as string));
      });

      const resetWorkUnit = await storage.getWorkUnitById(req.params.id as string);
      res.json({
        status: "success",
        workUnit: resetWorkUnit,
      });
    } catch (error) {
      log(`[Routes] Reset item check error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno no reset" });
    }
  });

  app.post("/api/work-units/:id/reset-item-picking", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { itemIds } = req.body;
      const workUnit = await storage.getWorkUnitById(req.params.id as string);

      if (!workUnit) {
        return res.status(404).json({ error: "Unidade não encontrada" });
      }
      const authWU = authorizeWorkUnit(workUnit, req);
      if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });

      if (workUnit.lockedBy !== req.user?.id) {
        return res.status(403).json({ error: "Você não tem permissão para resetar itens desta unidade." });
      }

      if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return res.status(400).json({ error: "Nenhum item informado para reset" });
      }

      await db.transaction(async (tx) => {
        for (const id of itemIds) {
          const itemBelongsToWu = workUnit.items.some(i => i.id === id);
          if (itemBelongsToWu) {
            await tx.update(orderItems)
              .set({ separatedQty: 0, status: "recontagem" })
              .where(eq(orderItems.id, id));
          }
        }
        await tx.update(workUnits)
          .set({ status: "em_andamento" })
          .where(eq(workUnits.id, req.params.id as string));
      });
      const resetWorkUnit = await storage.getWorkUnitById(req.params.id as string);
      res.json({ status: "success", workUnit: resetWorkUnit });
    } catch (error) {
      log(`[Routes] Reset item picking error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno no reset" });
    }
  });

  app.post("/api/work-units/:id/balcao-item", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { barcode } = req.body;
      const workUnit = await storage.getWorkUnitById(req.params.id as string);

      if (!workUnit) {
        return res.status(404).json({ error: "Unidade não encontrada" });
      }
      const authWU = authorizeWorkUnit(workUnit, req);
      if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
      const lockCheck = assertLockOwnership(workUnit, req);
      if (!lockCheck.allowed) return res.status(403).json({ error: lockCheck.reason });

      const product = await storage.getProductByBarcode(barcode);
      if (!product) {
        return res.json({ status: "not_found" });
      }

      const matchingItems = workUnit.items.filter(i => i.productId === product.id);
      if (matchingItems.length === 0) {
        return res.json({ status: "not_found" });
      }
      const item = matchingItems.length === 1
        ? matchingItems[0]
        : matchingItems.find(i => {
            const sep = Number(i.separatedQty);
            const tgt = Number(i.quantity) - Number(i.exceptionQty || 0);
            return sep < tgt;
          }) || matchingItems[0];

      const currentQty = Number(item.separatedQty);
      const itemExcQty = Number(item.exceptionQty || 0);

      const targetQty = Number(item.quantity) - itemExcQty;

      if (targetQty <= 0) {
        return res.json({ status: "not_found" });
      }

      const multiplier = await storage.getBarcodeMultiplier(barcode, product);

      const rawQty = req.body.quantity !== undefined && req.body.quantity !== null
        ? Number(req.body.quantity)
        : 1;
      if (isNaN(rawQty) || rawQty < 0) {
        return res.status(400).json({ error: "Quantidade inválida" });
      }
      const requestedQty = rawQty === 1 ? multiplier : rawQty;

      if (currentQty >= targetQty) {
        await storage.atomicResetItemAndWorkUnit(item.id, req.params.id as string, workUnit.orderId, "separatedQty", "pendente");
        const resetWorkUnit = await storage.getWorkUnitById(req.params.id as string);
        return res.json({ 
          status: "over_quantity", 
          product, 
          quantity: requestedQty,
          workUnit: resetWorkUnit,
          message: `Quantidade excedida! Separação Balcão resetada. Bipe os ${targetQty} itens novamente.`
        });
      }

      const availableQty = targetQty - currentQty;

      if (requestedQty > availableQty) {
        await storage.atomicResetItemAndWorkUnit(item.id, req.params.id as string, workUnit.orderId, "separatedQty", "pendente");
        const resetWorkUnit = await storage.getWorkUnitById(req.params.id as string);

        if (itemExcQty > 0) {
          return res.json({
            status: "over_quantity_with_exception",
            workUnit: resetWorkUnit,
            product,
            quantity: requestedQty,
            exceptionQty: itemExcQty,
            message: `Este item tem ${itemExcQty} unidade(s) com exceção. Quantidade disponível: ${availableQty}. Separação Balcão resetada.`
          });
        }

        return res.json({
          status: "over_quantity",
          product,
          quantity: requestedQty,
          workUnit: resetWorkUnit,
          message: `Quantidade excedida! Disponível: ${availableQty}. Separação Balcão resetada.`
        });
      }

      const newQty = currentQty + requestedQty;
      const newStatus = newQty >= targetQty ? "conferido" : "pendente";
      await storage.atomicIncrementSeparatedQty(item.id, requestedQty, newStatus);

      const updated = await storage.getWorkUnitById(req.params.id as string);

      res.json({
        status: "success",
        product,
        quantity: requestedQty,
        workUnit: updated,
      });
    } catch (error) {
      log(`[Routes] Balcao item error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/complete-balcao", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { elapsedTime } = req.body;
      const wuCheck = await storage.getWorkUnitById(req.params.id as string);
      if (!wuCheck) return res.status(404).json({ error: "Unidade não encontrada" });
      const authWU = authorizeWorkUnit(wuCheck, req);
      if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
      const lockCheck = assertLockOwnership(wuCheck, req);
      if (!lockCheck.allowed) return res.status(403).json({ error: lockCheck.reason });

      if (wuCheck.status === "concluido") {
        return res.json({ success: true });
      }

      const isComplete = await storage.checkAndCompleteWorkUnit(req.params.id as string, true, "finalizado");

      if (!isComplete) {
        return res.status(400).json({ error: "Existem itens pendentes" });
      }

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "complete_balcao",
        entityType: "work_unit",
        entityId: req.params.id as string,
        details: `Atendimento balcão concluído em ${elapsedTime}s`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true });
    } catch (error) {
      log(`[Routes] Complete balcao error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/work-units/:id/batch-sync", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const wuCheck = await storage.getWorkUnitById(id);
      if (!wuCheck) return res.status(404).json({ error: "Unidade não encontrada" });
      const authWU = authorizeWorkUnit(wuCheck, req);
      if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
      const lockCheck = assertLockOwnership(wuCheck, req);
      if (!lockCheck.allowed) return res.status(403).json({ error: lockCheck.reason });
      const userId = req.user!.id;
      const parsed = batchSyncPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Payload inválido.", details: parsed.error.flatten() });
      }
      const { items, exceptions: excs } = parsed.data;

      log(`[Routes] Received Batch Sync for WU ${id} - Items: ${items?.length}, Excs: ${excs?.length}`);

      await storage.processBatchSync(id, { items, exceptions: excs }, userId);

      // We do NOT complete the unit here. Completing is a separate step usually.
      // But we can return success so the app knows it safely reached the server DB.
      res.json({ success: true });
    } catch (error) {
      const errMsg = getErrorMessage(error);
      log(`[Routes] Batch sync error: ${errMsg}`);
      res.status(500).json({ error: errMsg || "Erro interno ao processar lote" });
    }
  });

  app.post("/api/work-units/:id/heartbeat", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const wuCheck = await storage.getWorkUnitById(id);
      if (!wuCheck) return res.status(404).json({ error: "Unidade não encontrada" });
      const authWU = authorizeWorkUnit(wuCheck, req);
      if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
      const { items } = req.body;
      const userId = req.user!.id;

      // Renova o lock se o chamador for o dono (ou supervisor)
      const isOwner = wuCheck.lockedBy === userId;
      const isSupervisor = req.user!.role === "supervisor" || req.user!.role === "administrador";
      if ((isOwner || isSupervisor) && wuCheck.status !== "concluido") {
        const newExpiry = new Date(Date.now() + LOCK_TTL_MINUTES * 60 * 1000).toISOString();
        await storage.renewWorkUnitLock(id, newExpiry);
      }

      if (items && Array.isArray(items)) {
        broadcastSSE("work_unit_heartbeat", { workUnitId: id, items }, req.companyId);
      }

      res.json({ success: true });
    } catch (error) {
      log(`[WU Heartbeat] Falha no heartbeat do WU ${req.params.id}: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ success: false, error: "Erro no heartbeat" });
    }
  });

  app.post("/api/work-units/:id/complete", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const wuCheck = await storage.getWorkUnitById(id);
      if (!wuCheck) return res.status(404).json({ error: "Unidade não encontrada" });
      const authWU = authorizeWorkUnit(wuCheck, req);
      if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
      const lockCheck = assertLockOwnership(wuCheck, req);
      if (!lockCheck.allowed) return res.status(403).json({ error: lockCheck.reason });

      if (wuCheck.status === "concluido") {
        return res.json({ success: true });
      }

      const isComplete = await storage.checkAndCompleteWorkUnit(id);

      if (isComplete) {
        const wu = await storage.getWorkUnitById(id);
        if (wu) {
          broadcastSSE("picking_finished", { workUnitId: id, orderId: wu.orderId }, req.companyId);

          const conferenceUnit = await storage.checkAndUpdateOrderStatus(wu.orderId);
          if (conferenceUnit) {
            broadcastSSE("work_unit_created", conferenceUnit, req.companyId);
          }
        }

        await storage.createAuditLog({
          userId: req.user!.id,
          action: "complete_separation",
          entityType: "work_unit",
          entityId: id,
          details: `Separação concluída`,
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
        });

        res.json({ success: true });
      } else {
        res.status(400).json({ error: "Existem itens pendentes" });
      }
    } catch (error) {
      log(`[Routes] Manual complete error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // S1-02: endpoint atômico — completa WUs e deduz estoque de endereço na mesma transação DB
  app.post("/api/picking/finalize-separation", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { workUnitIds, deductions, finalOrderStatus } = req.body as {
        workUnitIds: string[];
        deductions?: Array<{ productId: string; addressId: string; quantity: number; orderId?: string; erpOrderId?: string; workUnitId?: string }>;
        finalOrderStatus?: string;
      };

      if (!Array.isArray(workUnitIds) || workUnitIds.length === 0) {
        return res.status(400).json({ error: "workUnitIds é obrigatório" });
      }

      // Validar autorização para cada WU antes de entrar na transação
      for (const wuId of workUnitIds) {
        const wu = await storage.getWorkUnitById(wuId);
        if (!wu) return res.status(404).json({ error: `Unidade ${wuId} não encontrada` });
        const authWU = authorizeWorkUnit(wu, req);
        if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
        const lockCheck = assertLockOwnership(wu, req);
        if (!lockCheck.allowed) return res.status(403).json({ error: lockCheck.reason });
      }

      const result = await storage.finalizeWorkUnitsWithDeductions({
        workUnitIds,
        deductions: deductions || [],
        userId: req.user!.id,
        companyId: req.companyId!,
        finalOrderStatus,
      });

      // Broadcasts SSE e audit logs (fora da transação — não crítico para atomicidade)
      // Precisamos do orderId de cada WU — buscar individualmente
      for (const wuId of result.completed) {
        const wu = await storage.getWorkUnitById(wuId);
        if (wu) {
          broadcastSSE("picking_finished", { workUnitId: wuId, orderId: wu.orderId }, req.companyId);
          const conferenceUnit = await storage.checkAndUpdateOrderStatus(wu.orderId);
          if (conferenceUnit) broadcastSSE("work_unit_created", conferenceUnit, req.companyId);
        }
        storage.createAuditLog({
          userId: req.user!.id,
          action: "complete_separation",
          entityType: "work_unit",
          entityId: wuId,
          details: `Separação concluída (finalize-separation)`,
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
        }).catch(() => {});
      }

      res.json({ ok: true, completed: result.completed, unlocked: result.unlocked });
    } catch (error) {
      log(`[Routes] finalize-separation error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao finalizar separação" });
    }
  });

  app.post("/api/work-units/:id/complete-conference", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const wuCheck = await storage.getWorkUnitById(id);
      if (!wuCheck) return res.status(404).json({ error: "Unidade não encontrada" });
      const authWU = authorizeWorkUnit(wuCheck, req);
      if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
      const lockCheck = assertLockOwnership(wuCheck, req);
      if (!lockCheck.allowed) return res.status(403).json({ error: lockCheck.reason });

      if (wuCheck.status === "concluido") {
        return res.json({ success: true });
      }

      const isComplete = await storage.checkAndCompleteConference(id);

      if (isComplete) {
        const wu = await storage.getWorkUnitById(id);
        if (wu) {
          broadcastSSE("conference_finished", { workUnitId: id, orderId: wu.orderId }, req.companyId);
        }

        await storage.createAuditLog({
          userId: req.user!.id,
          action: "complete_conference",
          entityType: "work_unit",
          entityId: id,
          details: `Conferência concluída`,
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
        });

        res.json({ success: true });
      } else {
        res.status(400).json({ error: "Existem itens pendentes" });
      }
    } catch (error) {
      log(`[Routes] Conference complete error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Audit Logs
  app.get("/api/audit-logs", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const logs = await storage.getAllAuditLogs();
      res.json(logs);
    } catch (error) {
      log(`[Routes] Get audit logs error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/audit-logs", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { action, entityType, entityId, details, previousValue, newValue } = req.body;

      if (!action || !entityType) {
        return res.status(400).json({ error: "Ação e Tipo de Entidade são obrigatórios" });
      }

      const log = await storage.createAuditLog({
        userId: req.user!.id,
        action,
        entityType,
        entityId: entityId || null,
        details: details || null,
        previousValue: previousValue || null,
        newValue: newValue || null,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json(log);
    } catch (error) {
      log(`[Routes] Create audit log error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Exceptions
  app.get("/api/exceptions", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const exceptions = await storage.getAllExceptions();
      res.json(exceptions);
    } catch (error) {
      log(`[Routes] Get exceptions error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/exceptions", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { workUnitId, orderItemId, type, quantity, observation } = req.body;

      if (workUnitId) {
        const wuCheck = await storage.getWorkUnitById(workUnitId);
        if (wuCheck) {
          const authWU = authorizeWorkUnit(wuCheck, req);
          if (!authWU.allowed) return res.status(403).json({ error: authWU.reason });
        }
      }

      const canCreate = await storage.canCreateException(orderItemId, quantity);
      if (!canCreate) {
        return res.status(400).json({ error: "Quantidade da exceção excede o total do item." });
      }

      const exception = await storage.createException({
        workUnitId,
        orderItemId,
        type,
        quantity,
        observation,
        reportedBy: req.user!.id,
      });

      // Decrease separated quantity if needed (if converting separated to exception)
      await storage.adjustItemQuantityForException(orderItemId);

      await storage.updateOrderItem(orderItemId, { status: "excecao" });

      // Check if work unit is now complete, but do NOT auto-complete here.
      // Auto-complete must be false so the frontend handles authorization before manual completion.
      await storage.checkAndCompleteWorkUnit(workUnitId, false);

      broadcastSSE("exception_created", { workUnitId, orderItemId, type, quantity, exceptionId: exception.id }, req.companyId);

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "create_exception",
        entityType: "exception",
        entityId: exception.id,
        details: `Exceção ${type} registrada`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json(exception);
    } catch (error) {
      log(`[Routes] Create exception error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // DELETE /api/exceptions/:id — admin deletes a pending exception and resets item status
  app.delete("/api/exceptions/:id", isAuthenticated, requireCompany, requireRole("administrador"), async (req: Request, res: Response) => {
    try {
      const exceptionId = req.params.id as string;
      const allExceptions = await storage.getAllExceptions();
      const exc = allExceptions.find((e: any) => e.id === exceptionId);
      if (!exc) {
        return res.status(404).json({ error: "Exceção não encontrada" });
      }

      if (exc.workUnit?.companyId && exc.workUnit.companyId !== req.companyId) {
        return res.status(403).json({ error: "Acesso negado: empresa diferente" });
      }

      await storage.deleteExceptionWithRollback(exceptionId, exc);

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "delete_exception",
        entityType: "exception",
        entityId: exceptionId,
        details: `Exceção removida pelo administrador`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });
      broadcastSSE("exception_deleted", { exceptionId }, req.companyId);
      res.json({ ok: true });
    } catch (error) {
      log(`[Routes] Delete exception error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao remover exceção" });
    }
  });


  app.post("/api/reports/route-orders-print", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { orderIds } = req.body;
      if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.json([]);
      }

      const results = await storage.getRouteOrdersPrintData(orderIds);
      res.json(results);
    } catch (error) {
      log(`[Routes] Route print fetch error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar dados de impressão" });
    }
  });

  // Report PDF generation endpoint
  app.get("/api/reports/loading-map-by-product/:loadCode", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const loadCode = Array.isArray(req.params.loadCode) ? req.params.loadCode[0] : String(req.params.loadCode);
      const results = await storage.getLoadingMapProductCentricReportData(loadCode);
      res.json(results);
    } catch (error) {
      log(`[Routes] Loading map product fetch error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar dados do mapa de carregamento por produto" });
    }
  });

  app.post("/api/reports/picking-list/generate", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { orderIds, pickupPoints, mode, sections: filterSections, groupId } = req.body;

      if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: "Selecione pelo menos um pedido" });
      }

      const companyId = req.companyId;
      const ppStrings = pickupPoints && pickupPoints.length > 0 ? pickupPoints.map(String) : undefined;
      const reportData = await storage.getPickingListReportData({
        orderIds,
        pickupPoints: ppStrings,
        sections: filterSections,
      }, companyId);

      const selectedOrders: any[] = [];
      for (const oid of orderIds) {
        const order = await storage.getOrderWithItems(oid);
        if (order && (!companyId || order.companyId === companyId)) {
          selectedOrders.push(order);
        }
      }

      const totalReportItems = reportData.reduce((sum, g) => sum + g.items.length, 0);
      const reportPickupPoints = [...new Set(reportData.map(g => g.pickupPoint))];
      log(`[Routes] Company: ${companyId} | Orders: ${orderIds.length} | PP filter: ${JSON.stringify(ppStrings || 'all')} | Items in report: ${totalReportItems} | PPs in result: ${JSON.stringify(reportPickupPoints)}`);

      res.json({
        reportData,
        orders: selectedOrders,
        filters: { orderIds, pickupPoints, mode, sections: filterSections, groupId },
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      log(`[Routes] Generate picking list error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao gerar relatório" });
    }
  });

  app.delete("/api/exceptions/item/:orderItemId", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const orderItemId = req.params.orderItemId as string;

      // Delete all exceptions for this order item via storage
      await storage.deleteExceptionsForItem(orderItemId);

      // Reset item status if it was in exception status
      await storage.updateOrderItem(orderItemId, { status: "pendente" });

      await storage.createAuditLog({
        userId: req.user!.id,
        action: "clear_exceptions",
        entityType: "order_item",
        entityId: orderItemId,
        details: `Exceções limpas para o item`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json({ success: true });
    } catch (error) {
      log(`[Routes] Clear exceptions error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // Authorize exceptions (supervisor/admin only)
  app.post("/api/exceptions/authorize", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { username, password, exceptionIds } = req.body;

      if (!username || !password || !exceptionIds || !Array.isArray(exceptionIds)) {
        return res.status(400).json({ error: "Dados inválidos" });
      }

      // Find user by username
      const authUser = await storage.getUserByUsername(username);
      if (!authUser) {
        return res.status(401).json({ error: "Credenciais inválidas" });
      }

      // Verify password
      const bcrypt = await import("bcrypt");
      const passwordMatch = await bcrypt.compare(password, authUser.password);
      if (!passwordMatch) {
        return res.status(401).json({ error: "Credenciais inválidas" });
      }

      // Check role (only supervisor or admin)
      if (authUser.role !== "supervisor" && authUser.role !== "administrador") {
        return res.status(403).json({ error: "Apenas supervisores ou administradores podem autorizar exceções" });
      }

      const now = new Date().toISOString();
      await storage.authorizeExceptions(exceptionIds, {
        authorizedBy: authUser.id,
        authorizedByName: authUser.name,
        authorizedAt: now,
      }, req.companyId);

      await storage.createAuditLog({
        userId: authUser.id,
        action: "authorize_exceptions",
        entityType: "exceptions",
        entityId: exceptionIds.join(","),
        details: `Autorizou ${exceptionIds.length} exceção(ões)`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      return res.json({
        success: true,
        authorizedBy: authUser.id,
        authorizedByName: authUser.name,
        authorizedAt: now,
      });
    } catch (error) {
      log(`[Routes] Exception authorization error: ${error instanceof Error ? error.message : String(error)}`);
      return res.status(500).json({ error: "Erro ao autorizar exceções" });
    }
  });

  app.post("/api/exceptions/authorize-by-badge", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { badge, exceptionIds } = req.body;

      if (!badge || !exceptionIds || !Array.isArray(exceptionIds)) {
        return res.status(400).json({ error: "Dados inválidos" });
      }

      // Badge is now the MD5 hash
      const authUser = await storage.getUserByBadgeCode(badge);

      if (!authUser) {
        return res.status(401).json({ error: "Crachá inválido ou não encontrado" });
      }

      if (!authUser.active) {
        return res.status(401).json({ error: "Usuário inativo" });
      }

      if (authUser.role !== "supervisor" && authUser.role !== "administrador") {
        return res.status(403).json({ error: "Apenas supervisores ou administradores podem autorizar exceções" });
      }

      const now = new Date().toISOString();
      await storage.authorizeExceptions(exceptionIds, {
        authorizedBy: authUser.id,
        authorizedByName: authUser.name,
        authorizedAt: now,
      }, req.companyId);

      await storage.createAuditLog({
        userId: authUser.id,
        action: "authorize_exceptions_badge",
        entityType: "exceptions",
        entityId: exceptionIds.join(","),
        details: `Autorizou ${exceptionIds.length} exce\u00e7\u00e3o(\u00f5es) via crach\u00e1`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      return res.json({
        success: true,
        authorizedBy: authUser.id,
        authorizedByName: authUser.name,
        authorizedAt: now,
      });
    } catch (error) {
      log(`[Routes] Badge authorization error: ${error instanceof Error ? error.message : String(error)}`);
      return res.status(500).json({ error: "Erro ao autorizar exce\u00e7\u00f5es" });
    }
  });

  // Auto-authorize exceptions (for users with permission)
  app.post("/api/exceptions/auto-authorize", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { exceptionIds } = req.body;
      const user = req.user;

      if (!exceptionIds || !Array.isArray(exceptionIds)) {
        return res.status(400).json({ error: "IDs das exceções são obrigatórios" });
      }

      // Check permission
      const userSettings = user.settings as UserSettings;
      if (!userSettings?.canAuthorizeOwnExceptions) {
        return res.status(403).json({ error: "Usuário não tem permissão para auto-autorizar exceções" });
      }

      const now = new Date().toISOString();
      await storage.authorizeExceptions(exceptionIds, {
        authorizedBy: user.id,
        authorizedByName: user.name,
        authorizedAt: now,
      }, req.companyId);

      await storage.createAuditLog({
        userId: user.id,
        action: "auto_authorize_exceptions",
        entityType: "exceptions",
        entityId: exceptionIds.join(","),
        details: `Auto-autorizou ${exceptionIds.length} exceção(ões)`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      return res.json({
        success: true,
        authorizedBy: user.id,
        authorizedByName: user.name,
        authorizedAt: now,
      });
    } catch (error) {
      log(`[Routes] Auto-authorization error: ${error instanceof Error ? error.message : String(error)}`);
      return res.status(500).json({ error: "Erro ao auto-autorizar exceções" });
    }
  });

  // Admin: Gera novos códigos de crachá aleatórios para usuários que não têm
  app.post("/api/admin/backfill-badges", isAuthenticated, requireRole("administrador"), async (req: Request, res: Response) => {
    try {
      const allUsers = await storage.getAllUsers();
      let updatedCount = 0;

      for (const user of allUsers) {
        if (!user.badgeCode || user.badgeCode === "") {
          const newBadge = generateBadgeCode();
          await storage.updateUser(user.id, { badgeCode: newBadge });
          updatedCount++;
        }
      }

      res.json({ success: true, updated: updatedCount, message: `${updatedCount} crachás gerados` });
    } catch (error) {
      log(`[Admin] Erro ao gerar crachás: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // ==================== Permissions Management ====================

  app.get("/api/admin/permissions", isAuthenticated, requireRole("administrador"), async (req: Request, res: Response) => {
    try {
      const allUsers = await storage.getAllUsers();
      const result = allUsers.map((u: any) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        allowedModules: u.allowedModules ? (typeof u.allowedModules === "string" ? JSON.parse(u.allowedModules) : u.allowedModules) : null,
        allowedReports: u.allowedReports ? (typeof u.allowedReports === "string" ? JSON.parse(u.allowedReports) : u.allowedReports) : null,
      }));
      res.json(result);
    } catch (error) {
      log(`[Routes] Get permissions error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.put("/api/admin/permissions/:userId", isAuthenticated, requireRole("administrador"), async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { allowedModules, allowedReports } = req.body;

      if (allowedModules !== null && allowedModules !== undefined && !Array.isArray(allowedModules)) {
        return res.status(400).json({ error: "allowedModules deve ser um array ou null" });
      }

      if (allowedReports !== null && allowedReports !== undefined && !Array.isArray(allowedReports)) {
        return res.status(400).json({ error: "allowedReports deve ser um array ou null" });
      }

      const updates: any = {};
      if (allowedModules !== undefined) updates.allowedModules = allowedModules;
      if (allowedReports !== undefined) updates.allowedReports = allowedReports;

      await storage.updateUser(userId, updates);
      res.json({ success: true });
    } catch (error) {
      log(`[Routes] Update permissions error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // ==================== Mapping Studio ====================

  app.get("/api/datasets", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      res.json(getAvailableDatasets());
    } catch (error) {
      log(`[Routes] Get datasets error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/schema/:dataset", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const dataset = req.params.dataset as string;
      const contract = getDataContract(dataset);
      if (!contract) {
        return res.status(404).json({ error: "Dataset não encontrado" });
      }
      res.json({ dataset, fields: contract });
    } catch (error) {
      log(`[Routes] Get schema error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/mapping/:dataset", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const dataset = req.params.dataset as string;
      const mapping = await storage.getMappingByDataset(dataset);
      res.json(mapping || null);
    } catch (error) {
      log(`[Routes] Get mapping error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/mappings", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const mappings = await storage.getAllMappings();
      res.json(mappings);
    } catch (error) {
      log(`[Routes] Get all mappings error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/mapping/:dataset", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const dataset = req.params.dataset as string;
      const contract = getDataContract(dataset);
      if (!contract) {
        return res.status(404).json({ error: "Dataset não encontrado" });
      }

      const { mappingJson, description } = req.body;
      if (!mappingJson || !Array.isArray(mappingJson)) {
        return res.status(400).json({ error: "mappingJson é obrigatório e deve ser um array" });
      }

      const errors: string[] = [];
      for (const field of contract) {
        if (field.required) {
          const mapped = mappingJson.find((m: MappingField) => m.appField === field.appField);
          if (!mapped || (!mapped.dbExpression && !mapped.defaultValue)) {
            errors.push(`Campo obrigatório '${field.appField}' precisa de uma expressão DB2 ou valor padrão`);
          }
        }
      }

      if (errors.length > 0) {
        return res.status(400).json({ error: "Validação falhou", details: errors });
      }

      const userId = req.user!.id;
      const mapping = await storage.saveMapping(dataset, mappingJson, description || null, userId);

      await storage.createAuditLog({
        userId,
        action: "save_mapping",
        entityType: "db2_mapping",
        entityId: mapping.id,
        details: `Mapping v${mapping.version} salvo para dataset '${dataset}'`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json(mapping);
    } catch (error) {
      log(`[Routes] Save mapping error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/mapping/:id/activate", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const mapping = await storage.activateMapping(id);
      if (!mapping) {
        return res.status(404).json({ error: "Mapping não encontrado" });
      }

      const userId = req.user!.id;
      await storage.createAuditLog({
        userId,
        action: "activate_mapping",
        entityType: "db2_mapping",
        entityId: id as string,
        details: `Mapping v${mapping.version} ativado para dataset '${mapping.dataset}'`,
        ipAddress: getClientIp(req),
        userAgent: getUserAgent(req),
      });

      res.json(mapping);
    } catch (error) {
      log(`[Routes] Activate mapping error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/preview/:dataset", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const dataset = req.params.dataset as string;
      const contract = getDataContract(dataset);
      if (!contract) {
        return res.status(404).json({ error: "Dataset não encontrado" });
      }

      const { mappingJson } = req.body;
      if (!mappingJson || !Array.isArray(mappingJson)) {
        return res.status(400).json({ error: "mappingJson é obrigatório" });
      }

      const cachedRows = await storage.getCacheOrcamentosPreview(20);

      if (cachedRows.length === 0) {
        return res.json({
          preview: [],
          warnings: ["Nenhum dado no cache. Execute a sincronização DB2 primeiro."],
          errors: [],
        });
      }

      const preview: any[] = [];
      const errors: string[] = [];
      const warnings: string[] = [];

      const requiredFields = contract.filter(f => f.required).map(f => f.appField);
      const mappedRequiredFields = mappingJson
        .filter((m: MappingField) => requiredFields.includes(m.appField) && (m.dbExpression || m.defaultValue))
        .map((m: MappingField) => m.appField);

      for (const reqField of requiredFields) {
        if (!mappedRequiredFields.includes(reqField)) {
          errors.push(`Campo obrigatório '${reqField}' não mapeado`);
        }
      }

      for (const row of cachedRows) {
        const transformed: Record<string, any> = {};
        const rowObj = row as Record<string, any>;

        for (const mapping of mappingJson as MappingField[]) {
          const { appField, dbExpression, cast, defaultValue, type } = mapping;

          let value: any = null;

          if (dbExpression) {
            const colName = dbExpression.trim();
            const upperCol = colName.toUpperCase();
            const matchingKey = Object.keys(rowObj).find(k => k.toUpperCase() === upperCol);
            if (matchingKey) {
              value = rowObj[matchingKey];
            } else {
              const camelKey = Object.keys(rowObj).find(k => {
                const snake = k.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
                return snake.toUpperCase() === upperCol || k.toUpperCase() === upperCol;
              });
              if (camelKey) {
                value = rowObj[camelKey];
              }
            }
          }

          if (value === null || value === undefined || value === '') {
            value = defaultValue || null;
          }

          if (value !== null && cast) {
            switch (cast) {
              case "number":
                value = Number(value);
                break;
              case "string":
                value = String(value);
                break;
              case "divide_100":
                value = Number(value) / 100;
                break;
              case "divide_1000":
                value = Number(value) / 1000;
                break;
              case "boolean_T_F":
                value = value === "T" || value === "t";
                break;
            }
          }

          transformed[appField] = value;
        }

        preview.push(transformed);
      }

      res.json({ preview, errors, warnings });
    } catch (error) {
      log(`[Routes] Preview error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.get("/api/cache-columns", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const cachedRows = await storage.getCacheOrcamentosPreview(1);
      if (cachedRows.length === 0) {
        return res.json({ columns: [], message: "Nenhum dado no cache. Execute a sincronização DB2 primeiro." });
      }
      const row = cachedRows[0] as Record<string, any>;
      const columns = Object.keys(row).map(key => ({
        name: key,
        sampleValue: row[key],
      }));
      res.json({ columns });
    } catch (error) {
      log(`[Routes] Get cache columns error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/sql-query", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query SQL é obrigatória" });
      }

      const trimmed = query.trim().replace(/;+$/, "").trim();

      if (trimmed.includes(";")) {
        return res.status(400).json({ error: "Apenas uma consulta por vez é permitida." });
      }

      const upper = trimmed.toUpperCase().replace(/\s+/g, " ");
      const firstWord = upper.split(/\s/)[0];
      if (firstWord !== "SELECT" && firstWord !== "WITH" && firstWord !== "EXPLAIN") {
        return res.status(400).json({ error: `Comando "${firstWord}" não permitido. Apenas consultas SELECT, WITH e EXPLAIN são aceitas.` });
      }

      if (firstWord === "WITH") {
        let depth = 0;
        let mainKeyword = "";
        const tokens = upper.match(/\(|\)|\b\w+\b/g) || [];
        for (const token of tokens) {
          if (token === "(") depth++;
          else if (token === ")") depth--;
          else if (depth === 0 && ["SELECT", "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "MERGE", "TRUNCATE"].includes(token)) {
            mainKeyword = token;
            break;
          }
        }
        if (mainKeyword && mainKeyword !== "SELECT") {
          return res.status(400).json({ error: `Comando WITH...${mainKeyword} não permitido. Apenas WITH...SELECT é aceito.` });
        }
      }

      const startTime = Date.now();
      const result = await db.$client.execute(trimmed);
      const elapsed = Date.now() - startTime;

      const columns = result.columns || [];
      const rows = result.rows?.map(row => {
        const obj: Record<string, any> = {};
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      }) || [];

      res.json({
        columns,
        rows,
        rowCount: rows.length,
        elapsed,
      });
    } catch (error) {
      const rawMsg = getErrorMessage(error);
      log(`[Routes] SQL query error: ${rawMsg}`);
      const safeMsg = rawMsg.replace(/at\s+.*$/gm, "").trim() || "Erro ao executar consulta SQL";
      res.status(400).json({ error: safeMsg.length > 200 ? safeMsg.slice(0, 200) : safeMsg });
    }
  });

  app.post("/api/db2-query", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const { query } = req.body;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "Query SQL é obrigatória" });
      }

      // Use process.cwd() instead of fileURLToPath(import.meta.url) — CJS compat
      const scriptPath = path.resolve(process.cwd(), "db2_query.py");
      const QUERY_TIMEOUT = 120000;

      const result = await new Promise<string>((resolve, reject) => {
        const pythonCmd = process.platform === "win32" ? "python" : "python3";
        const proc = spawn(pythonCmd, [scriptPath], {
          cwd: process.cwd(),
        });

        let stdout = "";
        let stderr = "";
        let killed = false;

        const timer = setTimeout(() => {
          killed = true;
          proc.kill("SIGKILL");
          reject(new Error("Consulta excedeu o tempo limite de 2 minutos."));
        }, QUERY_TIMEOUT);

        proc.stdin.write(query);
        proc.stdin.end();

        proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
        proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

        proc.on("close", (code) => {
          clearTimeout(timer);
          if (killed) return;
          if (code !== 0 && !stdout.trim()) {
            reject(new Error(stderr || `Processo encerrado com código ${code}`));
          } else {
            resolve(stdout);
          }
        });

        proc.on("error", (err) => {
          clearTimeout(timer);
          reject(new Error(`Falha ao iniciar processo: ${err.message}`));
        });
      });

      const parsed = JSON.parse(result);
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }

      res.json(parsed);
    } catch (error) {
      const errMsg = getErrorMessage(error);
      log(`[Routes] DB2 query error: ${errMsg}`);
      res.status(400).json({ error: errMsg || "Erro ao executar consulta no DB2" });
    }
  });

  // ── Order Volumes ─────────────────────────────────────────────────────
  // GET /api/order-volumes — lista todos com dados do pedido e rota (supervisor/admin)
  app.get("/api/order-volumes", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { db: database } = await import("./db");
      const { sql: rawSql } = await import("drizzle-orm");
      const companyId = req.companyId;
      const rows = await database.execute(rawSql`
        SELECT
          ov.id,
          ov.order_id   AS "orderId",
          ov.erp_order_id AS "erpOrderId",
          ov.sacola,
          ov.caixa,
          ov.saco,
          ov.avulso,
          ov.total_volumes AS "totalVolumes",
          ov.created_at  AS "createdAt",
          ov.updated_at  AS "updatedAt",
          o.customer_name   AS "customerName",
          o.address,
          o.address_number  AS "addressNumber",
          o.neighborhood,
          o.city,
          o.state,
          r.code AS "routeCode",
          r.name AS "routeName",
          c.name AS "companyName"
        FROM order_volumes ov
        LEFT JOIN orders o ON o.id = ov.order_id
        LEFT JOIN routes r ON r.id = o.route_id
        LEFT JOIN companies c ON c.id::integer = o.company_id
        WHERE o.company_id = ${companyId}
        ORDER BY ov.created_at DESC
      `);
      res.json(rows.rows);
    } catch (error) {
      log(`[Routes] Get all volumes error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar volumes" });
    }
  });

  // GET /api/order-volumes/:orderId — busca volume de um pedido específico
  app.get("/api/order-volumes/:orderId", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const volume = await storage.getOrderVolume(req.params.orderId as string);
      res.json(volume || null);
    } catch (error) {
      log(`[Routes] Get order volume error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar volume do pedido" });
    }
  });

  // POST /api/order-volumes — cria ou atualiza volumes de um pedido
  app.post("/api/order-volumes", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const user = req.user;
      const { orderId, erpOrderId, sacola, caixa, saco, avulso } = req.body;

      if (!orderId || !erpOrderId) {
        return res.status(400).json({ error: "orderId e erpOrderId são obrigatórios" });
      }

      // Verificar se o pedido está em conferência
      const { db: database } = await import("./db");
      const { orders: ordersTable } = await import("@shared/schema");
      const { eq: eqFn } = await import("drizzle-orm");
      const [order] = await database.select().from(ordersTable).where(eqFn(ordersTable.id, orderId));
      if (!order) return res.status(404).json({ error: "Pedido não encontrado" });
      // Permite geração de volumes para qualquer pedido já lançado
      const blockedStatuses = ["pendente", "cancelado"];
      if (blockedStatuses.includes(order.status)) {
        return res.status(400).json({ error: "Não é possível gerar volumes para pedidos pendentes ou cancelados" });
      }


      const volume = await storage.upsertOrderVolume({
        orderId,
        erpOrderId,
        sacola: Number(sacola) || 0,
        caixa: Number(caixa) || 0,
        saco: Number(saco) || 0,
        avulso: Number(avulso) || 0,
        userId: user.id,
      });

      await storage.createAuditLog({
        userId: user.id,
        action: "upsert_order_volume",
        entityType: "order",
        entityId: orderId,
        details: `Volumes gerados: sacola=${sacola}, caixa=${caixa}, saco=${saco}, avulso=${avulso}`,
      });

      res.json(volume);
    } catch (error) {
      log(`[Routes] Upsert order volume error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao salvar volumes" });
    }
  });

  // DELETE /api/order-volumes/:orderId — remove volumes de um pedido
  app.delete("/api/order-volumes/:orderId", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      await storage.deleteOrderVolume(req.params.orderId as string);
      res.json({ ok: true });
    } catch (error) {
      log(`[Routes] Delete order volume error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao remover volumes" });
    }
  });

  // ─── Admin: Data Cleanup ──────────────────────────────────────────────────────

  // Counts per module for current company
  app.get("/api/admin/cleanup/counts", isAuthenticated, requireCompany, requireRole("administrador"), async (req: Request, res: Response) => {
    try {
      const companyId = req.companyId!;
      const { sql: rawSql } = await import("drizzle-orm");

      const safeCount = async (query: string) => {
        try {
          const result = await db.execute(rawSql.raw(query));
          return Number((result.rows?.[0] as any)?.count ?? 0);
        } catch (e) {
          log(`[Cleanup] Erro ao contar registros: ${e instanceof Error ? e.message : String(e)}`);
          return 0;
        }
      };

      const cid = Number(companyId);
      if (!Number.isInteger(cid) || cid <= 0) {
        return res.status(400).json({ error: "companyId inválido" });
      }
      const sanitizeUUID = (val: string) => val.replace(/[^a-f0-9\-]/gi, "").substring(0, 36);
      const safeUserId = sanitizeUUID(req.user?.id || "00000000");

      const counts = {
        pedidos: {
          orders: await safeCount(`SELECT COUNT(*) as count FROM orders WHERE company_id = ${cid}`),
          order_items: await safeCount(`SELECT COUNT(*) as count FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE company_id = ${cid})`),
          work_units: await safeCount(`SELECT COUNT(*) as count FROM work_units WHERE company_id = ${cid}`),
          exceptions: await safeCount(`SELECT COUNT(*) as count FROM exceptions WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE company_id = ${cid}))`),
          picking_sessions: await safeCount(`SELECT COUNT(*) as count FROM picking_sessions WHERE order_id IN (SELECT id FROM orders WHERE company_id = ${cid})`),
          order_volumes: await safeCount(`SELECT COUNT(*) as count FROM order_volumes WHERE order_id IN (SELECT id FROM orders WHERE company_id = ${cid})`),
          cache_orcamentos: await safeCount(`SELECT COUNT(*) as count FROM cache_orcamentos WHERE "IDEMPRESA" = ${cid}`),
        },
        usuarios: {
          users: await safeCount(`SELECT COUNT(*) as count FROM users WHERE id NOT IN (
            SELECT user_id FROM picking_sessions WHERE user_id IS NOT NULL
            UNION SELECT locked_by FROM work_units WHERE locked_by IS NOT NULL
            UNION SELECT reported_by FROM exceptions WHERE reported_by IS NOT NULL
            UNION SELECT authorized_by FROM exceptions WHERE authorized_by IS NOT NULL
            UNION SELECT user_id FROM audit_logs WHERE user_id IS NOT NULL
            UNION SELECT user_id FROM pallet_movements WHERE user_id IS NOT NULL
            UNION SELECT counted_by FROM counting_cycle_items WHERE counted_by IS NOT NULL
            UNION SELECT created_by FROM pallets WHERE created_by IS NOT NULL
            UNION SELECT cancelled_by FROM pallets WHERE cancelled_by IS NOT NULL
            UNION SELECT created_by FROM wms_addresses WHERE created_by IS NOT NULL
            UNION SELECT approved_by FROM counting_cycles WHERE approved_by IS NOT NULL
            UNION SELECT created_by FROM counting_cycles WHERE created_by IS NOT NULL
          ) AND id != '${safeUserId}'`),
        },
        recebimento: {
          nf_cache: await safeCount(`SELECT COUNT(*) as count FROM nf_cache WHERE company_id = ${cid}`),
          nf_items: await safeCount(`SELECT COUNT(*) as count FROM nf_items WHERE company_id = ${cid}`),
        },
        pallets: {
          pallets: await safeCount(`SELECT COUNT(*) as count FROM pallets WHERE company_id = ${cid}`),
          pallet_items: await safeCount(`SELECT COUNT(*) as count FROM pallet_items WHERE company_id = ${cid}`),
          pallet_movements: await safeCount(`SELECT COUNT(*) as count FROM pallet_movements WHERE company_id = ${cid}`),
        },
        contagens: {
          counting_cycles: await safeCount(`SELECT COUNT(*) as count FROM counting_cycles WHERE company_id = ${cid}`),
          counting_cycle_items: await safeCount(`SELECT COUNT(*) as count FROM counting_cycle_items WHERE company_id = ${cid}`),
        },
        enderecos: {
          wms_addresses: await safeCount(`SELECT COUNT(*) as count FROM wms_addresses WHERE company_id = ${cid}`),
          product_company_stock: await safeCount(`SELECT COUNT(*) as count FROM product_company_stock WHERE company_id = ${cid}`),
        },
        logs: {
          audit_logs: await safeCount(`SELECT COUNT(*) as count FROM audit_logs WHERE company_id = ${cid}`),
        },
        barcodes: {
          product_barcodes: await safeCount(`SELECT COUNT(*) as count FROM product_barcodes WHERE company_id = ${cid}`),
          barcode_change_history: await safeCount(`SELECT COUNT(*) as count FROM barcode_change_history WHERE barcode_id IN (SELECT id FROM product_barcodes WHERE company_id = ${cid})`),
        },
      };

      res.json(counts);
    } catch (error) {
      log(`[Routes] Cleanup counts error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao obter contagens" });
    }
  });

  // Execute cleanup for selected modules
  app.post("/api/admin/cleanup", isAuthenticated, requireCompany, requireRole("administrador"), async (req: Request, res: Response) => {
    try {
      const companyId = req.companyId!;
      const { modules, confirmation }: { modules: string[]; confirmation: string } = req.body;

      if (confirmation !== "LIMPAR DADOS") {
        return res.status(400).json({ error: "Confirmação inválida" });
      }
      if (!modules || !Array.isArray(modules) || modules.length === 0) {
        return res.status(400).json({ error: "Selecione ao menos um módulo" });
      }

      const validModules = ["pedidos", "usuarios", "recebimento", "pallets", "contagens", "enderecos", "logs", "barcodes"];
      const invalidMods = modules.filter(m => !validModules.includes(m));
      if (invalidMods.length > 0) {
        return res.status(400).json({ error: `Módulos inválidos: ${invalidMods.join(", ")}` });
      }

      const cid = Number(companyId);
      if (!Number.isInteger(cid) || cid <= 0) {
        return res.status(400).json({ error: "companyId inválido" });
      }
      const sanitizeUUID = (val: string) => val.replace(/[^a-f0-9\-]/gi, "").substring(0, 36);
      const deleted: Record<string, number> = {};

      const { sql: rawSql } = await import("drizzle-orm");

      await db.transaction(async (tx) => {
        const run = async (query: string, label: string) => {
          try {
            const result = await tx.execute(rawSql.raw(query));
            deleted[label] = (deleted[label] || 0) + ((result as any).rowCount ?? 0);
          } catch (e) {
            log(`[Cleanup] skip ${label}: ${e instanceof Error ? e.message : String(e)}`);
          }
        };

        if (modules.includes("pedidos")) {
          await run(`DELETE FROM exceptions WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE company_id = ${cid}))`, "exceptions");
          await run(`DELETE FROM picking_sessions WHERE order_id IN (SELECT id FROM orders WHERE company_id = ${cid})`, "picking_sessions");
          await run(`DELETE FROM work_units WHERE company_id = ${cid}`, "work_units");
          await run(`DELETE FROM order_volumes WHERE order_id IN (SELECT id FROM orders WHERE company_id = ${cid})`, "order_volumes");
          await run(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE company_id = ${cid})`, "order_items");
          await run(`DELETE FROM orders WHERE company_id = ${cid}`, "orders");
          await run(`DELETE FROM cache_orcamentos WHERE "IDEMPRESA" = ${cid}`, "cache_orcamentos");
        }

        if (modules.includes("usuarios")) {
          const safeCurrentUserId = sanitizeUUID(req.user?.id || "00000000");
          await run(`DELETE FROM users WHERE id NOT IN (
            SELECT user_id FROM picking_sessions WHERE user_id IS NOT NULL
            UNION SELECT locked_by FROM work_units WHERE locked_by IS NOT NULL
            UNION SELECT reported_by FROM exceptions WHERE reported_by IS NOT NULL
            UNION SELECT authorized_by FROM exceptions WHERE authorized_by IS NOT NULL
            UNION SELECT user_id FROM audit_logs WHERE user_id IS NOT NULL
            UNION SELECT user_id FROM pallet_movements WHERE user_id IS NOT NULL
            UNION SELECT counted_by FROM counting_cycle_items WHERE counted_by IS NOT NULL
            UNION SELECT created_by FROM pallets WHERE created_by IS NOT NULL
            UNION SELECT cancelled_by FROM pallets WHERE cancelled_by IS NOT NULL
            UNION SELECT created_by FROM wms_addresses WHERE created_by IS NOT NULL
            UNION SELECT approved_by FROM counting_cycles WHERE approved_by IS NOT NULL
            UNION SELECT created_by FROM counting_cycles WHERE created_by IS NOT NULL
          ) AND id != '${safeCurrentUserId}'`, "users");
        }

        if (modules.includes("recebimento")) {
          await run(`DELETE FROM nf_items WHERE company_id = ${cid}`, "nf_items");
          await run(`DELETE FROM nf_cache WHERE company_id = ${cid}`, "nf_cache");
        }

        if (modules.includes("contagens") || modules.includes("enderecos")) {
          await run(`DELETE FROM counting_cycle_items WHERE company_id = ${cid}`, "counting_cycle_items");
          await run(`DELETE FROM counting_cycles WHERE company_id = ${cid}`, "counting_cycles");
        }

        if (modules.includes("pallets") || modules.includes("enderecos")) {
          await run(`DELETE FROM pallet_movements WHERE company_id = ${cid}`, "pallet_movements");
          await run(`DELETE FROM pallet_items WHERE company_id = ${cid}`, "pallet_items");
          await run(`DELETE FROM pallets WHERE company_id = ${cid}`, "pallets");
        }

        if (modules.includes("enderecos")) {
          await run(`DELETE FROM product_company_stock WHERE company_id = ${cid}`, "product_company_stock");
          await run(`DELETE FROM wms_addresses WHERE company_id = ${cid}`, "wms_addresses");
        }

        if (modules.includes("logs")) {
          await run(`DELETE FROM audit_logs WHERE company_id = ${cid}`, "audit_logs");
        }

        if (modules.includes("barcodes")) {
          await run(`DELETE FROM barcode_change_history WHERE barcode_id IN (SELECT id FROM product_barcodes WHERE company_id = ${cid})`, "barcode_change_history");
          await run(`DELETE FROM product_barcodes WHERE company_id = ${cid}`, "product_barcodes");
        }
      });

      try {
        const userId = req.user?.id || "system";
        const details = JSON.stringify({ modules, deleted });
        await storage.createAuditLog({
          userId,
          companyId: cid,
          action: "cleanup",
          entityType: "system",
          entityId: "cleanup",
          details,
        });
      } catch (auditErr) {
        log(`[Cleanup] Falha ao registrar auditoria: ${auditErr instanceof Error ? auditErr.message : String(auditErr)}`);
      }

      res.json({ ok: true, deleted, modulesProcessed: modules });
    } catch (error) {
      log(`[Routes] Cleanup execution error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao executar limpeza" });
    }
  });

  // ─── Reports: Pallet Movements ───────────────────────────────────────────────
  app.get("/api/reports/pallet-movements", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const companyId = req.companyId!;
      const { palletMovements, pallets, wmsAddresses, users: usersTable } = await import("@shared/schema");
      const { and: andFn, eq: eqFn, gte, lte } = await import("drizzle-orm");

      const { type: typeFilter, dateFrom, dateTo } = req.query as Record<string, string>;

      const conditions: any[] = [eqFn(palletMovements.companyId, companyId)];
      if (typeFilter && typeFilter !== "all") conditions.push(eqFn(palletMovements.movementType, typeFilter as any));
      if (dateFrom) conditions.push(gte(palletMovements.createdAt, dateFrom));
      if (dateTo) conditions.push(lte(palletMovements.createdAt, dateTo + "T23:59:59"));

      const rows = await db.select({
        id: palletMovements.id,
        movementType: palletMovements.movementType,
        createdAt: palletMovements.createdAt,
        notes: palletMovements.notes,
        palletCode: pallets.code,
        fromAddressId: palletMovements.fromAddressId,
        toAddressId: palletMovements.toAddressId,
        userId: palletMovements.userId,
      })
        .from(palletMovements)
        .leftJoin(pallets, eqFn(pallets.id, palletMovements.palletId))
        .where(conditions.length > 1 ? andFn(...conditions) : conditions[0])
        .orderBy(palletMovements.createdAt);

      // Collect address and user IDs to resolve
      const addressIds = [...new Set([...rows.map(r => r.fromAddressId), ...rows.map(r => r.toAddressId)].filter(Boolean))] as string[];
      const userIds = [...new Set(rows.map(r => r.userId).filter(Boolean))] as string[];

      const addressMap: Record<string, string> = {};
      if (addressIds.length > 0) {
        const allAddrs = await db.select({ id: wmsAddresses.id, code: wmsAddresses.code }).from(wmsAddresses);
        allAddrs.forEach(a => { addressMap[a.id] = a.code; });
      }
      const userMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const allUsers = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
        allUsers.forEach(u => { userMap[u.id] = u.name; });
      }

      const movements = rows.map(r => ({
        id: r.id,
        movementType: r.movementType,
        createdAt: r.createdAt,
        notes: r.notes,
        palletCode: r.palletCode || "—",
        fromAddressCode: r.fromAddressId ? (addressMap[r.fromAddressId] || "—") : "—",
        toAddressCode: r.toAddressId ? (addressMap[r.toAddressId] || "—") : "—",
        performedByName: r.userId ? (userMap[r.userId] || "—") : "—",
      }));

      const movTypeLabels: Record<string, string> = {
        created: "Criado", allocated: "Alocação", transferred: "Transferência",
        split: "Divisão", cancelled: "Cancelamento", counted: "Contagem",
      };
      const byType: Record<string, number> = {};
      movements.forEach(m => { byType[m.movementType] = (byType[m.movementType] || 0) + 1; });
      const byTypeArr = Object.entries(byType).map(([type, count]) => ({ type, label: movTypeLabels[type] || type, count }));

      const byDayMap: Record<string, number> = {};
      movements.forEach(m => {
        const day = m.createdAt ? m.createdAt.slice(0, 10) : "?";
        byDayMap[day] = (byDayMap[day] || 0) + 1;
      });
      const byDay = Object.entries(byDayMap).map(([date, count]) => ({ date, count })).sort((a, b) => b.date.localeCompare(a.date));

      res.json({
        movements,
        summary: { totalMovements: movements.length, byType: byTypeArr, byDay },
      });
    } catch (error) {
      log(`[Routes] Report pallet movements error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao gerar relatório" });
    }
  });

  // ─── Reports: Counting Cycles ─────────────────────────────────────────────────
  app.get("/api/reports/counting-cycles", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const companyId = req.companyId!;
      const { countingCycles, countingCycleItems, wmsAddresses, users: usersTable, products } = await import("@shared/schema");
      const { and: andFn, eq: eqFn, gte, lte } = await import("drizzle-orm");

      const { status: statusFilter, dateFrom, dateTo } = req.query as Record<string, string>;

      const conditions: any[] = [eqFn(countingCycles.companyId, companyId)];
      if (statusFilter && statusFilter !== "all") conditions.push(eqFn(countingCycles.status, statusFilter as any));
      if (dateFrom) conditions.push(gte(countingCycles.createdAt, dateFrom));
      if (dateTo) conditions.push(lte(countingCycles.createdAt, dateTo + "T23:59:59"));

      const cycles = await db.select().from(countingCycles)
        .where(conditions.length > 1 ? andFn(...conditions) : conditions[0])
        .orderBy(countingCycles.createdAt);

      if (cycles.length === 0) {
        return res.json({ cycles: [], summary: { totalCycles: 0, byStatus: {}, totalDivergent: 0, totalItemsCounted: 0 } });
      }

      // Load all users, addresses, products for join
      const allUsers = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
      const userMap: Record<string, string> = {};
      allUsers.forEach(u => { userMap[u.id] = u.name; });

      const allAddrs = await db.select({ id: wmsAddresses.id, code: wmsAddresses.code }).from(wmsAddresses);
      const addrMap: Record<string, string> = {};
      allAddrs.forEach(a => { addrMap[a.id] = a.code; });

      const allProds = await db.select({ id: products.id, name: products.name, erpCode: products.erpCode }).from(products);
      const prodMap: Record<string, { name: string; erpCode: string }> = {};
      allProds.forEach(p => { prodMap[p.id] = { name: p.name, erpCode: p.erpCode || "" }; });

      const cycleIds = cycles.map(c => c.id);
      const { inArray } = await import("drizzle-orm");
      const items = cycleIds.length > 0
        ? await db.select().from(countingCycleItems).where(inArray(countingCycleItems.cycleId, cycleIds))
        : [];

      const itemsByCycle: Record<string, any[]> = {};
      items.forEach(item => {
        if (!itemsByCycle[item.cycleId]) itemsByCycle[item.cycleId] = [];
        itemsByCycle[item.cycleId].push({
          id: item.id,
          addressCode: item.addressId ? (addrMap[item.addressId] || "—") : "—",
          productName: item.productId ? (prodMap[item.productId]?.name || "—") : "—",
          productErpCode: item.productId ? (prodMap[item.productId]?.erpCode || "—") : "—",
          expectedQty: item.expectedQty,
          countedQty: item.countedQty,
          divergencePct: item.divergencePct,
          status: item.status,
          countedByName: item.countedBy ? (userMap[item.countedBy] || "—") : "—",
        });
      });

      const result = cycles.map(c => {
        const cItems = itemsByCycle[c.id] || [];
        const countedItems = cItems.filter(i => i.countedQty !== null).length;
        const divergentItems = cItems.filter(i => i.status === "divergente").length;
        const avgPct = divergentItems > 0
          ? Math.round((cItems.filter(i => i.divergencePct !== null).reduce((s, i) => s + Math.abs(Number(i.divergencePct)), 0) / divergentItems) * 100) / 100
          : 0;
        return {
          id: c.id,
          type: c.type,
          status: c.status,
          notes: c.notes,
          createdAt: c.createdAt,
          completedAt: c.completedAt,
          approvedAt: c.approvedAt,
          createdByName: c.createdBy ? (userMap[c.createdBy] || "—") : "—",
          approvedByName: c.approvedBy ? (userMap[c.approvedBy] || "—") : "—",
          totalItems: cItems.length,
          countedItems,
          divergentItems,
          avgDivergencePct: avgPct,
          items: cItems,
        };
      });

      const byStatus: Record<string, number> = {};
      result.forEach(c => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
      const totalDivergent = result.reduce((s, c) => s + c.divergentItems, 0);
      const totalItemsCounted = result.reduce((s, c) => s + c.countedItems, 0);

      res.json({ cycles: result, summary: { totalCycles: result.length, byStatus, totalDivergent, totalItemsCounted } });
    } catch (error) {
      log(`[Routes] Report counting cycles error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao gerar relatório" });
    }
  });

  // ==================== KPI Dashboard ====================
  app.get("/api/kpi/operators", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      // companyId: prefere o da sessão autenticada; aceita override via query param para admins multi-empresa
      const sessionCompanyId = req.companyId;
      const queryCompanyId   = req.query.companyId ? parseInt(req.query.companyId as string, 10) : NaN;

      // Valida que o usuário tem acesso à empresa solicitada
      if (!isNaN(queryCompanyId) && queryCompanyId > 0 && queryCompanyId !== sessionCompanyId) {
        const allowedCompanies = req.user?.allowedCompanies ?? [];
        if (req.user?.role !== "administrador" && allowedCompanies.length > 0 && !allowedCompanies.includes(queryCompanyId)) {
          return res.status(403).json({ error: "Empresa não autorizada" });
        }
      }

      const companyId = (!isNaN(queryCompanyId) && queryCompanyId > 0) ? queryCompanyId : (sessionCompanyId ?? 1);

      // Validação de formato de data (YYYY-MM-DD)
      const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const defaultTo   = new Date().toISOString().slice(0, 10);

      const rawFrom = (req.query.from as string) || defaultFrom;
      const rawTo   = (req.query.to   as string) || defaultTo;

      if (!ISO_DATE_RE.test(rawFrom) || !ISO_DATE_RE.test(rawTo)) {
        return res.status(400).json({ error: "Parâmetros de data inválidos. Use o formato YYYY-MM-DD." });
      }

      const from    = rawFrom <= rawTo ? rawFrom : rawTo;
      const to      = rawFrom <= rawTo ? rawTo   : rawFrom;
      const fromStr = from + "T00:00:00.000Z";
      const toStr   = to   + "T23:59:59.999Z";

      // 1) Work units por operador (separação e conferência)
      const wuRows = await db.execute(drizzleSql`
        SELECT
          wu.locked_by                                                AS user_id,
          u.name                                                      AS user_name,
          u.username,
          u.role,
          COUNT(*) FILTER (WHERE wu.type = 'separacao' AND wu.status = 'concluido')                AS secoes_separadas,
          COUNT(DISTINCT wu.order_id) FILTER (WHERE wu.type = 'separacao' AND wu.status = 'concluido') AS pedidos_unicos_sep,
          COUNT(*) FILTER (WHERE wu.type = 'conferencia' AND wu.status = 'concluido')              AS conf_concluidos,
          COUNT(*) FILTER (WHERE wu.type = 'separacao' AND wu.status = 'em_andamento')             AS sep_andamento,
          ROUND(AVG(
            CASE WHEN wu.status = 'concluido'
                      AND wu.type = 'separacao'
                      AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL
                      AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                             AS tempo_medio_sep_min,
          ROUND(AVG(
            CASE WHEN wu.status = 'concluido'
                      AND wu.type = 'conferencia'
                      AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL
                      AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                             AS tempo_medio_conf_min
        FROM work_units wu
        JOIN users u ON wu.locked_by = u.id
        WHERE wu.company_id = ${companyId}
          AND wu.locked_at IS NOT NULL
          AND wu.locked_at >= ${fromStr}
          AND wu.locked_at <= ${toStr}
        GROUP BY wu.locked_by, u.name, u.username, u.role
      `);

      // 2) Exceções por operador que as registrou
      const excRows = await db.execute(drizzleSql`
        SELECT
          e.reported_by                                              AS user_id,
          COUNT(*)                                                   AS total_excecoes,
          COUNT(*) FILTER (WHERE e.type = 'nao_encontrado')         AS nao_encontrado,
          COUNT(*) FILTER (WHERE e.type = 'avariado')               AS avariado,
          COUNT(*) FILTER (WHERE e.type = 'vencido')                AS vencido
        FROM exceptions e
        WHERE e.created_at >= ${fromStr}
          AND e.created_at <= ${toStr}
        GROUP BY e.reported_by
      `);

      // 3) Itens separados (qty_picked) via work_units concluídos de separação
      // Filtra por section E pickup_point para evitar dupla contagem de pedidos multi-seção
      const itemRows = await db.execute(drizzleSql`
        SELECT
          wu.locked_by                                               AS user_id,
          COUNT(DISTINCT wu.order_id)                                AS ordens_unicas,
          COUNT(oi.id)                                               AS total_itens,
          COALESCE(SUM(oi.qty_picked), 0)                           AS total_qty_picked,
          COALESCE(SUM(oi.quantity), 0)                             AS total_qty_esperada,
          COUNT(*) FILTER (WHERE oi.qty_picked > oi.quantity)       AS itens_excedidos
        FROM work_units wu
        JOIN order_items oi
          ON oi.order_id = wu.order_id
         AND oi.pickup_point = wu.pickup_point
         AND (wu.section IS NULL OR oi.section = wu.section)
        WHERE wu.type = 'separacao'
          AND wu.status = 'concluido'
          AND wu.company_id = ${companyId}
          AND wu.locked_at IS NOT NULL
          AND wu.locked_at >= ${fromStr}
          AND wu.locked_at <= ${toStr}
        GROUP BY wu.locked_by
      `);

      // 4) Volumes gerados por operador (conferência)
      const volRows = await db.execute(drizzleSql`
        SELECT
          ov.created_by                                              AS user_id,
          COUNT(*)                                                   AS pedidos_com_volume,
          COALESCE(SUM(ov.total_volumes), 0)                        AS total_volumes,
          COALESCE(SUM(ov.sacola), 0)                               AS sacolas,
          COALESCE(SUM(ov.caixa), 0)                                AS caixas,
          COALESCE(SUM(ov.saco), 0)                                 AS sacos,
          COALESCE(SUM(ov.avulso), 0)                               AS avulsos
        FROM order_volumes ov
        WHERE ov.created_at >= ${fromStr}
          AND ov.created_at <= ${toStr}
        GROUP BY ov.created_by
      `);

      // 5) Atividade diária por operador (separação + conferência)
      const dailyRows = await db.execute(drizzleSql`
        SELECT
          wu.locked_by                                               AS user_id,
          LEFT(wu.completed_at, 10)                                  AS dia,
          COUNT(*) FILTER (WHERE wu.type = 'separacao')             AS sep_dia,
          COUNT(*) FILTER (WHERE wu.type = 'conferencia')           AS conf_dia,
          ROUND(AVG(
            CASE WHEN wu.type = 'separacao'
                      AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL
                      AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                            AS tempo_medio_sep_dia
        FROM work_units wu
        WHERE wu.status = 'concluido'
          AND wu.company_id = ${companyId}
          AND wu.completed_at IS NOT NULL
          AND wu.completed_at >= ${fromStr}
          AND wu.completed_at <= ${toStr}
        GROUP BY wu.locked_by, LEFT(wu.completed_at, 10)
        ORDER BY dia ASC
      `);

      // 6) Estatísticas de tempo por operador (min, max, mediana)
      const timeStatsRows = await db.execute(drizzleSql`
        SELECT
          wu.locked_by                                               AS user_id,
          ROUND(MIN(
            CASE WHEN wu.type = 'separacao' AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                            AS tempo_min_sep_min,
          ROUND(MAX(
            CASE WHEN wu.type = 'separacao' AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                            AS tempo_max_sep_min,
          ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY
            CASE WHEN wu.type = 'separacao' AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                            AS tempo_p50_sep_min,
          ROUND(MIN(
            CASE WHEN wu.type = 'conferencia' AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                            AS tempo_min_conf_min,
          ROUND(MAX(
            CASE WHEN wu.type = 'conferencia' AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                            AS tempo_max_conf_min
        FROM work_units wu
        WHERE wu.status = 'concluido'
          AND wu.company_id = ${companyId}
          AND wu.locked_at IS NOT NULL
          AND wu.locked_at >= ${fromStr}
          AND wu.locked_at <= ${toStr}
        GROUP BY wu.locked_by
      `);

      // 7) Work units individuais com tempo (até 60 mais recentes por operador)
      const wuDetailRows = await db.execute(drizzleSql`
        SELECT
          wu.locked_by                                               AS user_id,
          wu.order_id,
          wu.type,
          wu.section,
          wu.completed_at,
          ROUND(
            EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
          ::numeric, 1)                                             AS duracao_min
        FROM work_units wu
        WHERE wu.status = 'concluido'
          AND wu.type IN ('separacao', 'conferencia')
          AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL
          AND wu.completed_at IS NOT NULL
          AND wu.company_id = ${companyId}
          AND wu.locked_at IS NOT NULL
          AND wu.locked_at >= ${fromStr}
          AND wu.locked_at <= ${toStr}
        ORDER BY wu.completed_at DESC
        LIMIT 600
      `);

      // 8) Gráfico global diário (todos os operadores agregados)
      const globalDailyRows = await db.execute(drizzleSql`
        SELECT
          LEFT(wu.completed_at, 10)                                  AS dia,
          COUNT(*) FILTER (WHERE wu.type = 'separacao')             AS sep,
          COUNT(*) FILTER (WHERE wu.type = 'conferencia')           AS conf,
          ROUND(AVG(
            CASE WHEN wu.type = 'separacao' AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                            AS tempo_medio_sep
        FROM work_units wu
        WHERE wu.status = 'concluido'
          AND wu.completed_at IS NOT NULL
          AND wu.company_id = ${companyId}
          AND wu.locked_at IS NOT NULL
          AND wu.locked_at >= ${fromStr}
          AND wu.locked_at <= ${toStr}
        GROUP BY LEFT(wu.completed_at, 10)
        ORDER BY dia ASC
      `);

      // Merge all data by userId
      const excMap = new Map(excRows.rows.map((r: any) => [r.user_id, r]));
      const itemMap = new Map(itemRows.rows.map((r: any) => [r.user_id, r]));
      const volMap = new Map(volRows.rows.map((r: any) => [r.user_id, r]));
      const timeStatsMap = new Map(timeStatsRows.rows.map((r: any) => [r.user_id, r]));
      const dailyMap = new Map<string, any[]>();
      for (const r of dailyRows.rows as any[]) {
        if (!dailyMap.has(r.user_id)) dailyMap.set(r.user_id, []);
        dailyMap.get(r.user_id)!.push({
          dia: r.dia,
          sep: Number(r.sep_dia),
          conf: Number(r.conf_dia),
          tempoMedioSep: r.tempo_medio_sep_dia !== null ? Number(r.tempo_medio_sep_dia) : null,
        });
      }

      // Group individual WU details by operator (max 50 per operator)
      const wuDetailMap = new Map<string, any[]>();
      for (const r of wuDetailRows.rows as any[]) {
        if (!wuDetailMap.has(r.user_id)) wuDetailMap.set(r.user_id, []);
        const arr = wuDetailMap.get(r.user_id)!;
        if (arr.length < 50) {
          arr.push({
            orderId: r.order_id,
            type: r.type,
            section: r.section,
            completedAt: r.completed_at,
            duracaoMin: r.duracao_min !== null ? Number(r.duracao_min) : null,
          });
        }
      }

      const operators = (wuRows.rows as any[]).map((wu) => {
        const exc  = excMap.get(wu.user_id)  || {};
        const item = itemMap.get(wu.user_id) || {};
        const vol  = volMap.get(wu.user_id)  || {};
        const daily = dailyMap.get(wu.user_id) || [];
        const ts = timeStatsMap.get(wu.user_id) || {};
        const wuDetail = wuDetailMap.get(wu.user_id) || [];

        const secoesSeparadas  = Number(wu.secoes_separadas  ?? 0);
        const pedidosUnicosSep = Number(wu.pedidos_unicos_sep ?? 0);
        const confConcluidos   = Number(wu.conf_concluidos  ?? 0);
        const totalExcecoes   = Number(exc.total_excecoes  ?? 0);
        const totalItens      = Number(item.total_itens    ?? 0);
        const totalQtyPicked  = Number(item.total_qty_picked  ?? 0);
        const taxaExcecao     = totalItens > 0 ? parseFloat(((totalExcecoes / totalItens) * 100).toFixed(1)) : 0;

        return {
          userId:           wu.user_id,
          userName:         wu.user_name,
          username:         wu.username,
          role:             wu.role,
          // Separação
          secoesSeparadas:     secoesSeparadas,
          pedidosUnicosSep:    pedidosUnicosSep,
          pedidosSeparados:    secoesSeparadas,
          pedidosAndamento:    Number(wu.sep_andamento ?? 0),
          tempoMedioSepMin:    wu.tempo_medio_sep_min !== null ? Number(wu.tempo_medio_sep_min) : null,
          tempoMinSepMin:      ts.tempo_min_sep_min !== null && ts.tempo_min_sep_min !== undefined ? Number(ts.tempo_min_sep_min) : null,
          tempoMaxSepMin:      ts.tempo_max_sep_min !== null && ts.tempo_max_sep_min !== undefined ? Number(ts.tempo_max_sep_min) : null,
          tempoP50SepMin:      ts.tempo_p50_sep_min !== null && ts.tempo_p50_sep_min !== undefined ? Number(ts.tempo_p50_sep_min) : null,
          // Conferência
          pedidosConferidos:   confConcluidos,
          tempoMedioConfMin:   wu.tempo_medio_conf_min !== null ? Number(wu.tempo_medio_conf_min) : null,
          tempoMinConfMin:     ts.tempo_min_conf_min !== null && ts.tempo_min_conf_min !== undefined ? Number(ts.tempo_min_conf_min) : null,
          tempoMaxConfMin:     ts.tempo_max_conf_min !== null && ts.tempo_max_conf_min !== undefined ? Number(ts.tempo_max_conf_min) : null,
          // Itens
          totalItens,
          totalQtyPicked,
          totalQtyEsperada:    Number(item.total_qty_esperada ?? 0),
          itensExcedidos:      Number(item.itens_excedidos ?? 0),
          // Exceções
          totalExcecoes,
          taxaExcecao,
          excNaoEncontrado:    Number(exc.nao_encontrado ?? 0),
          excAvariado:         Number(exc.avariado ?? 0),
          excVencido:          Number(exc.vencido  ?? 0),
          // Volumes (conferência)
          pedidosComVolume:    Number(vol.pedidos_com_volume ?? 0),
          totalVolumes:        Number(vol.total_volumes ?? 0),
          // Atividade diária
          diario:              daily,
          // Work units individuais
          workUnitsDetalhe:    wuDetail,
        };
      });

      // Ordenar por pedidos separados desc
      operators.sort((a, b) => b.pedidosSeparados - a.pedidosSeparados);

      const dailyGlobal = (globalDailyRows.rows as any[]).map((r: any) => ({
        dia: r.dia,
        sep: Number(r.sep ?? 0),
        conf: Number(r.conf ?? 0),
        tempoMedioSep: r.tempo_medio_sep !== null ? Number(r.tempo_medio_sep) : null,
      }));

      res.json({ operators, from, to, companyId, dailyGlobal });
    } catch (error) {
      log(`KPI operators error: ${(error as Error).message}`, "error");
      res.status(500).json({ error: "Erro ao gerar KPIs" });
    }
  });

  // ── Print Agents ──────────────────────────────────────────────────────────
  app.get("/api/print-agents", isAuthenticated, requireCompany, requireRole("administrador"), async (req: Request, res: Response) => {
    try {
      const { printAgents: agentsTable } = await import("@shared/schema");
      const { eq: eqFn } = await import("drizzle-orm");
      const companyId = req.companyId!;
      const records = await db.select({
        id: agentsTable.id,
        name: agentsTable.name,
        machineId: agentsTable.machineId,
        active: agentsTable.active,
        createdAt: agentsTable.createdAt,
        lastSeenAt: agentsTable.lastSeenAt,
      }).from(agentsTable).where(eqFn(agentsTable.companyId, companyId));
      const connected = getConnectedAgents(companyId);
      const result = records.map(r => ({
        ...r,
        online: connected.some(c => c.agentId === r.id),
        printers: connected.find(c => c.agentId === r.id)?.printers ?? [],
        lastPing: connected.find(c => c.agentId === r.id)?.lastPing ?? null,
      }));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "Erro ao buscar agentes" });
    }
  });

  app.post("/api/print-agents", isAuthenticated, requireCompany, requireRole("administrador"), async (req: Request, res: Response) => {
    try {
      const { printAgents: agentsTable } = await import("@shared/schema");
      const companyId = req.companyId!;
      const { name } = req.body as { name: string };
      if (!name?.trim()) return res.status(400).json({ error: "Nome obrigatório" });

      // Gera token aleatório (64 hex chars) — retornado UMA VEZ ao admin
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      const [agent] = await db.insert(agentsTable).values({
        id: crypto.randomUUID(),
        companyId,
        name: name.trim(),
        machineId: "",
        tokenHash,
        active: true,
        createdAt: new Date().toISOString(),
      }).returning();

      res.status(201).json({ ...agent, token, tokenHash: undefined });
    } catch (err) {
      res.status(500).json({ error: "Erro ao criar agente" });
    }
  });

  app.delete("/api/print-agents/:id", isAuthenticated, requireCompany, requireRole("administrador"), async (req: Request, res: Response) => {
    try {
      const { printAgents: agentsTable } = await import("@shared/schema");
      const { eq: eqFn, and: andFn } = await import("drizzle-orm");
      const companyId = req.companyId!;
      await db.delete(agentsTable).where(andFn(eqFn(agentsTable.id, req.params.id), eqFn(agentsTable.companyId, companyId)));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Erro ao remover agente" });
    }
  });

  app.post("/api/print-agents/:id/regenerate-token", isAuthenticated, requireCompany, requireRole("administrador"), async (req: Request, res: Response) => {
    try {
      const { printAgents: agentsTable } = await import("@shared/schema");
      const { eq: eqFn, and: andFn } = await import("drizzle-orm");
      const companyId = req.companyId!;
      const [current] = await db.select().from(agentsTable).where(andFn(eqFn(agentsTable.id, req.params.id), eqFn(agentsTable.companyId, companyId))).limit(1);
      if (!current) return res.status(404).json({ error: "Agente não encontrado" });
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await db.update(agentsTable).set({ tokenHash }).where(eqFn(agentsTable.id, req.params.id));
      res.json({ token, id: current.id, name: current.name });
    } catch (err) {
      res.status(500).json({ error: "Erro ao regenerar token" });
    }
  });

  app.patch("/api/print-agents/:id/toggle", isAuthenticated, requireCompany, requireRole("administrador"), async (req: Request, res: Response) => {
    try {
      const { printAgents: agentsTable } = await import("@shared/schema");
      const { eq: eqFn, and: andFn } = await import("drizzle-orm");
      const companyId = req.companyId!;
      const [current] = await db.select().from(agentsTable).where(andFn(eqFn(agentsTable.id, req.params.id), eqFn(agentsTable.companyId, companyId))).limit(1);
      if (!current) return res.status(404).json({ error: "Agente não encontrado" });
      await db.update(agentsTable).set({ active: !current.active }).where(eqFn(agentsTable.id, req.params.id));
      res.json({ success: true, active: !current.active });
    } catch (err) {
      res.status(500).json({ error: "Erro ao atualizar agente" });
    }
  });

  // ── Tempo por Seção (KPI) ────────────────────────────────────────────────
  app.get("/api/kpi/section-times", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const sessionCompanyId = req.companyId;
      const queryCompanyId   = req.query.companyId ? parseInt(req.query.companyId as string, 10) : NaN;
      if (!isNaN(queryCompanyId) && queryCompanyId > 0 && queryCompanyId !== sessionCompanyId) {
        const allowedCompanies = req.user?.allowedCompanies ?? [];
        if (req.user?.role !== "administrador" && allowedCompanies.length > 0 && !allowedCompanies.includes(queryCompanyId)) {
          return res.status(403).json({ error: "Empresa não autorizada" });
        }
      }
      const companyId = (!isNaN(queryCompanyId) && queryCompanyId > 0) ? queryCompanyId : (sessionCompanyId ?? 1);

      const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const defaultTo   = new Date().toISOString().slice(0, 10);
      const rawFrom = (req.query.from as string) || defaultFrom;
      const rawTo   = (req.query.to   as string) || defaultTo;
      if (!ISO_DATE_RE.test(rawFrom) || !ISO_DATE_RE.test(rawTo)) {
        return res.status(400).json({ error: "Parâmetros de data inválidos. Use o formato YYYY-MM-DD." });
      }
      const from    = rawFrom <= rawTo ? rawFrom : rawTo;
      const to      = rawFrom <= rawTo ? rawTo   : rawFrom;
      const fromStr = from + "T00:00:00.000Z";
      const toStr   = to   + "T23:59:59.999Z";

      const rows = await db.execute(drizzleSql`
        SELECT
          COALESCE(wu.section, 'Sem Seção')                          AS section,
          s.name                                                      AS section_name,
          COUNT(*) FILTER (WHERE wu.type = 'separacao' AND wu.status = 'concluido')  AS sep_count,
          ROUND(AVG(
            CASE WHEN wu.type = 'separacao' AND wu.status = 'concluido'
                      AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                             AS avg_sep_min,
          ROUND(MIN(
            CASE WHEN wu.type = 'separacao' AND wu.status = 'concluido'
                      AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                             AS min_sep_min,
          ROUND(MAX(
            CASE WHEN wu.type = 'separacao' AND wu.status = 'concluido'
                      AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                             AS max_sep_min,
          COUNT(*) FILTER (WHERE wu.type = 'conferencia' AND wu.status = 'concluido') AS conf_count,
          ROUND(AVG(
            CASE WHEN wu.type = 'conferencia' AND wu.status = 'concluido'
                      AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                             AS avg_conf_min,
          ROUND(MIN(
            CASE WHEN wu.type = 'conferencia' AND wu.status = 'concluido'
                      AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                             AS min_conf_min,
          ROUND(MAX(
            CASE WHEN wu.type = 'conferencia' AND wu.status = 'concluido'
                      AND COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            END
          )::numeric, 1)                                             AS max_conf_min
        FROM work_units wu
        LEFT JOIN sections s ON s.id::text = wu.section
        WHERE wu.company_id = ${companyId}
          AND wu.completed_at IS NOT NULL
          AND wu.completed_at >= ${fromStr}
          AND wu.completed_at <= ${toStr}
        GROUP BY wu.section, s.name
        ORDER BY wu.section ASC NULLS LAST
      `);

      const sections = (rows.rows as any[]).map(r => ({
        section:     r.section,
        sectionName: r.section_name ?? null,
        sepCount:   Number(r.sep_count  || 0),
        avgSepMin:  r.avg_sep_min  !== null ? Number(r.avg_sep_min)  : null,
        minSepMin:  r.min_sep_min  !== null ? Number(r.min_sep_min)  : null,
        maxSepMin:  r.max_sep_min  !== null ? Number(r.max_sep_min)  : null,
        confCount:  Number(r.conf_count || 0),
        avgConfMin: r.avg_conf_min !== null ? Number(r.avg_conf_min) : null,
        minConfMin: r.min_conf_min !== null ? Number(r.min_conf_min) : null,
        maxConfMin: r.max_conf_min !== null ? Number(r.max_conf_min) : null,
      }));

      res.json({ sections, from, to, companyId });
    } catch (error) {
      log(`[Routes] KPI section-times error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // ── Tempo por Seção de um pedido específico (busca por erpOrderId) ──────────
  app.get("/api/kpi/order-section-times", isAuthenticated, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const erpOrderId       = (req.query.erpOrderId as string | undefined)?.trim();
      const sessionCompanyId = req.companyId;
      const queryCompanyId   = req.query.companyId ? parseInt(req.query.companyId as string, 10) : NaN;
      if (!isNaN(queryCompanyId) && queryCompanyId > 0 && queryCompanyId !== sessionCompanyId) {
        const allowedCompanies = req.user?.allowedCompanies ?? [];
        if (req.user?.role !== "administrador" && allowedCompanies.length > 0 && !allowedCompanies.includes(queryCompanyId)) {
          return res.status(403).json({ error: "Empresa não autorizada" });
        }
      }
      const companyId = (!isNaN(queryCompanyId) && queryCompanyId > 0) ? queryCompanyId : (sessionCompanyId ?? 1);

      if (!erpOrderId) return res.status(400).json({ error: "erpOrderId obrigatório" });

      // Busca pedido pelo número do ERP
      const orderRows = await db.execute(drizzleSql`
        SELECT id, erp_order_id, customer_name, status
        FROM orders
        WHERE erp_order_id = ${erpOrderId}
          AND company_id = ${companyId}
        LIMIT 1
      `);

      if (!orderRows.rows.length) {
        return res.status(404).json({ error: "Pedido não encontrado" });
      }

      const order = orderRows.rows[0] as any;

      // Work units desse pedido
      const wuRows = await db.execute(drizzleSql`
        SELECT
          wu.type,
          wu.section,
          wu.status,
          wu.locked_at,
          wu.started_at,
          wu.completed_at,
          u.name AS operator_name,
          CASE WHEN COALESCE(wu.started_at, wu.locked_at) IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN ROUND(
              EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - COALESCE(wu.started_at, wu.locked_at)::timestamptz)) / 60.0
            ::numeric, 1)
            ELSE NULL
          END AS duracao_min
        FROM work_units wu
        LEFT JOIN users u ON wu.locked_by = u.id
        WHERE wu.order_id = ${order.id}
          AND wu.company_id = ${companyId}
        ORDER BY wu.type ASC, wu.section ASC NULLS LAST, wu.created_at ASC
      `);

      // Separa work units de separação (por seção) dos de conferência
      const sepSectionMap: Record<string, { section: string; wus: any[] }> = {};
      const confWus: any[] = [];

      for (const r of wuRows.rows as any[]) {
        const wu = {
          type:         r.type,
          status:       r.status,
          operatorName: r.operator_name || null,
          startedAt:    r.started_at || r.locked_at,
          completedAt:  r.completed_at,
          duracaoMin:   r.duracao_min !== null ? Number(r.duracao_min) : null,
        };
        if (r.type === "conferencia") {
          confWus.push(wu);
        } else {
          const key = r.section || "Sem seção";
          if (!sepSectionMap[key]) sepSectionMap[key] = { section: key, wus: [] };
          sepSectionMap[key].wus.push(wu);
        }
      }

      // Monta resposta final com separação e conferência claramente separados
      const sections = Object.values(sepSectionMap);

      return res.json({
        order: {
          erpOrderId:   order.erp_order_id,
          customerName: order.customer_name,
          status:       order.status,
        },
        sections,
        conferencia: confWus,
      });
    } catch (error) {
      log(`[Routes] KPI order-section-times error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  // ── Work Units de um pedido (para detalhes de tempo) ─────────────────────
  app.get("/api/orders/:id/work-units", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const orderId   = req.params.id as string;
      const companyId = req.companyId!;

      const rows = await db.execute(drizzleSql`
        SELECT
          wu.id,
          wu.order_id,
          wu.type,
          wu.section,
          wu.pickup_point,
          wu.status,
          wu.started_at,
          wu.completed_at,
          wu.locked_by,
          u.name                                                         AS operator_name,
          CASE WHEN wu.started_at IS NOT NULL AND wu.completed_at IS NOT NULL
            THEN ROUND(
              EXTRACT(EPOCH FROM (wu.completed_at::timestamptz - wu.started_at::timestamptz)) / 60.0
            ::numeric, 1)
            ELSE NULL
          END                                                            AS duracao_min
        FROM work_units wu
        LEFT JOIN users u ON wu.locked_by = u.id
        WHERE wu.order_id = ${orderId}
          AND wu.company_id = ${companyId}
        ORDER BY wu.section ASC NULLS LAST, wu.type ASC, wu.created_at ASC
      `);

      const wus = (rows.rows as any[]).map(r => ({
        id:           r.id,
        type:         r.type,
        section:      r.section,
        pickupPoint:  r.pickup_point,
        status:       r.status,
        startedAt:    r.started_at,
        completedAt:  r.completed_at,
        operatorName: r.operator_name || null,
        duracaoMin:   r.duracao_min !== null ? Number(r.duracao_min) : null,
      }));

      res.json(wus);
    } catch (error) {
      log(`[Routes] Order work-units error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  registerWmsRoutes(app);
  registerPrintRoutes(app);

  return httpServer;
}
