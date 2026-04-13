import { db } from "./db";
import { eq, and, sql, desc, inArray, isNull, gt, lt, or, like, ne } from "drizzle-orm";
import {
  users, orders, orderItems, products, routes, workUnits, exceptions, auditLogs, sessions, sections, sectionGroups, db2Mappings, cacheOrcamentos, orderVolumes, systemSettings, nfItems, productBarcodes, scanLog,
  wmsAddresses, pallets, palletItems, addressPickingLog,
  type User, type InsertUser, type Order, type InsertOrder, type OrderItem, type InsertOrderItem,
  type Product, type InsertProduct, type Route, type InsertRoute, type WorkUnit, type InsertWorkUnit,
  type Exception, type InsertException, type AuditLog, type InsertAuditLog, type Session,
  type SectionGroup, type InsertSectionGroup, type Section, pickingSessions, type PickingSession, type InsertPickingSession,
  type Db2Mapping, type MappingField, type BatchSyncPayload,
  type OrderVolume, type InsertOrderVolume, companies, type Company,
  type SystemSettings, type SeparationMode
} from "@shared/schema";
import { randomUUID } from "crypto";
import { log, getErrorMessage, getDbError } from "./log";
import { getCompanyOperationPickupPoints, getCompanyReportPickupPoints, getCompanyBalcaoPickupPoints } from "./company-config";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByBadgeCode(badgeCode: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUser(id: string, user: Partial<User>): Promise<User | undefined>;

  // Companies
  getCompaniesByIds(ids: number[]): Promise<Company[]>;
  getAllCompanies(): Promise<Company[]>;

  // Sections
  getAllSections(): Promise<Section[]>;

  // Section Groups
  getAllSectionGroups(): Promise<SectionGroup[]>;
  getSectionGroupById(id: string): Promise<SectionGroup | undefined>;
  createSectionGroup(group: InsertSectionGroup): Promise<SectionGroup>;
  updateSectionGroup(id: string, group: Partial<InsertSectionGroup>): Promise<SectionGroup | undefined>;
  deleteSectionGroup(id: string): Promise<void>;

  // Sessions
  createSession(userId: string, token: string, sessionKey: string, expiresAt: Date, companyId?: number): Promise<Session>;
  getSessionByToken(token: string): Promise<Session | undefined>;
  deleteSession(token: string): Promise<void>;
  deleteExpiredSessions(): Promise<number>;

  // Routes
  getAllRoutes(): Promise<Route[]>;
  createRoute(route: InsertRoute): Promise<Route>;
  updateRoute(id: string, route: Partial<InsertRoute>): Promise<Route | undefined>;
  toggleRouteActive(id: string, active: boolean): Promise<Route | undefined>;

  // Products
  getAllProducts(): Promise<Product[]>;
  getProductByBarcode(barcode: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;

  // Orders
  getAllOrders(companyId?: number): Promise<Order[]>;
  getOrderById(id: string): Promise<Order | undefined>;
  getOrderWithItems(id: string): Promise<(Order & { items: (OrderItem & { product: Product })[] }) | undefined>;
  createOrder(order: InsertOrder): Promise<Order>;
  updateOrder(id: string, data: Partial<Order>): Promise<Order | undefined>;
  assignRouteToOrders(orderIds: string[], routeId: string | null): Promise<void>;
  setOrderPriority(orderIds: string[], priority: number): Promise<void>;
  launchOrders(orderIds: string[], loadCode?: string): Promise<void>;
  checkAndUpdateOrderStatus(orderId: string): Promise<WorkUnit | null>;
  recalculateOrderStatus(orderId: string): Promise<void>;

  // Order Items
  createOrderItem(item: InsertOrderItem): Promise<OrderItem>;
  getOrderItemsByOrderId(orderId: string): Promise<(OrderItem & { product: Product; exceptionQty?: number; exceptions?: Exception[] })[]>;
  updateOrderItem(id: string, data: Partial<OrderItem>): Promise<OrderItem | undefined>;
  atomicIncrementSeparatedQty(itemId: string, delta: number, newStatus: string): Promise<OrderItem | undefined>;
  atomicIncrementCheckedQty(itemId: string, delta: number, newStatus: string): Promise<OrderItem | undefined>;
  atomicScanCheckedQty(itemId: string, delta: number, targetQty: number): Promise<{ result: "success"; updated: OrderItem; appliedQty: number } | { result: "already_complete"; currentQty: number; targetQty: number } | { result: "over_quantity"; currentQty: number; availableQty: number; targetQty: number }>;
  atomicResetItemAndWorkUnit(itemId: string, workUnitId: string, orderId: string, field: "separatedQty" | "checkedQty", itemStatus: string): Promise<void>;
  atomicScanSeparatedQty(itemId: string, delta: number, adjustedTarget: number, workUnitId: string, orderId: string, msgId?: string, userId?: string, companyId?: number): Promise<{ result: "success"; updated: OrderItem } | { result: "already_complete"; currentQty: number; adjustedTarget: number } | { result: "over_quantity"; availableQty: number; adjustedTarget: number } | { result: "duplicate" }>;
  finalizeWorkUnitsWithDeductions(params: {
    workUnitIds: string[];
    deductions: Array<{ productId: string; addressId: string; quantity: number; orderId?: string; erpOrderId?: string; workUnitId?: string }>;
    userId: string;
    companyId: number;
    finalOrderStatus?: string;
  }): Promise<{ completed: string[]; unlocked: string[]; sseOrders: string[] }>;
  relaunchOrder(orderId: string): Promise<void>;

  // Work Units
  getWorkUnits(type?: string, companyId?: number): Promise<(WorkUnit & { order: Order; items: (OrderItem & { product: Product; exceptionQty?: number })[]; lockedByName?: string })[]>;
  getWorkUnitById(id: string): Promise<(WorkUnit & { order: Order; items: (OrderItem & { product: Product; exceptionQty?: number })[] }) | undefined>;
  getWorkUnitsByOrderId(orderId: string): Promise<WorkUnit[]>;
  createWorkUnit(workUnit: InsertWorkUnit): Promise<WorkUnit>;
  updateWorkUnit(id: string, data: Partial<WorkUnit>): Promise<WorkUnit | undefined>;
  lockWorkUnits(workUnitIds: string[], userId: string, expiresAt: Date): Promise<number>;
  unlockWorkUnits(workUnitIds: string[]): Promise<void>;
  renewWorkUnitLock(id: string, newExpiresAt: string): Promise<void>;
  resetWorkUnitProgress(id: string): Promise<void>; // Added missing interface method
  resetConferenciaProgress(id: string): Promise<void>;
  resetConferenciaWorkUnitForOrder(orderId: string): Promise<void>;
  checkAndCompleteWorkUnit(id: string, autoComplete?: boolean, finalOrderStatus?: string): Promise<boolean>;
  checkAllWorkUnitsComplete(orderId: string): Promise<boolean>;
  checkAllConferenceUnitsComplete(orderId: string): Promise<boolean>;

  // Exceptions
  getAllExceptions(): Promise<(Exception & { orderItem: OrderItem & { product: Product; order: Order }; reportedByUser: User; workUnit: WorkUnit })[]>;

  createException(exception: InsertException): Promise<Exception>;
  deleteException(id: string): Promise<void>;
  deleteExceptionWithRollback(id: string, exc: any): Promise<void>;
  deleteExceptionsForItem(orderItemId: string): Promise<void>;
  authorizeExceptions(exceptionIds: string[], authData: { authorizedBy: string; authorizedByName: string; authorizedAt: string }, companyId?: number): Promise<void>;

  // Audit Logs
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAllAuditLogs(): Promise<(AuditLog & { user: User | null })[]>;

  // Stats
  getOrderStats(): Promise<{ pendentes: number; emSeparacao: number; separados: number; conferidos: number; excecoes: number }>;

  // Reports
  getPickingListReportData(filters: { orderIds?: string[]; pickupPoints?: string[]; sections?: string[] }, companyId?: number): Promise<{
    section: string;
    pickupPoint: number;
    items: (OrderItem & { product: Product; order: Order })[];
  }[]>;
  getRouteOrdersPrintData(orderIds: string[]): Promise<any[]>;
  getLoadingMapProductCentricReportData(loadCode: string): Promise<{
    section: string;
    products: {
      product: Product;
      totalQuantity: number;
      orders: {
        erpOrderId: string;
        customerName: string;
        quantity: number;
      }[];
    }[];
  }[]>;
  getLoadingMapReportData(loadCode: string): Promise<{
    customerName: string;
    customerCode: string | null;
    sections: {
      section: string;
      items: {
        product: Product;
        quantity: number;
        exceptionQty: number;
        exceptionType: string | null;
        exceptionObs: string | null;
      }[];
    }[];
  }[]>;

  // Picking Sessions
  createPickingSession(session: InsertPickingSession): Promise<PickingSession>;
  getPickingSession(orderId: string, sectionId: string): Promise<PickingSession | undefined>;
  updatePickingSessionHeartbeat(id: string, userId?: string): Promise<number>;
  deletePickingSession(orderId: string, sectionId: string): Promise<void>;
  getPickingSessionsByOrder(orderId: string): Promise<PickingSession[]>;
  cancelOrderLaunch(orderId: string): Promise<void>;

  // DB2 Mappings
  getMappingByDataset(dataset: string): Promise<Db2Mapping | undefined>;
  getAllMappings(): Promise<Db2Mapping[]>;
  saveMapping(dataset: string, mappingJson: MappingField[], description: string | null, createdBy: string): Promise<Db2Mapping>;
  activateMapping(id: string): Promise<Db2Mapping | undefined>;
  getCacheOrcamentosPreview(limit: number): Promise<any[]>;

  // Order Volumes
  upsertOrderVolume(data: Omit<InsertOrderVolume, 'totalVolumes'> & { userId: string }): Promise<OrderVolume>;
  getOrderVolume(orderId: string): Promise<OrderVolume | undefined>;
  deleteOrderVolume(orderId: string): Promise<void>;
  getAllOrderVolumes(): Promise<OrderVolume[]>;

  // System Settings
  getSystemSettings(): Promise<SystemSettings>;
  updateSeparationMode(mode: SeparationMode, updatedBy: string): Promise<SystemSettings>;
  updateQuickLinkEnabled(enabled: boolean, updatedBy: string): Promise<SystemSettings>;
  getActiveSeparationConflicts(): Promise<{ activeSessions: number; activeWorkUnits: number; affectedSections: string[]; activeUsers: string[] }>;
  cancelAllPickingSessions(): Promise<void>;
  resetActiveWorkUnits(): Promise<number>;

  // Scan Log — dedup persistente de msgIds (S1-04)
  insertScanLogDedup(msgId: string, userId: string, companyId: number | undefined, workUnitId: string, barcode: string, quantity: number): Promise<{ inserted: boolean }>;
  cleanupOldScanLogs(daysOld?: number): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  // Companies
  async getCompaniesByIds(ids: number[]): Promise<Company[]> {
    if (!ids || ids.length === 0) return [];
    return db.select().from(companies).where(inArray(companies.id, ids));
  }

  async getAllCompanies(): Promise<Company[]> {
    return db.select().from(companies);
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByBadgeCode(badgeCode: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.badgeCode, badgeCode));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(insertUser as any).returning();
    return newUser;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(users.name);
  }

  async updateUser(id: string, userUpdate: Partial<User>): Promise<User | undefined> {
    await db
      .update(users)
      .set(userUpdate)
      .where(eq(users.id, id));

    // Fetch the updated user to return it (workaround for potential returning() issues or just safety)
    return this.getUser(id);
  }



  // Sessions
  async createSession(userId: string, token: string, sessionKey: string, expiresAt: Date, companyId?: number): Promise<Session> {
    const [session] = await db.insert(sessions).values({
      userId,
      token,
      sessionKey,
      companyId: companyId ?? null,
      expiresAt: expiresAt.toISOString(),
    }).returning();
    return session;
  }

  async updateSessionCompany(token: string, companyId: number): Promise<void> {
    await db.update(sessions).set({ companyId }).where(eq(sessions.token, token));
  }

  async getSessionByToken(token: string): Promise<Session | undefined> {
    const [session] = await db.select().from(sessions)
      .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date().toISOString())));
    return session;
  }

  async deleteSession(token: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.token, token));
  }

  async deleteExpiredSessions(): Promise<number> {
    const result = await db.delete(sessions)
      .where(lt(sessions.expiresAt, new Date().toISOString()))
      .returning({ id: sessions.id });
    return result.length;
  }

  // Routes
  async getAllRoutes(): Promise<Route[]> {
    return db.select().from(routes).orderBy(routes.name);
  }

  async createRoute(route: InsertRoute): Promise<Route> {
    if (!route.code) {
      let slug = route.name.toUpperCase().replace(/[^A-Z0-9]/g, "").substring(0, 10);
      if (!slug || slug.length === 0) {
        slug = `R-${randomUUID().substring(0, 8).toUpperCase()}`;
      }
      route.code = slug;

      const existing = await db.select().from(routes).where(eq(routes.code, route.code)).limit(1);
      if (existing.length > 0) {
        route.code = `${route.code}-${randomUUID().substring(0, 6).toUpperCase()}`;
      }
    }

    try {
      const [newRoute] = await db.insert(routes).values({
        ...route,
        code: route.code!,
      }).returning();
      return newRoute;
    } catch (e) {
      const { code: errCode } = getDbError(e);
      if (errCode === "23505") {
        route.code = `${route.code}-${randomUUID().substring(0, 6).toUpperCase()}`;
        const [newRoute] = await db.insert(routes).values({
          ...route,
          code: route.code!,
        }).returning();
        return newRoute;
      }
      throw e;
    }
  }

  async updateRoute(id: string, route: Partial<InsertRoute>): Promise<Route | undefined> {
    const [updated] = await db.update(routes).set(route).where(eq(routes.id, id)).returning();
    return updated;
  }

  async toggleRouteActive(id: string, active: boolean): Promise<Route | undefined> {
    const [updated] = await db.update(routes).set({ active }).where(eq(routes.id, id)).returning();
    return updated;
  }

  // Products
  async getAllProducts(): Promise<Product[]> {
    return db.select().from(products).orderBy(products.name);
  }

  async getProductByBarcode(barcode: string): Promise<Product | undefined> {
    const pbMatch = await db.select().from(productBarcodes).where(
      and(eq(productBarcodes.barcode, barcode), eq(productBarcodes.active, true))
    ).limit(1);
    if (pbMatch.length > 0) {
      const [p] = await db.select().from(products).where(eq(products.id, pbMatch[0].productId)).limit(1);
      if (p) return p;
    }

    const matchedProducts = await db.select().from(products).where(
      or(
        eq(products.barcode, barcode),
        eq(products.boxBarcode, barcode),
        sql`${products.boxBarcodes}::text LIKE ${'%' + barcode + '%'}`
      )
    );

    for (const p of matchedProducts) {
      if (p.barcode === barcode || p.boxBarcode === barcode) return p;
      if (p.boxBarcodes && Array.isArray(p.boxBarcodes)) {
        if (p.boxBarcodes.some((b: any) => b.code === barcode)) return p;
      }
    }
    return undefined;
  }

  async getBarcodeMultiplier(barcode: string, product: Product): Promise<number> {
    const [pb] = await db.select().from(productBarcodes).where(
      and(eq(productBarcodes.barcode, barcode), eq(productBarcodes.active, true), eq(productBarcodes.productId, product.id))
    ).limit(1);
    if (pb) return pb.type === "UNITARIO" ? 1 : pb.packagingQty;
    if (product.barcode === barcode) return 1;
    if (product.boxBarcodes && Array.isArray(product.boxBarcodes)) {
      const bx = (product.boxBarcodes as any[]).find((b: any) => b.code === barcode);
      if (bx && bx.qty) return bx.qty;
    }
    if (product.boxBarcode === barcode) return 1;
    return 1;
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const [newProduct] = await db.insert(products).values(product).returning();
    return newProduct;
  }

  // Orders
  async getAllOrders(companyId?: number, includeReportsPoints: boolean = false): Promise<(Order & { hasExceptions: boolean; totalItems: number; pickedItems: number })[]> {
    const query = companyId 
      ? db.select().from(orders).where(eq(orders.companyId, companyId)).orderBy(desc(orders.priority), desc(orders.createdAt))
      : db.select().from(orders).orderBy(desc(orders.priority), desc(orders.createdAt));
      
    let allOrders = await query;
    
    if (companyId) {
      const allowedPP = includeReportsPoints 
        ? getCompanyReportPickupPoints(companyId)
        : getCompanyOperationPickupPoints(companyId);

      if (allowedPP) {
        allOrders = allOrders.filter(o => 
          Array.isArray(o.pickupPoints) && o.pickupPoints.some(p => allowedPP.includes(p))
        );
      }
    }

    // Get Exceptions
    const allExceptions = await db.select({ orderItemId: exceptions.orderItemId }).from(exceptions);
    const exceptionItemIds = new Set(allExceptions.map(e => e.orderItemId));

    // Get Item Stats
    const itemStats = await db.select({
      orderId: orderItems.orderId,
      total: sql<number>`count(*)`,
      picked: sql<number>`sum(case when ${orderItems.status} in ('separado', 'conferido', 'finalizado') then 1 else 0 end)`
    }).from(orderItems).groupBy(orderItems.orderId);

    const statsMap = new Map(itemStats.map(s => [s.orderId, { total: Number(s.total), picked: Number(s.picked) }]));

    const allItems = await db.select({ id: orderItems.id, orderId: orderItems.orderId }).from(orderItems);
    const ordersWithExceptions = new Set<string>();

    for (const item of allItems) {
      if (exceptionItemIds.has(item.id)) {
        ordersWithExceptions.add(item.orderId);
      }
    }

    return allOrders.map(o => {
      const stats = statsMap.get(o.id) || { total: 0, picked: 0 };
      return {
        ...o,
        hasExceptions: ordersWithExceptions.has(o.id),
        totalItems: stats.total,
        itemCount: stats.total,
        pickedItems: stats.picked
      };
    });
  }

  async getOrderById(id: string): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order;
  }

  async getOrderWithItems(id: string): Promise<(Order & { items: (OrderItem & { product: Product })[] }) | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    if (!order) return undefined;

    const items = await this.getOrderItemsByOrderId(id);
    return { ...order, items };
  }

  async createOrder(order: InsertOrder): Promise<Order> {
    const [newOrder] = await db.insert(orders).values({
      ...order,
      status: (order.status || "pendente") as any,
    }).returning();
    return newOrder;
  }

  async updateOrder(id: string, data: Partial<Order>): Promise<Order | undefined> {
    const [updated] = await db.update(orders)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(orders.id, id))
      .returning();
    return updated;
  }

  async assignRouteToOrders(orderIds: string[], routeId: string | null): Promise<void> {
    await db.update(orders)
      .set({ routeId, updatedAt: new Date().toISOString() })
      .where(inArray(orders.id, orderIds));
  }

  async setOrderPriority(orderIds: string[], priority: number): Promise<void> {
    await db.update(orders)
      .set({ priority, updatedAt: new Date().toISOString() })
      .where(inArray(orders.id, orderIds));
  }

  async launchOrders(orderIds: string[], loadCode?: string): Promise<void> {
    await db.update(orders)
      .set({
        isLaunched: true,
        launchedAt: new Date().toISOString(),
        loadCode: loadCode || null,
        updatedAt: new Date().toISOString()
      })
      .where(inArray(orders.id, orderIds));
  }

  async checkAndUpdateOrderStatus(orderId: string): Promise<WorkUnit | null> {
      return await db.transaction(async (tx) => {
        const [currentOrder] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        if (!currentOrder || currentOrder.status === "cancelado" || currentOrder.status === "finalizado") return null;

        const sepUnits = await tx.select().from(workUnits)
          .where(and(eq(workUnits.orderId, orderId), eq(workUnits.type, "separacao")));
        if (sepUnits.length === 0) return null;
        const allWusDone = sepUnits.every(u => u.status === "concluido");
        if (!allWusDone) return null;

        let createdWorkUnit: WorkUnit | null = null;

        await tx.update(orders)
          .set({
            status: "separado",
            updatedAt: new Date().toISOString()
          })
          .where(eq(orders.id, orderId));

        const existing = await tx.select().from(workUnits)
          .where(and(
            eq(workUnits.orderId, orderId),
            eq(workUnits.type, "conferencia")
          ))
          .limit(1);

        if (existing.length === 0) {
          const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
          [createdWorkUnit] = await tx.insert(workUnits).values({
            orderId,
            type: "conferencia",
            status: "pendente",
            pickupPoint: 0,
            companyId: order?.companyId || undefined,
          }).returning();
        }

        return createdWorkUnit;
      });
    }

  async recalculateOrderStatus(orderId: string): Promise<void> {
    const order = await this.getOrderById(orderId);
    if (!order || !order.isLaunched) return;
    // Removido bloqueio restritivo para permitir revers\u00e3o de 'separado' se itens forem resetados
    if (["conferido", "em_conferencia", "finalizado"].includes(order.status)) return;

    const items = await this.getOrderItemsByOrderId(orderId);
    const allItemsPicked = items.length > 0 && items.every(i => Number(i.separatedQty) >= Number(i.quantity));

    if (allItemsPicked) {
      return;
    }

    const orderWorkUnits = await db.select().from(workUnits)
      .where(and(eq(workUnits.orderId, orderId), eq(workUnits.type, "separacao")));

    const anyInProgress = orderWorkUnits.some(wu => wu.status === "em_andamento");

    const newStatus = anyInProgress ? "em_separacao" : "pendente";

    if (order.status !== newStatus) {
      await db.update(orders)
        .set({ status: newStatus as any, updatedAt: new Date().toISOString() })
        .where(eq(orders.id, orderId));
    }
  }

  // Order Items
  async createOrderItem(item: InsertOrderItem): Promise<OrderItem> {
    const [newItem] = await db.insert(orderItems).values({
      orderId: item.orderId,
      productId: item.productId,
      quantity: item.quantity,
      section: item.section,
      pickupPoint: item.pickupPoint, // Ensure this exists in item
      status: (item.status || "pendente") as any,
      qtyPicked: item.qtyPicked || 0,
      qtyChecked: item.qtyChecked || 0,
      exceptionType: item.exceptionType as any,
      separatedQty: item.separatedQty || 0,
      checkedQty: item.checkedQty || 0,
    }).returning();
    return newItem;
  }

  async getOrderItemsByOrderId(orderId: string): Promise<(OrderItem & { product: Product; exceptionQty?: number; exceptions?: Exception[] })[]> {
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    if (items.length === 0) return [];

    const productIds = [...new Set(items.map(i => i.productId))];
    const itemIds = items.map(i => i.id);

    const [allProducts, allExceptions] = await Promise.all([
      db.select().from(products).where(inArray(products.id, productIds)),
      db.select().from(exceptions).where(inArray(exceptions.orderItemId, itemIds)),
    ]);

    const productMap = new Map(allProducts.map(p => [p.id, p]));
    const exceptionMap = new Map<string, Exception[]>();
    for (const exc of allExceptions) {
      const list = exceptionMap.get(exc.orderItemId) || [];
      list.push(exc);
      exceptionMap.set(exc.orderItemId, list);
    }

    return items.map(item => {
      const itemExceptions = exceptionMap.get(item.id) || [];
      const exceptionQty = itemExceptions.reduce((sum, e) => sum + Number(e.quantity), 0);
      return {
        ...item,
        product: productMap.get(item.productId)!,
        exceptionQty,
        exceptions: itemExceptions,
      };
    });
  }

  async updateOrderItem(id: string, data: Partial<OrderItem>): Promise<OrderItem | undefined> {
    const [updated] = await db.update(orderItems)
      .set(data)
      .where(eq(orderItems.id, id))
      .returning();
    return updated;
  }

  async atomicResetItemAndWorkUnit(itemId: string, workUnitId: string, orderId: string, field: "separatedQty" | "checkedQty", itemStatus: string): Promise<void> {
    await db.transaction(async (tx) => {
      const setData: any = { status: itemStatus };
      setData[field] = 0;
      await tx.update(orderItems).set(setData).where(eq(orderItems.id, itemId));
      await tx.update(workUnits).set({ status: "em_andamento" }).where(eq(workUnits.id, workUnitId));
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (order && order.status === "separado") {
        await tx.update(orders).set({ status: "em_separacao", updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId));
      }
    });
  }

  async atomicIncrementSeparatedQty(itemId: string, delta: number, newStatus: string): Promise<OrderItem | undefined> {
    const [updated] = await db.update(orderItems)
      .set({
        separatedQty: sql`LEAST(COALESCE(${orderItems.separatedQty}, 0) + ${delta}, ${orderItems.quantity} - COALESCE(${orderItems.exceptionQty}, 0))`,
        status: newStatus,
      })
      .where(eq(orderItems.id, itemId))
      .returning();
    return updated;
  }

  async atomicIncrementCheckedQty(itemId: string, delta: number, newStatus: string): Promise<OrderItem | undefined> {
    const [updated] = await db.update(orderItems)
      .set({
        checkedQty: sql`LEAST(COALESCE(${orderItems.checkedQty}, 0) + ${delta}, ${orderItems.quantity} - COALESCE(${orderItems.exceptionQty}, 0))`,
        status: newStatus,
      })
      .where(eq(orderItems.id, itemId))
      .returning();
    return updated;
  }

  async atomicScanCheckedQty(itemId: string, delta: number, targetQty: number): Promise<
    { result: "success"; updated: OrderItem; appliedQty: number } |
    { result: "already_complete"; currentQty: number; targetQty: number } |
    { result: "over_quantity"; currentQty: number; availableQty: number; targetQty: number }
  > {
    return await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id, checked_qty FROM order_items WHERE id = ${itemId} FOR UPDATE`
      );
      const rows = (locked as any).rows ?? (locked as any);
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) throw new Error("Item not found");

      const currentQty = Number(row.checked_qty ?? 0);

      if (currentQty >= targetQty) {
        return { result: "already_complete" as const, currentQty, targetQty };
      }

      const availableQty = targetQty - currentQty;
      if (delta > availableQty) {
        return { result: "over_quantity" as const, currentQty, availableQty, targetQty };
      }

      const newQty = currentQty + delta;
      const newStatus = newQty >= targetQty ? "conferido" : "separado";
      const [updated] = await tx.update(orderItems)
        .set({ checkedQty: newQty, status: newStatus })
        .where(eq(orderItems.id, itemId))
        .returning();
      return { result: "success" as const, updated, appliedQty: delta };
    });
  }

  async atomicScanSeparatedQty(itemId: string, delta: number, adjustedTarget: number, workUnitId: string, orderId: string, msgId?: string, userId?: string, companyId?: number): Promise<
    { result: "success"; updated: OrderItem } |
    { result: "already_complete"; currentQty: number; adjustedTarget: number } |
    { result: "over_quantity"; availableQty: number; adjustedTarget: number } |
    { result: "duplicate" }
  > {
    return await db.transaction(async (tx) => {
      // S1-04: dedup de msgId dentro da mesma transação do UPDATE (atomicidade garantida).
      // Se o INSERT falhar por conflito → scan já foi processado → retorna "duplicate".
      // Se o INSERT suceder → prossegue com o UPDATE → ambos commitados juntos.
      if (msgId && userId) {
        const companyIdInt = companyId ?? -1;
        const dedupResult = await tx.execute(
          sql`INSERT INTO scan_log (msg_id, user_id, company_id_int, work_unit_id, barcode, quantity, ack_status, created_at)
              VALUES (${msgId}, ${userId}, ${companyIdInt}, ${workUnitId}, ${itemId}, ${delta}, 'pending', ${new Date().toISOString()})
              ON CONFLICT (msg_id, user_id, company_id_int) DO NOTHING`
        );
        const rowCount = (dedupResult as any).rowCount ?? 0;
        if (Number(rowCount) === 0) {
          return { result: "duplicate" as const };
        }
      }

      // Lock the row to prevent concurrent scans from racing on the same item
      const locked = await tx.execute(
        sql`SELECT id, separated_qty FROM order_items WHERE id = ${itemId} FOR UPDATE`
      );
      const rows = (locked as any).rows ?? (locked as any);
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) throw new Error("Item not found");

      const currentQty = Number(row.separated_qty ?? 0);

      if (currentQty >= adjustedTarget) {
        // Already at or above limit — report without resetting progress
        // The server never resets valid picking progress automatically.
        // Explicit reset is only done via /reset-item-picking when the operator confirms.
        return { result: "already_complete" as const, currentQty, adjustedTarget };
      }

      const availableQty = adjustedTarget - currentQty;
      if (delta > availableQty) {
        // Requested qty exceeds what's left — report without resetting
        // Operator is informed and can choose to recount explicitly.
        return { result: "over_quantity" as const, availableQty, adjustedTarget };
      }

      const newQty = currentQty + delta;
      const newStatus = newQty >= adjustedTarget ? "separado" : "pendente";
      const [updated] = await tx.update(orderItems)
        .set({ separatedQty: newQty, status: newStatus })
        .where(eq(orderItems.id, itemId))
        .returning();
      return { result: "success" as const, updated };
    });
  }

  async finalizeWorkUnitsWithDeductions(params: {
    workUnitIds: string[];
    deductions: Array<{ productId: string; addressId: string; quantity: number; orderId?: string; erpOrderId?: string; workUnitId?: string }>;
    userId: string;
    companyId: number;
    finalOrderStatus?: string;
  }): Promise<{ completed: string[]; unlocked: string[]; sseOrders: string[] }> {
    const { workUnitIds, deductions, userId, companyId, finalOrderStatus } = params;
    const now = new Date().toISOString();
    const completed: string[] = [];
    const unlocked: string[] = [];
    const sseOrders = new Set<string>();

    await db.transaction(async (tx) => {
      // 1. Para cada WU: verificar completabilidade dentro da transação (SELECT FOR UPDATE)
      for (const wuId of workUnitIds) {
        const [workUnit] = await tx.select().from(workUnits).where(eq(workUnits.id, wuId));
        if (!workUnit) continue;

        // Determinar quais items pertencem a esta WU (mesma lógica de checkAndCompleteWorkUnit)
        let items;
        if (workUnit.type === "separacao") {
          const filters: any[] = [eq(orderItems.orderId, workUnit.orderId)];
          if (workUnit.section) filters.push(eq(orderItems.section, workUnit.section));
          items = await tx.select().from(orderItems).where(and(...filters));
        } else {
          const completeConds: any[] = [
            eq(orderItems.orderId, workUnit.orderId),
            eq(orderItems.pickupPoint, workUnit.pickupPoint as any),
          ];
          if (workUnit.section) completeConds.push(eq(orderItems.section, workUnit.section));
          items = await tx.select().from(orderItems).where(and(...completeConds));
        }

        const unitExceptions = await tx.select().from(exceptions).where(eq(exceptions.workUnitId, wuId));
        const allComplete = items.every(item => {
          const itemExcs = unitExceptions.filter(e => e.orderItemId === item.id);
          const excQty = itemExcs.reduce((sum, e) => sum + Number(e.quantity), 0);
          return Number(item.separatedQty) + excQty >= Number(item.quantity);
        });

        if (allComplete) {
          await tx.update(workUnits)
            .set({ status: "concluido", completedAt: now, lockedBy: null, lockedAt: null })
            .where(eq(workUnits.id, wuId));
          completed.push(wuId);
          sseOrders.add(workUnit.orderId);
          if (finalOrderStatus) {
            const [order] = await tx.select().from(orders).where(eq(orders.id, workUnit.orderId)).limit(1);
            if (order && order.status !== "cancelado" && order.status !== "finalizado") {
              await tx.update(orders)
                .set({ status: finalOrderStatus as any, updatedAt: now })
                .where(eq(orders.id, workUnit.orderId));
            }
          }
        } else {
          await tx.update(workUnits)
            .set({ lockedBy: null, lockedAt: null, lockExpiresAt: null })
            .where(eq(workUnits.id, wuId));
          unlocked.push(wuId);
        }
      }

      // 2. Deduções de endereço (FIFO) — na mesma transação
      for (const ded of deductions) {
        const { productId, addressId, quantity, orderId, erpOrderId, workUnitId: dedWuId } = ded;

        const [addr] = await tx.select().from(wmsAddresses).where(eq(wmsAddresses.id, addressId));
        if (!addr) continue;

        const [product] = await tx.select().from(products).where(eq(products.id, productId));
        const [usr] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));

        const palletItemsAtAddress = await tx.select({
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

        let remaining = quantity;
        for (const pi of palletItemsAtAddress) {
          if (remaining <= 0) break;
          const currentQty = Number(pi.palletItemQty);
          const deductQty = Math.min(remaining, currentQty);
          const newQty = currentQty - deductQty;

          if (newQty <= 0) {
            await tx.delete(palletItems).where(eq(palletItems.id, pi.palletItemId));
          } else {
            await tx.update(palletItems)
              .set({ quantity: newQty })
              .where(eq(palletItems.id, pi.palletItemId));
          }
          remaining -= deductQty;
        }

        await tx.insert(addressPickingLog).values({
          companyId,
          addressId,
          addressCode: addr.code,
          productId,
          productName: (product as any)?.name || null,
          erpCode: (product as any)?.erpCode || null,
          quantity,
          orderId: orderId || null,
          erpOrderId: erpOrderId || null,
          workUnitId: dedWuId || null,
          userId,
          userName: (usr as any)?.name || null,
          createdAt: now,
          notes: remaining > 0 ? `Saldo insuficiente: ${remaining} un não deduzidas` : null,
        });
      }
    });

    return { completed, unlocked, sseOrders: Array.from(sseOrders) };
  }

  async relaunchOrder(orderId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(orders)
        .set({
          status: "pendente",
          isLaunched: true,
          launchedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .where(eq(orders.id, orderId));

      await tx.update(workUnits)
        .set({
          status: "pendente",
          lockedBy: null,
          lockedAt: null,
          lockExpiresAt: null,
          startedAt: null,
          completedAt: null,
          cartQrCode: null,
          palletQrCode: null
        })
        .where(eq(workUnits.orderId, orderId));

      await tx.update(orderItems)
        .set({
          status: "pendente",
          separatedQty: 0,
          checkedQty: 0
        })
        .where(eq(orderItems.orderId, orderId));

      const orderItemIds = await tx.select({ id: orderItems.id })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));

      if (orderItemIds.length > 0) {
        await tx.delete(exceptions).where(
          inArray(exceptions.orderItemId, orderItemIds.map(i => i.id))
        );
      }

      await tx.delete(pickingSessions).where(
        eq(pickingSessions.orderId, orderId)
      );
    });
  }

  // Work Units
  // Retorna unidades de trabalho, opcionalmente filtradas por tipo e empresa.
  // IMPORTANTE: Para 'conferencia', filtra pedidos que ainda não estão 'separado' ou adiante.
  async getWorkUnits(type?: string, companyId?: number): Promise<(WorkUnit & { order: Order; items: (OrderItem & { product: Product; exceptionQty?: number })[]; lockedByName?: string })[]> {
    let conditions = [];
    if (type) conditions.push(eq(workUnits.type, type as any));
    if (companyId) conditions.push(eq(workUnits.companyId, companyId));
    
    if (companyId && type !== "separacao" && type !== "conferencia") {
      const allowedPP = type === "balcao"
        ? getCompanyBalcaoPickupPoints(companyId)
        : getCompanyOperationPickupPoints(companyId);
      if (allowedPP) {
        conditions.push(inArray(workUnits.pickupPoint, allowedPP));
      }
    }

    const query = conditions.length > 0 
      ? db.select().from(workUnits).where(and(...conditions))
      : db.select().from(workUnits);

    let wus = await query;
    
    if (companyId && (type === "separacao" || type === "conferencia")) {
      const allowedPP = getCompanyOperationPickupPoints(companyId);
      if (allowedPP) {
        const orderIdsForType = [...new Set(wus.map(wu => wu.orderId))];
        if (orderIdsForType.length > 0) {
          const ordersForFilter = await db.select().from(orders).where(inArray(orders.id, orderIdsForType));
          const validOrderIds = new Set(
            ordersForFilter
              .filter(o => Array.isArray(o.pickupPoints) && o.pickupPoints.some(p => allowedPP.includes(p)))
              .map(o => o.id)
          );
          wus = wus.filter(wu => validOrderIds.has(wu.orderId));
        }
      }
    }
    if (wus.length === 0) return [];

    const orderIds = [...new Set(wus.map(wu => wu.orderId))];

    // Fetch Orders
    const ordersData = await db.select().from(orders).where(inArray(orders.id, orderIds));
    const ordersMap = new Map(ordersData.map(o => [o.id, o]));

    // Fetch locked-by user names
    const lockedByIds = [...new Set(wus.map(wu => wu.lockedBy).filter(Boolean))] as string[];
    const usersMap = new Map<string, string>();
    if (lockedByIds.length > 0) {
      const usersData = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, lockedByIds));
      for (const u of usersData) {
        usersMap.set(u.id, u.name);
      }
    }

    // Fetch Items
    const itemsData = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));

    // Fetch Products
    const productIds = [...new Set(itemsData.map(i => i.productId))];
    const productsData = productIds.length > 0
      ? await db.select().from(products).where(inArray(products.id, productIds))
      : [];

    // Enrich products with factory code (CODIGOINTERNOFORN from cacheOrcamentos)
    const erpCodesWU = productsData.map(p => p.erpCode).filter(Boolean);
    const factoryCodeMapWU = new Map<string, string>();
    if (erpCodesWU.length > 0) {
      const nfRowsWU = await db.select({
        idProduto: cacheOrcamentos.idProduto,
        codigoInternoForn: cacheOrcamentos.codigoInternoForn,
      }).from(cacheOrcamentos)
        .where(and(
          inArray(cacheOrcamentos.idProduto, erpCodesWU),
          sql`${cacheOrcamentos.codigoInternoForn} IS NOT NULL AND ${cacheOrcamentos.codigoInternoForn} != ''`
        ));
      for (const row of nfRowsWU) {
        if (row.idProduto && row.codigoInternoForn && !factoryCodeMapWU.has(row.idProduto)) {
          factoryCodeMapWU.set(row.idProduto, row.codigoInternoForn);
        }
      }
    }
    const productsMap = new Map(
      productsData.map(p => [p.id, { ...p, factoryCode: p.erpCode ? (factoryCodeMapWU.get(p.erpCode) || "") : "" }])
    );

    // Fetch Exceptions
    const itemIds = itemsData.map(i => i.id);
    const exceptionsData = itemIds.length > 0
      ? await db.select().from(exceptions).where(inArray(exceptions.orderItemId, itemIds))
      : [];

    // Group exceptions by itemId
    const exceptionsMap = new Map<string, number>();
    const exceptionsByItem = new Map<string, typeof exceptionsData>();
    for (const exc of exceptionsData) {
      const current = exceptionsMap.get(exc.orderItemId) || 0;
      exceptionsMap.set(exc.orderItemId, current + Number(exc.quantity));
      const list = exceptionsByItem.get(exc.orderItemId) || [];
      list.push(exc);
      exceptionsByItem.set(exc.orderItemId, list);
    }

    // Assemble Items
    const itemsByOrder = new Map<string, (OrderItem & { product: Product; exceptionQty?: number })[]>();
    for (const item of itemsData) {
      const product = productsMap.get(item.productId);
      if (!product) continue;

      const exceptionQty = exceptionsMap.get(item.id) || 0;
      const itemExceptions = exceptionsByItem.get(item.id) || [];
      const fullItem = { ...item, product, exceptionQty, exceptions: itemExceptions };

      const list = itemsByOrder.get(item.orderId) || [];
      list.push(fullItem);
      itemsByOrder.set(item.orderId, list);
    }

    // Assemble Result
    const result: (WorkUnit & { order: Order; items: (OrderItem & { product: Product; exceptionQty?: number })[]; lockedByName?: string })[] = [];


    for (const wu of wus) {
      const order = ordersMap.get(wu.orderId);
      if (order) {
        // Filtro específico para Conferência: Só ver pedidos Separados ou já em Conferência/Conferidos
        if (type === "conferencia") {
          const allowedStatuses = ["separado", "em_conferencia", "conferido"];
          if (!allowedStatuses.includes(order.status) || wu.status === "concluido") {
            continue;
          }
        }

        const allItems = itemsByOrder.get(wu.orderId) || [];
        let filteredItems = allItems;

        if (wu.type === "separacao") {
          filteredItems = wu.section
            ? allItems.filter(i => i.section === wu.section)
            : allItems;
        } else if (wu.type === "conferencia") {
          filteredItems = allItems;
        } else {
          filteredItems = wu.section
            ? allItems.filter(i => i.section === wu.section && i.pickupPoint === wu.pickupPoint)
            : allItems.filter(i => i.pickupPoint === wu.pickupPoint);
        }



        const lockedByName = wu.lockedBy ? usersMap.get(wu.lockedBy) : undefined;
        result.push({ ...wu, order, items: filteredItems, lockedByName });
      }
    }

    result.sort((a, b) => {
      const timeA = a.order?.launchedAt ? new Date(a.order.launchedAt).getTime() : 0;
      const timeB = b.order?.launchedAt ? new Date(b.order.launchedAt).getTime() : 0;
      return timeB - timeA;
    });

    return result;
  }

  async getWorkUnitById(id: string): Promise<(WorkUnit & { order: Order; items: (OrderItem & { product: Product; exceptionQty?: number })[] }) | undefined> {
    const [wu] = await db.select().from(workUnits).where(eq(workUnits.id, id));
    if (!wu) return undefined;

    const [order] = await db.select().from(orders).where(eq(orders.id, wu.orderId));
    if (!order) return undefined;

    const items = await this.getOrderItemsByOrderId(wu.orderId);
    let filteredItems = items;

    if (wu.type === "separacao") {
      filteredItems = wu.section
        ? items.filter(i => i.section === wu.section)
        : items;
    } else if (wu.type === "conferencia") {
      filteredItems = items;
    } else {
      filteredItems = wu.section
        ? items.filter(i => i.section === wu.section && i.pickupPoint === wu.pickupPoint)
        : items.filter(i => i.pickupPoint === wu.pickupPoint);
    }

    return { ...wu, order, items: filteredItems };
  }

  async createWorkUnit(workUnit: InsertWorkUnit): Promise<WorkUnit> {
    const [newWu] = await db.insert(workUnits).values({
      ...workUnit,
      type: workUnit.type as any,
      status: (workUnit.status || "pendente") as any,
    }).returning();
    return newWu;
  }

  async updateWorkUnit(id: string, data: Partial<WorkUnit>): Promise<WorkUnit | undefined> {
    const [updated] = await db.update(workUnits)
      .set(data)
      .where(eq(workUnits.id, id))
      .returning();
    return updated;
  }

  async getWorkUnitsByOrderId(orderId: string): Promise<WorkUnit[]> {
    return db.select().from(workUnits).where(eq(workUnits.orderId, orderId));
  }

  async lockWorkUnits(workUnitIds: string[], userId: string, expiresAt: Date): Promise<number> {
    const now = new Date().toISOString();
    return await db.transaction(async (tx) => {
      const result = await tx.update(workUnits)
        .set({
          lockedBy: userId,
          lockedAt: now,
          lockExpiresAt: expiresAt.toISOString(),
        })
        .where(and(
          inArray(workUnits.id, workUnitIds),
          or(
            isNull(workUnits.lockedBy),
            eq(workUnits.lockedBy, userId),
            lt(workUnits.lockExpiresAt, now)
          )
        ))
        .returning();

      if (result.length < workUnitIds.length) {
        throw new Error("LOCK_CONFLICT");
      }
      return result.length;
    });
  }

  async unlockWorkUnits(workUnitIds: string[]): Promise<void> {
    if (workUnitIds.length === 0) return;
    await db.update(workUnits)
      .set({ lockedBy: null, lockedAt: null, lockExpiresAt: null })
      .where(inArray(workUnits.id, workUnitIds));
  }

  async renewWorkUnitLock(id: string, newExpiresAt: string): Promise<void> {
    await db.update(workUnits)
      .set({ lockExpiresAt: newExpiresAt })
      .where(eq(workUnits.id, id));
  }

  async resetWorkUnitProgress(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [wu] = await tx.select().from(workUnits).where(eq(workUnits.id, id));
      if (!wu) return;

      let resetConds: any[];
      if (wu.type === "separacao") {
        resetConds = [eq(orderItems.orderId, wu.orderId)];
        if (wu.section) resetConds.push(eq(orderItems.section, wu.section));
        if (wu.pickupPoint) resetConds.push(eq(orderItems.pickupPoint, wu.pickupPoint));
      } else {
        resetConds = [
          eq(orderItems.orderId, wu.orderId),
          eq(orderItems.pickupPoint, wu.pickupPoint),
        ];
        if (wu.section) resetConds.push(eq(orderItems.section, wu.section));
      }

      const affectedItems = await tx.select({ id: orderItems.id })
        .from(orderItems)
        .where(and(...resetConds));

      if (affectedItems.length > 0) {
        await tx.delete(exceptions)
          .where(inArray(exceptions.orderItemId, affectedItems.map(i => i.id)));
      }

      await tx.update(orderItems)
        .set({ separatedQty: 0, status: "pendente", exceptionType: null })
        .where(and(...resetConds));

      await tx.update(workUnits)
        .set({ status: "pendente", startedAt: null, completedAt: null, cartQrCode: null })
        .where(eq(workUnits.id, id));
    });
  }

  async resetConferenciaProgress(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      const [wu] = await tx.select().from(workUnits).where(eq(workUnits.id, id));
      if (!wu) return;

      await tx.update(orderItems)
        .set({ checkedQty: 0 })
        .where(eq(orderItems.orderId, wu.orderId));

      await tx.update(workUnits)
        .set({ status: "pendente", startedAt: null, completedAt: null })
        .where(eq(workUnits.id, id));
    });
  }

  async resetConferenciaWorkUnitForOrder(orderId: string): Promise<void> {
    const confWus = await db.select().from(workUnits)
      .where(and(eq(workUnits.orderId, orderId), eq(workUnits.type, "conferencia")));
    for (const wu of confWus) {
      if (wu.status !== "pendente") {
        await db.update(workUnits)
          .set({ status: "pendente", completedAt: null, lockedBy: null, lockedAt: null })
          .where(eq(workUnits.id, wu.id));
      }
    }
  }

  async checkAndCompleteWorkUnit(id: string, autoComplete: boolean = true, finalOrderStatus?: string): Promise<boolean> {
    return await db.transaction(async (tx) => {
      const [workUnit] = await tx.select().from(workUnits).where(eq(workUnits.id, id));
      if (!workUnit) return false;

      let items;
      if (workUnit.type === "conferencia") {
        items = await tx.select().from(orderItems).where(eq(orderItems.orderId, workUnit.orderId));
      } else if (workUnit.type === "separacao") {
        const filters: any[] = [eq(orderItems.orderId, workUnit.orderId)];
        if (workUnit.section) filters.push(eq(orderItems.section, workUnit.section));
        items = await tx.select().from(orderItems).where(and(...filters));
      } else {
        const completeConds: any[] = [
          eq(orderItems.orderId, workUnit.orderId),
          eq(orderItems.pickupPoint, workUnit.pickupPoint),
        ];
        if (workUnit.section) completeConds.push(eq(orderItems.section, workUnit.section));
        items = await tx.select().from(orderItems).where(and(...completeConds));
      }

      const unitExceptions = await tx.select().from(exceptions).where(eq(exceptions.workUnitId, id));

      const allComplete = items.every(item => {
        const itemExcs = unitExceptions.filter(e => e.orderItemId === item.id);
        const excQty = itemExcs.reduce((sum, e) => sum + Number(e.quantity), 0);
        const isItemDone = Number(item.separatedQty) + excQty >= Number(item.quantity);
        return isItemDone;
      });

      if (allComplete) {
        if (autoComplete) {
          await tx.update(workUnits)
            .set({ status: "concluido", completedAt: new Date().toISOString(), lockedBy: null, lockedAt: null })
            .where(eq(workUnits.id, id));
        }
        if (finalOrderStatus) {
          const [order] = await tx.select().from(orders).where(eq(orders.id, workUnit.orderId)).limit(1);
          if (order && order.status !== "cancelado" && order.status !== "finalizado") {
            await tx.update(orders)
              .set({ status: finalOrderStatus, updatedAt: new Date().toISOString() })
              .where(eq(orders.id, workUnit.orderId));
          }
        }
        return true;
      }
      return false;
    });
  }

  async checkAllWorkUnitsComplete(orderId: string): Promise<boolean> {
    // 1. Pegar TODAS as unidades de separa\u00e7\u00e3o existentes
    const units = await db.select().from(workUnits).where(and(eq(workUnits.orderId, orderId), eq(workUnits.type, "separacao")));
    if (units.length === 0) return false;

    // Todas as WUs de separa\u00e7\u00e3o devem estar conclu\u00eddas
    const allWusDone = units.every(u => u.status === "concluido");
    if (!allWusDone) return false;

    // 2. DOUBLE CHECK: Validar itens do pedido e exce\u00e7\u00f5es
    // Isso evita que o pedido seja finalizado se existem se\u00e7\u00f5es que sequer tiveram WUs criadas
    const items = await this.getOrderItemsByOrderId(orderId);
    if (items.length === 0) return false;

    // Buscar exce\u00e7\u00f5es de separa\u00e7\u00e3o do pedido
    const orderExceptions = await db.select().from(exceptions)
      .innerJoin(workUnits, eq(exceptions.workUnitId, workUnits.id))
      .where(and(eq(workUnits.orderId, orderId), eq(workUnits.type, "separacao")));

    // Validar se CADA item foi separado ou tratado como exce\u00e7\u00e3o
    // Adicionalmente, verificamos se existe ALGUM item com quantidade > 0 que n\u00e3o tem separa\u00e7\u00e3o nem exce\u00e7\u00e3o.
    // Se existir, for\u00e7amos FALSE.
    const anyItemPending = items.some(item => {
      const itemExcs = orderExceptions.filter(e => e.exceptions.orderItemId === item.id);
      const excQty = itemExcs.reduce((sum, e) => sum + Number(e.exceptions.quantity), 0);
      const sep = Number(item.separatedQty);
      const qty = Number(item.quantity);
      // Item Pendente se (sep + exc < qty) E (qty > 0)
      return qty > 0 && (sep + excQty) < qty;
    });

    if (anyItemPending) return false;

    // Redundante, mas mant\u00e9m a l\u00f3gica original de 'every'
    const everythingSeparated = items.every(item => {
      const itemExcs = orderExceptions.filter(e => e.exceptions.orderItemId === item.id);
      const excQty = itemExcs.reduce((sum, e) => sum + Number(e.exceptions.quantity), 0);
      const isDone = (Number(item.separatedQty) + excQty) >= Number(item.quantity);
      return isDone;
    });

    return everythingSeparated;
  }

  async checkAllConferenceUnitsComplete(orderId: string): Promise<boolean> {
    // 1. Pegar TODAS as unidades de confer\u00eancia (paletiza\u00e7\u00e3o/confer\u00eancia)
    // Assumindo que confer\u00eancia usa type='conferencia' ou que itens verificados marcam o pedido.
    // O pedido entra em 'em_conferencia'. O target \u00e9 'conferido'.

    // items must be fully checked
    const items = await this.getOrderItemsByOrderId(orderId);
    if (items.length === 0) return false;

    const unitExceptions = await db.select().from(exceptions)
      .where(sql`order_item_id IN (SELECT id FROM order_items WHERE order_id = ${orderId})`);

    const everythingChecked = items.every(item => {
      const itemExcs = unitExceptions.filter(e => e.orderItemId === item.id);
      const excQty = itemExcs.reduce((sum, e) => sum + Number(e.quantity), 0);
      const sep = Number(item.separatedQty);
      const originalQty = Number(item.quantity);
      if (sep === 0 && originalQty === 0) return true;
      if (sep === 0 && originalQty > 0) {
        return excQty >= originalQty;
      }
      return Number(item.checkedQty) + excQty >= sep;
    });

    return everythingChecked;
  }

  async adjustItemQuantityForException(orderItemId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id, separated_qty, quantity FROM order_items WHERE id = ${orderItemId} FOR UPDATE`
      );
      const rows = (locked as any).rows ?? (locked as any);
      const item = Array.isArray(rows) ? rows[0] : rows;
      if (!item) return;

      const itemExceptions = await tx.select().from(exceptions).where(eq(exceptions.orderItemId, orderItemId));
      const totalExceptionQty = itemExceptions.reduce((sum, e) => sum + Number(e.quantity), 0);

      const currentSeparated = Number((item as any).separated_qty ?? (item as any).separatedQty ?? 0);
      const target = Number((item as any).quantity ?? 0);
      const maxSeparated = Math.max(0, target - totalExceptionQty);

      if (currentSeparated > maxSeparated) {
        await tx.update(orderItems)
          .set({ separatedQty: maxSeparated })
          .where(eq(orderItems.id, orderItemId));
      }
    });
  }

  async canCreateException(orderItemId: string, newQuantity: number): Promise<boolean> {
    const [item] = await db.select().from(orderItems).where(eq(orderItems.id, orderItemId));
    if (!item) return false;

    const itemExceptions = await db.select().from(exceptions).where(eq(exceptions.orderItemId, orderItemId));
    const currentExceptionQty = itemExceptions.reduce((sum, e) => sum + Number(e.quantity), 0);

    return (currentExceptionQty + Number(newQuantity)) <= Number(item.quantity);
  }

  // Exceptions
  async getAllExceptions(): Promise<(Exception & { orderItem: OrderItem & { product: Product; order: Order }; reportedByUser: User; workUnit: WorkUnit })[]> {
    const rows = await db
      .select({
        exc: exceptions,
        item: orderItems,
        product: products,
        order: orders,
        user: users,
        wu: workUnits,
      })
      .from(exceptions)
      .innerJoin(orderItems, eq(exceptions.orderItemId, orderItems.id))
      .innerJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .innerJoin(users, eq(exceptions.reportedBy, users.id))
      .innerJoin(workUnits, eq(exceptions.workUnitId, workUnits.id))
      .orderBy(desc(exceptions.createdAt));

    return rows.map(r => ({
      ...r.exc,
      orderItem: { ...r.item, product: r.product, order: r.order },
      reportedByUser: r.user,
      workUnit: r.wu,
    }));
  }


  async createException(exception: InsertException): Promise<Exception> {
    const [newExc] = await db.insert(exceptions).values({
      ...exception,
      type: exception.type as any,
    }).returning();
    return newExc;
  }

  async deleteException(id: string): Promise<void> {
    await db.delete(exceptions).where(eq(exceptions.id, id));
  }

  async deleteExceptionWithRollback(id: string, exc: any): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(exceptions).where(eq(exceptions.id, id));

      if (exc.orderItemId) {
        const wuType = exc.workUnit?.type;
        const isSeparacao = wuType === "separacao";

        if (isSeparacao) {
          await tx.update(orderItems)
            .set({ status: "pendente", separatedQty: 0, checkedQty: 0 })
            .where(eq(orderItems.id, exc.orderItemId));
        } else {
          await tx.update(orderItems)
            .set({ status: "pendente", checkedQty: 0 })
            .where(eq(orderItems.id, exc.orderItemId));
        }

        if (exc.workUnit) {
          await tx.update(workUnits)
            .set({
              status: "pendente",
              completedAt: null,
              lockedBy: null,
              lockedAt: null,
            })
            .where(eq(workUnits.id, exc.workUnit.id));
        }

        if (isSeparacao && exc.orderItem?.orderId) {
          await tx.update(workUnits)
            .set({ status: "pendente", completedAt: null })
            .where(and(
              eq(workUnits.orderId, exc.orderItem.orderId),
              eq(workUnits.type, "conferencia")
            ));
        }

        if (exc.orderItem?.orderId) {
          const [order] = await tx.select().from(orders).where(eq(orders.id, exc.orderItem.orderId)).limit(1);
          if (order) {
            let newStatus = order.status;
            if (isSeparacao && ["separado", "em_conferencia", "conferido"].includes(order.status)) {
              newStatus = "em_separacao";
            } else if (!isSeparacao && ["conferido"].includes(order.status)) {
              newStatus = "separado";
            }
            if (order.status !== newStatus) {
              await tx.update(orders)
                .set({ status: newStatus as any, updatedAt: new Date().toISOString() })
                .where(eq(orders.id, order.id));
            }
          }
        }
      }
    });
  }

  async deleteExceptionsForItem(orderItemId: string): Promise<void> {
    await db.delete(exceptions).where(eq(exceptions.orderItemId, orderItemId));
  }

  async authorizeExceptions(exceptionIds: string[], authData: { authorizedBy: string; authorizedByName: string; authorizedAt: string }, companyId?: number): Promise<void> {
    if (companyId) {
      const validExceptions = await db.select({ id: exceptions.id })
        .from(exceptions)
        .innerJoin(workUnits, eq(exceptions.workUnitId, workUnits.id))
        .where(and(
          inArray(exceptions.id, exceptionIds),
          eq(workUnits.companyId, companyId)
        ));
      const validIds = validExceptions.map(e => e.id);
      if (validIds.length === 0) return;
      await db.update(exceptions)
        .set({
          authorizedBy: authData.authorizedBy,
          authorizedByName: authData.authorizedByName,
          authorizedAt: authData.authorizedAt,
        })
        .where(and(
          inArray(exceptions.id, validIds),
          sql`${exceptions.authorizedBy} IS NULL`
        ));
    } else {
      await db.update(exceptions)
        .set({
          authorizedBy: authData.authorizedBy,
          authorizedByName: authData.authorizedByName,
          authorizedAt: authData.authorizedAt,
        })
        .where(inArray(exceptions.id, exceptionIds));
    }
  }

  // Audit Logs
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [newLog] = await db.insert(auditLogs).values({
      ...log,
      createdAt: new Date().toISOString()
    }).returning();
    return newLog;
  }

  async getAllAuditLogs(): Promise<(AuditLog & { user: User | null })[]> {
    const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt));
    if (logs.length === 0) return [];

    const userIds = [...new Set(logs.map(l => l.userId).filter(Boolean))] as string[];
    const allUsers = userIds.length > 0
      ? await db.select().from(users).where(inArray(users.id, userIds))
      : [];
    const userMap = new Map(allUsers.map(u => [u.id, u]));

    return logs.map(log => ({
      ...log,
      user: log.userId ? (userMap.get(log.userId) || null) : null,
    }));
  }

  async getAllSections(): Promise<Section[]> {
    return db.select().from(sections).orderBy(sections.id);
  }

  // Section Groups
  async getAllSectionGroups(): Promise<SectionGroup[]> {
    return await db.select().from(sectionGroups);
  }

  async getSectionGroupById(id: string): Promise<SectionGroup | undefined> {
    const [group] = await db.select().from(sectionGroups).where(eq(sectionGroups.id, id));
    return group;
  }

  async createSectionGroup(group: InsertSectionGroup): Promise<SectionGroup> {
    try {
      const [newGroup] = await db.insert(sectionGroups).values(group).returning();
      return newGroup;
    } catch (error) {
      throw error;
    }
  }

  async updateSectionGroup(id: string, group: Partial<InsertSectionGroup>): Promise<SectionGroup | undefined> {
    const [updated] = await db
      .update(sectionGroups)
      .set({ ...group, updatedAt: new Date().toISOString() })
      .where(eq(sectionGroups.id, id))
      .returning();
    return updated;
  }

  async deleteSectionGroup(id: string): Promise<void> {
    await db.delete(sectionGroups).where(eq(sectionGroups.id, id));
  }

  // Stats
  async getOrderStats(): Promise<{ pendentes: number; emSeparacao: number; separados: number; conferidos: number; excecoes: number }> {
    const allOrders = await db.select().from(orders);
    const allExceptions = await db.select().from(exceptions);

    return {
      pendentes: allOrders.filter(o => o.status === "pendente").length,
      emSeparacao: allOrders.filter(o => o.status === "em_separacao").length,
      separados: allOrders.filter(o => o.status === "separado").length,
      conferidos: allOrders.filter(o => o.status === "conferido").length,
      excecoes: allExceptions.length,
    };
  }

  async getPickingListReportData(filters: { orderIds?: string[]; pickupPoints?: string[]; sections?: string[] }, companyId?: number): Promise<{
    section: string;
    pickupPoint: number;
    items: (OrderItem & { product: Product; order: Order })[];
  }[]> {
    const userPP = filters.pickupPoints ? filters.pickupPoints.map(p => parseInt(p)).filter(p => !isNaN(p)) : [];
    const companyPP = companyId ? getCompanyReportPickupPoints(companyId) : null;

    let ppFilters: number[];
    if (userPP.length > 0 && companyPP) {
      ppFilters = userPP.filter(pp => companyPP.includes(pp));
      if (ppFilters.length === 0) return [];
    } else if (userPP.length > 0) {
      ppFilters = userPP;
    } else if (companyPP) {
      ppFilters = companyPP;
    } else {
      ppFilters = [];
    }

    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);

      const conditions = [];
      let validOrderIds = filters.orderIds || [];

      if (companyId) {
        const orderConds: any[] = [eq(orders.companyId, companyId)];
        if (validOrderIds.length > 0) orderConds.push(inArray(orders.id, validOrderIds));

        const companyOrders = await tx.select({ id: orders.id }).from(orders).where(and(...orderConds));
        validOrderIds = companyOrders.map(o => o.id);

        if (validOrderIds.length === 0) return [];
      }

      if (validOrderIds.length > 0) {
        conditions.push(inArray(orderItems.orderId, validOrderIds));
      }

      if (ppFilters.length > 0) {
        conditions.push(inArray(orderItems.pickupPoint, ppFilters));
      }

      if (filters.sections && filters.sections.length > 0) {
        conditions.push(inArray(orderItems.section, filters.sections));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const items = await tx.select().from(orderItems).where(whereClause);
      const result: any[] = [];

      const productIds = Array.from(new Set(items.map(i => i.productId)));
      const orderIds = Array.from(new Set(items.map(i => i.orderId)));

      const fetchedProducts = productIds.length > 0
        ? await tx.select().from(products).where(inArray(products.id, productIds))
        : [];
      const fetchedOrders = orderIds.length > 0
        ? await tx.select().from(orders).where(inArray(orders.id, orderIds))
        : [];

      const productMap = new Map(fetchedProducts.map(p => [p.id, p]));
      const orderMap = new Map(fetchedOrders.map(o => [o.id, o]));

      const erpCodes = fetchedProducts.map(p => p.erpCode).filter(Boolean);
      const factoryCodeMap = new Map<string, string>();
      if (erpCodes.length > 0) {
        const nfRows = await tx.select({
          idProduto: cacheOrcamentos.idProduto,
          codigoInternoForn: cacheOrcamentos.codigoInternoForn,
        }).from(cacheOrcamentos)
          .where(and(
            inArray(cacheOrcamentos.idProduto, erpCodes),
            sql`${cacheOrcamentos.codigoInternoForn} IS NOT NULL AND ${cacheOrcamentos.codigoInternoForn} != ''`
          ));
        for (const row of nfRows) {
          if (row.idProduto && row.codigoInternoForn && !factoryCodeMap.has(row.idProduto)) {
            factoryCodeMap.set(row.idProduto, row.codigoInternoForn);
          }
        }
      }

      const grouped = new Map<string, any>();

      for (const item of items) {
        const product = productMap.get(item.productId);
        const order = orderMap.get(item.orderId);

        // Never discard items — use fallback data if product/order not in map
        const resolvedProduct = product ?? {
          id: item.productId,
          erpCode: item.productId,
          name: `[Produto ${item.productId}]`,
          barcode: "",
          boxBarcode: null,
          boxBarcodes: null,
          section: item.section ?? "",
          pickupPoint: item.pickupPoint ?? 0,
          unit: "UN",
          manufacturer: "",
          price: 0,
          stockQty: 0,
          erpUpdatedAt: null,
        };
        const resolvedOrder = order ?? {
          id: item.orderId,
          erpOrderId: item.orderId,
          customerName: "",
          routeId: null,
          companyId: companyId ?? 0,
          status: "pendente",
          isLaunched: false,
          pickupPoint: item.pickupPoint ?? 0,
          createdAt: "",
          updatedAt: "",
        };

        if (!product) {
          log(`[Storage] Produto não encontrado for item ${item.id} (productId=${item.productId}) — using fallback`);
        }
        if (!order) {
          log(`[Storage] Pedido não encontrado for item ${item.id} (orderId=${item.orderId}) — using fallback`);
        }

        const factoryCode = resolvedProduct.erpCode ? factoryCodeMap.get(resolvedProduct.erpCode) || "" : "";
        const enrichedProduct = { ...resolvedProduct, factoryCode };

        const key = `${item.section}|${item.pickupPoint}`;

        if (!grouped.has(key)) {
          grouped.set(key, {
            section: item.section,
            pickupPoint: item.pickupPoint,
            items: []
          });
        }

        grouped.get(key).items.push({ ...item, product: enrichedProduct, order: resolvedOrder });
      }

      // Convert map to array and sort
      return Array.from(grouped.values()).sort((a, b) => {
        // Sort by Section then PickupPoint
        const secDiff = a.section.localeCompare(b.section);
        if (secDiff !== 0) return secDiff;
        return a.pickupPoint - b.pickupPoint;
      });
    });
  }



  // Picking Sessions
  async createPickingSession(session: InsertPickingSession): Promise<PickingSession> {
    const [newSession] = await db.insert(pickingSessions).values(session).returning();
    return newSession;
  }

  async getPickingSession(orderId: string, sectionId: string): Promise<PickingSession | undefined> {
    const [session] = await db.select()
      .from(pickingSessions)
      .where(and(eq(pickingSessions.orderId, orderId), eq(pickingSessions.sectionId, sectionId)));
    return session;
  }

  async updatePickingSessionHeartbeat(id: string, userId?: string): Promise<number> {
    const condition = userId
      ? and(eq(pickingSessions.id, id), eq(pickingSessions.userId, userId))
      : eq(pickingSessions.id, id);
    const result = await db.update(pickingSessions)
      .set({ lastHeartbeat: new Date().toISOString() })
      .where(condition)
      .returning({ id: pickingSessions.id });
    return result.length;
  }

  async deletePickingSession(orderId: string, sectionId: string): Promise<void> {
    await db.delete(pickingSessions)
      .where(and(eq(pickingSessions.orderId, orderId), eq(pickingSessions.sectionId, sectionId)));
  }

  async getPickingSessionsByOrder(orderId: string): Promise<PickingSession[]> {
    return await db.select().from(pickingSessions).where(eq(pickingSessions.orderId, orderId));
  }

  async cancelOrderLaunch(orderId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(workUnits).where(and(eq(workUnits.orderId, orderId), eq(workUnits.type, "conferencia")));

      await tx.update(workUnits)
        .set({ 
          status: "pendente", 
          lockedBy: null, 
          lockedAt: null,
          startedAt: null,
          completedAt: null,
          cartQrCode: null,
          palletQrCode: null
        })
        .where(and(eq(workUnits.orderId, orderId), inArray(workUnits.type, ["separacao", "balcao"])));

      await tx.delete(pickingSessions).where(eq(pickingSessions.orderId, orderId));

      const items = await tx.select({ id: orderItems.id })
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));

      if (items.length > 0) {
        await tx.delete(exceptions).where(
          inArray(exceptions.orderItemId, items.map(i => i.id))
        );
      }

      await tx.update(orderItems)
        .set({
          status: "pendente",
          qtyPicked: 0,
          separatedQty: 0,
          checkedQty: 0,
          exceptionType: null,
        })
        .where(eq(orderItems.orderId, orderId));

      await tx.delete(orderVolumes).where(eq(orderVolumes.orderId, orderId));

      await tx.update(orders)
        .set({
          status: "pendente",
          isLaunched: false,
          launchedAt: null,
          loadCode: null,
          routeId: null,
          priority: 0,
          updatedAt: new Date().toISOString()
        })
        .where(eq(orders.id, orderId));
    });
  }


  // DB2 Mappings
  async getMappingByDataset(dataset: string): Promise<Db2Mapping | undefined> {
    const [mapping] = await db.select().from(db2Mappings)
      .where(and(eq(db2Mappings.dataset, dataset), eq(db2Mappings.isActive, true)))
      .orderBy(desc(db2Mappings.version))
      .limit(1);
    return mapping;
  }

  async getAllMappings(): Promise<Db2Mapping[]> {
    return db.select().from(db2Mappings).orderBy(db2Mappings.dataset, desc(db2Mappings.version));
  }

  async saveMapping(dataset: string, mappingJson: MappingField[], description: string | null, createdBy: string): Promise<Db2Mapping> {
    const existing = await db.select().from(db2Mappings)
      .where(eq(db2Mappings.dataset, dataset))
      .orderBy(desc(db2Mappings.version))
      .limit(1);

    const nextVersion = existing.length > 0 ? (existing[0].version + 1) : 1;

    const [mapping] = await db.insert(db2Mappings).values({
      dataset,
      version: nextVersion,
      isActive: false,
      mappingJson: mappingJson as any,
      description,
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning();

    return mapping;
  }

  async activateMapping(id: string): Promise<Db2Mapping | undefined> {
    const [mapping] = await db.select().from(db2Mappings).where(eq(db2Mappings.id, id));
    if (!mapping) return undefined;

    await db.update(db2Mappings)
      .set({ isActive: false })
      .where(eq(db2Mappings.dataset, mapping.dataset));

    const [activated] = await db.update(db2Mappings)
      .set({ isActive: true, updatedAt: new Date().toISOString() })
      .where(eq(db2Mappings.id, id))
      .returning();

    return activated;
  }

  async checkAndCompleteConference(id: string): Promise<boolean> {
    return await db.transaction(async (tx) => {
      const [workUnit] = await tx.select().from(workUnits).where(eq(workUnits.id, id));
      if (!workUnit) return false;

      const items = await tx.select().from(orderItems).where(
        eq(orderItems.orderId, workUnit.orderId)
      );

      const unitExceptions = await tx.select().from(exceptions).where(eq(exceptions.workUnitId, id));

      const allComplete = items.every(item => {
        const itemExcs = unitExceptions.filter(e => e.orderItemId === item.id);
        const excQty = itemExcs.reduce((sum, e) => sum + Number(e.quantity), 0);
        const sep = Number(item.separatedQty) || 0;
        const originalQty = Number(item.quantity) || 0;
        if (sep === 0 && originalQty === 0) return true;
        if (sep === 0 && originalQty > 0) {
          return excQty >= originalQty;
        }
        return Number(item.checkedQty) + excQty >= sep;
      });

      if (allComplete) {
        await tx.update(workUnits)
          .set({ status: "concluido", completedAt: new Date().toISOString(), lockedBy: null, lockedAt: null })
          .where(eq(workUnits.id, id));

        const [currentOrder] = await tx.select().from(orders).where(eq(orders.id, workUnit.orderId)).limit(1);
        if (currentOrder && currentOrder.status !== "cancelado" && currentOrder.status !== "finalizado") {
          await tx.update(orders)
            .set({ status: "conferido", updatedAt: new Date().toISOString() })
            .where(eq(orders.id, workUnit.orderId));
        }
        return true;
      }
      return false;
    });
  }

  async getCacheOrcamentosPreview(limit: number): Promise<any[]> {
    const rows = await db.select().from(cacheOrcamentos).limit(limit);
    return rows;
  }

  async processBatchSync(
    workUnitId: string,
    payload: BatchSyncPayload,
    userId: string
  ): Promise<void> {
    const wu = await this.getWorkUnitById(workUnitId);
    if (!wu) throw new Error("Work Unit não encontrada");

    // Start a Database Transaction
    await db.transaction(async (tx) => {

      // 1. Process Items (Add Quantities) — with FOR UPDATE lock and target validation
      for (const item of payload.items) {
        if (!item.qtyToAdd || item.qtyToAdd <= 0) continue;

        if (wu.type === "separacao") {
          const lockedRows = await tx.execute(
            sql`SELECT id, separated_qty, quantity FROM order_items WHERE id = ${item.orderItemId} FOR UPDATE`
          );
          const rows = (lockedRows as any).rows ?? (lockedRows as any);
          const row = Array.isArray(rows) ? rows[0] : rows;
          if (!row) continue;

          const currentQty = Number(row.separated_qty ?? 0);
          const originalQty = Number(row.quantity ?? 0);

          const excRows = await tx.select().from(exceptions)
            .where(eq(exceptions.orderItemId, item.orderItemId));
          const excQty = excRows.reduce((sum: number, e: any) => sum + Number(e.quantity || 0), 0);
          const adjustedTarget = Math.max(0, originalQty - excQty);

          if (currentQty >= adjustedTarget) {
            await tx.update(orderItems)
              .set({ separatedQty: 0, status: "recontagem" })
              .where(eq(orderItems.id, item.orderItemId));
            await tx.update(workUnits)
              .set({ status: "em_andamento" })
              .where(eq(workUnits.id, workUnitId));
            await tx.insert(auditLogs).values({
              action: "batch_sync_over_limit",
              entityType: "order_item",
              entityId: item.orderItemId,
              userId: userId,
              details: `Recontagem: qty offline (${item.qtyToAdd}) ultrapassou alvo ${adjustedTarget} na WU ${workUnitId}`,
            });
            continue;
          }

          const canAdd = Math.min(item.qtyToAdd, adjustedTarget - currentQty);
          const newQty = currentQty + canAdd;
          const newStatus = newQty >= adjustedTarget ? "separado" : "pendente";
          await tx.update(orderItems)
            .set({ separatedQty: newQty, status: newStatus })
            .where(eq(orderItems.id, item.orderItemId));

          await tx.insert(auditLogs).values({
            action: "batch_sync_item",
            entityType: "order_item",
            entityId: item.orderItemId,
            userId: userId,
            details: `Sync offline +${canAdd} (solicitado: ${item.qtyToAdd}), total ${newQty}/${adjustedTarget}, WU ${workUnitId}`,
          });

        } else if (wu.type === "conferencia" || wu.type === "balcao") {
          const lockedRows = await tx.execute(
            sql`SELECT id, checked_qty, separated_qty, quantity FROM order_items WHERE id = ${item.orderItemId} FOR UPDATE`
          );
          const rows = (lockedRows as any).rows ?? (lockedRows as any);
          const row = Array.isArray(rows) ? rows[0] : rows;
          if (!row) continue;

          const currentQty = Number(row.checked_qty ?? 0);
          const sep = Number(row.separated_qty ?? 0);
          const orig = Number(row.quantity ?? 0);
          const targetQty = sep > 0 ? sep : orig;

          if (currentQty >= targetQty) continue;

          const canAdd = Math.min(item.qtyToAdd, targetQty - currentQty);
          const newQty = currentQty + canAdd;
          const newStatus = newQty >= targetQty ? "conferido" : "separado";
          await tx.update(orderItems)
            .set({ checkedQty: newQty, status: newStatus })
            .where(eq(orderItems.id, item.orderItemId));

          await tx.insert(auditLogs).values({
            action: "batch_sync_item",
            entityType: "order_item",
            entityId: item.orderItemId,
            userId: userId,
            details: `Sync offline +${canAdd} (solicitado: ${item.qtyToAdd}), total ${newQty}/${targetQty}, WU ${workUnitId} (${wu.type})`,
          });
        }
      }

      // 2. Process Exceptions
      for (const exc of payload.exceptions) {
        if (!exc.quantity || exc.quantity <= 0) continue;

        const [item] = await tx.select().from(orderItems)
          .where(eq(orderItems.id, exc.orderItemId)).limit(1);
        if (item) {
          const existingExcRows = await tx.select().from(exceptions)
            .where(eq(exceptions.orderItemId, exc.orderItemId));
          const currentExcQty = existingExcRows.reduce((sum: number, e: any) => sum + Number(e.quantity || 0), 0);
          if (currentExcQty + exc.quantity > Number(item.quantity)) {
            continue;
          }
        }

        let verifiedAuthorizedBy: string | null = null;
        let verifiedAuthorizedByName: string | null = null;
        if (exc.authorizedBy) {
          const [authUser] = await tx.execute(
            sql`SELECT id, role, name FROM users WHERE id = ${exc.authorizedBy} LIMIT 1`
          ).then((r: any) => (r.rows ?? r) as any[]);
          if (authUser && (authUser.role === "supervisor" || authUser.role === "administrador")) {
            verifiedAuthorizedBy = String(authUser.id);
            verifiedAuthorizedByName = exc.authorizedByName || String(authUser.name) || null;
          }
        }

        await tx.insert(exceptions).values({
          workUnitId: workUnitId,
          orderItemId: exc.orderItemId,
          type: exc.type,
          quantity: exc.quantity,
          observation: exc.observation || null,
          reportedBy: userId,
          authorizedBy: verifiedAuthorizedBy,
          authorizedByName: verifiedAuthorizedByName,
          authorizedAt: verifiedAuthorizedBy ? new Date().toISOString() : undefined,
        });

        // Audit Log for Exception
        await tx.insert(auditLogs).values({
          action: "batch_sync_exception",
          entityType: "exception",
          entityId: exc.orderItemId, // Link to item ID
          userId: userId,
          details: `Exceção reportada: ${exc.type}, Qtd: ${exc.quantity}`,
        });
      }

    });
  }

  async getRouteOrdersPrintData(orderIds: string[]): Promise<any[]> {
    if (orderIds.length === 0) return [];

    const ordersData = await db.select().from(orders).where(inArray(orders.id, orderIds));
    const itemsData = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));

    const productIds = [...new Set(itemsData.map(i => i.productId))];
    const productsData = productIds.length > 0
      ? await db.select().from(products).where(inArray(products.id, productIds))
      : [];
    const productsMap = new Map(productsData.map(p => [p.id, p]));

    return ordersData.map(order => ({
      ...order,
      items: itemsData.filter(i => i.orderId === order.id).map(item => ({
        ...item,
        product: productsMap.get(item.productId)
      }))
    }));
  }

  async getLoadingMapProductCentricReportData(loadCode: string): Promise<{
    section: string;
    products: {
      product: Product;
      totalQuantity: number;
      totalExceptionQty?: number;
      orders: {
        erpOrderId: string;
        customerName: string;
        quantity: number;
        exceptionQty?: number;
        exceptionType?: string | null;
        exceptionObs?: string | null;
      }[];
    }[];
  }[]> {
    const ordersData = (await db.select().from(orders).where(eq(orders.loadCode, loadCode))).filter(o => o.status === "conferido");
    if (ordersData.length === 0) return [];

    const orderIds = ordersData.map(o => o.id);
    const itemsData = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
    if (itemsData.length === 0) return [];

    const productIds = [...new Set(itemsData.map(i => i.productId))];
    const productsData = productIds.length > 0
      ? await db.select().from(products).where(inArray(products.id, productIds))
      : [];
    const productsMap = new Map(productsData.map(p => [p.id, p]));
    const ordersMap = new Map(ordersData.map(o => [o.id, o]));

    const itemIds = itemsData.map(i => i.id);
    const exceptionsData = itemIds.length > 0
      ? await db.select().from(exceptions).where(inArray(exceptions.orderItemId, itemIds))
      : [];

    const exceptionByItem = new Map<string, { qty: number; type: string | null; obs: string | null }>();
    for (const exc of exceptionsData) {
      const existing = exceptionByItem.get(exc.orderItemId);
      const qty = Number(exc.quantity);
      if (!existing) {
        exceptionByItem.set(exc.orderItemId, { qty, type: exc.type, obs: exc.observation || null });
      } else {
        existing.qty += qty;
        if (!existing.type && exc.type) existing.type = exc.type;
        if (!existing.obs && exc.observation) existing.obs = exc.observation;
      }
    }

    const sectionMap = new Map<string, Map<string, {
      product: Product;
      totalQuantity: number;
      totalExceptionQty?: number;
      orders: { erpOrderId: string; customerName: string; quantity: number; exceptionQty?: number; exceptionType?: string | null; exceptionObs?: string | null }[]
    }>>();

    for (const item of itemsData) {
      const product = productsMap.get(item.productId);
      const order = ordersMap.get(item.orderId);
      if (!product || !order) continue;

      const sectionKey = item.section || "Sem Seção";
      if (!sectionMap.has(sectionKey)) {
        sectionMap.set(sectionKey, new Map());
      }

      const prodMap = sectionMap.get(sectionKey)!;
      if (!prodMap.has(product.id)) {
        prodMap.set(product.id, {
          product,
          totalQuantity: 0,
          totalExceptionQty: 0,
          orders: []
        });
      }

      const prodEntry = prodMap.get(product.id)!;
      prodEntry.totalQuantity += Number(item.quantity);
      
      const excInfo = exceptionByItem.get(item.id);
      if (excInfo) {
        prodEntry.totalExceptionQty = (prodEntry.totalExceptionQty || 0) + excInfo.qty;
      }

      prodEntry.orders.push({
        erpOrderId: order.erpOrderId,
        customerName: order.customerName,
        quantity: Number(item.quantity),
        exceptionQty: excInfo?.qty || 0,
        exceptionType: excInfo?.type || null,
        exceptionObs: excInfo?.obs || null
      });
    }

    return Array.from(sectionMap.entries()).map(([section, prodMap]) => {
      const products = Array.from(prodMap.values());
      products.sort((a, b) => a.product.name.localeCompare(b.product.name));
      return { section, products };
    }).sort((a, b) => a.section.localeCompare(b.section));
  }

  async getLoadingMapReportData(loadCode: string): Promise<{
    customerName: string;
    customerCode: string | null;
    erpOrderId: string;
    totalValue: number;
    totalProducts: number;
    sections: { section: string; items: { product: Product; quantity: number; exceptionQty: number; exceptionType: string | null; exceptionObs: string | null }[] }[];
  }[]> {
    // Find all completed orders with this loadCode
    const ordersData = (await db.select().from(orders).where(eq(orders.loadCode, loadCode))).filter(o => o.status === "conferido");
    if (ordersData.length === 0) return [];

    const orderIds = ordersData.map(o => o.id);

    // Fetch items for all these orders
    const itemsData = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
    if (itemsData.length === 0) return [];

    // Fetch products
    const productIds = [...new Set(itemsData.map(i => i.productId))];
    const productsData = productIds.length > 0
      ? await db.select().from(products).where(inArray(products.id, productIds))
      : [];
    const productsMap = new Map(productsData.map(p => [p.id, p]));

    // Fetch exceptions for all items
    const itemIds = itemsData.map(i => i.id);
    const exceptionsData = itemIds.length > 0
      ? await db.select().from(exceptions).where(inArray(exceptions.orderItemId, itemIds))
      : [];

    // Map exception data by orderItemId
    const exceptionByItem = new Map<string, { qty: number; type: string | null; obs: string | null }>();
    for (const exc of exceptionsData) {
      const existing = exceptionByItem.get(exc.orderItemId);
      const qty = Number(exc.quantity);
      if (!existing) {
        exceptionByItem.set(exc.orderItemId, { qty, type: exc.type, obs: exc.observation || null });
      } else {
        existing.qty += qty;
      }
    }

    // Build result grouped by customer -> section
    const customerMap = new Map<string, {
      customerName: string;
      customerCode: string | null;
      erpOrderId: string;
      totalValue: number;
      totalProducts: number;
      sectionMap: Map<string, { product: Product; quantity: number; exceptionQty: number; exceptionType: string | null; exceptionObs: string | null }[]>;
    }>();

    for (const order of ordersData) {
      const key = order.erpOrderId;
      const items = itemsData.filter(i => i.orderId === order.id);

      if (!customerMap.has(key)) {
        customerMap.set(key, {
          customerName: order.customerName,
          customerCode: order.customerCode || null,
          erpOrderId: order.erpOrderId,
          totalValue: Number(order.totalValue || 0),
          totalProducts: items.length,
          sectionMap: new Map(),
        });
      }
      const customer = customerMap.get(key)!;

      for (const item of items) {
        const product = productsMap.get(item.productId);
        if (!product) continue;

        const sectionKey = item.section || "Sem Seção";
        if (!customer.sectionMap.has(sectionKey)) {
          customer.sectionMap.set(sectionKey, []);
        }

        const excInfo = exceptionByItem.get(item.id) || { qty: 0, type: null, obs: null };
        customer.sectionMap.get(sectionKey)!.push({
          product,
          quantity: Number(item.quantity),
          exceptionQty: excInfo.qty,
          exceptionType: excInfo.type,
          exceptionObs: excInfo.obs,
        });
      }
    }

    // Convert to final structure
    return Array.from(customerMap.values()).map(customer => ({
      customerName: customer.customerName,
      customerCode: customer.customerCode,
      erpOrderId: customer.erpOrderId,
      totalValue: customer.totalValue,
      totalProducts: customer.totalProducts,
      sections: Array.from(customer.sectionMap.entries()).map(([section, items]) => {
        items.sort((a, b) => a.product.name.localeCompare(b.product.name));
        return {
          section,
          items,
        };
      }),
    }));
  }

  // Order Volumes
  async upsertOrderVolume(data: Omit<InsertOrderVolume, 'totalVolumes'> & { userId: string }): Promise<OrderVolume> {
    const total = (data.sacola ?? 0) + (data.caixa ?? 0) + (data.saco ?? 0) + (data.avulso ?? 0);
    const now = new Date().toISOString();

    const existing = await this.getOrderVolume(data.orderId);
    if (existing) {
      const [updated] = await db.update(orderVolumes)
        .set({ sacola: data.sacola, caixa: data.caixa, saco: data.saco, avulso: data.avulso, totalVolumes: total, updatedAt: now })
        .where(eq(orderVolumes.orderId, data.orderId))
        .returning();
      return updated;
    }

    const [created] = await db.insert(orderVolumes).values({
      id: randomUUID(),
      orderId: data.orderId,
      erpOrderId: data.erpOrderId,
      sacola: data.sacola ?? 0,
      caixa: data.caixa ?? 0,
      saco: data.saco ?? 0,
      avulso: data.avulso ?? 0,
      totalVolumes: total,
      createdBy: data.userId,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return created;
  }

  async getOrderVolume(orderId: string): Promise<OrderVolume | undefined> {
    const [vol] = await db.select().from(orderVolumes).where(eq(orderVolumes.orderId, orderId));
    return vol;
  }

  async deleteOrderVolume(orderId: string): Promise<void> {
    await db.delete(orderVolumes).where(eq(orderVolumes.orderId, orderId));
  }

  async getAllOrderVolumes(): Promise<OrderVolume[]> {
    return db.select().from(orderVolumes).orderBy(desc(orderVolumes.createdAt));
  }

  // System Settings
  async getSystemSettings(): Promise<SystemSettings> {
    try {
      const [settings] = await db.select().from(systemSettings).where(eq(systemSettings.id, "global"));
      if (settings) return settings;
      const [created] = await db.insert(systemSettings).values({ id: "global", separationMode: "by_order", updatedAt: new Date().toISOString() }).returning();
      return created;
    } catch {
      // Fallback: column missing (e.g. quick_link_enabled not yet migrated) — use raw SQL to avoid ORM schema mismatch
      try {
        const result = await db.execute(sql`SELECT id, separation_mode, updated_at, updated_by FROM system_settings WHERE id = 'global'`);
        if (result.rows.length > 0) {
          const row = result.rows[0] as Record<string, unknown>;
          return {
            id: row.id as string,
            separationMode: (row.separation_mode as SeparationMode) ?? "by_order",
            updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
            updatedBy: (row.updated_by as string | null) ?? null,
            quickLinkEnabled: true,
          };
        }
      } catch { /* continue to default */ }
      return { id: "global", separationMode: "by_order", updatedAt: new Date().toISOString(), updatedBy: null, quickLinkEnabled: true };
    }
  }

  async updateSeparationMode(mode: SeparationMode, updatedBy: string): Promise<SystemSettings> {
    const [updated] = await db.update(systemSettings)
      .set({ separationMode: mode, updatedAt: new Date().toISOString(), updatedBy })
      .where(eq(systemSettings.id, "global"))
      .returning();
    if (updated) return updated;
    const [created] = await db.insert(systemSettings).values({ id: "global", separationMode: mode, updatedAt: new Date().toISOString(), updatedBy }).returning();
    return created;
  }

  async updateQuickLinkEnabled(enabled: boolean, updatedBy: string): Promise<SystemSettings> {
    const [updated] = await db.update(systemSettings)
      .set({ quickLinkEnabled: enabled, updatedAt: new Date().toISOString(), updatedBy })
      .where(eq(systemSettings.id, "global"))
      .returning();
    if (updated) return updated;
    const [created] = await db.insert(systemSettings).values({ id: "global", separationMode: "by_order", quickLinkEnabled: enabled, updatedAt: new Date().toISOString(), updatedBy }).returning();
    return created;
  }

  async getActiveSeparationConflicts(): Promise<{ activeSessions: number; activeWorkUnits: number; affectedSections: string[]; activeUsers: string[] }> {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const activeSessions = await db.select({
      sectionId: pickingSessions.sectionId,
      userId: pickingSessions.userId,
    }).from(pickingSessions).where(gt(pickingSessions.lastHeartbeat, twoMinutesAgo));

    const activeWus = await db.select({
      section: workUnits.section,
      lockedBy: workUnits.lockedBy,
    }).from(workUnits).where(eq(workUnits.status, "em_andamento"));

    const affectedSectionsSet = new Set<string>();
    const activeUsersSet = new Set<string>();

    for (const s of activeSessions) {
      affectedSectionsSet.add(s.sectionId);
      activeUsersSet.add(s.userId);
    }
    for (const wu of activeWus) {
      if (wu.section) affectedSectionsSet.add(wu.section);
      if (wu.lockedBy) activeUsersSet.add(wu.lockedBy);
    }

    // Resolve user names
    const userIds = Array.from(activeUsersSet);
    const activeUserNames: string[] = [];
    if (userIds.length > 0) {
      const userRows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds));
      for (const u of userRows) activeUserNames.push(u.name);
    }

    return {
      activeSessions: activeSessions.length,
      activeWorkUnits: activeWus.length,
      affectedSections: Array.from(affectedSectionsSet).sort(),
      activeUsers: activeUserNames,
    };
  }

  async cancelAllPickingSessions(): Promise<void> {
    await db.delete(pickingSessions);
  }

  async resetActiveWorkUnits(): Promise<number> {
    const result = await db.update(workUnits)
      .set({ status: "pendente", lockedBy: null, lockedAt: null, lockExpiresAt: null, startedAt: null })
      .where(eq(workUnits.status, "em_andamento"))
      .returning({ id: workUnits.id });
    return result.length;
  }

  // Scan Log — dedup persistente de msgIds (S1-04)
  async insertScanLogDedup(msgId: string, userId: string, companyId: number | undefined, workUnitId: string, barcode: string, quantity: number): Promise<{ inserted: boolean }> {
    const companyIdInt = companyId ?? -1;
    const result = await db.execute(
      sql`INSERT INTO scan_log (msg_id, user_id, company_id_int, work_unit_id, barcode, quantity, ack_status, created_at)
          VALUES (${msgId}, ${userId}, ${companyIdInt}, ${workUnitId}, ${barcode}, ${quantity}, 'pending', ${new Date().toISOString()})
          ON CONFLICT (msg_id, user_id, company_id_int) DO NOTHING`
    );
    const rowCount = (result as any).rowCount ?? 0;
    return { inserted: Number(rowCount) > 0 };
  }

  async cleanupOldScanLogs(daysOld = 7): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);
    const result = await db.execute(
      sql`DELETE FROM scan_log WHERE created_at < ${cutoff.toISOString()}`
    );
    return (result as any).rowCount ?? 0;
  }
}

export const storage = new DatabaseStorage();

