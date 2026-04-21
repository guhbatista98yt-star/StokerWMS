import type { Express, Request, Response } from "express";
import { isAuthenticated, requireRole, requireCompany, getTokenFromRequest } from "./auth";
import { storage } from "./storage";
import { db } from "./db";
import { eq, and, sql, desc, isNull, ilike, or, inArray, ne } from "drizzle-orm";
import {
  wmsAddresses, pallets, palletItems, palletMovements, nfCache, nfItems,
  countingCycles, countingCycleItems, productCompanyStock, products, productAddresses,
  addressPickingLog, productBarcodes, barcodeChangeHistory, users,
  insertProductAddressSchema,
  type WmsAddress, type Pallet, type PalletItem,
  type BarcodeType, barcodeTypeEnum,
} from "@shared/schema";
import { z } from "zod";
import { broadcastSSE } from "./sse";
import { log } from "./log";
import { randomUUID } from "crypto";

const addressSchema = z.object({
  bairro: z.string().min(1).max(50).transform(v => v.toUpperCase()),
  rua: z.string().min(1).max(50).transform(v => v.toUpperCase()),
  bloco: z.string().min(1).max(50).transform(v => v.toUpperCase()),
  nivel: z.string().min(1).max(50).transform(v => v.toUpperCase()),
  type: z.string().max(30).optional(),
});

const palletItemSchema = z.object({
  productId: z.string().min(1),
  erpNfId: z.string().nullable().optional(),
  quantity: z.number().positive(),
  lot: z.string().max(100).nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  fefoEnabled: z.boolean().optional(),
});

const createPalletSchema = z.object({
  items: z.array(palletItemSchema).min(1),
  nfIds: z.array(z.string()).optional(),
});

const allocatePalletSchema = z.object({
  addressId: z.string().min(1),
});

const countItemSchema = z.object({
  itemId: z.string().min(1),
  countedQty: z.number().min(0),
  lot: z.string().max(100).optional(),
  expiryDate: z.string().optional(),
});

function getCompanyId(req: Request): number {
  return req.companyId;
}

function getUserId(req: Request): string {
  return req.user!.id;
}

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

async function createAuditLog(req: Request, action: string, entityType: string, entityId: string, details: string) {
  await storage.createAuditLog({
    userId: getUserId(req),
    action,
    entityType,
    entityId,
    details,
    companyId: getCompanyId(req),
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
  });
}

