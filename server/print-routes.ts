import type { Express, Request, Response } from "express";
import { isAuthenticated, requireRole } from "./auth";
import { storage } from "./storage";
import { execFile } from "child_process";
import os from "os";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { log } from "./log";
// pdf-to-printer: usa SumatraPDF no Windows — impressão silenciosa sem abrir janela
import pdfToPrinter from "pdf-to-printer";
import { getAgentPrinters, isAgentPrinter, parseAgentPrinter, printViaAgent } from "./print-agent";
import { db } from "./db";
import { printAgents as printAgentsTable } from "@shared/schema";
import { eq as eqFn } from "drizzle-orm";

const IS_WIN = process.platform === "win32";

interface PrinterInfo {
  name: string;
  isDefault: boolean;
  status: string;
}

/** Cache de impressoras em memória — atualizado na inicialização e a cada sync */
let printerCache: PrinterInfo[] | null = null;

/** Fallback: lista impressoras via PowerShell simples (Get-Printer), sem depender do parser da biblioteca */
async function getPrintersFallbackWindows(): Promise<PrinterInfo[]> {
  const { promisify } = await import("util");
  const execFileAsync = promisify((await import("child_process")).execFile);
  try {
    const { stdout: namesOut } = await execFileAsync("Powershell.exe", [
      "-NoProfile", "-Command",
      "Get-Printer | Select-Object -ExpandProperty Name",
    ]);
    const { stdout: defOut } = await execFileAsync("Powershell.exe", [
      "-NoProfile", "-Command",
      "try { (Get-CimInstance Win32_Printer -Filter 'Default=true').Name } catch { '' }",
    ]).catch(() => ({ stdout: "" }));
    const defName = (defOut || "").trim();
    return namesOut
      .split(/\r?\n/)
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => ({ name, isDefault: name === defName, status: "ready" }));
  } catch {
    return [];
  }
}

/** Busca impressoras do sistema operacional e atualiza o cache */
export async function refreshPrinterCache(): Promise<void> {
  if (!IS_WIN) {
    log("AVISO: não foi possível listar impressoras — Operating System not supported", "print");
    if (!printerCache) printerCache = [];
    return;
  }
  try {
    const [rawPrinters, rawDefault] = await Promise.all([
      pdfToPrinter.getPrinters(),
      pdfToPrinter.getDefaultPrinter().catch(() => null),
    ]);
    const extractName = (p: any): string =>
      typeof p === "string" ? p.trim() : String(p?.name ?? p?.deviceId ?? "").trim();
    const defName = extractName(rawDefault);
    printerCache = (rawPrinters as any[])
      .map((p) => ({ name: extractName(p), isDefault: extractName(p) === defName, status: "ready" }))
      .filter((p) => p.name);
    if (printerCache.length > 0) {
      const def = printerCache.find((p) => p.isDefault)?.name ?? printerCache[0].name;
      log(`${printerCache.length} impressora(s) carregada(s) | padrão: "${def}"`, "print");
    }
  } catch (e) {
    // Biblioteca pdf-to-printer pode falhar quando impressoras têm propriedades vazias (bug do parser)
    // Tentamos um fallback via PowerShell simples (Get-Printer) que é mais robusto
    log(`pdf-to-printer falhou (${e instanceof Error ? e.message : String(e)}), tentando fallback PowerShell...`, "print");
    try {
      printerCache = await getPrintersFallbackWindows();
      if (printerCache.length > 0) {
        const def = printerCache.find((p) => p.isDefault)?.name ?? printerCache[0].name;
        log(`${printerCache.length} impressora(s) carregada(s) via fallback | padrão: "${def}"`, "print");
      } else {
        log("Nenhuma impressora encontrada via fallback", "print");
        printerCache = [];
      }
    } catch (e2) {
      log(`AVISO: não foi possível listar impressoras — ${getErrorMessage(e2)}`, "print");
      if (!printerCache) printerCache = [];
    }
  }
}

