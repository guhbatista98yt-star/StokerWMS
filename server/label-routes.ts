import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { isAuthenticated } from "./auth";
import {
  insertLabelTemplateSchema,
  labelContextEnum,
  type LabelContext,
  type LabelLayout,
} from "@shared/schema";

const baseFields = {
  id: z.string().min(1),
  x: z.number().min(-1000).max(1000),
  y: z.number().min(-1000).max(1000),
  width: z.number().min(0.1).max(2000),
  height: z.number().min(0.1).max(2000),
  rotation: z.number().optional(),
  zIndex: z.number().int().optional(),
};

const textSchema = z.object({
  ...baseFields, type: z.literal("text"),
  content: z.string(), fontSize: z.number().min(1).max(200),
  fontFamily: z.string().optional(),
  fontWeight: z.enum(["normal", "bold"]).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  color: z.string().optional(),
});
const dynamicTextSchema = z.object({
  ...baseFields, type: z.literal("dynamic_text"),
  field: z.string().min(1), fontSize: z.number().min(1).max(200),
  fontFamily: z.string().optional(),
  fontWeight: z.enum(["normal", "bold"]).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  color: z.string().optional(),
  prefix: z.string().optional(), suffix: z.string().optional(),
});
const barcodeSchema = z.object({
  ...baseFields, type: z.literal("barcode"),
  field: z.string().min(1),
  format: z.enum(["CODE128", "CODE39", "EAN13", "EAN8", "ITF14"]),
  showValue: z.boolean().optional(),
  lineWidth: z.number().optional(), barHeight: z.number().optional(),
});
const qrcodeSchema = z.object({
  ...baseFields, type: z.literal("qrcode"),
  field: z.string().min(1),
  errorLevel: z.enum(["L", "M", "Q", "H"]).optional(),
});
const lineSchema = z.object({
  ...baseFields, type: z.literal("line"),
  orientation: z.enum(["horizontal", "vertical"]),
  strokeWidth: z.number().optional(),
  color: z.string().optional(), dashed: z.boolean().optional(),
});
const rectangleSchema = z.object({
  ...baseFields, type: z.literal("rectangle"),
  fillColor: z.string().optional(), strokeColor: z.string().optional(),
  strokeWidth: z.number().optional(), borderRadius: z.number().optional(),
});

const componentSchema = z.discriminatedUnion("type", [
  textSchema, dynamicTextSchema, barcodeSchema, qrcodeSchema, lineSchema, rectangleSchema,
]);

const layoutSchema = z.object({
  components: z.array(componentSchema),
});

const patchedInsertSchema = insertLabelTemplateSchema.omit({ companyId: true });
const patchedUpdateSchema = insertLabelTemplateSchema.omit({ companyId: true }).partial();

function getCompanyId(req: Request): number | undefined {
  return (req as any).companyId;
}

function requireCompanyId(req: Request, res: Response): number | null {
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: "Empresa não identificada." });
    return null;
  }
  return companyId;
}

async function requireTemplateOwnership(
  req: Request,
  res: Response,
  id: string,
): Promise<{ companyId: number } | null> {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return null;
  const tpl = await storage.getLabelTemplateById(id, companyId);
  if (!tpl) {
    res.status(404).json({ error: "Modelo não encontrado." });
    return null;
  }
  if (tpl.companyId === null) {
    res.status(403).json({
      error: "Modelos do sistema (globais) não podem ser modificados. Duplique para editar.",
    });
    return null;
  }
  if (tpl.companyId !== companyId) {
    res.status(403).json({ error: "Modelo pertence a outra empresa." });
    return null;
  }
  return { companyId };
}