export function registerWmsRoutes(app: Express) {
  const authMiddleware = [isAuthenticated, requireCompany];
  const supervisorRoles = requireRole("supervisor", "administrador");
  const receiverRoles = requireRole("recebedor", "supervisor", "administrador");
  const forkliftRoles = requireRole("empilhador", "supervisor", "administrador");
  const wmsCounterRoles = requireRole("conferente_wms", "supervisor", "administrador");
  const anyWmsRole = requireRole("recebedor", "empilhador", "conferente_wms", "supervisor", "administrador");

  app.get("/api/wms-addresses", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const addresses = await db.select().from(wmsAddresses)
        .where(eq(wmsAddresses.companyId, companyId))
        .orderBy(wmsAddresses.code);
      res.json(addresses);
    } catch (error) {
      log(`[WMS] Get addresses error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar endereços" });
    }
  });

  app.post("/api/wms-addresses", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const parsed = addressSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
      }
      const { bairro, rua, bloco, nivel, type } = parsed.data;
      const code = `${bairro}-${rua}-${bloco}-${nivel}`;

      const [address] = await db.insert(wmsAddresses).values({
        companyId,
        bairro,
        rua,
        bloco,
        nivel,
        code,
        type: type || "standard",
        createdBy: getUserId(req),
        createdAt: new Date().toISOString(),
      }).onConflictDoNothing().returning();

      if (!address) {
        return res.status(409).json({ error: "Endereço já existe" });
      }

      await createAuditLog(req, "create", "wms_address", address.id, `Endereço criado: ${code}`);
      res.json(address);
    } catch (error) {
      log(`[WMS] Create address error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao criar endereço" });
    }
  });

  const patchAddressSchema = addressSchema.extend({
    active: z.boolean().optional(),
  }).partial();

  app.patch("/api/wms-addresses/:id", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const parsed = patchAddressSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
      }
      const { bairro, rua, bloco, nivel, type, active } = parsed.data;

      const [existing] = await db.select().from(wmsAddresses)
        .where(and(eq(wmsAddresses.id, id), eq(wmsAddresses.companyId, companyId)));
      if (!existing) {
        return res.status(404).json({ error: "Endereço não encontrado" });
      }

      const updates: Record<string, unknown> = {};
      if (bairro !== undefined) updates.bairro = bairro;
      if (rua !== undefined) updates.rua = rua;
      if (bloco !== undefined) updates.bloco = bloco;
      if (nivel !== undefined) updates.nivel = nivel;
      if (type !== undefined) updates.type = type;
      if (active !== undefined) updates.active = active;

      const newBairro = (updates.bairro as string) || existing.bairro;
      const newRua = (updates.rua as string) || existing.rua;
      const newBloco = (updates.bloco as string) || existing.bloco;
      const newNivel = (updates.nivel as string) || existing.nivel;
      const newCode = `${newBairro}-${newRua}-${newBloco}-${newNivel}`;

      if (newCode !== existing.code) {
        // Verifica unicidade do novo código dentro da empresa
        const duplicate = await db.select({ id: wmsAddresses.id }).from(wmsAddresses)
          .where(and(eq(wmsAddresses.companyId, companyId), eq(wmsAddresses.code, newCode)));
        if (duplicate.length > 0) {
          return res.status(400).json({ error: "Já existe um endereço com este código na empresa" });
        }
        updates.code = newCode;
      }

      const [updated] = await db.update(wmsAddresses).set(updates).where(eq(wmsAddresses.id, id)).returning();
      await createAuditLog(req, "update", "wms_address", id, `Endereço atualizado: ${updated.code}`);
      res.json(updated);
    } catch (error) {
      log(`[WMS] Update address error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao atualizar endereço" });
    }
  });

  app.delete("/api/wms-addresses/:id", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const [existing] = await db.select().from(wmsAddresses)
        .where(and(eq(wmsAddresses.id, id), eq(wmsAddresses.companyId, companyId)));
      if (!existing) {
        return res.status(404).json({ error: "Endereço não encontrado" });
      }

      const activePallets = await db.select().from(pallets)
        .where(and(eq(pallets.addressId, id), sql`${pallets.status} != 'cancelado'`));
      if (activePallets.length > 0) {
        return res.status(400).json({ error: "Endereço possui pallets alocados" });
      }

      await db.delete(wmsAddresses).where(eq(wmsAddresses.id, id));
      await createAuditLog(req, "delete", "wms_address", id, `Endereço apagado: ${existing.code}`);
      res.json({ success: true });
    } catch (error) {
      log(`[WMS] Delete address error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao apagar endereço" });
    }
  });

  app.get("/api/wms-addresses/with-occupancy", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const allAddresses = await db.select().from(wmsAddresses)
        .where(eq(wmsAddresses.companyId, companyId))
        .orderBy(wmsAddresses.code);

      const occupiedPallets = await db.select({
        addressId: pallets.addressId,
        palletId: pallets.id,
        palletCode: pallets.code,
        palletStatus: pallets.status,
      }).from(pallets)
        .where(and(
          eq(pallets.companyId, companyId),
          sql`${pallets.status} != 'cancelado'`,
          sql`${pallets.addressId} IS NOT NULL`,
        ));

      const occupancyMap = new Map<string, { palletId: string; palletCode: string; palletStatus: string }>();
      for (const p of occupiedPallets) {
        if (p.addressId) {
          occupancyMap.set(p.addressId, { palletId: p.palletId, palletCode: p.palletCode, palletStatus: p.palletStatus });
        }
      }

      const enriched = allAddresses.map(addr => ({
        ...addr,
        occupied: occupancyMap.has(addr.id),
        pallet: occupancyMap.get(addr.id) || null,
      }));

      res.json(enriched);
    } catch (error) {
      log(`[WMS] Get addresses with occupancy error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar endereços" });
    }
  });

  app.get("/api/wms-addresses/available", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const allAddresses = await db.select().from(wmsAddresses)
        .where(and(
          eq(wmsAddresses.companyId, companyId),
          eq(wmsAddresses.active, true),
          eq(wmsAddresses.type, "standard"),
        ));

      const occupiedAddressIds = await db.select({ addressId: pallets.addressId }).from(pallets)
        .where(and(
          eq(pallets.companyId, companyId),
          sql`${pallets.status} IN ('sem_endereco', 'alocado', 'em_transferencia')`,
          sql`${pallets.addressId} IS NOT NULL`,
        ));

      const occupiedSet = new Set(occupiedAddressIds.map(p => p.addressId).filter(Boolean));
      const available = allAddresses.filter(a => !occupiedSet.has(a.id));
      res.json(available);
    } catch (error) {
      log(`[WMS] Get available addresses error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar endereços disponíveis" });
    }
  });

  app.post("/api/wms-addresses/import", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { addresses } = req.body;

      if (!Array.isArray(addresses)) {
        return res.status(400).json({ error: "Lista de endereços inválida" });
      }

      const result = await db.transaction(async (tx) => {
        let created = 0;
        let skipped = 0;

        for (const addr of addresses) {
          if (!addr.bairro || !addr.rua || !addr.bloco || !addr.nivel) {
            skipped++;
            continue;
          }
          const code = `${String(addr.bairro)}-${String(addr.rua)}-${String(addr.bloco)}-${String(addr.nivel)}`;
          const existing = await tx.select().from(wmsAddresses)
            .where(and(eq(wmsAddresses.companyId, companyId), eq(wmsAddresses.code, code)));

          if (existing.length > 0) {
            skipped++;
            continue;
          }

          await tx.insert(wmsAddresses).values({
            companyId,
            bairro: String(addr.bairro),
            rua: String(addr.rua),
            bloco: String(addr.bloco),
            nivel: String(addr.nivel),
            code,
            type: addr.type || "standard",
            createdBy: getUserId(req),
            createdAt: new Date().toISOString(),
          });
          created++;
        }

        return { created, skipped };
      });

      await createAuditLog(req, "import", "wms_address", "", `Importação: ${result.created} criados, ${result.skipped} ignorados`);
      res.json(result);
    } catch (error) {
      log(`[WMS] Import addresses error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao importar endereços" });
    }
  });

  app.get("/api/pallets", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const statusFilter = req.query.status as string | undefined;

      const conditions = [eq(pallets.companyId, companyId)];
      if (statusFilter) {
        conditions.push(eq(pallets.status, statusFilter as any));
      }

      const result = await db.select().from(pallets)
        .where(and(...conditions))
        .orderBy(desc(pallets.createdAt))
        .limit(500);

      const palletIds = result.map(p => p.id);
      const addressIds = result.map(p => p.addressId).filter(Boolean) as string[];

      const allItems = palletIds.length > 0
        ? await db.select().from(palletItems).where(sql`${palletItems.palletId} IN (${sql.join(palletIds.map(id => sql`${id}`), sql`, `)})`)
        : [];

      const allAddresses = addressIds.length > 0
        ? await db.select().from(wmsAddresses).where(sql`${wmsAddresses.id} IN (${sql.join(addressIds.map(id => sql`${id}`), sql`, `)})`)
        : [];

      const itemsByPallet = new Map<string, typeof allItems>();
      for (const item of allItems) {
        const list = itemsByPallet.get(item.palletId) || [];
        list.push(item);
        itemsByPallet.set(item.palletId, list);
      }

      const addressMap = new Map<string, (typeof allAddresses)[0]>();
      for (const addr of allAddresses) {
        addressMap.set(addr.id, addr);
      }

      const enriched = result.map(p => ({
        ...p,
        items: itemsByPallet.get(p.id) || [],
        address: p.addressId ? addressMap.get(p.addressId) || null : null,
      }));

      res.json(enriched);
    } catch (error) {
      log(`[WMS] Get pallets error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar pallets" });
    }
  });

  app.post("/api/pallets", ...authMiddleware, receiverRoles, async (req: Request, res: Response) => {
    try {
      const parsed = createPalletSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
      }
      const { items, nfIds } = parsed.data;
      const companyId = getCompanyId(req);
      const userId = getUserId(req);

      const seq = Date.now().toString(36).toUpperCase().slice(-6);
      const code = `P${companyId}-${seq}`;
      const now = new Date().toISOString();

      const { pallet, createdItems } = await db.transaction(async (tx) => {
        const [pallet] = await tx.insert(pallets).values({
          companyId,
          code,
          status: "sem_endereco",
          createdBy: userId,
          createdAt: now,
        }).returning();

        const createdItems = [];
        if (Array.isArray(items)) {
          for (const item of items) {
            const [inserted] = await tx.insert(palletItems).values({
              palletId: pallet.id,
              productId: item.productId,
              erpNfId: item.erpNfId || null,
              quantity: item.quantity,
              lot: item.lot || null,
              expiryDate: item.expiryDate || null,
              fefoEnabled: item.fefoEnabled || false,
              companyId,
              createdAt: now,
            }).returning();
            createdItems.push(inserted);
          }
        }

        await tx.insert(palletMovements).values({
          palletId: pallet.id,
          companyId,
          movementType: "created",
          userId,
          notes: nfIds ? `NFs: ${nfIds.join(", ")}` : null,
          createdAt: now,
        });

        return { pallet, createdItems };
      });

      await createAuditLog(req, "create", "pallet", pallet.id, `Pallet criado: ${code}`);
      broadcastSSE("pallet_created", { palletId: pallet.id, code, companyId });

      res.json({ ...pallet, items: createdItems });
    } catch (error) {
      log(`[WMS] Create pallet error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao criar pallet" });
    }
  });

  app.get("/api/pallets/:id", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const [pallet] = await db.select().from(pallets)
        .where(and(eq(pallets.id, id), eq(pallets.companyId, companyId)));
      if (!pallet) {
        return res.status(404).json({ error: "Pallet não encontrado" });
      }

      const items = await db.select().from(palletItems).where(eq(palletItems.palletId, id));
      let address = null;
      if (pallet.addressId) {
        const [addr] = await db.select().from(wmsAddresses).where(eq(wmsAddresses.id, pallet.addressId));
        address = addr || null;
      }

      const movements = await db.select().from(palletMovements)
        .where(eq(palletMovements.palletId, id))
        .orderBy(desc(palletMovements.createdAt));

      const itemProductIds = [...new Set(items.map(i => i.productId))];
      const itemProducts = itemProductIds.length > 0
        ? await db.select().from(products).where(inArray(products.id, itemProductIds))
        : [];
      const itemProductMap = new Map(itemProducts.map(p => [p.id, p]));
      const enrichedItems = items.map(item => ({ ...item, product: itemProductMap.get(item.productId) || null }));

      res.json({ ...pallet, items: enrichedItems, address, movements });
    } catch (error) {
      log(`[WMS] Get pallet error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar pallet" });
    }
  });

  app.patch("/api/pallets/:id", ...authMiddleware, receiverRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;
      const { items } = req.body;

      const [pallet] = await db.select().from(pallets)
        .where(and(eq(pallets.id, id), eq(pallets.companyId, companyId)));
      if (!pallet) {
        return res.status(404).json({ error: "Pallet não encontrado" });
      }

      if (pallet.status === "cancelado") {
        return res.status(400).json({ error: "Pallet cancelado não pode ser editado" });
      }

      if (pallet.status !== "sem_endereco") {
        return res.status(400).json({ error: "Apenas pallets sem endereço podem ter itens editados diretamente. Use Adição ou Retirada." });
      }

      if (Array.isArray(items)) {
        const updateNow = new Date().toISOString();
        const userId = getUserId(req);
        await db.transaction(async (tx) => {
          await tx.delete(palletItems).where(eq(palletItems.palletId, id));
          for (const item of items) {
            await tx.insert(palletItems).values({
              palletId: id,
              productId: item.productId,
              erpNfId: item.erpNfId || null,
              quantity: item.quantity,
              lot: item.lot || null,
              expiryDate: item.expiryDate || null,
              fefoEnabled: item.fefoEnabled || false,
              companyId,
              createdAt: updateNow,
            });
          }
          await tx.insert(palletMovements).values({
            palletId: id,
            companyId,
            movementType: "updated",
            fromAddressId: pallet.addressId || null,
            toAddressId: pallet.addressId || null,
            userId,
            notes: `Itens atualizados (${items.length} itens)`,
            createdAt: updateNow,
          });
        });
      }

      await createAuditLog(req, "update", "pallet", id, `Pallet atualizado: ${pallet.code}`);
      res.json({ success: true });
    } catch (error) {
      log(`[WMS] Update pallet error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao atualizar pallet" });
    }
  });

  app.post("/api/pallets/:id/allocate", ...authMiddleware, forkliftRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;
      const parsed = allocatePalletSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "ID do endereço é obrigatório" });
      }
      const { addressId } = parsed.data;

      const [pallet] = await db.select().from(pallets)
        .where(and(eq(pallets.id, id), eq(pallets.companyId, companyId)));
      if (!pallet) {
        return res.status(404).json({ error: "Pallet não encontrado" });
      }
      if (pallet.status === "cancelado") {
        return res.status(400).json({ error: "Pallet cancelado" });
      }

      const [address] = await db.select().from(wmsAddresses)
        .where(and(eq(wmsAddresses.id, addressId), eq(wmsAddresses.companyId, companyId)));
      if (!address) {
        return res.status(404).json({ error: "Endereço não encontrado ou de outra empresa" });
      }
      if (!address.active) {
        return res.status(400).json({ error: "Endereço inativo" });
      }

      const now = new Date().toISOString();

      const userId = getUserId(req);

      const allocationResult = await db.transaction(async (tx) => {
        const occupants = await tx.select().from(pallets)
          .where(and(
            eq(pallets.addressId, addressId),
            sql`${pallets.status} != 'cancelado'`,
            sql`${pallets.id} != ${id}`,
          ));

        if (occupants.length > 0) {
          const targetPallet = occupants[0];
          const incomingItems = await tx.select().from(palletItems)
            .where(eq(palletItems.palletId, id));

          if (incomingItems.length === 0) {
            return { error: "Pallet sem itens para transferir" } as const;
          }

          for (const item of incomingItems) {
            const matchConditions = [
              eq(palletItems.palletId, targetPallet.id),
              eq(palletItems.productId, item.productId),
            ];
            if (item.lot) {
              matchConditions.push(eq(palletItems.lot, item.lot));
            } else {
              matchConditions.push(sql`${palletItems.lot} IS NULL`);
            }
            if (item.expiryDate) {
              matchConditions.push(eq(palletItems.expiryDate, item.expiryDate));
            } else {
              matchConditions.push(sql`${palletItems.expiryDate} IS NULL`);
            }

            const [existing] = await tx.select().from(palletItems)
              .where(and(...matchConditions));

            if (existing) {
              await tx.update(palletItems).set({
                quantity: Number(existing.quantity) + Number(item.quantity),
              }).where(eq(palletItems.id, existing.id));
            } else {
              await tx.insert(palletItems).values({
                id: `pi-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                palletId: targetPallet.id,
                productId: item.productId,
                quantity: item.quantity,
                lot: item.lot,
                expiryDate: item.expiryDate,
                erpNfId: item.erpNfId,
                fefoEnabled: item.fefoEnabled,
                companyId: item.companyId,
              });
            }
          }

          await tx.delete(palletItems).where(eq(palletItems.palletId, id));

          await tx.update(pallets).set({
            status: "cancelado",
            cancelledAt: now,
            cancelledBy: userId,
            cancelReason: `Produtos transferidos para pallet ${targetPallet.code} no endereço ${address.code}`,
          }).where(eq(pallets.id, id));

          await tx.insert(palletMovements).values({
            palletId: id,
            companyId,
            movementType: "transferred",
            fromAddressId: null,
            toAddressId: addressId,
            userId,
            notes: `Produtos mesclados ao pallet ${targetPallet.code}`,
            createdAt: now,
          });

          return { success: true, merged: true, targetPalletCode: targetPallet.code } as const;
        }

        await tx.update(pallets).set({
          addressId,
          status: "alocado",
          allocatedAt: now,
        }).where(eq(pallets.id, id));

        await tx.insert(palletMovements).values({
          palletId: id,
          companyId,
          movementType: "allocated",
          fromAddressId: pallet.addressId || null,
          toAddressId: addressId,
          userId,
          createdAt: now,
        });

        return { success: true, merged: false } as const;
      });

      if ("error" in allocationResult) {
        return res.status(400).json({ error: allocationResult.error });
      }

      if (allocationResult.merged) {
        await createAuditLog(req, "merge_allocate", "pallet", id, `Produtos do pallet ${pallet.code} mesclados ao pallet ${allocationResult.targetPalletCode} em ${address.code}`);
      } else {
        await createAuditLog(req, "allocate", "pallet", id, `Pallet ${pallet.code} alocado em ${address.code}`);
      }
      broadcastSSE("pallet_allocated", { palletId: id, addressId, companyId });

      res.json({ success: true });
    } catch (error) {
      log(`[WMS] Allocate pallet error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao alocar pallet" });
    }
  });

  app.post("/api/pallets/:id/transfer", ...authMiddleware, forkliftRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;
      const { toAddressId } = req.body;
      if (!toAddressId || typeof toAddressId !== "string") {
        return res.status(400).json({ error: "Endereço de destino é obrigatório" });
      }

      const [pallet] = await db.select().from(pallets)
        .where(and(eq(pallets.id, id), eq(pallets.companyId, companyId)));
      if (!pallet) {
        return res.status(404).json({ error: "Pallet não encontrado" });
      }
      if (pallet.status === "cancelado") {
        return res.status(400).json({ error: "Pallet cancelado não pode ser transferido" });
      }
      if (pallet.status === "sem_endereco") {
        return res.status(400).json({ error: "Pallet sem endereço. Use o módulo de Check-in para alocar primeiro." });
      }

      if (!toAddressId) {
        return res.status(400).json({ error: "Selecione um endereço de destino" });
      }

      if (pallet.addressId === toAddressId) {
        return res.status(400).json({ error: "Endereço de destino é o mesmo endereço atual do pallet" });
      }

      const [toAddress] = await db.select().from(wmsAddresses)
        .where(and(eq(wmsAddresses.id, toAddressId), eq(wmsAddresses.companyId, companyId)));
      if (!toAddress) {
        return res.status(404).json({ error: "Endereço destino não encontrado" });
      }
      if (!toAddress.active) {
        return res.status(400).json({ error: "Endereço destino está inativo" });
      }

      const now = new Date().toISOString();
      const fromAddressId = pallet.addressId;

      const transferResult = await db.transaction(async (tx) => {
        const occupant = await tx.select().from(pallets)
          .where(and(
            eq(pallets.addressId, toAddressId),
            sql`${pallets.status} != 'cancelado'`,
            sql`${pallets.id} != ${id}`,
          ));
        if (occupant.length > 0) {
          return { error: "Endereço destino já ocupado por outro pallet" } as const;
        }

        await tx.update(pallets).set({
          addressId: toAddressId,
          status: "alocado",
        }).where(eq(pallets.id, id));

        await tx.insert(palletMovements).values({
          palletId: id,
          companyId,
          movementType: "transferred",
          fromAddressId: fromAddressId || null,
          toAddressId,
          userId: getUserId(req),
          createdAt: now,
        });

        return { success: true } as const;
      });

      if ("error" in transferResult) {
        return res.status(400).json({ error: transferResult.error });
      }

      await createAuditLog(req, "transfer", "pallet", id, `Pallet ${pallet.code} transferido para ${toAddress.code}`);
      broadcastSSE("pallet_transferred", { palletId: id, fromAddressId, toAddressId, companyId });

      res.json({ success: true });
    } catch (error) {
      log(`[WMS] Transfer pallet error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao transferir pallet" });
    }
  });

  app.post("/api/pallets/:id/cancel", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;
      const { reason } = req.body;

      const [pallet] = await db.select().from(pallets)
        .where(and(eq(pallets.id, id), eq(pallets.companyId, companyId)));
      if (!pallet) {
        return res.status(404).json({ error: "Pallet não encontrado" });
      }
      if (pallet.status === "cancelado") {
        return res.status(400).json({ error: "Pallet já cancelado" });
      }

      if (!reason || reason.trim().length < 3) {
        return res.status(400).json({ error: "Informe o motivo do cancelamento (mínimo 3 caracteres)" });
      }

      const pickingAddresses = await db.select().from(wmsAddresses)
        .where(and(eq(wmsAddresses.companyId, companyId), eq(wmsAddresses.type, "picking")));

      let pickingAddressId: string | null = null;
      if (pickingAddresses.length > 0) {
        pickingAddressId = pickingAddresses[0].id;
      }

      const now = new Date().toISOString();
      const cancelUserId = getUserId(req);

      await db.transaction(async (tx) => {
        await tx.update(pallets).set({
          status: "cancelado",
          addressId: pickingAddressId,
          cancelledAt: now,
          cancelledBy: cancelUserId,
          cancelReason: reason || null,
        }).where(eq(pallets.id, id));

        await tx.insert(palletMovements).values({
          palletId: id,
          companyId,
          movementType: "cancelled",
          fromAddressId: pallet.addressId || null,
          toAddressId: pickingAddressId,
          userId: cancelUserId,
          notes: reason || "Cancelamento",
          createdAt: now,
        });
      });

      await createAuditLog(req, "cancel", "pallet", id, `Pallet ${pallet.code} cancelado: ${reason || 'sem motivo'}`);
      broadcastSSE("pallet_cancelled", { palletId: id, companyId });

      res.json({ success: true });
    } catch (error) {
      log(`[WMS] Cancel pallet error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao cancelar pallet" });
    }
  });

  app.post("/api/pallets/:id/withdraw", ...authMiddleware, forkliftRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const userId = getUserId(req);
      const { id } = req.params;
      const { items, reason, notes } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Informe ao menos um item para retirada" });
      }
      if (!reason) {
        return res.status(400).json({ error: "Motivo da retirada é obrigatório" });
      }

      const reasonLabels: Record<string, string> = {
        abastecimento_pick: "Abastecimento Pick",
        saida_avulsa: "Saída Avulsa",
        outro: notes || "Outro",
      };

      const [pallet] = await db.select().from(pallets)
        .where(and(eq(pallets.id, id), eq(pallets.companyId, companyId)));
      if (!pallet) return res.status(404).json({ error: "Pallet não encontrado" });
      if (pallet.status === "cancelado") return res.status(400).json({ error: "Pallet já cancelado" });

      const now = new Date().toISOString();

      const removedSummary = await db.transaction(async (tx) => {
        const currentItems = await tx.select().from(palletItems)
          .where(eq(palletItems.palletId, id));

        const summary: { productId: string; removed: number; remaining: number }[] = [];

        for (const { palletItemId, quantity } of items) {
          if (!palletItemId || !quantity || quantity <= 0) continue;
          const item = currentItems.find(ci => ci.id === palletItemId);
          if (!item) continue;

          const toRemove = Math.min(quantity, item.quantity);
          const remaining = item.quantity - toRemove;

          if (remaining <= 0) {
            await tx.delete(palletItems).where(eq(palletItems.id, palletItemId));
          } else {
            await tx.update(palletItems)
              .set({ quantity: remaining })
              .where(eq(palletItems.id, palletItemId));
          }
          summary.push({ productId: item.productId, removed: toRemove, remaining });
        }

        const remaining = await tx.select().from(palletItems).where(eq(palletItems.palletId, id));
        if (remaining.length === 0) {
          await tx.update(pallets).set({
            status: "cancelado",
            cancelledAt: now,
            cancelledBy: userId,
            cancelReason: `Esvaziado via retirada: ${reasonLabels[reason] || reason}`,
          }).where(eq(pallets.id, id));
          if (pallet.addressId) {
            await tx.update(wmsAddresses)
              .set({ occupied: false })
              .where(eq(wmsAddresses.id, pallet.addressId));
          }
        }

        const noteText = [reasonLabels[reason] || reason, reason === "outro" ? null : notes].filter(Boolean).join(" - ");
        await tx.insert(palletMovements).values({
          palletId: id,
          companyId,
          movementType: "withdrawn",
          fromAddressId: pallet.addressId || null,
          toAddressId: null,
          fromPalletId: null,
          userId,
          notes: noteText || null,
          createdAt: now,
        });

        return summary;
      });

      await createAuditLog(req, "withdraw", "pallet", id, `Retirada do pallet ${pallet.code}: ${removedSummary.map(s => `${s.productId}×${s.removed}`).join(", ")} | Motivo: ${reasonLabels[reason] || reason}`);
      broadcastSSE("pallet_updated", { palletId: id, companyId });

      res.json({ success: true, removed: removedSummary });
    } catch (error) {
      log(`[WMS] Withdraw pallet error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao registrar retirada" });
    }
  });

  const additionRoles = requireRole("empilhador", "recebedor", "supervisor", "administrador");
  app.post("/api/pallets/:id/add-items", ...authMiddleware, additionRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const userId = getUserId(req);
      const { id } = req.params;
      const { items, notes } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Informe ao menos um item para adicionar" });
      }

      const [pallet] = await db.select().from(pallets)
        .where(and(eq(pallets.id, id), eq(pallets.companyId, companyId)));
      if (!pallet) return res.status(404).json({ error: "Pallet não encontrado" });
      if (pallet.status === "cancelado") return res.status(400).json({ error: "Pallet cancelado" });

      const now = new Date().toISOString();
      const addedSummary: { productId: string; added: number; newTotal: number }[] = [];

      await db.transaction(async (tx) => {
        for (const { productId, quantity, lot, expiryDate } of items) {
          if (!productId || !quantity || quantity <= 0) continue;

          const existing = await tx.select().from(palletItems)
            .where(and(eq(palletItems.palletId, id), eq(palletItems.productId, productId)));

          if (existing.length > 0) {
            const newQty = Number(existing[0].quantity) + Number(quantity);
            const updateFields: any = { quantity: newQty };
            if (lot !== undefined) updateFields.lot = lot;
            if (expiryDate !== undefined) updateFields.expiryDate = expiryDate;
            await tx.update(palletItems).set(updateFields).where(eq(palletItems.id, existing[0].id));
            addedSummary.push({ productId, added: Number(quantity), newTotal: newQty });
          } else {
            await tx.insert(palletItems).values({
              palletId: id,
              productId,
              quantity: Number(quantity),
              lot: lot || null,
              expiryDate: expiryDate || null,
              companyId,
              createdAt: now,
            });
            addedSummary.push({ productId, added: Number(quantity), newTotal: Number(quantity) });
          }
        }

        await tx.insert(palletMovements).values({
          palletId: id,
          companyId,
          movementType: "addition",
          fromAddressId: null,
          toAddressId: pallet.addressId || null,
          userId,
          notes: notes || `Adição de ${addedSummary.length} item(ns)`,
          createdAt: now,
        });
      });

      await createAuditLog(req, "add_items", "pallet", id, `Adição ao pallet ${pallet.code}: ${addedSummary.map(s => `${s.productId}×${s.added}`).join(", ")}`);
      broadcastSSE("pallet_updated", { palletId: id, companyId });

      res.json({ success: true, added: addedSummary });
    } catch (error) {
      log(`[WMS] Add items to pallet error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao adicionar itens ao pallet" });
    }
  });

  app.post("/api/pallets/:id/cancel-unaddressed", ...authMiddleware,
    requireRole("recebedor", "empilhador", "supervisor", "administrador"),
    async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const [pallet] = await db.select().from(pallets)
        .where(and(eq(pallets.id, id), eq(pallets.companyId, companyId)));
      if (!pallet) return res.status(404).json({ error: "Pallet não encontrado" });
      if (pallet.status !== "sem_endereco") return res.status(400).json({ error: "Apenas pallets sem endereço podem ser cancelados aqui" });

      const now = new Date().toISOString();
      const userId = getUserId(req);

      await db.transaction(async (tx) => {
        await tx.update(pallets).set({
          status: "cancelado",
          cancelledAt: now,
          cancelledBy: userId,
          cancelReason: "Cancelado pelo operador",
        }).where(eq(pallets.id, id));

        await tx.delete(palletItems).where(eq(palletItems.palletId, id));

        await tx.insert(palletMovements).values({
          palletId: id,
          companyId,
          movementType: "cancelled",
          fromAddressId: null,
          userId,
          notes: "Cancelado pelo operador (sem endereço)",
          createdAt: now,
        });
      });

      await createAuditLog(req, "cancel", "pallet", id, `Pallet ${pallet.code} cancelado pelo operador (sem endereço)`);
      res.json({ success: true });
    } catch (error) {
      log(`[WMS] Cancel unaddressed pallet error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao cancelar pallet" });
    }
  });

  app.post("/api/pallets/:id/partial-transfer", ...authMiddleware, forkliftRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;
      const { items, toAddressId } = req.body;

      if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Selecione itens para transferir" });
      if (!toAddressId) return res.status(400).json({ error: "Endereço de destino obrigatório" });

      const [pallet] = await db.select().from(pallets)
        .where(and(eq(pallets.id, id), eq(pallets.companyId, companyId)));
      if (!pallet) return res.status(404).json({ error: "Pallet não encontrado" });
      if (pallet.status === "cancelado") return res.status(400).json({ error: "Pallet cancelado" });

      const [toAddress] = await db.select().from(wmsAddresses)
        .where(and(eq(wmsAddresses.id, toAddressId), eq(wmsAddresses.companyId, companyId)));
      if (!toAddress) return res.status(404).json({ error: "Endereço não encontrado ou de outra empresa" });
      if (!toAddress.active) return res.status(400).json({ error: "Endereço de destino está inativo" });

      if (pallet.addressId === toAddressId) {
        return res.status(400).json({ error: "Endereço de destino é o mesmo endereço atual do pallet" });
      }

      const allItems = await db.select().from(palletItems).where(eq(palletItems.palletId, id));
      const now = new Date().toISOString();
      const userId = getUserId(req);

      const newCode = `P${companyId}-${Date.now().toString(36).toUpperCase().slice(-6)}`;

      const newPallet = await db.transaction(async (tx) => {
        const [newPallet] = await tx.insert(pallets).values({
          companyId,
          code: newCode,
          status: "alocado",
          addressId: toAddressId,
          createdBy: userId,
          createdAt: now,
          allocatedAt: now,
        }).returning();

        let anyTransferred = false;
        for (const reqItem of items) {
          const existing = allItems.find(i => i.productId === reqItem.productId);
          if (!existing) continue;
          const qty = Math.min(Number(reqItem.quantity), Number(existing.quantity));
          if (qty <= 0) continue;

          anyTransferred = true;
          await tx.insert(palletItems).values({
            palletId: newPallet.id,
            productId: existing.productId,
            quantity: qty,
            lot: existing.lot,
            expiryDate: existing.expiryDate,
            fefoEnabled: existing.fefoEnabled,
            companyId,
            createdAt: now,
          });

          const remaining = Number(existing.quantity) - qty;
          if (remaining <= 0) {
            await tx.delete(palletItems).where(eq(palletItems.id, existing.id));
          } else {
            await tx.update(palletItems).set({ quantity: remaining }).where(eq(palletItems.id, existing.id));
          }
        }

        if (!anyTransferred) throw new Error("Nenhum item válido para transferência");

        const remainingItems = await tx.select().from(palletItems).where(eq(palletItems.palletId, id));
        if (remainingItems.length === 0) {
          await tx.update(pallets).set({ status: "cancelado", cancelledAt: now }).where(eq(pallets.id, id));
        }

        await tx.insert(palletMovements).values({
          palletId: newPallet.id,
          companyId,
          movementType: "partial_transfer",
          fromAddressId: pallet.addressId,
          toAddressId,
          fromPalletId: id,
          userId,
          notes: `Transferência parcial de ${pallet.code}`,
          createdAt: now,
        });

        await tx.insert(palletMovements).values({
          palletId: id,
          companyId,
          movementType: "partial_transfer",
          fromAddressId: pallet.addressId,
          toAddressId,
          userId,
          notes: `Itens transferidos para novo pallet ${newCode} em ${toAddress.code}`,
          createdAt: now,
        });

        return newPallet;
      });

      await createAuditLog(req, "partial_transfer", "pallet", id, `Transferência parcial de ${pallet.code} para ${toAddress.code}`);
      res.json({ success: true, newPallet });
    } catch (error) {
      log(`[WMS] Partial transfer error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao realizar transferência parcial" });
    }
  });

  app.get("/api/pallets/:id/print-label", ...authMiddleware, receiverRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const [pallet] = await db.select().from(pallets)
        .where(and(eq(pallets.id, id), eq(pallets.companyId, companyId)));
      if (!pallet) {
        return res.status(404).json({ error: "Pallet não encontrado" });
      }

      const items = await db.select().from(palletItems).where(eq(palletItems.palletId, id));
      const labelProductIds = [...new Set(items.map(i => i.productId))];
      const labelProducts = labelProductIds.length > 0
        ? await db.select().from(products).where(inArray(products.id, labelProductIds))
        : [];
      const labelProductMap = new Map(labelProducts.map(p => [p.id, p]));
      const enrichedItems = items.map(item => ({ ...item, product: labelProductMap.get(item.productId) || null }));

      let address = null;
      if (pallet.addressId) {
        const [addr] = await db.select().from(wmsAddresses).where(eq(wmsAddresses.id, pallet.addressId));
        address = addr;
      }

      const label = {
        palletCode: pallet.code,
        companyId: pallet.companyId,
        createdAt: pallet.createdAt,
        createdBy: pallet.createdBy,
        address: address?.code || "SEM ENDEREÇO",
        items: enrichedItems.map(i => ({
          product: i.product?.name || "Produto",
          erpCode: i.product?.erpCode || "",
          quantity: i.quantity,
          lot: i.lot,
          expiryDate: i.expiryDate,
          unit: i.product?.unit || "UN",
        })),
        nfIds: [...new Set(items.map(i => i.erpNfId).filter(Boolean))],
        qrData: pallet.code,
      };

      res.json(label);
    } catch (error) {
      log(`[WMS] Print label error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao gerar etiqueta" });
    }
  });

  app.get("/api/pallets/by-address/:id", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const result = await db.select().from(pallets)
        .where(and(eq(pallets.addressId, id), eq(pallets.companyId, companyId), sql`${pallets.status} != 'cancelado'`));

      if (result.length === 0) return res.json([]);

      const palletIds = result.map(p => p.id);
      const itemCounts = await db.select({
        palletId: palletItems.palletId,
        count: sql<number>`COUNT(*)::int`,
      })
        .from(palletItems)
        .where(inArray(palletItems.palletId, palletIds))
        .groupBy(palletItems.palletId);

      const countMap = new Map(itemCounts.map(ic => [ic.palletId, ic.count]));
      const enriched = result.map(p => ({ ...p, itemCount: countMap.get(p.id) || 0 }));

      res.json(enriched);
    } catch (error) {
      log(`[WMS] Get pallet by address error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar pallet por endereço" });
    }
  });

  app.get("/api/pallets/by-code/:code", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { code } = req.params;
      const statusFilter = req.query.status as string | undefined;

      const conditions = [eq(pallets.companyId, companyId), sql`UPPER(${pallets.code}) = UPPER(${code})`];
      if (statusFilter) {
        conditions.push(eq(pallets.status, statusFilter as any));
      } else {
        conditions.push(sql`${pallets.status} != 'cancelado'`);
      }

      const [pallet] = await db.select().from(pallets).where(and(...conditions));
      if (!pallet) return res.status(404).json({ error: "Pallet não encontrado" });

      const items = await db.select().from(palletItems).where(eq(palletItems.palletId, pallet.id));
      const productIds = items.map(i => i.productId).filter(Boolean) as string[];
      const prods = productIds.length > 0
        ? await db.select().from(products).where(sql`${products.id} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`)
        : [];
      const prodMap = new Map(prods.map(p => [p.id, p]));

      const addr = pallet.addressId
        ? await db.select().from(wmsAddresses).where(eq(wmsAddresses.id, pallet.addressId)).then(r => r[0] || null)
        : null;

      res.json({
        ...pallet,
        address: addr,
        items: items.map(i => ({ ...i, product: i.productId ? prodMap.get(i.productId) || null : null })),
      });
    } catch (error) {
      log(`[WMS] Get pallet by code error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar pallet por código" });
    }
  });

  app.get("/api/nf/list", ...authMiddleware, receiverRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const q = (req.query.q as string || "").trim();

      let conditions = [eq(nfCache.companyId, companyId)];
      if (q) {
        conditions.push(
          sql`(${nfCache.nfNumber} ILIKE ${'%' + q + '%'} OR ${nfCache.supplierName} ILIKE ${'%' + q + '%'})`
        );
      }

      const results = await db.select().from(nfCache)
        .where(and(...conditions))
        .orderBy(desc(nfCache.syncedAt))
        .limit(50);

      res.json(results);
    } catch (error) {
      log(`[WMS] List NF error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao listar NFs" });
    }
  });

  app.get("/api/nf/:nfNumber", ...authMiddleware, receiverRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { nfNumber } = req.params;

      const [nf] = await db.select().from(nfCache)
        .where(and(eq(nfCache.companyId, companyId), eq(nfCache.nfNumber, nfNumber)));

      if (!nf) {
        return res.status(404).json({ error: "NF não encontrada. Verifique o número ou aguarde sincronização." });
      }

      const items = await db.select().from(nfItems).where(eq(nfItems.nfId, nf.id));
      
      const productIds = items.map(i => i.productId).filter(Boolean) as string[];
      const productStock = productIds.length > 0 
        ? await db.select({
            productId: productCompanyStock.productId,
            stockQty: productCompanyStock.stockQty
          })
          .from(productCompanyStock)
          .where(and(
            inArray(productCompanyStock.productId, productIds),
            eq(productCompanyStock.companyId, companyId)
          ))
        : [];
        
      const alocadoStock = productIds.length > 0
        ? await db.select({
            productId: palletItems.productId,
            total: sql<number>`SUM(${palletItems.quantity})`
          })
          .from(palletItems)
          .innerJoin(pallets, eq(palletItems.palletId, pallets.id))
          .where(and(
             inArray(palletItems.productId, productIds),
             eq(palletItems.companyId, companyId),
             ne(pallets.status, "cancelado"),
             sql`${pallets.addressId} IS NOT NULL`
          ))
          .groupBy(palletItems.productId)
        : [];

      const stockMap = new Map();
      productStock.forEach(s => stockMap.set(s.productId, Number(s.stockQty)));
      
      const alocadoMap = new Map();
      alocadoStock.forEach(s => alocadoMap.set(s.productId, Number(s.total)));

      const enrichedItems = items.map(item => ({
        ...item,
        quantity: Number(item.quantity),
        currentStock: item.productId ? (stockMap.get(item.productId) || 0) : 0,
        alocadoStock: item.productId ? (alocadoMap.get(item.productId) || 0) : 0,
      }));

      res.json({ ...nf, totalValue: Number(nf.totalValue), items: enrichedItems });
    } catch (error) {
      log(`[WMS] Get NF error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar NF" });
    }
  });

  app.post("/api/nf/sync", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    res.json({
      message: "Sincronização executada automaticamente a cada 10 minutos via sync_db2.py. Use POST /api/sync para forçar.",
      status: "ok",
    });
  });

  app.get("/api/pallet-movements", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const palletId = req.query.palletId as string | undefined;
      const addressId = req.query.addressId as string | undefined;

      let conditions = [eq(palletMovements.companyId, companyId)];
      if (palletId) {
        conditions.push(eq(palletMovements.palletId, palletId));
      }
      if (addressId) {
        conditions.push(or(
          eq(palletMovements.fromAddressId, addressId),
          eq(palletMovements.toAddressId, addressId),
        )!);
      }

      const movements = await db.select({
        id: palletMovements.id,
        palletId: palletMovements.palletId,
        companyId: palletMovements.companyId,
        movementType: palletMovements.movementType,
        fromAddressId: palletMovements.fromAddressId,
        toAddressId: palletMovements.toAddressId,
        fromPalletId: palletMovements.fromPalletId,
        userId: palletMovements.userId,
        notes: palletMovements.notes,
        createdAt: palletMovements.createdAt,
        palletCode: pallets.code,
        userName: users.name,
      })
        .from(palletMovements)
        .leftJoin(pallets, eq(palletMovements.palletId, pallets.id))
        .leftJoin(users, eq(palletMovements.userId, users.id))
        .where(and(...conditions))
        .orderBy(desc(palletMovements.createdAt))
        .limit(200);

      res.json(movements);
    } catch (error) {
      log(`[WMS] Get movements error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar movimentações" });
    }
  });

  app.get("/api/counting-cycles", ...authMiddleware, wmsCounterRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const result = await db.select().from(countingCycles)
        .where(eq(countingCycles.companyId, companyId))
        .orderBy(desc(countingCycles.createdAt));
      res.json(result);
    } catch (error) {
      log(`[WMS] Get counting cycles error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar ciclos" });
    }
  });

  app.post("/api/counting-cycles", ...authMiddleware, wmsCounterRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { type, items, notes } = req.body;

      const cycle = await db.transaction(async (tx) => {
        const [cycle] = await tx.insert(countingCycles).values({
          companyId,
          type: type || "por_endereco",
          status: "pendente",
          createdBy: getUserId(req),
          notes: notes || null,
          createdAt: new Date().toISOString(),
        }).returning();

        if (Array.isArray(items)) {
          for (const item of items) {
            await tx.insert(countingCycleItems).values({
              cycleId: cycle.id,
              companyId,
              addressId: item.addressId || null,
              productId: item.productId || null,
              palletId: item.palletId || null,
              expectedQty: item.expectedQty ?? null,
              status: "pendente",
              createdAt: new Date().toISOString(),
            });
          }
        }

        return cycle;
      });

      await createAuditLog(req, "create", "counting_cycle", cycle.id, `Ciclo de contagem criado`);
      res.json(cycle);
    } catch (error) {
      log(`[WMS] Create counting cycle error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao criar ciclo" });
    }
  });

  app.get("/api/counting-cycles/:id", ...authMiddleware, wmsCounterRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const [cycle] = await db.select().from(countingCycles)
        .where(and(eq(countingCycles.id, id), eq(countingCycles.companyId, companyId)));
      if (!cycle) {
        return res.status(404).json({ error: "Ciclo não encontrado" });
      }

      const items = await db.select().from(countingCycleItems)
        .where(eq(countingCycleItems.cycleId, id));

      const productIds = [...new Set(items.map(i => i.productId).filter(Boolean))] as string[];
      const productMap = new Map<string, any>();
      if (productIds.length > 0) {
        const prods = await db.select().from(products)
          .where(sql`${products.id} IN (${sql.join(productIds.map(pid => sql`${pid}`), sql`, `)})`);
        for (const p of prods) productMap.set(p.id, p);
      }

      const enrichedItems = items.map(item => ({
        ...item,
        product: item.productId ? productMap.get(item.productId) || null : null,
      }));

      res.json({ ...cycle, items: enrichedItems });
    } catch (error) {
      log(`[WMS] Get counting cycle error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar ciclo" });
    }
  });

  app.post("/api/counting-cycles/:id/items", ...authMiddleware, wmsCounterRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;
      const { barcode, productId, palletCode, addressId } = req.body;

      const [cycle] = await db.select().from(countingCycles)
        .where(and(eq(countingCycles.id, id), eq(countingCycles.companyId, companyId)));
      if (!cycle) return res.status(404).json({ error: "Ciclo não encontrado" });
      if (cycle.status === "aprovado") return res.status(400).json({ error: "Ciclo já aprovado" });
      if (cycle.status === "em_andamento") return res.status(400).json({ error: "Não é possível adicionar itens a um ciclo em andamento" });

      if (cycle.type === "por_pallet" && palletCode) {
        const [pallet] = await db.select().from(pallets)
          .where(and(eq(pallets.code, palletCode), eq(pallets.companyId, companyId)));
        if (!pallet) return res.status(404).json({ error: "Pallet não encontrado" });
        if (pallet.status === "cancelado") return res.status(400).json({ error: "Pallet cancelado não pode ser contado" });

        const existingByPallet = await db.select().from(countingCycleItems)
          .where(and(eq(countingCycleItems.cycleId, id), eq(countingCycleItems.palletId, pallet.id)));
        if (existingByPallet.length > 0) return res.status(400).json({ error: "Pallet já adicionado a este ciclo" });

        const items = await db.select().from(palletItems)
          .where(eq(palletItems.palletId, pallet.id));

        if (items.length === 0) return res.status(400).json({ error: "Pallet sem itens" });

        const now = new Date().toISOString();
        const newItems: any[] = [];

        await db.transaction(async (tx) => {
          for (const pi of items) {
            const [newItem] = await tx.insert(countingCycleItems).values({
              id: `cci-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              cycleId: id,
              companyId,
              productId: pi.productId,
              palletId: pallet.id,
              addressId: pallet.addressId || null,
              expectedQty: Number(pi.quantity),
              status: "pendente",
              createdAt: now,
            }).returning();

            let productData = null;
            if (pi.productId) {
              const [p] = await tx.select().from(products).where(eq(products.id, pi.productId));
              productData = p || null;
            }
            newItems.push({ ...newItem, product: productData });
          }
        });

        return res.json(newItems);
      }

      if (cycle.type === "por_endereco" && addressId) {
        const [address] = await db.select().from(wmsAddresses)
          .where(and(eq(wmsAddresses.id, addressId), eq(wmsAddresses.companyId, companyId)));
        if (!address) return res.status(404).json({ error: "Endereço não encontrado" });

        const existingByAddr = await db.select().from(countingCycleItems)
          .where(and(eq(countingCycleItems.cycleId, id), eq(countingCycleItems.addressId, addressId)));
        if (existingByAddr.length > 0) return res.status(400).json({ error: "Endereço já adicionado a este ciclo" });

        const palletsAtAddr = await db.select().from(pallets)
          .where(and(
            eq(pallets.addressId, addressId),
            eq(pallets.companyId, companyId),
            sql`${pallets.status} != 'cancelado'`
          ));

        if (palletsAtAddr.length === 0) return res.status(400).json({ error: "Nenhum pallet neste endereço" });

        const now = new Date().toISOString();
        const newItems: any[] = [];

        await db.transaction(async (tx) => {
          for (const plt of palletsAtAddr) {
            const items = await tx.select().from(palletItems)
              .where(eq(palletItems.palletId, plt.id));

            for (const pi of items) {
              const [newItem] = await tx.insert(countingCycleItems).values({
                id: `cci-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                cycleId: id,
                companyId,
                productId: pi.productId,
                palletId: plt.id,
                addressId: addressId,
                expectedQty: Number(pi.quantity),
                status: "pendente",
                createdAt: now,
              }).returning();

              let productData = null;
              if (pi.productId) {
                const [p] = await tx.select().from(products).where(eq(products.id, pi.productId));
                productData = p || null;
              }
              newItems.push({ ...newItem, product: productData });
            }
          }
        });

        return res.json(newItems);
      }

      if (cycle.type === "por_pallet" && !palletCode) {
        return res.status(400).json({ error: "Informe o código do pallet" });
      }
      if (cycle.type === "por_endereco" && !addressId) {
        return res.status(400).json({ error: "Selecione um endereço" });
      }

      let resolvedProductId = productId || null;
      if (!resolvedProductId && barcode) {
        const [found] = await db.select().from(products).where(
          or(eq(products.barcode, barcode), eq(products.erpCode, barcode))
        );
        if (!found) return res.status(404).json({ error: "Produto não encontrado para este código" });
        resolvedProductId = found.id;
      }

      const [newItem] = await db.insert(countingCycleItems).values({
        id: `cci-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        cycleId: id,
        companyId,
        productId: resolvedProductId,
        palletId: null,
        addressId: null,
        expectedQty: null,
        status: "pendente",
        createdAt: new Date().toISOString(),
      }).returning();

      let productData = null;
      if (resolvedProductId) {
        const [p] = await db.select().from(products).where(eq(products.id, resolvedProductId));
        productData = p || null;
      }

      res.json({ ...newItem, product: productData });
    } catch (error) {
      log(`[WMS] Add counting cycle item error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao adicionar item" });
    }
  });

  app.patch("/api/counting-cycles/:id/item", ...authMiddleware, wmsCounterRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;
      const parsed = countItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
      }
      const { itemId, countedQty, lot, expiryDate } = parsed.data;

      const [cycle] = await db.select().from(countingCycles)
        .where(and(eq(countingCycles.id, id), eq(countingCycles.companyId, companyId)));
      if (!cycle) {
        return res.status(404).json({ error: "Ciclo não encontrado" });
      }
      if (cycle.status === "aprovado") {
        return res.status(400).json({ error: "Ciclo já aprovado" });
      }

      const [item] = await db.select().from(countingCycleItems)
        .where(and(eq(countingCycleItems.id, itemId), eq(countingCycleItems.cycleId, id)));
      if (!item) {
        return res.status(404).json({ error: "Item não encontrado" });
      }

      const now = new Date().toISOString();
      let divergencePct: number | null = null;
      if (item.expectedQty !== null && item.expectedQty !== undefined && item.expectedQty > 0) {
        divergencePct = Math.abs((countedQty - item.expectedQty) / item.expectedQty) * 100;
      }

      const updates: any = {
        countedQty,
        countedBy: getUserId(req),
        countedAt: now,
        status: "contado",
        divergencePct,
      };

      if (lot !== undefined) {
        updates.oldLot = item.lot;
        updates.lot = lot;
      }
      if (expiryDate !== undefined) {
        updates.oldExpiryDate = item.expiryDate;
        updates.expiryDate = expiryDate;
      }

      if (divergencePct !== null && divergencePct > 0) {
        updates.status = "divergente";
      }

      await db.transaction(async (tx) => {
        await tx.update(countingCycleItems).set(updates).where(eq(countingCycleItems.id, itemId));

        const allItems = await tx.select().from(countingCycleItems)
          .where(eq(countingCycleItems.cycleId, id));
        const allCounted = allItems.every(i => i.id === itemId ? true : i.status !== "pendente");
        if (allCounted) {
          await tx.update(countingCycles).set({
            status: "concluido",
            completedAt: now,
          }).where(eq(countingCycles.id, id));
        } else if (cycle.status === "pendente") {
          await tx.update(countingCycles).set({ status: "em_andamento" }).where(eq(countingCycles.id, id));
        }
      });

      await createAuditLog(req, "count_item", "counting_cycle_item", itemId, `Contagem: ${countedQty} (esperado: ${item.expectedQty})`);
      res.json({ success: true });
    } catch (error) {
      log(`[WMS] Count item error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao registrar contagem" });
    }
  });

  app.post("/api/counting-cycles/:id/approve", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const [cycle] = await db.select().from(countingCycles)
        .where(and(eq(countingCycles.id, id), eq(countingCycles.companyId, companyId)));
      if (!cycle) {
        return res.status(404).json({ error: "Ciclo não encontrado" });
      }
      if (cycle.status !== "concluido") {
        return res.status(400).json({ error: "Ciclo precisa estar concluído para aprovação" });
      }

      const now = new Date().toISOString();
      const approveUserId = getUserId(req);

      const items = await db.select().from(countingCycleItems)
        .where(eq(countingCycleItems.cycleId, id));

      await db.transaction(async (tx) => {
        await tx.update(countingCycles).set({
          status: "aprovado",
          approvedBy: approveUserId,
          approvedAt: now,
        }).where(eq(countingCycles.id, id));

        const stockByProduct = new Map<string, number>();
        for (const item of items) {
          if (item.countedQty !== null && item.productId) {
            stockByProduct.set(item.productId, (stockByProduct.get(item.productId) || 0) + item.countedQty);
          }
        }

        for (const [productId, totalQty] of stockByProduct.entries()) {
          const existing = await tx.select().from(productCompanyStock)
            .where(and(
              eq(productCompanyStock.productId, productId),
              eq(productCompanyStock.companyId, companyId),
            ));

          if (existing.length > 0) {
            await tx.update(productCompanyStock).set({
              stockQty: totalQty,
              erpUpdatedAt: now,
            }).where(eq(productCompanyStock.id, existing[0].id));
          } else {
            await tx.insert(productCompanyStock).values({
              productId,
              companyId,
              stockQty: totalQty,
              erpUpdatedAt: now,
            });
          }
        }

        for (const item of items) {
          if (item.palletId && item.productId) {
            const updateFields: any = {};
            if (item.lot !== undefined) updateFields.lot = item.lot;
            if (item.expiryDate !== undefined) updateFields.expiryDate = item.expiryDate;
            if (item.countedQty !== null && item.countedQty !== undefined) {
              updateFields.quantity = item.countedQty;
            }
            if (Object.keys(updateFields).length > 0) {
              await tx.update(palletItems).set(updateFields).where(and(
                eq(palletItems.palletId, item.palletId),
                eq(palletItems.productId, item.productId),
              ));
            }

            if (item.countedQty !== null && item.countedQty !== undefined) {
              await tx.insert(palletMovements).values({
                palletId: item.palletId,
                companyId,
                movementType: "counted",
                userId: approveUserId,
                notes: `Contagem aprovada: ${item.countedQty}${item.expectedQty != null ? ` (esperado: ${item.expectedQty})` : ""}`,
                createdAt: now,
              });
            }
          }

          await tx.update(countingCycleItems).set({ status: "aprovado" })
            .where(eq(countingCycleItems.id, item.id));
        }
      });

      await createAuditLog(req, "approve", "counting_cycle", id, `Ciclo aprovado`);
      res.json({ success: true });
    } catch (error) {
      log(`[WMS] Approve counting cycle error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao aprovar ciclo" });
    }
  });

  app.post("/api/counting-cycles/:id/reject", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;
      const { notes } = req.body;

      const [cycle] = await db.select().from(countingCycles)
        .where(and(eq(countingCycles.id, id), eq(countingCycles.companyId, companyId)));
      if (!cycle) {
        return res.status(404).json({ error: "Ciclo não encontrado" });
      }

      await db.update(countingCycles).set({
        status: "rejeitado",
        notes: notes || cycle.notes,
      }).where(eq(countingCycles.id, id));

      await createAuditLog(req, "reject", "counting_cycle", id, `Ciclo rejeitado: ${notes || ''}`);
      res.json({ success: true });
    } catch (error) {
      log(`[WMS] Reject counting cycle error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao rejeitar ciclo" });
    }
  });

  app.delete("/api/counting-cycles/:id", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const [cycle] = await db.select().from(countingCycles)
        .where(and(eq(countingCycles.id, id), eq(countingCycles.companyId, companyId)));
      if (!cycle) {
        return res.status(404).json({ error: "Ciclo não encontrado" });
      }

      if (cycle.status === "em_andamento") {
        return res.status(400).json({ error: "Não é possível apagar um ciclo em andamento" });
      }

      await db.delete(countingCycleItems).where(eq(countingCycleItems.cycleId, id));
      await db.delete(countingCycles).where(eq(countingCycles.id, id));

      await createAuditLog(req, "delete", "counting_cycle", id, `Ciclo de contagem apagado (status: ${cycle.status})`);
      res.json({ success: true });
    } catch (error) {
      log(`[WMS] Delete counting cycle error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao apagar ciclo" });
    }
  });

  app.get("/api/products/by-barcode/:code", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const { code } = req.params;
      const companyId = getCompanyId(req);

      let [product] = await db.select().from(products)
        .where(eq(products.barcode, code));

      if (!product) {
        [product] = await db.select().from(products)
          .where(eq(products.erpCode, code));
      }

      if (!product) {
        const boxMatches = await db.select().from(products)
          .where(sql`${products.boxBarcodes}::text LIKE ${'%' + code + '%'}`);
        product = boxMatches.find(p => {
          if (!p.boxBarcodes) return false;
          try {
            const barcodes = typeof p.boxBarcodes === "string" ? JSON.parse(p.boxBarcodes) : p.boxBarcodes;
            return Array.isArray(barcodes) && barcodes.some((b: any) => b.code === code);
          } catch { return false; }
        }) as any;
      }

      if (!product) {
        return res.status(404).json({ error: "Produto não encontrado" });
      }

      const [cs] = await db.select().from(productCompanyStock)
        .where(and(eq(productCompanyStock.productId, product.id), eq(productCompanyStock.companyId, companyId)));

      let boxQty = null;
      if (product.boxBarcodes) {
        try {
          const barcodes = typeof product.boxBarcodes === "string" ? JSON.parse(product.boxBarcodes) : product.boxBarcodes;
          if (Array.isArray(barcodes)) {
            const match = barcodes.find((b: any) => b.code === code);
            if (match) boxQty = match.qty;
          }
        } catch {}
      }

      res.json({
        ...product,
        companyStockQty: cs?.stockQty ?? product.stockQty,
        boxQty,
      });
    } catch (error) {
      log(`[WMS] Product by barcode error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar produto" });
    }
  });

  app.get("/api/products/search", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string || "").trim();
      const companyId = getCompanyId(req);

      if (q.length < 2) return res.json([]);

      let results: typeof products.$inferSelect[] = [];

      if (q.includes("%")) {
        // Wildcard mode: user typed % as abbreviation wildcards for description search
        const pattern = (q.startsWith("%") ? "" : "%") + q + (q.endsWith("%") ? "" : "%");
        results = await db.select().from(products)
          .where(ilike(products.name, pattern))
          .limit(50);
      } else {
        // Priority 1: exact ERP code match → return only that product
        const exactErp = await db.select().from(products)
          .where(eq(products.erpCode, q))
          .limit(1);

        if (exactErp.length > 0) {
          results = exactErp;
        } else {
          // Priority 2: exact barcode match (main barcode or additional barcodes table)
          const barcodeResults = await db.select().from(products)
            .where(or(
              eq(products.barcode, q),
              sql`EXISTS (
                SELECT 1 FROM product_barcodes pb
                WHERE pb.product_id = ${products.id}
                  AND pb.barcode = ${q}
                  AND (pb.company_id = ${companyId} OR pb.company_id IS NULL)
              )`
            ))
            .limit(20);

          if (barcodeResults.length > 0) {
            results = barcodeResults;
          } else {
            // Priority 3: general partial search — name (words as wildcards) + partial ERP + partial barcode
            const escapedQ = q.replace(/[%_\\]/g, "\\$&");
            const namePattern = `%${escapedQ.replace(/\s+/g, "%")}%`;
            const partialPattern = `%${escapedQ}%`;
            const partialBarcodeSubquery = sql`EXISTS (
              SELECT 1 FROM product_barcodes pb
              WHERE pb.product_id = ${products.id}
                AND pb.barcode ILIKE ${partialPattern}
                AND (pb.company_id = ${companyId} OR pb.company_id IS NULL)
            )`;

            results = await db.select().from(products)
              .where(or(
                ilike(products.name, namePattern),
                ilike(products.erpCode, partialPattern),
                ilike(products.barcode, partialPattern),
                partialBarcodeSubquery
              ))
              .limit(50);
          }
        }
      }

      const productIds = results.map(p => p.id);

      const allCompanyStock = productIds.length > 0
        ? await db.select().from(productCompanyStock)
            .where(and(
              sql`${productCompanyStock.productId} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
              eq(productCompanyStock.companyId, companyId)
            ))
        : [];

      const stockMap = new Map<string, number>();
      for (const cs of allCompanyStock) {
        stockMap.set(cs.productId, Number(cs.stockQty));
      }

      const addressStockAll = productIds.length > 0
        ? await db.select({
            productId: palletItems.productId,
            addressCode: wmsAddresses.code,
            quantity: sql<number>`SUM(${palletItems.quantity})`
          })
          .from(palletItems)
          .innerJoin(pallets, eq(palletItems.palletId, pallets.id))
          .innerJoin(wmsAddresses, eq(pallets.addressId, wmsAddresses.id))
          .where(and(
            sql`${palletItems.productId} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
            eq(palletItems.companyId, companyId),
            sql`${pallets.status} != 'cancelado'`
          ))
          .groupBy(palletItems.productId, wmsAddresses.code)
        : [];

      const addressStockByProduct = new Map<string, Array<{ code: string; quantity: number }>>();
      for (const row of addressStockAll) {
        const list = addressStockByProduct.get(row.productId) || [];
        list.push({ code: row.addressCode, quantity: Number(row.quantity) });
        addressStockByProduct.set(row.productId, list);
      }

      const lastMovements = productIds.length > 0
        ? await db.select({
            productId: palletItems.productId,
            lastMovement: sql<string>`MAX(${palletMovements.createdAt})`,
            lastMovementType: sql<string>`(ARRAY_AGG(${palletMovements.movementType} ORDER BY ${palletMovements.createdAt} DESC))[1]`
          })
          .from(palletMovements)
          .innerJoin(palletItems, eq(palletMovements.palletId, palletItems.palletId))
          .where(and(
            sql`${palletItems.productId} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
            eq(palletItems.companyId, companyId)
          ))
          .groupBy(palletItems.productId)
        : [];

      const lastMovementMap = new Map<string, { date: string; type: string }>();
      for (const m of lastMovements) {
        lastMovementMap.set(m.productId, { date: m.lastMovement, type: m.lastMovementType });
      }

      const withStock = results.map(p => {
        const totalStock = stockMap.get(p.id) ?? Number(p.stockQty ?? 0);
        const addresses = addressStockByProduct.get(p.id) || [];
        const totalInAddresses = addresses.reduce((acc, curr) => acc + curr.quantity, 0);
        const pickingStock = Math.max(0, totalStock - totalInAddresses);
        const lastMove = lastMovementMap.get(p.id);

        return {
          ...p,
          companyStockQty: totalStock,
          totalStock,
          palletizedStock: totalInAddresses,
          pickingStock,
          addressCount: addresses.length,
          hasNoAddress: addresses.length === 0 && totalStock > 0,
          lastMovementDate: lastMove?.date || null,
          lastMovementType: lastMove?.type || null,
          addresses,
        };
      });

      const sorted = [...withStock].sort((a, b) => {
        if (a.erpCode === q) return -1;
        if (b.erpCode === q) return 1;
        if (a.totalStock > 0 && b.totalStock === 0) return -1;
        if (b.totalStock > 0 && a.totalStock === 0) return 1;
        return (a.name || "").localeCompare(b.name || "");
      });

      res.json(sorted);
    } catch (error) {
      log(`[WMS] Product search error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar produtos" });
    }
  });

  app.get("/api/products/:id/stock", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { id } = req.params;

      const [product] = await db.select().from(products).where(eq(products.id, id));
      if (!product) {
        return res.status(404).json({ error: "Produto não encontrado" });
      }

      const [companyStock] = await db.select().from(productCompanyStock)
        .where(and(eq(productCompanyStock.productId, id), eq(productCompanyStock.companyId, companyId)));

      res.json({
        productId: id,
        companyId,
        stockQty: companyStock?.stockQty ?? product.stockQty,
        source: companyStock ? "product_company_stock" : "products_legacy",
        erpUpdatedAt: companyStock?.erpUpdatedAt || product.erpUpdatedAt,
      });
    } catch (error) {
      log(`[WMS] Get product stock error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar estoque" });
    }
  });

  app.post("/api/products/stock-batch", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { productIds } = req.body;
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.json({});
      }

      const ids = productIds.slice(0, 100);

      const companyStockRows = await db.select().from(productCompanyStock)
        .where(and(
          sql`${productCompanyStock.productId} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`,
          eq(productCompanyStock.companyId, companyId)
        ));

      const stockMap = new Map<string, number>();
      for (const cs of companyStockRows) {
        stockMap.set(cs.productId, Number(cs.stockQty));
      }

      const productsRows = await db.select({ id: products.id, stockQty: products.stockQty, unit: products.unit })
        .from(products)
        .where(sql`${products.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);

      const productMap = new Map<string, { stockQty: number; unit: string }>();
      for (const p of productsRows) {
        productMap.set(p.id, { stockQty: Number(p.stockQty ?? 0), unit: p.unit || "UN" });
      }

      const addressStock = await db.select({
          productId: palletItems.productId,
          quantity: sql<number>`SUM(${palletItems.quantity})`,
        })
        .from(palletItems)
        .innerJoin(pallets, eq(palletItems.palletId, pallets.id))
        .where(and(
          sql`${palletItems.productId} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`,
          eq(palletItems.companyId, companyId),
          sql`${pallets.status} != 'cancelado'`,
          sql`${pallets.addressId} IS NOT NULL`
        ))
        .groupBy(palletItems.productId);

      const palletizedMap = new Map<string, number>();
      for (const row of addressStock) {
        palletizedMap.set(row.productId, Number(row.quantity));
      }

      const result: Record<string, { totalStock: number; palletizedStock: number; pickingStock: number; difference: number; unit: string }> = {};
      for (const pid of ids) {
        const pInfo = productMap.get(pid);
        const totalStock = stockMap.get(pid) ?? pInfo?.stockQty ?? 0;
        const palletizedStock = palletizedMap.get(pid) || 0;
        const pickingStock = Math.max(0, totalStock - palletizedStock);
        const wmsTotal = palletizedStock + pickingStock;
        result[pid] = {
          totalStock,
          palletizedStock,
          pickingStock,
          difference: wmsTotal - totalStock,
          unit: pInfo?.unit || "UN",
        };
      }

      res.json(result);
    } catch (error) {
      log(`[WMS] Batch stock info error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar info de estoque" });
    }
  });

  const anyOperationalRole = requireRole("recebedor", "empilhador", "conferente_wms", "supervisor", "administrador", "separacao", "conferencia", "balcao");
  app.post("/api/products/addresses-batch", ...authMiddleware, anyOperationalRole, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { productIds } = req.body;
      if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.json({});
      }

      const ids = productIds.slice(0, 200);
      const result: Record<string, { code: string; type: string | null; quantity: number; addressId: string }[]> = {};

      // 1) Pallet-based addresses
      const palletRows = await db.select({
          productId: palletItems.productId,
          addressId: wmsAddresses.id,
          addressCode: wmsAddresses.code,
          addressType: wmsAddresses.type,
          quantity: sql<number>`SUM(${palletItems.quantity})`,
        })
        .from(palletItems)
        .innerJoin(pallets, eq(palletItems.palletId, pallets.id))
        .innerJoin(wmsAddresses, eq(pallets.addressId, wmsAddresses.id))
        .where(and(
          sql`${palletItems.productId} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`,
          eq(palletItems.companyId, companyId),
          ne(pallets.status, 'cancelado')
        ))
        .groupBy(palletItems.productId, wmsAddresses.id, wmsAddresses.code, wmsAddresses.type);

      for (const row of palletRows) {
        if (!result[row.productId]) result[row.productId] = [];
        result[row.productId].push({
          addressId: row.addressId,
          code: row.addressCode,
          type: row.addressType,
          quantity: Number(row.quantity),
        });
      }

      // 2) Direct product-address mappings
      const directRows = await db.select({
          productId: productAddresses.productId,
          addressId: wmsAddresses.id,
          addressCode: wmsAddresses.code,
          addressType: wmsAddresses.type,
        })
        .from(productAddresses)
        .innerJoin(wmsAddresses, eq(productAddresses.addressId, wmsAddresses.id))
        .where(and(
          sql`${productAddresses.productId} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`,
          eq(productAddresses.companyId, companyId),
        ));

      for (const row of directRows) {
        if (!result[row.productId]) result[row.productId] = [];
        const exists = result[row.productId].some(a => a.code === row.addressCode);
        if (!exists) {
          result[row.productId].push({
            addressId: row.addressId,
            code: row.addressCode,
            type: row.addressType,
            quantity: 0,
          });
        }
      }

      res.json(result);
    } catch (error) {
      log(`[WMS] Batch addresses error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar endereços" });
    }
  });

  // Endpoint: deduzir quantidade de endereço durante separação
  const pickingRoles = requireRole("separacao", "supervisor", "administrador");

  app.post("/api/picking/deduct-address", ...authMiddleware, pickingRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const userId = getUserId(req);
      const { deductions } = req.body as {
        deductions: Array<{
          productId: string;
          addressId: string;
          quantity: number;
          orderId?: string;
          erpOrderId?: string;
          workUnitId?: string;
        }>;
      };

      if (!Array.isArray(deductions) || deductions.length === 0) {
        return res.status(400).json({ error: "Nenhuma dedução fornecida" });
      }

      const now = new Date().toISOString();
      const results = [];

      for (const ded of deductions) {
        const { productId, addressId, quantity, orderId, erpOrderId, workUnitId } = ded;

        // Busca dados do endereço e produto para log
        const [addr] = await db.select().from(wmsAddresses).where(eq(wmsAddresses.id, addressId));
        if (!addr) continue;

        const [product] = await db.select().from(products).where(eq(products.id, productId));
        const [usr] = await db.select({ name: sql<string>`name` }).from(sql`users`).where(sql`id = ${userId}`).catch(() => [null]);

        // Busca pallets no endereço com este produto (FIFO: mais antigo primeiro)
        const palletItemsAtAddress = await db.select({
          palletItemId: palletItems.id,
          palletId: palletItems.palletId,
          palletItemQty: palletItems.quantity,
          palletCreatedAt: pallets.createdAt,
        })
        .from(palletItems)
        .innerJoin(pallets, eq(palletItems.palletId, pallets.id))
        .where(and(
          eq(palletItems.productId, productId),
          eq(palletItems.companyId, companyId),
          eq(pallets.addressId, addressId),
          ne(pallets.status, 'cancelado')
        ))
        .orderBy(pallets.createdAt);

        // Deduz FIFO
        let remaining = quantity;
        for (const pi of palletItemsAtAddress) {
          if (remaining <= 0) break;
          const currentQty = Number(pi.palletItemQty);
          const deductQty = Math.min(remaining, currentQty);
          const newQty = currentQty - deductQty;

          if (newQty <= 0) {
            await db.delete(palletItems).where(eq(palletItems.id, pi.palletItemId));
          } else {
            await db.update(palletItems)
              .set({ quantity: newQty })
              .where(eq(palletItems.id, pi.palletItemId));
          }
          remaining -= deductQty;
        }

        // Registra no log de auditoria de endereço
        await db.insert(addressPickingLog).values({
          companyId,
          addressId,
          addressCode: addr.code,
          productId,
          productName: product?.name || null,
          erpCode: product?.erpCode || null,
          quantity,
          orderId: orderId || null,
          erpOrderId: erpOrderId || null,
          workUnitId: workUnitId || null,
          userId,
          userName: (usr as any)?.name || null,
          createdAt: now,
          notes: remaining > 0 ? `Saldo insuficiente: ${remaining} un não deduzidas` : null,
        });

        results.push({
          productId,
          addressId,
          addressCode: addr.code,
          requestedQty: quantity,
          deduzido: quantity - remaining,
          semSaldo: remaining,
        });
      }

      res.json({ ok: true, results });
    } catch (error) {
      log(`[WMS] Deduct address error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao deduzir endereço" });
    }
  });

  // Endpoint: log de movimentação de endereço (auditoria)
  app.get("/api/picking/address-log", ...authMiddleware, anyWmsRole, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { addressId, productId, orderId, limit: limitParam, offset: offsetParam } = req.query as Record<string, string>;
      const limitN = Math.min(parseInt(limitParam || "50"), 200);
      const offsetN = parseInt(offsetParam || "0");

      const conditions = [eq(addressPickingLog.companyId, companyId)];
      if (addressId) conditions.push(eq(addressPickingLog.addressId, addressId));
      if (productId) conditions.push(eq(addressPickingLog.productId, productId));
      if (orderId) conditions.push(eq(addressPickingLog.orderId, orderId));

      const rows = await db.select().from(addressPickingLog)
        .where(and(...conditions))
        .orderBy(desc(addressPickingLog.createdAt))
        .limit(limitN)
        .offset(offsetN);

      res.json(rows);
    } catch (error) {
      log(`[WMS] Address log error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar log" });
    }
  });

  // CRUD endpoints for direct product-address mappings
  const supervisorOrAdmin = requireRole("supervisor", "administrador");

  app.get("/api/product-addresses", ...authMiddleware, supervisorOrAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const productId = req.query.productId as string | undefined;
      const conditions = [eq(productAddresses.companyId, companyId)];
      if (productId) conditions.push(eq(productAddresses.productId, productId));

      const rows = await db.select({
          id: productAddresses.id,
          productId: productAddresses.productId,
          companyId: productAddresses.companyId,
          addressId: productAddresses.addressId,
          addressCode: wmsAddresses.code,
          addressType: wmsAddresses.type,
          productName: products.name,
          productErpCode: products.erpCode,
          createdAt: productAddresses.createdAt,
        })
        .from(productAddresses)
        .innerJoin(wmsAddresses, eq(productAddresses.addressId, wmsAddresses.id))
        .innerJoin(products, eq(productAddresses.productId, products.id))
        .where(and(...conditions))
        .orderBy(products.name);

      res.json(rows);
    } catch (error) {
      log(`[WMS] Get product addresses error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar endereços de produto" });
    }
  });

  app.post("/api/product-addresses", ...authMiddleware, supervisorOrAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const parsed = insertProductAddressSchema.safeParse({ ...req.body, companyId });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

      const [row] = await db.insert(productAddresses).values({
        id: randomUUID(),
        ...parsed.data,
      }).onConflictDoNothing().returning();

      res.json(row ?? { message: "Já existe" });
    } catch (error) {
      log(`[WMS] Create product address error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao criar endereço de produto" });
    }
  });

  app.delete("/api/product-addresses/:id", ...authMiddleware, supervisorOrAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      await db.delete(productAddresses)
        .where(and(eq(productAddresses.id, req.params.id), eq(productAddresses.companyId, companyId)));
      res.json({ success: true });
    } catch (error) {
      log(`[WMS] Delete product address error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao deletar endereço de produto" });
    }
  });

  app.post("/api/product-addresses/bulk", ...authMiddleware, supervisorOrAdmin, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { entries } = req.body as { entries: { productId: string; addressId: string }[] };
      if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: "Nenhuma entrada fornecida" });
      }
      const values = entries.map(e => ({ id: randomUUID(), productId: e.productId, companyId, addressId: e.addressId, createdAt: new Date().toISOString() }));
      await db.insert(productAddresses).values(values).onConflictDoNothing();
      res.json({ success: true, count: values.length });
    } catch (error) {
      log(`[WMS] Bulk product addresses error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao importar endereços" });
    }
  });

  app.get("/api/reports/counting-cycles", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const statusFilter = req.query.status as string | undefined;
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;

      const conditions = [eq(countingCycles.companyId, companyId)];
      if (statusFilter && statusFilter !== "all") {
        conditions.push(eq(countingCycles.status, statusFilter as any));
      }
      if (dateFrom) {
        conditions.push(sql`${countingCycles.createdAt} >= ${dateFrom}`);
      }
      if (dateTo) {
        conditions.push(sql`${countingCycles.createdAt} <= ${dateTo + "T23:59:59"}`);
      }

      const cycles = await db.select().from(countingCycles)
        .where(and(...conditions))
        .orderBy(desc(countingCycles.createdAt));

      const cycleIds = cycles.map(c => c.id);
      const allItems = cycleIds.length > 0
        ? await db.select().from(countingCycleItems)
            .where(sql`${countingCycleItems.cycleId} IN (${sql.join(cycleIds.map(id => sql`${id}`), sql`, `)})`)
        : [];

      const itemsByCycle = new Map<string, typeof allItems>();
      for (const item of allItems) {
        const list = itemsByCycle.get(item.cycleId) || [];
        list.push(item);
        itemsByCycle.set(item.cycleId, list);
      }

      const userIds = new Set<string>();
      cycles.forEach(c => { if (c.createdBy) userIds.add(c.createdBy); if (c.approvedBy) userIds.add(c.approvedBy); });
      allItems.forEach(i => { if (i.countedBy) userIds.add(i.countedBy); });

      const userList = userIds.size > 0
        ? await db.select({ id: users.id, name: users.name }).from(users)
            .where(sql`${users.id} IN (${sql.join([...userIds].map(id => sql`${id}`), sql`, `)})`)
        : [];
      const userMap = new Map<string, string>();
      for (const u of userList) userMap.set(u.id, u.name);

      const productIds = new Set<string>();
      const addressIds = new Set<string>();
      allItems.forEach(i => {
        if (i.productId) productIds.add(i.productId);
        if (i.addressId) addressIds.add(i.addressId);
      });

      const productList = productIds.size > 0
        ? await db.select({ id: products.id, name: products.name, erpCode: products.erpCode }).from(products)
            .where(sql`${products.id} IN (${sql.join([...productIds].map(id => sql`${id}`), sql`, `)})`)
        : [];
      const productMap = new Map<string, { name: string; erpCode: string }>();
      for (const p of productList) productMap.set(p.id, { name: p.name, erpCode: p.erpCode });

      const addressList = addressIds.size > 0
        ? await db.select({ id: wmsAddresses.id, code: wmsAddresses.code }).from(wmsAddresses)
            .where(sql`${wmsAddresses.id} IN (${sql.join([...addressIds].map(id => sql`${id}`), sql`, `)})`)
        : [];
      const addressMap = new Map<string, string>();
      for (const a of addressList) addressMap.set(a.id, a.code);

      const enriched = cycles.map(c => {
        const items = itemsByCycle.get(c.id) || [];
        const totalItems = items.length;
        const countedItems = items.filter(i => i.status === "contado" || i.status === "divergente").length;
        const divergentItems = items.filter(i => i.status === "divergente").length;
        const avgDivergence = divergentItems > 0
          ? items.filter(i => i.divergencePct !== null).reduce((sum, i) => sum + Math.abs(Number(i.divergencePct || 0)), 0) / Math.max(1, items.filter(i => i.divergencePct !== null).length)
          : 0;

        return {
          ...c,
          createdByName: c.createdBy ? userMap.get(c.createdBy) || "—" : "—",
          approvedByName: c.approvedBy ? userMap.get(c.approvedBy) || "—" : "—",
          totalItems,
          countedItems,
          divergentItems,
          avgDivergencePct: Math.round(avgDivergence * 100) / 100,
          items: items.map(i => ({
            ...i,
            productName: i.productId ? productMap.get(i.productId)?.name || "—" : "—",
            productErpCode: i.productId ? productMap.get(i.productId)?.erpCode || "—" : "—",
            addressCode: i.addressId ? addressMap.get(i.addressId) || "—" : "—",
            countedByName: i.countedBy ? userMap.get(i.countedBy) || "—" : "—",
          })),
        };
      });

      const summary = {
        totalCycles: cycles.length,
        byStatus: {
          pendente: cycles.filter(c => c.status === "pendente").length,
          em_andamento: cycles.filter(c => c.status === "em_andamento").length,
          concluido: cycles.filter(c => c.status === "concluido").length,
          aprovado: cycles.filter(c => c.status === "aprovado").length,
          rejeitado: cycles.filter(c => c.status === "rejeitado").length,
        },
        totalItemsCounted: allItems.filter(i => i.countedQty !== null).length,
        totalDivergent: allItems.filter(i => i.status === "divergente").length,
      };

      res.json({ cycles: enriched, summary });
    } catch (error) {
      log(`[WMS] Counting cycles report error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao gerar relatório de contagens" });
    }
  });

  app.get("/api/reports/wms-addresses", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const typeFilter = req.query.type as string | undefined;

      const conditions = [eq(wmsAddresses.companyId, companyId)];
      if (typeFilter && typeFilter !== "all") {
        conditions.push(eq(wmsAddresses.type, typeFilter));
      }

      const allAddresses = await db.select().from(wmsAddresses)
        .where(and(...conditions))
        .orderBy(wmsAddresses.code);

      const occupiedPallets = await db.select({
        addressId: pallets.addressId,
        palletId: pallets.id,
        palletCode: pallets.code,
        palletStatus: pallets.status,
      }).from(pallets)
        .where(and(
          eq(pallets.companyId, companyId),
          sql`${pallets.status} != 'cancelado'`,
          sql`${pallets.addressId} IS NOT NULL`,
        ));

      const occupancyMap = new Map<string, { palletId: string; palletCode: string; palletStatus: string }>();
      for (const p of occupiedPallets) {
        if (p.addressId) occupancyMap.set(p.addressId, { palletId: p.palletId, palletCode: p.palletCode, palletStatus: p.palletStatus });
      }

      const palletIds = occupiedPallets.map(p => p.palletId);
      const palletItemsData = palletIds.length > 0
        ? await db.select({
            palletId: palletItems.palletId,
            productId: palletItems.productId,
            quantity: palletItems.quantity,
          }).from(palletItems)
            .where(sql`${palletItems.palletId} IN (${sql.join(palletIds.map(id => sql`${id}`), sql`, `)})`)
        : [];

      const itemsByPallet = new Map<string, number>();
      for (const item of palletItemsData) {
        itemsByPallet.set(item.palletId, (itemsByPallet.get(item.palletId) || 0) + Number(item.quantity));
      }

      const enriched = allAddresses.map(addr => {
        const pallet = occupancyMap.get(addr.id);
        return {
          ...addr,
          occupied: !!pallet,
          palletCode: pallet?.palletCode || null,
          palletStatus: pallet?.palletStatus || null,
          palletItemCount: pallet ? (itemsByPallet.get(pallet.palletId) || 0) : 0,
        };
      });

      const typeLabels: Record<string, string> = { standard: "Padrão", picking: "Picking", recebimento: "Recebimento", expedicao: "Expedição" };
      const summary = {
        total: allAddresses.length,
        active: allAddresses.filter(a => a.active).length,
        inactive: allAddresses.filter(a => !a.active).length,
        occupied: enriched.filter(a => a.occupied).length,
        empty: enriched.filter(a => a.active && !a.occupied).length,
        byType: Object.entries(
          allAddresses.reduce((acc, a) => { acc[a.type] = (acc[a.type] || 0) + 1; return acc; }, {} as Record<string, number>)
        ).map(([type, count]) => ({ type, label: typeLabels[type] || type, count })),
        occupancyRate: allAddresses.filter(a => a.active).length > 0
          ? Math.round((enriched.filter(a => a.occupied).length / allAddresses.filter(a => a.active).length) * 100)
          : 0,
      };

      res.json({ addresses: enriched, summary });
    } catch (error) {
      log(`[WMS] WMS addresses report error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao gerar relatório de endereços" });
    }
  });

  app.get("/api/reports/pallet-movements", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const dateFrom = req.query.dateFrom as string | undefined;
      const dateTo = req.query.dateTo as string | undefined;
      const movType = req.query.type as string | undefined;

      const conditions = [eq(palletMovements.companyId, companyId)];
      if (dateFrom) {
        conditions.push(sql`${palletMovements.createdAt} >= ${dateFrom}`);
      }
      if (dateTo) {
        conditions.push(sql`${palletMovements.createdAt} <= ${dateTo + "T23:59:59"}`);
      }
      if (movType && movType !== "all") {
        conditions.push(eq(palletMovements.movementType, movType as any));
      }

      const movements = await db.select().from(palletMovements)
        .where(and(...conditions))
        .orderBy(desc(palletMovements.createdAt))
        .limit(500);

      const palletIdsSet = new Set(movements.map(m => m.palletId));
      const addressIdsSet = new Set<string>();
      movements.forEach(m => {
        if (m.fromAddressId) addressIdsSet.add(m.fromAddressId);
        if (m.toAddressId) addressIdsSet.add(m.toAddressId);
      });
      const userIdsSet = new Set(movements.map(m => m.userId).filter(Boolean) as string[]);

      const palletList = palletIdsSet.size > 0
        ? await db.select({ id: pallets.id, code: pallets.code }).from(pallets)
            .where(sql`${pallets.id} IN (${sql.join([...palletIdsSet].map(id => sql`${id}`), sql`, `)})`)
        : [];
      const palletMap = new Map<string, string>();
      for (const p of palletList) palletMap.set(p.id, p.code);

      const addrList = addressIdsSet.size > 0
        ? await db.select({ id: wmsAddresses.id, code: wmsAddresses.code }).from(wmsAddresses)
            .where(sql`${wmsAddresses.id} IN (${sql.join([...addressIdsSet].map(id => sql`${id}`), sql`, `)})`)
        : [];
      const addrMap = new Map<string, string>();
      for (const a of addrList) addrMap.set(a.id, a.code);

      const uList = userIdsSet.size > 0
        ? await db.select({ id: users.id, name: users.name }).from(users)
            .where(sql`${users.id} IN (${sql.join([...userIdsSet].map(id => sql`${id}`), sql`, `)})`)
        : [];
      const uMap = new Map<string, string>();
      for (const u of uList) uMap.set(u.id, u.name);

      const enriched = movements.map(m => ({
        ...m,
        palletCode: palletMap.get(m.palletId) || "—",
        fromAddressCode: m.fromAddressId ? addrMap.get(m.fromAddressId) || "—" : "—",
        toAddressCode: m.toAddressId ? addrMap.get(m.toAddressId) || "—" : "—",
        performedByName: m.userId ? uMap.get(m.userId) || "—" : "—",
      }));

      const movementTypeLabels: Record<string, string> = {
        created: "Criado",
        allocated: "Alocação",
        transferred: "Transferência",
        split: "Divisão",
        cancelled: "Cancelamento",
        counted: "Contagem",
      };

      const byType = movements.reduce((acc, m) => {
        acc[m.movementType] = (acc[m.movementType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const byDay = movements.reduce((acc, m) => {
        const day = m.createdAt.split("T")[0];
        acc[day] = (acc[day] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const summary = {
        totalMovements: movements.length,
        byType: Object.entries(byType).map(([type, count]) => ({ type, label: movementTypeLabels[type] || type, count })),
        byDay: Object.entries(byDay).sort(([a], [b]) => b.localeCompare(a)).slice(0, 30).map(([date, count]) => ({ date, count })),
      };

      res.json({ movements: enriched, summary });
    } catch (error) {
      log(`[WMS] Pallet movements report error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao gerar relatório de movimentações" });
    }
  });

  app.get("/api/reports/stock-discrepancy", ...authMiddleware, supervisorRoles, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const filterType = req.query.filter as string || "all";

      const allProducts = await db.select().from(products);
      const productIds = allProducts.map(p => p.id);

      const companyStock = productIds.length > 0
        ? await db.select().from(productCompanyStock)
            .where(and(
              sql`${productCompanyStock.productId} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
              eq(productCompanyStock.companyId, companyId)
            ))
        : [];

      const stockMap = new Map<string, number>();
      for (const cs of companyStock) {
        stockMap.set(cs.productId, Number(cs.stockQty));
      }

      const addressStockAll = productIds.length > 0
        ? await db.select({
            productId: palletItems.productId,
            addressId: wmsAddresses.id,
            addressCode: wmsAddresses.code,
            quantity: sql<number>`SUM(${palletItems.quantity})`,
            palletCode: sql<string>`STRING_AGG(DISTINCT ${pallets.code}, ', ')`,
          })
          .from(palletItems)
          .innerJoin(pallets, eq(palletItems.palletId, pallets.id))
          .innerJoin(wmsAddresses, eq(pallets.addressId, wmsAddresses.id))
          .where(and(
            sql`${palletItems.productId} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
            eq(palletItems.companyId, companyId),
            sql`${pallets.status} != 'cancelado'`
          ))
          .groupBy(palletItems.productId, wmsAddresses.id, wmsAddresses.code)
        : [];

      const addressStockByProduct = new Map<string, Array<{ addressCode: string; quantity: number; palletCode: string }>>();
      const palletizedByProduct = new Map<string, number>();
      for (const row of addressStockAll) {
        const list = addressStockByProduct.get(row.productId) || [];
        list.push({ addressCode: row.addressCode, quantity: Number(row.quantity), palletCode: row.palletCode });
        addressStockByProduct.set(row.productId, list);
        palletizedByProduct.set(row.productId, (palletizedByProduct.get(row.productId) || 0) + Number(row.quantity));
      }

      const results = allProducts.map(p => {
        const totalStock = stockMap.get(p.id) ?? Number(p.stockQty ?? 0);
        const palletizedStock = palletizedByProduct.get(p.id) || 0;
        const pickingStock = Math.max(0, totalStock - palletizedStock);
        const wmsTotal = palletizedStock + pickingStock;
        const difference = wmsTotal - totalStock;
        const addresses = addressStockByProduct.get(p.id) || [];

        return {
          id: p.id,
          name: p.name,
          erpCode: p.erpCode,
          barcode: p.barcode,
          section: p.section,
          manufacturer: p.manufacturer,
          unit: p.unit,
          totalStock,
          palletizedStock,
          pickingStock,
          wmsTotal,
          difference,
          addressCount: addresses.length,
          addresses,
        };
      }).filter(p => {
        if (filterType === "positive") return p.difference > 0;
        if (filterType === "negative") return p.difference < 0;
        if (filterType === "all_discrepancy") return p.difference !== 0;
        return p.difference !== 0;
      }).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

      const summary = {
        totalProducts: results.length,
        positiveCount: results.filter(p => p.difference > 0).length,
        negativeCount: results.filter(p => p.difference < 0).length,
        totalPositiveUnits: results.filter(p => p.difference > 0).reduce((s, p) => s + p.difference, 0),
        totalNegativeUnits: results.filter(p => p.difference < 0).reduce((s, p) => s + p.difference, 0),
      };

      res.json({ products: results, summary });
    } catch (error) {
      log(`[WMS] Stock discrepancy report error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao gerar relatório de divergências" });
    }
  });

  const barcodeCreateSchema = z.object({
    productId: z.string().min(1),
    barcode: z.string().min(1),
    type: z.enum(barcodeTypeEnum),
    packagingQty: z.number().int().positive().default(1),
    packagingType: z.string().max(50).optional().nullable(),
    isPrimary: z.boolean().optional().default(false),
    notes: z.string().max(500).optional().nullable(),
  });

  const barcodeUpdateSchema = z.object({
    barcode: z.string().min(1).optional(),
    packagingQty: z.number().int().positive().optional(),
    packagingType: z.string().max(50).optional().nullable(),
    isPrimary: z.boolean().optional(),
    notes: z.string().max(500).optional().nullable(),
  });

  const quickLinkSchema = z.object({
    productBarcode: z.string().min(1),
    packageBarcode: z.string().min(1),
    packagingQty: z.number().int().positive(),
    packagingType: z.string().max(50).optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  });

  app.get("/api/barcodes", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { productId, barcode, type, active, search, page, limit: lim } = req.query;
      const pageNum = Math.max(1, Number(page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(lim) || 50));

      const conditions: any[] = [];
      if (companyId) conditions.push(or(eq(productBarcodes.companyId, companyId), isNull(productBarcodes.companyId)));
      if (productId) conditions.push(eq(productBarcodes.productId, String(productId)));
      if (barcode) conditions.push(ilike(productBarcodes.barcode, `%${String(barcode)}%`));
      if (type) conditions.push(eq(productBarcodes.type, String(type) as BarcodeType));
      if (active === "true") conditions.push(eq(productBarcodes.active, true));
      else if (active === "false") conditions.push(eq(productBarcodes.active, false));

      let query = db.select({
        barcode: productBarcodes,
        productName: products.name,
        erpCode: products.erpCode,
        productSection: products.section,
        manufacturer: products.manufacturer,
      }).from(productBarcodes)
        .leftJoin(products, eq(productBarcodes.productId, products.id));

      if (search) {
        const s = `%${String(search)}%`;
        conditions.push(or(
          ilike(productBarcodes.barcode, s),
          ilike(products.name, s),
          ilike(products.erpCode, s),
        ));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const rows = await (where ? query.where(where) : query)
        .orderBy(desc(productBarcodes.createdAt))
        .limit(pageSize)
        .offset((pageNum - 1) * pageSize);

      const [countRow] = await db.select({ count: sql<number>`count(*)` })
        .from(productBarcodes)
        .leftJoin(products, eq(productBarcodes.productId, products.id))
        .where(where ?? sql`true`);

      res.json({
        data: rows.map(r => ({ ...r.barcode, productName: r.productName, erpCode: r.erpCode, productSection: r.productSection, manufacturer: r.manufacturer })),
        total: Number(countRow?.count ?? 0),
        page: pageNum,
        pageSize,
      });
    } catch (error) {
      log(`[WMS] [Barcodes] List error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao listar códigos de barras" });
    }
  });

  // ── Barcodes grouped by product (one row per product) ─────────────────────
  app.get("/api/barcodes/products", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const cid = Number(companyId);
      const { search, page, limit: lim } = req.query;
      const pageNum  = Math.max(1, Number(page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(lim) || 50));
      const offset   = (pageNum - 1) * pageSize;
      const { sql: rawSql } = await import("drizzle-orm");

      // Use parameterized SQL to prevent SQL injection
      const searchPat = search ? `%${String(search)}%` : null;

      const rowsResult = await db.execute(rawSql`
        SELECT
          p.id,
          p.name,
          p.erp_code,
          p.manufacturer,
          p.barcode          AS erp_barcode,
          p.box_barcode      AS erp_box_barcode,
          (
            SELECT json_agg(json_build_object(
              'id',           pb.id,
              'barcode',      pb.barcode,
              'type',         pb.type,
              'packagingQty', pb.packaging_qty,
              'packagingType',pb.packaging_type,
              'active',       pb.active,
              'isPrimary',    pb.is_primary,
              'notes',        pb.notes,
              'createdAt',    pb.created_at,
              'createdBy',    pb.created_by
            ) ORDER BY pb.active DESC, pb.type, pb.created_at)
            FROM product_barcodes pb
            WHERE pb.product_id = p.id
              AND (pb.company_id = ${cid} OR pb.company_id IS NULL)
          ) AS all_barcodes
        FROM products p
        WHERE (
          (p.barcode IS NOT NULL AND p.barcode <> '')
          OR (p.box_barcode IS NOT NULL AND p.box_barcode <> '')
          OR EXISTS (
            SELECT 1 FROM product_barcodes pb0
            WHERE pb0.product_id = p.id
              AND (pb0.company_id = ${cid} OR pb0.company_id IS NULL)
          )
        )
        ${searchPat ? rawSql`AND (
          p.name        ILIKE ${searchPat}
          OR p.erp_code ILIKE ${searchPat}
          OR p.manufacturer ILIKE ${searchPat}
          OR p.barcode  ILIKE ${searchPat}
          OR EXISTS (
            SELECT 1 FROM product_barcodes pbs
            WHERE pbs.product_id = p.id
              AND pbs.barcode ILIKE ${searchPat}
              AND (pbs.company_id = ${cid} OR pbs.company_id IS NULL)
          )
        )` : rawSql``}
        ORDER BY p.name
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const countResult = await db.execute(rawSql`
        SELECT COUNT(*) AS count FROM products p
        WHERE (
          (p.barcode IS NOT NULL AND p.barcode <> '')
          OR (p.box_barcode IS NOT NULL AND p.box_barcode <> '')
          OR EXISTS (
            SELECT 1 FROM product_barcodes pb0
            WHERE pb0.product_id = p.id
              AND (pb0.company_id = ${cid} OR pb0.company_id IS NULL)
          )
        )
        ${searchPat ? rawSql`AND (
          p.name        ILIKE ${searchPat}
          OR p.erp_code ILIKE ${searchPat}
          OR p.manufacturer ILIKE ${searchPat}
          OR p.barcode  ILIKE ${searchPat}
          OR EXISTS (
            SELECT 1 FROM product_barcodes pbs
            WHERE pbs.product_id = p.id
              AND pbs.barcode ILIKE ${searchPat}
              AND (pbs.company_id = ${cid} OR pbs.company_id IS NULL)
          )
        )` : rawSql``}
      `);

      const data = (rowsResult.rows as any[]).map(r => ({
        productId:      r.id,
        productName:    r.name,
        erpCode:        r.erp_code,
        manufacturer:   r.manufacturer,
        erpBarcode:     r.erp_barcode     || null,
        erpBoxBarcode:  r.erp_box_barcode || null,
        allBarcodes:    (r.all_barcodes as any[] | null) ?? [],
      }));

      res.json({
        data,
        total: Number((countResult.rows as any[])[0]?.count ?? 0),
        page: pageNum,
        pageSize,
      });
    } catch (error) {
      log(`[WMS] [Barcodes] Products list error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao listar produtos com códigos de barras" });
    }
  });

  app.get("/api/barcodes/by-product/:productId", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const rows = await db.select().from(productBarcodes)
        .where(and(
          eq(productBarcodes.productId, req.params.productId),
          or(eq(productBarcodes.companyId, companyId), isNull(productBarcodes.companyId)),
        ))
        .orderBy(desc(productBarcodes.active), productBarcodes.type, productBarcodes.createdAt);
      res.json(rows);
    } catch (error) {
      log(`[WMS] [Barcodes] By product error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar códigos do produto" });
    }
  });

  app.get("/api/barcodes/history/:productId", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const rows = await db.select().from(barcodeChangeHistory)
        .innerJoin(productBarcodes, eq(barcodeChangeHistory.barcodeId, productBarcodes.id))
        .where(and(eq(barcodeChangeHistory.productId, req.params.productId), eq(productBarcodes.companyId, companyId)))
        .orderBy(desc(barcodeChangeHistory.createdAt))
        .limit(100);
      res.json(rows.map(r => r.barcode_change_history));
    } catch (error) {
      log(`[WMS] [Barcodes] History error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar histórico" });
    }
  });

  app.get("/api/barcodes/lookup/:barcode", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const code = req.params.barcode;
      const companyId = getCompanyId(req);
      const rows = await db.select({
        barcode: productBarcodes,
        productName: products.name,
        erpCode: products.erpCode,
      }).from(productBarcodes)
        .leftJoin(products, eq(productBarcodes.productId, products.id))
        .where(and(eq(productBarcodes.barcode, code), eq(productBarcodes.active, true), eq(productBarcodes.companyId, companyId)));

      if (rows.length === 0) {
        const product = await storage.getProductByBarcode(code);
        if (product) {
          const isUnit = product.barcode === code;
          let qty = 1;
          if (!isUnit && product.boxBarcodes && Array.isArray(product.boxBarcodes)) {
            const bx = (product.boxBarcodes as any[]).find((b: any) => b.code === code);
            if (bx) qty = bx.qty;
          }
          return res.json({
            found: true, source: "legacy",
            product: { id: product.id, name: product.name, erpCode: product.erpCode },
            type: isUnit ? "UNITARIO" : "EMBALAGEM",
            packagingQty: qty,
          });
        }
        return res.json({ found: false });
      }

      const r = rows[0];
      res.json({
        found: true, source: "module",
        barcodeRecord: { ...r.barcode, productName: r.productName, erpCode: r.erpCode },
        product: { id: r.barcode.productId, name: r.productName, erpCode: r.erpCode },
        type: r.barcode.type,
        packagingQty: r.barcode.packagingQty,
      });
    } catch (error) {
      log(`[WMS] [Barcodes] Lookup error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao consultar código" });
    }
  });

  app.post("/api/barcodes", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const parsed = barcodeCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() });
      const data = parsed.data;
      const companyId = getCompanyId(req);
      const userId = getUserId(req);
      const userName = req.user?.name || req.user?.username || "unknown";

      const [prod] = await db.select().from(products).where(eq(products.id, data.productId)).limit(1);
      if (!prod) return res.status(404).json({ error: "Produto não encontrado" });

      const conflicting = await db.select().from(productBarcodes).where(
        and(eq(productBarcodes.barcode, data.barcode), eq(productBarcodes.active, true))
      );
      if (conflicting.length > 0) {
        const c = conflicting[0];
        if (c.productId !== data.productId || c.type !== data.type) {
          return res.status(409).json({
            error: "Código de barras já ativo para outro produto/tipo",
            conflictProductId: c.productId,
            conflictType: c.type,
          });
        }
        if (c.type === data.type && c.packagingQty === data.packagingQty) {
          return res.status(409).json({ error: "Código de barras já cadastrado com mesma configuração" });
        }
      }

      if (data.type === "UNITARIO") {
        data.packagingQty = 1;
        const existing = await db.select().from(productBarcodes).where(
          and(
            eq(productBarcodes.productId, data.productId),
            eq(productBarcodes.type, "UNITARIO"),
            eq(productBarcodes.active, true),
          )
        );
        if (existing.length > 0 && !data.isPrimary) {
          data.isPrimary = false;
        } else if (existing.length === 0) {
          data.isPrimary = true;
        }
      }

      const now = new Date().toISOString();
      const created = await db.transaction(async (tx) => {
        const [rec] = await tx.insert(productBarcodes).values({
          id: randomUUID(),
          companyId,
          productId: data.productId,
          barcode: data.barcode,
          type: data.type,
          packagingQty: data.packagingQty,
          packagingType: data.packagingType ?? null,
          active: true,
          isPrimary: data.isPrimary ?? false,
          notes: data.notes ?? null,
          createdAt: now,
          createdBy: userId,
        }).returning();

        await tx.insert(barcodeChangeHistory).values({
          barcodeId: rec.id,
          productId: data.productId,
          operation: "criacao",
          newBarcode: data.barcode,
          barcodeType: data.type,
          newQty: data.packagingQty,
          userId,
          userName,
          notes: data.notes ?? null,
          createdAt: now,
        });
        return rec;
      });

      log(`[Barcodes] Created: product=${data.productId} barcode=${data.barcode} type=${data.type} qty=${data.packagingQty} by=${userName}`);
      res.status(201).json(created);
    } catch (error) {
      log(`[WMS] [Barcodes] Create error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao cadastrar código de barras" });
    }
  });

  app.put("/api/barcodes/:id", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const parsed = barcodeUpdateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() });
      const data = parsed.data;
      const companyId = getCompanyId(req);
      const userId = getUserId(req);
      const userName = req.user?.name || req.user?.username || "unknown";

      const [existing] = await db.select().from(productBarcodes).where(
        and(eq(productBarcodes.id, req.params.id), eq(productBarcodes.companyId, companyId))
      ).limit(1);
      if (!existing) return res.status(404).json({ error: "Código não encontrado" });

      if (data.barcode && data.barcode !== existing.barcode) {
        const conflicts = await db.select().from(productBarcodes).where(
          and(eq(productBarcodes.barcode, data.barcode), eq(productBarcodes.active, true), ne(productBarcodes.id, existing.id))
        );
        if (conflicts.length > 0) {
          return res.status(409).json({ error: "Código de barras já ativo para outro registro" });
        }
      }

      const now = new Date().toISOString();
      const oldBarcode = existing.barcode;
      const oldQty = existing.packagingQty;

      const updateData: any = { updatedAt: now, updatedBy: userId };
      if (data.barcode !== undefined) updateData.barcode = data.barcode;
      if (data.packagingQty !== undefined) updateData.packagingQty = data.packagingQty;
      if (data.packagingType !== undefined) updateData.packagingType = data.packagingType;
      if (data.isPrimary !== undefined) updateData.isPrimary = data.isPrimary;
      if (data.notes !== undefined) updateData.notes = data.notes;

      const result = await db.transaction(async (tx) => {
        const [updated] = await tx.update(productBarcodes).set(updateData).where(eq(productBarcodes.id, req.params.id)).returning();
        const isReplace = data.barcode && data.barcode !== oldBarcode;
        await tx.insert(barcodeChangeHistory).values({
          barcodeId: existing.id,
          productId: existing.productId,
          operation: isReplace ? "substituicao" : "edicao",
          oldBarcode,
          newBarcode: data.barcode ?? oldBarcode,
          barcodeType: existing.type as BarcodeType,
          oldQty,
          newQty: data.packagingQty ?? oldQty,
          userId,
          userName,
          notes: data.notes ?? null,
          createdAt: now,
        });
        return { updated, isReplace };
      });

      log(`[Barcodes] Updated: id=${existing.id} ${result.isReplace ? "replaced" : "edited"} by=${userName}`);
      res.json(result.updated);
    } catch (error) {
      log(`[WMS] [Barcodes] Update error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao atualizar código de barras" });
    }
  });

  app.patch("/api/barcodes/:id/deactivate", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const userId = getUserId(req);
      const userName = req.user?.name || req.user?.username || "unknown";
      const notes = req.body.notes || null;

      const [existing] = await db.select().from(productBarcodes).where(
        and(eq(productBarcodes.id, req.params.id), eq(productBarcodes.companyId, companyId))
      ).limit(1);
      if (!existing) return res.status(404).json({ error: "Código não encontrado" });
      if (!existing.active) return res.status(400).json({ error: "Código já está inativo" });

      const now = new Date().toISOString();
      const updated = await db.transaction(async (tx) => {
        const [upd] = await tx.update(productBarcodes).set({
          active: false, deactivatedAt: now, deactivatedBy: userId, updatedAt: now, updatedBy: userId,
        }).where(eq(productBarcodes.id, req.params.id)).returning();

        await tx.insert(barcodeChangeHistory).values({
          barcodeId: existing.id,
          productId: existing.productId,
          operation: "desativacao",
          oldBarcode: existing.barcode,
          barcodeType: existing.type as BarcodeType,
          oldQty: existing.packagingQty,
          userId,
          userName,
          notes,
          createdAt: now,
        });
        return upd;
      });

      log(`[Barcodes] Deactivated: id=${existing.id} barcode=${existing.barcode} by=${userName}`);
      res.json(updated);
    } catch (error) {
      log(`[WMS] [Barcodes] Deactivate error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao desativar código" });
    }
  });

  app.patch("/api/barcodes/:id/activate", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const userId = getUserId(req);
      const userName = req.user?.name || req.user?.username || "unknown";

      const [existing] = await db.select().from(productBarcodes).where(
        and(eq(productBarcodes.id, req.params.id), eq(productBarcodes.companyId, companyId))
      ).limit(1);
      if (!existing) return res.status(404).json({ error: "Código não encontrado" });
      if (existing.active) return res.status(400).json({ error: "Código já está ativo" });

      const conflicts = await db.select().from(productBarcodes).where(
        and(eq(productBarcodes.barcode, existing.barcode), eq(productBarcodes.active, true))
      );
      if (conflicts.length > 0) {
        return res.status(409).json({ error: "Outro código ativo já usa este barcode" });
      }

      const now = new Date().toISOString();
      const updated = await db.transaction(async (tx) => {
        const [upd] = await tx.update(productBarcodes).set({
          active: true, deactivatedAt: null, deactivatedBy: null, updatedAt: now, updatedBy: userId,
        }).where(eq(productBarcodes.id, req.params.id)).returning();

        await tx.insert(barcodeChangeHistory).values({
          barcodeId: existing.id,
          productId: existing.productId,
          operation: "ativacao",
          newBarcode: existing.barcode,
          barcodeType: existing.type as BarcodeType,
          newQty: existing.packagingQty,
          userId,
          userName,
          createdAt: now,
        });
        return upd;
      });

      log(`[Barcodes] Activated: id=${existing.id} barcode=${existing.barcode} by=${userName}`);
      res.json(updated);
    } catch (error) {
      log(`[WMS] [Barcodes] Activate error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao ativar código" });
    }
  });

  app.post("/api/barcodes/import", isAuthenticated, requireCompany, requireRole("supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const userId = getUserId(req);
      const userName = req.user?.name || req.user?.username || "unknown";
      const now = new Date().toISOString();

      const rows: { productId: string; eanUnitario?: string; eanEmbalagem?: string; qtdEmbalagem?: number }[] = req.body.rows;
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: "Nenhuma linha enviada" });
      }

      log(`[Barcodes Import] Starting bulk import of ${rows.length} rows`);

      // ─── 1. Pre-load all data into memory (3 queries total) ───────────────────
      const [allProds, allActiveBarcodes] = await Promise.all([
        db.select({ id: products.id, erpCode: products.erpCode, barcode: products.barcode }).from(products),
        db.select({ id: productBarcodes.id, barcode: productBarcodes.barcode, productId: productBarcodes.productId, type: productBarcodes.type, packagingQty: productBarcodes.packagingQty }).from(productBarcodes).where(eq(productBarcodes.active, true)),
      ]);

      // Index products
      const productById   = new Map(allProds.map(p => [p.id, p]));
      const productByErp  = new Map(allProds.map(p => [p.erpCode, p]));
      const productByBarc = new Map(allProds.filter(p => p.barcode).map(p => [p.barcode!, p]));

      // Index active barcodes: barcode string -> record
      const activeBarcodeByCode = new Map(allActiveBarcodes.map(b => [b.barcode, b]));

      // Track which products already have a primary UNITARIO barcode
      const productsWithUnit = new Set(allActiveBarcodes.filter(b => b.type === "UNITARIO").map(b => b.productId));

      // ─── 2. Process all rows in memory ────────────────────────────────────────
      const results: { productId: string; resolvedCode?: string; status: string; message: string }[] = [];
      const toInsertBarcodes: (typeof productBarcodes.$inferInsert)[] = [];
      const toInsertHistory: (typeof barcodeChangeHistory.$inferInsert)[] = [];

      for (const row of rows) {
        const eanUnitario  = row.eanUnitario?.trim()  || undefined;
        const eanEmbalagem = row.eanEmbalagem?.trim() || undefined;
        const qtdEmbalagem = row.qtdEmbalagem;
        const rawProductId = (row.productId || "").trim();

        // ── Resolve product: try internal UUID → erpCode → EAN lookup ─────────
        let prod: { id: string; erpCode: string; barcode?: string | null } | undefined;

        if (rawProductId) {
          // Excel typically sends erpCode; fallback to internal id
          prod = productByErp.get(rawProductId) ?? productById.get(rawProductId);
        }

        if (!prod) {
          // No code (or code not found) — try to locate via EAN
          const eans = [eanUnitario, eanEmbalagem].filter(Boolean) as string[];
          for (const ean of eans) {
            prod = productByBarc.get(ean) ?? productByErp.get(ean);
            if (prod) break;
            const linked = activeBarcodeByCode.get(ean);
            if (linked) { prod = productById.get(linked.productId); if (prod) break; }
          }
          if (!prod) {
            const label = rawProductId || eans.join(", ") || "?";
            results.push({ productId: label, status: "error", message: rawProductId ? `Produto "${rawProductId}" não encontrado` : `Produto não encontrado pelo EAN (${label})` });
            continue;
          }
        }

        const productId = prod.id; // always use internal UUID from here on

        const rowMessages: string[] = [];

        // ── EAN Unitário ───────────────────────────────────────────────────────
        // activeBarcodeByCode is updated in-memory after every insert, so it
        // naturally prevents duplicates both across rows AND on re-import.
        if (eanUnitario) {
          const existing = activeBarcodeByCode.get(eanUnitario);
          if (existing && existing.productId !== productId) {
            rowMessages.push(`EAN unitário ${eanUnitario} já vinculado a outro produto`);
          } else if (!existing) {
            const isPrimary = !productsWithUnit.has(productId);
            const newId = crypto.randomUUID();
            toInsertBarcodes.push({ id: newId, companyId, productId, barcode: eanUnitario, type: "UNITARIO", packagingQty: 1, active: true, isPrimary, createdBy: userName, createdAt: now });
            toInsertHistory.push({ barcodeId: newId, productId, operation: "criacao", newBarcode: eanUnitario, barcodeType: "UNITARIO", newQty: 1, userId, userName, createdAt: now });
            activeBarcodeByCode.set(eanUnitario, { id: newId, barcode: eanUnitario, productId, type: "UNITARIO", packagingQty: 1 });
            productsWithUnit.add(productId);
          }
          // if existing && existing.productId === productId → already linked, silently skip (idempotent)
        }

        // ── EAN Embalagem ──────────────────────────────────────────────────────
        if (eanEmbalagem) {
          const qty = qtdEmbalagem && qtdEmbalagem > 1 ? qtdEmbalagem : 2;
          const existing = activeBarcodeByCode.get(eanEmbalagem);
          if (existing && existing.productId !== productId) {
            rowMessages.push(`EAN embalagem ${eanEmbalagem} já vinculado a outro produto`);
          } else if (!existing) {
            const newId = crypto.randomUUID();
            toInsertBarcodes.push({ id: newId, companyId, productId, barcode: eanEmbalagem, type: "EMBALAGEM", packagingQty: qty, active: true, isPrimary: false, createdBy: userName, createdAt: now });
            toInsertHistory.push({ barcodeId: newId, productId, operation: "criacao", newBarcode: eanEmbalagem, barcodeType: "EMBALAGEM", newQty: qty, userId, userName, createdAt: now });
            activeBarcodeByCode.set(eanEmbalagem, { id: newId, barcode: eanEmbalagem, productId, type: "EMBALAGEM", packagingQty: qty });
          }
          // if existing && existing.productId === productId → already linked, silently skip (idempotent)
        }

        results.push({
          productId,
          resolvedCode: prod.erpCode,
          status: rowMessages.length > 0 ? "warning" : "ok",
          message: rowMessages.length > 0 ? rowMessages.join("; ") : "Importado com sucesso",
        });
      }

      // ─── 3. Bulk INSERT in chunks of 500 (2 queries max each) ─────────────────
      const CHUNK = 500;
      for (let i = 0; i < toInsertBarcodes.length; i += CHUNK) {
        await db.insert(productBarcodes).values(toInsertBarcodes.slice(i, i + CHUNK));
      }
      for (let i = 0; i < toInsertHistory.length; i += CHUNK) {
        await db.insert(barcodeChangeHistory).values(toInsertHistory.slice(i, i + CHUNK));
      }

      const ok   = results.filter(r => r.status === "ok").length;
      const warn = results.filter(r => r.status === "warning").length;
      const err  = results.filter(r => r.status === "error").length;

      log(`[Barcodes Import] Done: ${ok} ok, ${warn} warn, ${err} error | inserted ${toInsertBarcodes.length} barcodes`);
      // Return only non-ok results to avoid large response payload
      res.json({ results: results.filter(r => r.status !== "ok"), summary: { ok, warn, error: err } });
    } catch (error) {
      log(`[WMS] [Barcodes] Import error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao importar códigos" });
    }
  });

  app.post("/api/barcodes/quick-link", isAuthenticated, requireCompany, requireRole("operador", "supervisor", "administrador"), async (req: Request, res: Response) => {
    try {
      const parsed = quickLinkSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten() });
      const data = parsed.data;
      const companyId = getCompanyId(req);
      const userId = getUserId(req);
      const userName = req.user?.name || req.user?.username || "unknown";

      const product = await storage.getProductByBarcode(data.productBarcode);
      if (!product) return res.status(404).json({ error: "Produto não encontrado pelo código unitário" });

      if (data.productBarcode === data.packageBarcode) {
        return res.status(400).json({ error: "Código de embalagem não pode ser igual ao unitário" });
      }

      const now = new Date().toISOString();
      await db.transaction(async (tx) => {
        const conflicting = await tx.select().from(productBarcodes).where(
          and(eq(productBarcodes.barcode, data.packageBarcode), eq(productBarcodes.active, true))
        );
        for (const c of conflicting) {
          if (c.productId !== product.id) {
            throw new Error("Código de embalagem já ativo para outro produto");
          }
        }

        const existingUnit = await tx.select().from(productBarcodes).where(
          and(
            eq(productBarcodes.productId, product.id),
            eq(productBarcodes.barcode, data.productBarcode),
            eq(productBarcodes.type, "UNITARIO"),
            eq(productBarcodes.active, true),
          )
        );
        if (existingUnit.length === 0) {
          const unitId = randomUUID();
          await tx.insert(productBarcodes).values({
            id: unitId, companyId, productId: product.id,
            barcode: data.productBarcode, type: "UNITARIO",
            packagingQty: 1, active: true, isPrimary: true,
            createdAt: now, createdBy: userId,
          });
          await tx.insert(barcodeChangeHistory).values({
            barcodeId: unitId, productId: product.id, operation: "criacao",
            newBarcode: data.productBarcode, barcodeType: "UNITARIO", newQty: 1,
            userId, userName, notes: "Auto-criado via vínculo rápido", createdAt: now,
          });
        }

        const existingPkg = await tx.select().from(productBarcodes).where(
          and(
            eq(productBarcodes.productId, product.id),
            eq(productBarcodes.barcode, data.packageBarcode),
            eq(productBarcodes.type, "EMBALAGEM"),
            eq(productBarcodes.active, true),
          )
        );

        if (existingPkg.length > 0) {
          const old = existingPkg[0];
          if (old.packagingQty !== data.packagingQty || old.packagingType !== (data.packagingType ?? null)) {
          await tx.update(productBarcodes).set({
            packagingQty: data.packagingQty,
            packagingType: data.packagingType ?? null,
            updatedAt: now, updatedBy: userId,
          }).where(eq(productBarcodes.id, old.id));
          await tx.insert(barcodeChangeHistory).values({
            barcodeId: old.id, productId: product.id, operation: "edicao",
            oldBarcode: data.packageBarcode, newBarcode: data.packageBarcode,
            barcodeType: "EMBALAGEM", oldQty: old.packagingQty, newQty: data.packagingQty,
            userId, userName, notes: data.notes ?? "Atualizado via vínculo rápido", createdAt: now,
          });
          }
        } else {
          for (const c of conflicting) {
            if (c.productId === product.id && c.type === "EMBALAGEM") {
              await tx.update(productBarcodes).set({
                active: false, deactivatedAt: now, deactivatedBy: userId, updatedAt: now, updatedBy: userId,
              }).where(eq(productBarcodes.id, c.id));
              await tx.insert(barcodeChangeHistory).values({
                barcodeId: c.id, productId: product.id, operation: "substituicao",
                oldBarcode: c.barcode, newBarcode: data.packageBarcode,
                barcodeType: "EMBALAGEM", oldQty: c.packagingQty, newQty: data.packagingQty,
                userId, userName, notes: "Substituído via vínculo rápido", createdAt: now,
              });
            }
          }

          const pkgId = randomUUID();
          await tx.insert(productBarcodes).values({
            id: pkgId, companyId, productId: product.id,
            barcode: data.packageBarcode, type: "EMBALAGEM",
            packagingQty: data.packagingQty, packagingType: data.packagingType ?? null,
            active: true, isPrimary: false,
            createdAt: now, createdBy: userId,
          });
          await tx.insert(barcodeChangeHistory).values({
            barcodeId: pkgId, productId: product.id, operation: "criacao",
            newBarcode: data.packageBarcode, barcodeType: "EMBALAGEM", newQty: data.packagingQty,
            userId, userName, notes: data.notes ?? "Criado via vínculo rápido", createdAt: now,
          });
        }

        // Sincroniza o campo legado products.boxBarcodes (JSONB) com a tabela
        // normalizada productBarcodes. Diversos consumidores (incluindo o
        // getWorkUnits usado pelos módulos de coleta — Separação, Conferência,
        // Balcão) ainda fazem o lookup do EAN olhando product.boxBarcodes.
        // Sem este sync, o vínculo recém-criado existe em productBarcodes mas
        // não aparece no cache local do operador, e a próxima leitura mostra
        // "Produto não encontrado nos seus pedidos em aberto".
        const activePkgs = await tx.select().from(productBarcodes).where(
          and(
            eq(productBarcodes.productId, product.id),
            eq(productBarcodes.type, "EMBALAGEM"),
            eq(productBarcodes.active, true),
          )
        );
        const newBoxBarcodes = activePkgs.map(p => ({
          code: p.barcode,
          qty: p.packagingQty || 1,
        }));
        await tx.update(products).set({
          boxBarcodes: newBoxBarcodes.length > 0 ? newBoxBarcodes : null,
        }).where(eq(products.id, product.id));
      });

      log(`[Barcodes] Quick-link: product=${product.erpCode} unit=${data.productBarcode} pkg=${data.packageBarcode} qty=${data.packagingQty} by=${userName}`);
      res.json({ status: "success", productId: product.id, productName: product.name, erpCode: product.erpCode });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log(`[WMS] [Barcodes] Quick-link error: ${errMsg}`);
      if (errMsg === "Código de embalagem já ativo para outro produto") {
        return res.status(409).json({ error: errMsg });
      }
      res.status(500).json({ error: "Erro ao vincular códigos" });
    }
  });

  app.get("/api/barcodes/multiplier/:barcode", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const code = req.params.barcode;
      const [pb] = await db.select().from(productBarcodes).where(
        and(eq(productBarcodes.barcode, code), eq(productBarcodes.active, true))
      ).limit(1);
      if (pb) {
        return res.json({ multiplier: pb.type === "UNITARIO" ? 1 : pb.packagingQty, type: pb.type, source: "module" });
      }
      const product = await storage.getProductByBarcode(code);
      if (!product) return res.json({ multiplier: 1, type: "UNITARIO", source: "none" });
      if (product.barcode === code) return res.json({ multiplier: 1, type: "UNITARIO", source: "legacy" });
      if (product.boxBarcodes && Array.isArray(product.boxBarcodes)) {
        const bx = (product.boxBarcodes as any[]).find((b: any) => b.code === code);
        if (bx && bx.qty) return res.json({ multiplier: bx.qty, type: "EMBALAGEM", source: "legacy" });
      }
      if (product.boxBarcode === code) return res.json({ multiplier: 1, type: "EMBALAGEM", source: "legacy" });
      res.json({ multiplier: 1, type: "UNITARIO", source: "legacy" });
    } catch (error) {
      log(`[WMS] [Barcodes] Multiplier lookup error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar multiplicador" });
    }
  });

  app.get("/api/products/search-for-barcode", isAuthenticated, requireCompany, async (req: Request, res: Response) => {
    try {
      const { q } = req.query;
      if (!q || String(q).length < 2) return res.json([]);
      const s = `%${String(q)}%`;
      const rows = await db.select({
        id: products.id, erpCode: products.erpCode, name: products.name,
        barcode: products.barcode, section: products.section,
      }).from(products).where(
        or(ilike(products.name, s), ilike(products.erpCode, s), ilike(products.barcode, s))
      ).limit(20);
      res.json(rows);
    } catch (error) {
      log(`[WMS] [Barcodes] Product search error:: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: "Erro ao buscar produtos" });
    }
  });
}