/** Localiza executável do Chrome ou Edge */
function findBrowserExe(): string | null {
  const candidates = IS_WIN
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      ]
    : [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
      ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function cleanup(...files: string[]) {
  for (const f of files) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
}

/** Tenta gerar PDF via headless Chrome/Edge.
 *  Chrome 112+ exige --headless=old para --print-to-pdf funcionar. */
async function generatePdf(browserPath: string, fileUrl: string, pdfPath: string): Promise<{ success: boolean; error?: string }> {
  const baseArgs = [
    "--disable-gpu", "--no-sandbox",
    "--disable-dev-shm-usage", "--disable-extensions",
    `--print-to-pdf=${pdfPath}`,
    "--print-to-pdf-no-header",
    "--no-pdf-header-footer",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=5000",
    fileUrl,
  ];

  // Tenta --headless=old primeiro (Chrome 112+), depois --headless (Chrome antigo)
  for (const flag of ["--headless=old", "--headless"]) {
    try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch {}

    const ok = await new Promise<boolean>((res) => {
      execFile(browserPath, [flag, ...baseArgs], { timeout: 45_000 }, (err, _stdout, stderr) => {
        const exists = fs.existsSync(pdfPath);
        const size = exists ? fs.statSync(pdfPath).size : 0;
        const generated = !err && exists && size > 0;
        if (!generated && stderr) {
          log(`[pdf] Chrome ${flag} falhou: ${stderr.slice(0, 200)}`, "print");
        }
        res(generated);
      });
    });

    if (ok) return { success: true };
  }

  return { success: false, error: "Falha ao gerar PDF. Verifique se Chrome ou Edge está atualizado." };
}

/** Imprime HTML em uma impressora local do servidor via headless Chrome + pdf-to-printer */
async function printHtmlToPrinter(
  html: string,
  printerName: string,
  copies: number,
  user: string
): Promise<{ success: boolean; error?: string }> {
  const tmpDir  = os.tmpdir();
  const jobId   = crypto.randomUUID().slice(0, 8);
  const htmlPath = path.join(tmpDir, `stoker_${jobId}.html`);
  const pdfPath  = path.join(tmpDir, `stoker_${jobId}.pdf`);

  log(`#${jobId} "${printerName}" x${copies} (${user})`, "print");

  try {
    fs.writeFileSync(htmlPath, html, "utf-8");

    const browser = findBrowserExe();
    if (!browser) {
      return { success: false, error: "Chrome ou Edge não encontrado nesta máquina." };
    }

    const fileUrl = IS_WIN
      ? `file:///${htmlPath.replace(/\\/g, "/")}`
      : `file://${htmlPath}`;

    const pdfResult = await generatePdf(browser, fileUrl, pdfPath);
    if (!pdfResult.success) return pdfResult;

    const n = Math.max(1, Math.min(copies, 99));
    for (let i = 0; i < n; i++) {
      await pdfToPrinter.print(pdfPath, { printer: printerName, scale: "noscale" });
    }

    log(`#${jobId} ✓ "${printerName}"`, "print");
    return { success: true };

  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    log(`#${jobId} ERRO: ${errMsg}`, "print");
    return { success: false, error: `Erro ao imprimir: ${errMsg}` };
  } finally {
    setTimeout(() => cleanup(htmlPath, pdfPath), 10_000);
  }
}

function resolveUsername(req: Request): string {
  const user = req.user;
  return user?.username ?? user?.name ?? "desconhecido";
}

export function registerPrintRoutes(app: Express) {
  /** Lista impressoras disponíveis: locais do servidor + agentes conectados */
  app.get("/api/print/printers", isAuthenticated, async (req: Request, res: Response) => {
    if (!printerCache) await refreshPrinterCache();
    const localPrinters = printerCache ?? [];
    const defaultPrinter = localPrinters.find((p) => p.isDefault)?.name ?? localPrinters[0]?.name ?? null;

    const companyId = req.companyId;

    // Impressoras de agentes online (em memória)
    const onlineAgentPrinters = companyId ? getAgentPrinters(companyId) : [];
    const onlineNames = new Set(onlineAgentPrinters.map(p => p.name));

    // Impressoras de agentes offline (persistidas no banco)
    let offlineAgentPrinters: Array<{ name: string; isDefault: boolean; status: string; agentName: string; machineId: string; online: boolean }> = [];
    if (companyId) {
      try {
        const records = await db.select({
          id: printAgentsTable.id,
          name: printAgentsTable.name,
          machineId: printAgentsTable.machineId,
          printers: printAgentsTable.printers,
          active: printAgentsTable.active,
        }).from(printAgentsTable).where(eqFn(printAgentsTable.companyId, companyId));

        // IDs das máquinas dos agentes já representados como online
        const onlineAgentIds = new Set(onlineAgentPrinters.map(p => p.machineId));

        for (const rec of records) {
          if (!rec.active || !rec.printers || !rec.machineId) continue;
          if (onlineAgentIds.has(rec.machineId)) continue; // agente online, já incluído
          try {
            const pList = JSON.parse(rec.printers);
            if (!Array.isArray(pList)) continue;
            for (const p of pList) {
              const printerName = String(p?.name ?? "").trim();
              if (!printerName) continue;
              const fullName = `${rec.machineId}\\${printerName}`;
              if (!onlineNames.has(fullName)) {
                offlineAgentPrinters.push({
                  name: fullName,
                  isDefault: false,
                  status: "agent-offline",
                  agentName: rec.name,
                  machineId: rec.machineId,
                  online: false,
                });
              }
            }
          } catch (parseErr) {
            log(`[printers] Erro ao parsear impressoras do agente "${rec.name}": ${getErrorMessage(parseErr)}`, "print");
          }
        }
      } catch (dbErr) {
        log(`[printers] Erro ao buscar agentes offline: ${getErrorMessage(dbErr)}`, "print");
      }
    }

    const allPrinters = [
      ...localPrinters,
      ...onlineAgentPrinters.map(p => ({
        name: p.name,
        isDefault: false,
        status: "agent-online",
        agentName: p.agentName,
        machineId: p.machineId,
        online: true,
      })),
      ...offlineAgentPrinters,
    ];

    res.json({ success: true, default_printer: defaultPrinter, printers: allPrinters });
  });

  app.get("/api/print/label-template-resolve", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const context = String(req.query.context || "");
      const companyId = (req as any).companyId;
      if (!context || !companyId) {
        res.json({ template: null });
        return;
      }
      const assignment = await storage.getLabelDefaultAssignment(context as any, companyId);
      if (!assignment?.templateId) {
        res.json({ template: null });
        return;
      }
      const template = await storage.getLabelTemplateById(assignment.templateId, companyId);
      if (!template || !template.active) {
        res.json({ template: null });
        return;
      }
      res.json({ template });
    } catch (e: any) {
      res.json({ template: null });
    }
  });

  /** Envia trabalho de impressão.
   *  - Impressoras locais: responde 202 e executa Chrome em background.
   *  - Impressoras de agente (MACHINE\\Printer): roteia via WebSocket. */
  app.post("/api/print/job", isAuthenticated, async (req: Request, res: Response) => {
    const { html, printer, copies = 1, template, data } = req.body as {
      html?: string;
      printer: string;
      copies?: number;
      template?: string;
      data?: Record<string, unknown>;
    };

    const hasTemplate = template && data;
    const hasHtml = !!html;

    if (!printer || (!hasTemplate && !hasHtml)) {
      res.status(400).json({ success: false, error: "Campos obrigatórios: printer + (template+data ou html)" });
      return;
    }

    const username = resolveUsername(req);

    if (isAgentPrinter(printer)) {
      const parsed = parseAgentPrinter(printer);
      if (!parsed) {
        res.status(400).json({ success: false, error: "Nome de impressora de agente inválido." });
        return;
      }

      const companyId = req.companyId;
      if (!companyId) {
        res.status(400).json({ success: false, error: "Empresa não identificada." });
        return;
      }

      res.status(202).json({ success: true, queued: true, agent: parsed.machineId });

      const payload = hasTemplate ? { template, data } : { html };

      printViaAgent(
        companyId,
        parsed.machineId,
        parsed.printer,
        Math.max(1, Math.min(copies, 99)),
        username,
        payload as { html?: string; template?: string; data?: Record<string, unknown> }
      ).catch((err: Error) => {
        log(`[agent] Erro em background: ${err.message}`, "print");
      });
      return;
    }

    // ── Impressora local do servidor ───────────────────────────────────────
    if (!hasHtml) {
      res.status(400).json({ success: false, error: "Impressora local só suporta HTML. Templates (ReportLab) requerem agente." });
      return;
    }

    res.status(202).json({ success: true, queued: true });

    printHtmlToPrinter(
      html!,
      printer,
      Math.max(1, Math.min(copies, 99)),
      username
    ).catch((err: unknown) => {
      log(`[print] Erro em background: ${getErrorMessage(err)}`, "print");
    });
  });

  /** Retorna a config de impressoras do usuário logado */
  app.get("/api/print/config", isAuthenticated, async (req: Request, res: Response) => {
    const userId = req.user?.id as string;
    const user = await storage.getUser(userId);
    const printConfig = (user?.settings as any)?.printConfig ?? {};
    res.json({ success: true, printConfig });
  });

  /** Retorna a config de impressoras de um usuário específico (admin) */
  app.get("/api/print/config/:userId", isAuthenticated, requireRole("administrador"), async (req: Request, res: Response) => {
    const user = await storage.getUser(req.params.userId);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    const printConfig = (user.settings as any)?.printConfig ?? {};
    res.json({ success: true, printConfig });
  });

  /** Salva a config de impressoras de um usuário específico (admin) */
  app.put("/api/print/config/:userId", isAuthenticated, requireRole("administrador"), async (req: Request, res: Response) => {
    const { printConfig } = req.body as { printConfig: Record<string, { printer: string; copies: number }> };
    if (!printConfig || typeof printConfig !== "object") {
      return res.status(400).json({ error: "printConfig inválido" });
    }
    const user = await storage.getUser(req.params.userId);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    const currentSettings = (user.settings as any) ?? {};
    await storage.updateUser(req.params.userId, {
      settings: { ...currentSettings, printConfig },
    } as any);
    res.json({ success: true });
  });
}