export function registerLabelRoutes(app: Express) {
  app.get("/api/labels/templates", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const ctx = req.query.context as LabelContext | undefined;
      if (ctx && !labelContextEnum.includes(ctx)) {
        return res.status(400).json({ error: "Contexto inválido." });
      }
      const templates = await storage.getLabelTemplates(ctx, companyId);
      res.json(templates);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/labels/templates/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const tpl = await storage.getLabelTemplateById(req.params.id, companyId);
      if (!tpl) return res.status(404).json({ error: "Modelo não encontrado." });
      res.json(tpl);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/labels/templates", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const companyId = requireCompanyId(req, res);
      if (!companyId) return;
      const parsed = patchedInsertSchema.parse(req.body);
      if (parsed.layoutJson) layoutSchema.parse(parsed.layoutJson);
      const created = await storage.createLabelTemplate(parsed, companyId);
      res.status(201).json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Dados inválidos", details: e.errors });
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/labels/templates/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ownership = await requireTemplateOwnership(req, res, req.params.id);
      if (!ownership) return;
      const parsed = patchedUpdateSchema.parse(req.body);
      if (parsed.layoutJson) layoutSchema.parse(parsed.layoutJson);
      const updated = await storage.updateLabelTemplate(req.params.id, parsed, ownership.companyId);
      if (!updated) return res.status(404).json({ error: "Modelo não encontrado." });
      res.json(updated);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Dados inválidos", details: e.errors });
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/labels/templates/:id/duplicate", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const companyId = requireCompanyId(req, res);
      if (!companyId) return;
      const name = String(req.body?.name ?? "").trim();
      if (!name) return res.status(400).json({ error: "Nome é obrigatório." });
      const created = await storage.duplicateLabelTemplate(req.params.id, name, companyId);
      if (!created) return res.status(404).json({ error: "Modelo original não encontrado." });
      res.status(201).json(created);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/labels/templates/:id/active", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ownership = await requireTemplateOwnership(req, res, req.params.id);
      if (!ownership) return;
      const active = Boolean(req.body?.active);
      const updated = await storage.toggleLabelTemplateActive(req.params.id, active, ownership.companyId);
      if (!updated) return res.status(404).json({ error: "Modelo não encontrado." });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/labels/templates/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const ownership = await requireTemplateOwnership(req, res, req.params.id);
      if (!ownership) return;
      await storage.deleteLabelTemplate(req.params.id, ownership.companyId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Defaults
  app.get("/api/labels/defaults", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const companyId = requireCompanyId(req, res);
      if (!companyId) return;
      const rows = await storage.getLabelDefaultAssignments(companyId);
      const map: Record<string, string | null> = {};
      for (const ctx of labelContextEnum) map[ctx] = null;
      for (const r of rows) map[r.context] = r.templateId ?? null;
      res.json(map);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/labels/defaults/:context", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const companyId = requireCompanyId(req, res);
      if (!companyId) return;
      const context = req.params.context as LabelContext;
      if (!labelContextEnum.includes(context)) {
        return res.status(400).json({ error: "Contexto inválido." });
      }
      const templateId = req.body?.templateId ?? null;
      if (templateId) {
        const tpl = await storage.getLabelTemplateById(templateId, companyId);
        if (!tpl) return res.status(404).json({ error: "Modelo não encontrado." });
        if (tpl.context !== context) {
          return res.status(400).json({ error: "Modelo não corresponde ao contexto." });
        }
      }
      const result = await storage.setLabelDefaultAssignment(context, templateId, companyId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Export / Import
  app.get("/api/labels/templates/:id/export", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const tpl = await storage.getLabelTemplateById(req.params.id, companyId);
      if (!tpl) return res.status(404).json({ error: "Modelo não encontrado." });
      const exportData = {
        name: tpl.name,
        context: tpl.context,
        widthMm: tpl.widthMm,
        heightMm: tpl.heightMm,
        dpi: tpl.dpi,
        layoutJson: tpl.layoutJson,
        exportedAt: new Date().toISOString(),
        version: 1,
      };
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="label-${tpl.name.replace(/[^a-z0-9]/gi, "_")}.json"`);
      res.send(JSON.stringify(exportData, null, 2));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/labels/templates/import", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const companyId = requireCompanyId(req, res);
      if (!companyId) return;
      const body = req.body;
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "Payload inválido." });
      }
      const ctx = body.context as LabelContext;
      if (!labelContextEnum.includes(ctx)) {
        return res.status(400).json({ error: "Contexto inválido no arquivo." });
      }
      if (body.layoutJson) layoutSchema.parse(body.layoutJson);
      const created = await storage.createLabelTemplate({
        name: String(body.name ?? "Modelo importado"),
        context: ctx,
        widthMm: Number(body.widthMm) || 100,
        heightMm: Number(body.heightMm) || 70,
        dpi: Number(body.dpi) || 203,
        active: true,
        layoutJson: (body.layoutJson as LabelLayout) ?? { components: [] },
      } as any, companyId);
      res.status(201).json(created);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: "Layout inválido", details: e.errors });
      res.status(500).json({ error: e.message });
    }
  });
}
