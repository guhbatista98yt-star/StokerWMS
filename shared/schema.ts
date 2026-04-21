import { pgTable, text, integer, doublePrecision, boolean, serial, uniqueIndex, index, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userRoleEnum = ["administrador", "supervisor", "separacao", "conferencia", "balcao", "fila_pedidos", "recebedor", "empilhador", "conferente_wms"] as const;
export type UserRole = typeof userRoleEnum[number];

export const orderStatusEnum = ["pendente", "em_separacao", "separado", "em_conferencia", "conferido", "finalizado", "cancelado"] as const;
export type OrderStatus = typeof orderStatusEnum[number];

export const workUnitStatusEnum = ["pendente", "em_andamento", "concluido", "recontagem", "excecao"] as const;
export type WorkUnitStatus = typeof workUnitStatusEnum[number];

export const itemStatusEnum = ["pendente", "separado", "conferido", "excecao", "recontagem"] as const;
export type ItemStatus = typeof itemStatusEnum[number];

export const exceptionTypeEnum = ["nao_encontrado", "avariado", "vencido"] as const;
export type ExceptionType = typeof exceptionTypeEnum[number];

export const workUnitTypeEnum = ["separacao", "conferencia", "balcao"] as const;
export type WorkUnitType = typeof workUnitTypeEnum[number];

export const ORDER_STATUS = {
  PENDENTE: "pendente" as const,
  EM_SEPARACAO: "em_separacao" as const,
  SEPARADO: "separado" as const,
  EM_CONFERENCIA: "em_conferencia" as const,
  CONFERIDO: "conferido" as const,
  FINALIZADO: "finalizado" as const,
  CANCELADO: "cancelado" as const,
};

export const WU_STATUS = {
  PENDENTE: "pendente" as const,
  EM_ANDAMENTO: "em_andamento" as const,
  CONCLUIDO: "concluido" as const,
  RECONTAGEM: "recontagem" as const,
  EXCECAO: "excecao" as const,
};

export const WU_TYPE = {
  SEPARACAO: "separacao" as const,
  CONFERENCIA: "conferencia" as const,
  BALCAO: "balcao" as const,
};

export const palletStatusEnum = ["sem_endereco", "alocado", "em_transferencia", "cancelado"] as const;
export type PalletStatus = typeof palletStatusEnum[number];

export const palletMovementTypeEnum = ["created", "allocated", "transferred", "split", "cancelled", "counted", "withdrawn", "updated", "partial_transfer", "addition"] as const;
export type PalletMovementType = typeof palletMovementTypeEnum[number];

export const wmsAddressTypeEnum = ["standard", "picking", "recebimento", "expedicao"] as const;
export type WmsAddressType = typeof wmsAddressTypeEnum[number];

export const countingCycleTypeEnum = ["por_endereco", "por_produto", "por_pallet"] as const;
export type CountingCycleType = typeof countingCycleTypeEnum[number];

export const countingCycleStatusEnum = ["pendente", "em_andamento", "concluido", "aprovado", "rejeitado"] as const;
export type CountingCycleStatus = typeof countingCycleStatusEnum[number];

export const countingCycleItemStatusEnum = ["pendente", "contado", "divergente", "aprovado"] as const;
export type CountingCycleItemStatus = typeof countingCycleItemStatusEnum[number];

export const nfStatusEnum = ["pendente", "em_recebimento", "recebida", "cancelada"] as const;
export type NfStatus = typeof nfStatusEnum[number];

export const separationModeEnum = ["by_order", "by_section"] as const;
export type SeparationMode = typeof separationModeEnum[number];

export interface PrintConfig {
  printer: string;
  copies: number;
}

export interface UserSettings {
  allowMultiplier?: boolean;
  canAuthorizeOwnExceptions?: boolean;
  printConfig?: Record<string, PrintConfig>;
  // Permite digitação manual nos inputs de scan (físico ou via teclado virtual).
  // Se false, somente leitura de scanner é aceita. Default: true.
  allowManualScanInput?: boolean;
  // Mostra o botão de "Vínculo Rápido de Embalagem" nas telas operacionais. Default: true.
  viewQuickLinkBarcode?: boolean;
  // Mostra o botão de "Consultar Estoque" nas telas operacionais. Default: true.
  viewStockQuery?: boolean;
}

export const companies = pgTable("companies", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  cnpj: text("cnpj"),
});

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  username: text("username").notNull(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("separacao").$type<UserRole>(),
  sections: jsonb("sections").$type<string[]>(),
  settings: jsonb("settings").$type<UserSettings>().default({}),
  active: boolean("active").notNull().default(true),
  badgeCode: text("badge_code"),
  defaultCompanyId: integer("default_company_id"),
  allowedCompanies: jsonb("allowed_companies").$type<number[]>().default([]),
  allowedModules: jsonb("allowed_modules").$type<string[]>(),
  allowedReports: jsonb("allowed_reports").$type<string[]>(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
}, (table) => ({
  usernameIdx: index("idx_users_username").on(table.username),
  badgeCodeIdx: index("idx_users_badge_code").on(table.badgeCode),
}));

export const routes = pgTable("routes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const sections = pgTable("sections", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
});

export const pickupPoints = pgTable("pickup_points", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

export const sectionGroups = pgTable("section_groups", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  sections: jsonb("sections").$type<string[]>().notNull(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const cacheOrcamentos = pgTable("cache_orcamentos", {
  id: serial("id").primaryKey(),
  chave: text("CHAVE").notNull().unique(),
  idEmpresa: integer("IDEMPRESA"),
  idOrcamento: integer("IDORCAMENTO"),
  idProduto: text("IDPRODUTO"),
  idSubProduto: text("IDSUBPRODUTO"),
  numSequencia: integer("NUMSEQUENCIA"),
  qtdProduto: doublePrecision("QTDPRODUTO"),
  unidade: text("UNIDADE"),
  fabricante: text("FABRICANTE"),
  valUnitBruto: doublePrecision("VALUNITBRUTO"),
  valTotLiquido: doublePrecision("VALTOTLIQUIDO"),
  descrResProduto: text("DESCRRESPRODUTO"),
  idVendedor: text("IDVENDEDOR"),
  idLocalRetirada: integer("IDLOCALRETIRADA"),
  idSecao: integer("IDSECAO"),
  descrSecao: text("DESCRSECAO"),
  tipoEntrega: text("TIPOENTREGA"),
  nomeVendedor: text("NOMEVENDEDOR"),
  tipoEntregaDescr: text("TIPOENTREGA_DESCR"),
  localRetEstoque: text("LOCALRETESTOQUE"),
  flagCancelado: text("FLAGCANCELADO"),
  idCliFor: text("IDCLIFOR"),
  desCliente: text("DESCLIENTE"),
  dtMovimento: text("DTMOVIMENTO"),
  idRecebimento: text("IDRECEBIMENTO"),
  descrRecebimento: text("DESCRRECEBIMENTO"),
  flagPrenotaPaga: text("FLAGPRENOTAPAGA"),
  syncAt: text("sync_at"),
  codigoInternoForn: text("CODIGOINTERNOFORN"),
  codBarras: text("CODBARRAS"),
  codBarrasCaixa: text("CODBARRAS_CAIXA"),
  observacao: text("OBSERVACAO"),
  observacao2: text("OBSERVACAO2"),
  descrCidade: text("DESCRCIDADE"),
  uf: text("UF"),
  idCep: text("IDCEP"),
  endereco: text("ENDERECO"),
  bairro: text("BAIRRO"),
  cnpjCpf: text("CNPJCPF"),
  numero: text("NUMERO"),
});

export const products = pgTable("products", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  erpCode: text("erp_code").notNull().unique(),
  barcode: text("barcode"),
  boxBarcode: text("box_barcode"),
  boxBarcodes: jsonb("box_barcodes").$type<{ code: string, qty: number }[]>(),
  name: text("name").notNull(),
  section: text("section").notNull(),
  pickupPoint: integer("pickup_point").notNull(),
  unit: text("unit").notNull().default("UN"),
  manufacturer: text("manufacturer"),
  price: doublePrecision("price").notNull().default(0),
  stockQty: doublePrecision("stock_qty").notNull().default(0),
  erpUpdatedAt: text("erp_updated_at"),
}, (table) => ({
  barcodeIdx: index("idx_products_barcode").on(table.barcode),
  sectionIdx: index("idx_products_section").on(table.section),
}));

export const orders = pgTable("orders", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  erpOrderId: text("erp_order_id").notNull().unique(),
  customerName: text("customer_name").notNull(),
  customerCode: text("customer_code"),
  totalValue: doublePrecision("total_value").notNull().default(0),
  observation: text("observation"),
  observation2: text("observation2"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  address: text("address"),
  neighborhood: text("neighborhood"),
  cnpjCpf: text("cnpj_cpf"),
  addressNumber: text("address_number"),
  status: text("status").notNull().default("pendente").$type<OrderStatus>(),
  priority: integer("priority").notNull().default(0),
  isLaunched: boolean("is_launched").notNull().default(false),
  launchedAt: text("launched_at"),
  separatedAt: text("separated_at"),
  loadCode: text("load_code"),
  routeId: text("route_id").references(() => routes.id),
  separationCode: text("separation_code"),
  pickupPoints: jsonb("pickup_points").$type<number[]>(),
  erpUpdatedAt: text("erp_updated_at"),
  financialStatus: text("financial_status").notNull().default("pendente"),
  companyId: integer("company_id"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
}, (table) => ({
  statusIdx: index("idx_orders_status").on(table.status),
  companyStatusIdx: index("idx_orders_company_status").on(table.companyId, table.status),
  loadCodeIdx: index("idx_orders_load_code").on(table.loadCode),
}));

export const orderItems = pgTable("order_items", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderId: text("order_id").notNull().references(() => orders.id),
  productId: text("product_id").notNull().references(() => products.id),
  quantity: doublePrecision("quantity").notNull(),
  separatedQty: doublePrecision("separated_qty").notNull().default(0),
  checkedQty: doublePrecision("checked_qty").notNull().default(0),
  section: text("section").notNull(),
  pickupPoint: integer("pickup_point").notNull(),
  qtyPicked: doublePrecision("qty_picked").default(0),
  qtyChecked: doublePrecision("qty_checked").default(0),
  status: text("status").default("pendente").$type<ItemStatus>(),
  exceptionType: text("exception_type").$type<ExceptionType>(),
}, (table) => ({
  orderIdIdx: index("idx_order_items_order_id").on(table.orderId),
  productIdIdx: index("idx_order_items_product_id").on(table.productId),
}));

export const pickingSessions = pgTable("picking_sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  orderId: text("order_id").notNull().references(() => orders.id),
  sectionId: text("section_id").notNull(),
  lastHeartbeat: text("last_heartbeat").notNull().default(new Date().toISOString()),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const workUnits = pgTable("work_units", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderId: text("order_id").notNull().references(() => orders.id),
  pickupPoint: integer("pickup_point").notNull(),
  section: text("section"),
  type: text("type").notNull().$type<WorkUnitType>(),
  status: text("status").notNull().default("pendente").$type<WorkUnitStatus>(),
  lockedBy: text("locked_by").references(() => users.id),
  lockedAt: text("locked_at"),
  lockExpiresAt: text("lock_expires_at"),
  cartQrCode: text("cart_qr_code"),
  palletQrCode: text("pallet_qr_code"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  companyId: integer("company_id"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
}, (table) => ({
  orderIdIdx: index("idx_work_units_order_id").on(table.orderId),
  companyStatusIdx: index("idx_work_units_company_status").on(table.companyId, table.status),
  lockedByIdx: index("idx_work_units_locked_by").on(table.lockedBy),
}));

export const exceptions = pgTable("exceptions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workUnitId: text("work_unit_id").references(() => workUnits.id),
  orderItemId: text("order_item_id").notNull().references(() => orderItems.id),
  type: text("type").notNull().$type<ExceptionType>(),
  quantity: doublePrecision("quantity").notNull(),
  observation: text("observation"),
  reportedBy: text("reported_by").notNull().references(() => users.id),
  authorizedBy: text("authorized_by").references(() => users.id),
  authorizedByName: text("authorized_by_name"),
  authorizedAt: text("authorized_at"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  details: text("details"),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  companyId: integer("company_id"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const orderVolumes = pgTable("order_volumes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderId: text("order_id").notNull().references(() => orders.id),
  erpOrderId: text("erp_order_id").notNull(),
  sacola: integer("sacola").notNull().default(0),
  caixa: integer("caixa").notNull().default(0),
  saco: integer("saco").notNull().default(0),
  avulso: integer("avulso").notNull().default(0),
  totalVolumes: integer("total_volumes").notNull().default(0),
  createdBy: text("created_by").references(() => users.id),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id),
  token: text("token").notNull(),
  sessionKey: text("session_key").notNull(),
  companyId: integer("company_id"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const manualQtyRuleTypeEnum = ["product_code", "barcode", "description_keyword", "manufacturer"] as const;
export type ManualQtyRuleType = typeof manualQtyRuleTypeEnum[number];

export const manualQtyRules = pgTable("manual_qty_rules", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ruleType: text("rule_type").notNull().$type<ManualQtyRuleType>(),
  value: text("value").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").references(() => users.id),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const db2Mappings = pgTable("db2_mappings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  dataset: text("dataset").notNull(),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(false),
  mappingJson: jsonb("mapping_json").$type<MappingField[]>().notNull(),
  description: text("description"),
  createdBy: text("created_by").references(() => users.id),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const productCompanyStock = pgTable("product_company_stock", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  productId: text("product_id").notNull().references(() => products.id),
  companyId: integer("company_id").notNull(),
  stockQty: doublePrecision("stock_qty").notNull().default(0),
  erpUpdatedAt: text("erp_updated_at"),
}, (table) => ({
  productCompanyUnique: uniqueIndex("idx_product_company_stock_unique").on(table.productId, table.companyId),
}));

export const wmsAddresses = pgTable("wms_addresses", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: integer("company_id").notNull(),
  bairro: text("bairro").notNull(),
  rua: text("rua").notNull(),
  bloco: text("bloco").notNull(),
  nivel: text("nivel").notNull(),
  code: text("code").notNull(),
  type: text("type").notNull().default("standard").$type<WmsAddressType>(),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by").references(() => users.id),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
}, (table) => ({
  companyCodeIdx: index("idx_wms_addresses_company_code").on(table.companyId, table.code),
}));

export const pallets = pgTable("pallets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: integer("company_id").notNull(),
  code: text("code").notNull(),
  status: text("status").notNull().default("sem_endereco").$type<PalletStatus>(),
  addressId: text("address_id").references(() => wmsAddresses.id),
  createdBy: text("created_by").references(() => users.id),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  allocatedAt: text("allocated_at"),
  cancelledAt: text("cancelled_at"),
  cancelledBy: text("cancelled_by").references(() => users.id),
  cancelReason: text("cancel_reason"),
}, (table) => ({
  companyStatusIdx: index("idx_pallets_company_status").on(table.companyId, table.status),
}));

export const palletItems = pgTable("pallet_items", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  palletId: text("pallet_id").notNull().references(() => pallets.id),
  productId: text("product_id").notNull().references(() => products.id),
  erpNfId: text("erp_nf_id"),
  quantity: doublePrecision("quantity").notNull(),
  lot: text("lot"),
  expiryDate: text("expiry_date"),
  fefoEnabled: boolean("fefo_enabled").notNull().default(false),
  companyId: integer("company_id").notNull(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
}, (table) => ({
  palletIdx: index("idx_pallet_items_pallet").on(table.palletId),
}));

export const palletMovements = pgTable("pallet_movements", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  palletId: text("pallet_id").notNull().references(() => pallets.id),
  companyId: integer("company_id").notNull(),
  movementType: text("movement_type").notNull().$type<PalletMovementType>(),
  fromAddressId: text("from_address_id").references(() => wmsAddresses.id),
  toAddressId: text("to_address_id").references(() => wmsAddresses.id),
  fromPalletId: text("from_pallet_id"),
  userId: text("user_id").references(() => users.id),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const nfCache = pgTable("nf_cache", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: integer("company_id").notNull(),
  nfNumber: text("nf_number").notNull(),
  nfSeries: text("nf_series"),
  supplierName: text("supplier_name"),
  supplierCnpj: text("supplier_cnpj"),
  issueDate: text("issue_date"),
  totalValue: doublePrecision("total_value"),
  status: text("status").notNull().default("pendente").$type<NfStatus>(),
  syncedAt: text("synced_at"),
}, (table) => ({
  companyNfIdx: index("idx_nf_cache_company_nf").on(table.companyId, table.nfNumber),
}));

export const nfItems = pgTable("nf_items", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  nfId: text("nf_id").notNull().references(() => nfCache.id),
  productId: text("product_id"),
  erpCode: text("erp_code"),
  productName: text("product_name"),
  quantity: doublePrecision("quantity").notNull(),
  unit: text("unit"),
  lot: text("lot"),
  expiryDate: text("expiry_date"),
  companyId: integer("company_id").notNull(),
});

export const systemSettings = pgTable("system_settings", {
  id: text("id").primaryKey().default("global"),
  separationMode: text("separation_mode").notNull().default("by_order").$type<SeparationMode>(),
  quickLinkEnabled: boolean("quick_link_enabled").notNull().default(true),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
  updatedBy: text("updated_by"),
});

export const countingCycles = pgTable("counting_cycles", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: integer("company_id").notNull(),
  type: text("type").notNull().$type<CountingCycleType>(),
  status: text("status").notNull().default("pendente").$type<CountingCycleStatus>(),
  createdBy: text("created_by").references(() => users.id),
  approvedBy: text("approved_by").references(() => users.id),
  approvedAt: text("approved_at"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  completedAt: text("completed_at"),
}, (table) => ({
  companyStatusIdx: index("idx_counting_cycles_company_status").on(table.companyId, table.status),
}));

export const countingCycleItems = pgTable("counting_cycle_items", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  cycleId: text("cycle_id").notNull().references(() => countingCycles.id),
  companyId: integer("company_id").notNull(),
  addressId: text("address_id").references(() => wmsAddresses.id),
  productId: text("product_id").references(() => products.id),
  palletId: text("pallet_id").references(() => pallets.id),
  expectedQty: doublePrecision("expected_qty"),
  countedQty: doublePrecision("counted_qty"),
  lot: text("lot"),
  expiryDate: text("expiry_date"),
  oldLot: text("old_lot"),
  oldExpiryDate: text("old_expiry_date"),
  status: text("status").notNull().default("pendente").$type<CountingCycleItemStatus>(),
  countedBy: text("counted_by").references(() => users.id),
  countedAt: text("counted_at"),
  divergencePct: doublePrecision("divergence_pct"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export interface MappingField {
  appField: string;
  type: "string" | "number" | "date" | "boolean";
  required: boolean;
  dbExpression: string;
  cast?: string;
  defaultValue?: string;
}

export interface DataContractField {
  appField: string;
  type: "string" | "number" | "date" | "boolean";
  required: boolean;
  description: string;
  example: string;
}

export const datasetEnum = ["orders", "products", "order_items", "work_units"] as const;
export type DatasetName = typeof datasetEnum[number];

export type Db2Mapping = typeof db2Mappings.$inferSelect;
export type InsertDb2Mapping = typeof db2Mappings.$inferInsert;

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertRouteSchema = createInsertSchema(routes).omit({ id: true }).extend({ code: z.string().optional() });
export const insertSectionSchema = createInsertSchema(sections);
export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true });
export const insertWorkUnitSchema = createInsertSchema(workUnits).omit({ id: true });
export const insertPickingSessionSchema = createInsertSchema(pickingSessions).omit({ id: true, createdAt: true, lastHeartbeat: true });
export const insertExceptionSchema = createInsertSchema(exceptions).omit({ id: true, createdAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export const insertCompanySchema = createInsertSchema(companies);
export const insertOrderVolumeSchema = createInsertSchema(orderVolumes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWmsAddressSchema = createInsertSchema(wmsAddresses).omit({ id: true, createdAt: true });
export const insertPalletSchema = createInsertSchema(pallets).omit({ id: true, createdAt: true });
export const insertPalletItemSchema = createInsertSchema(palletItems).omit({ id: true, createdAt: true });
export const insertPalletMovementSchema = createInsertSchema(palletMovements).omit({ id: true, createdAt: true });
export const insertNfCacheSchema = createInsertSchema(nfCache).omit({ id: true });
export const insertNfItemSchema = createInsertSchema(nfItems).omit({ id: true });
export const insertCountingCycleSchema = createInsertSchema(countingCycles).omit({ id: true, createdAt: true });
export const insertCountingCycleItemSchema = createInsertSchema(countingCycleItems).omit({ id: true, createdAt: true });
export const insertProductCompanyStockSchema = createInsertSchema(productCompanyStock).omit({ id: true });

export const productAddresses = pgTable("product_addresses", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull(),
  addressId: text("address_id").notNull().references(() => wmsAddresses.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
}, (table) => ({
  uniqueIdx: uniqueIndex("product_addresses_unique_idx").on(table.productId, table.companyId, table.addressId),
  productCompanyIdx: index("idx_product_addresses_product_company").on(table.productId, table.companyId),
}));

export const insertProductAddressSchema = createInsertSchema(productAddresses).omit({ id: true, createdAt: true });

export const addressPickingLog = pgTable("address_picking_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: integer("company_id").notNull(),
  addressId: text("address_id").notNull().references(() => wmsAddresses.id),
  addressCode: text("address_code").notNull(),
  productId: text("product_id").notNull().references(() => products.id),
  productName: text("product_name"),
  erpCode: text("erp_code"),
  quantity: integer("quantity").notNull(),
  orderId: text("order_id"),
  erpOrderId: text("erp_order_id"),
  workUnitId: text("work_unit_id"),
  userId: text("user_id").notNull(),
  userName: text("user_name"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  notes: text("notes"),
});

export const insertAddressPickingLogSchema = createInsertSchema(addressPickingLog).omit({ id: true });
export type AddressPickingLog = typeof addressPickingLog.$inferSelect;
export type InsertAddressPickingLog = z.infer<typeof insertAddressPickingLogSchema>;

export const printAgents = pgTable("print_agents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  machineId: text("machine_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  lastSeenAt: text("last_seen_at"),
  printers: text("printers"),
});

export const insertPrintAgentSchema = createInsertSchema(printAgents).omit({ id: true, createdAt: true, lastSeenAt: true });
export type PrintAgent = typeof printAgents.$inferSelect;
export type InsertPrintAgent = z.infer<typeof insertPrintAgentSchema>;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type Route = typeof routes.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItems.$inferSelect;
export type InsertWorkUnit = z.infer<typeof insertWorkUnitSchema>;
export type WorkUnit = typeof workUnits.$inferSelect;
export type InsertPickingSession = z.infer<typeof insertPickingSessionSchema>;
export type PickingSession = typeof pickingSessions.$inferSelect;
export type InsertException = z.infer<typeof insertExceptionSchema>;
export type Exception = typeof exceptions.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type SectionGroup = typeof sectionGroups.$inferSelect;
export type OrderVolume = typeof orderVolumes.$inferSelect;
export type InsertOrderVolume = z.infer<typeof insertOrderVolumeSchema>;
export type WmsAddress = typeof wmsAddresses.$inferSelect;
export type InsertWmsAddress = z.infer<typeof insertWmsAddressSchema>;
export type Pallet = typeof pallets.$inferSelect;
export type InsertPallet = z.infer<typeof insertPalletSchema>;
export type PalletItem = typeof palletItems.$inferSelect;
export type InsertPalletItem = z.infer<typeof insertPalletItemSchema>;
export type PalletMovement = typeof palletMovements.$inferSelect;
export type InsertPalletMovement = z.infer<typeof insertPalletMovementSchema>;
export type NfCache = typeof nfCache.$inferSelect;
export type InsertNfCache = z.infer<typeof insertNfCacheSchema>;
export type NfItem = typeof nfItems.$inferSelect;
export type InsertNfItem = z.infer<typeof insertNfItemSchema>;
export type CountingCycle = typeof countingCycles.$inferSelect;
export type InsertCountingCycle = z.infer<typeof insertCountingCycleSchema>;
export type CountingCycleItem = typeof countingCycleItems.$inferSelect;
export type InsertCountingCycleItem = z.infer<typeof insertCountingCycleItemSchema>;
export type ProductCompanyStock = typeof productCompanyStock.$inferSelect;
export type InsertProductCompanyStock = z.infer<typeof insertProductCompanyStockSchema>;
export type Company = typeof companies.$inferSelect;
export type SystemSettings = typeof systemSettings.$inferSelect;

export interface BatchSyncItem {
  orderItemId: string;
  qtyToAdd: number;
}

export interface BatchSyncException {
  orderItemId: string;
  type: ExceptionType;
  quantity: number;
  observation?: string;
  authorizedBy?: string;
  authorizedByName?: string;
}

export interface BatchSyncPayload {
  items: BatchSyncItem[];
  exceptions: BatchSyncException[];
}

export const batchSyncItemSchema = z.object({
  orderItemId: z.string().min(1),
  qtyToAdd: z.number(),
});

export const batchSyncExceptionSchema = z.object({
  orderItemId: z.string().min(1),
  type: z.enum(exceptionTypeEnum),
  quantity: z.number().positive(),
  observation: z.string().optional(),
  authorizedBy: z.string().optional(),
  authorizedByName: z.string().optional(),
});

export const batchSyncPayloadSchema = z.object({
  items: z.array(batchSyncItemSchema),
  exceptions: z.array(batchSyncExceptionSchema),
});
export type InsertSectionGroup = typeof sectionGroups.$inferInsert;
export const loginSchema = z.object({
  username: z.string().min(1, "Usuário é obrigatório"),
  password: z.string().min(1, "Senha é obrigatória"),
  companyId: z.number().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export type OrderWithItems = Order & {
  items: (OrderItem & { product: Product })[];
  route?: Route | null;
  pickingSessions?: PickingSession[];
};

export type WorkUnitWithDetails = WorkUnit & {
  order: Order;
  items: (OrderItem & { product: Product })[];
  lockedByUser?: User | null;
  lockedByName?: string;
};

export type PalletWithItems = Pallet & {
  items: PalletItem[];
  address?: WmsAddress | null;
};

export type Section = typeof sections.$inferSelect;
export type ProductAddress = typeof productAddresses.$inferSelect;
export type InsertProductAddress = z.infer<typeof insertProductAddressSchema>;

export const barcodeTypeEnum = ["UNITARIO", "EMBALAGEM"] as const;
export type BarcodeType = typeof barcodeTypeEnum[number];

export const barcodeOperationEnum = ["criacao", "edicao", "substituicao", "desativacao", "ativacao"] as const;
export type BarcodeOperation = typeof barcodeOperationEnum[number];

export const productBarcodes = pgTable("product_barcodes", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: integer("company_id"),
  productId: text("product_id").notNull(),
  barcode: text("barcode").notNull(),
  type: text("type").notNull().$type<BarcodeType>(),
  packagingQty: integer("packaging_qty").notNull().default(1),
  packagingType: text("packaging_type"),
  active: boolean("active").notNull().default(true),
  isPrimary: boolean("is_primary").notNull().default(false),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  createdBy: text("created_by"),
  updatedAt: text("updated_at"),
  updatedBy: text("updated_by"),
  deactivatedAt: text("deactivated_at"),
  deactivatedBy: text("deactivated_by"),
}, (table) => ({
  barcodeIdx: index("idx_product_barcodes_barcode").on(table.barcode),
  productIdx: index("idx_product_barcodes_product").on(table.productId),
  activeIdx: index("idx_product_barcodes_active").on(table.active),
  companyIdx: index("idx_product_barcodes_company").on(table.companyId),
}));

export const barcodeChangeHistory = pgTable("barcode_change_history", {
  id: serial("id").primaryKey(),
  barcodeId: text("barcode_id"),
  productId: text("product_id").notNull(),
  operation: text("operation").notNull().$type<BarcodeOperation>(),
  oldBarcode: text("old_barcode"),
  newBarcode: text("new_barcode"),
  barcodeType: text("barcode_type").$type<BarcodeType>(),
  oldQty: integer("old_qty"),
  newQty: integer("new_qty"),
  userId: text("user_id"),
  userName: text("user_name"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
}, (table) => ({
  productIdx: index("idx_barcode_history_product").on(table.productId),
  barcodeIdx: index("idx_barcode_history_barcode_id").on(table.barcodeId),
  userIdx: index("idx_barcode_history_user").on(table.userId),
}));

export const insertProductBarcodeSchema = createInsertSchema(productBarcodes).omit({
  id: true, createdAt: true, updatedAt: true, deactivatedAt: true, deactivatedBy: true,
});
export type InsertProductBarcode = z.infer<typeof insertProductBarcodeSchema>;
export type ProductBarcode = typeof productBarcodes.$inferSelect;
export type BarcodeHistory = typeof barcodeChangeHistory.$inferSelect;

// Tabela de dedup persistente de scans (S1-04)
// Garante idempotência de msgId mesmo após reinício do servidor.
// company_id_int usa -1 quando company_id é null (para permitir UNIQUE constraint).
export const scanLog = pgTable("scan_log", {
  id: serial("id").primaryKey(),
  msgId: text("msg_id").notNull(),
  userId: text("user_id").notNull(),
  companyIdInt: integer("company_id_int").notNull().default(-1),
  workUnitId: text("work_unit_id").notNull(),
  barcode: text("barcode").notNull(),
  quantity: integer("quantity").notNull().default(1),
  ackStatus: text("ack_status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
}, (t) => ({
  dedupIdx: uniqueIndex("scan_log_dedup_idx").on(t.msgId, t.userId, t.companyIdInt),
  createdAtIdx: index("scan_log_created_at_idx").on(t.createdAt),
}));

// ─── Label Studio ──────────────────────────────────────────────────────────────
export const labelContextEnum = ["volume_label", "pallet_label", "product_label", "order_label"] as const;
export type LabelContext = typeof labelContextEnum[number];

export const LABEL_CONTEXT_LABELS: Record<LabelContext, string> = {
  volume_label:  "Etiqueta de Volume",
  pallet_label:  "Etiqueta de Palete",
  product_label: "Etiqueta de Produto",
  order_label:   "Etiqueta de Pedido",
};

export type LabelComponentType = "text" | "dynamic_text" | "barcode" | "qrcode" | "line" | "rectangle";

export interface LabelComponentBase {
  id: string;
  type: LabelComponentType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  zIndex?: number;
  name?: string;
  locked?: boolean;
  hidden?: boolean;
  opacity?: number;
}

export interface TextComponent extends LabelComponentBase {
  type: "text";
  content: string;
  fontSize: number;
  fontWeight?: "normal" | "bold";
  fontFamily?: string;
  align?: "left" | "center" | "right";
  color?: string;
}

export interface DynamicTextComponent extends LabelComponentBase {
  type: "dynamic_text";
  field: string;
  label?: string;
  fontSize: number;
  fontWeight?: "normal" | "bold";
  fontFamily?: string;
  align?: "left" | "center" | "right";
  color?: string;
  prefix?: string;
  suffix?: string;
}

export interface BarcodeComponent extends LabelComponentBase {
  type: "barcode";
  field: string;
  format: "CODE128" | "CODE39" | "EAN13" | "EAN8" | "ITF14";
  showValue?: boolean;
  lineWidth?: number;
  barHeight?: number;
}

export interface QRCodeComponent extends LabelComponentBase {
  type: "qrcode";
  field: string;
  errorLevel?: "L" | "M" | "Q" | "H";
}

export interface LineComponent extends LabelComponentBase {
  type: "line";
  orientation: "horizontal" | "vertical";
  strokeWidth?: number;
  color?: string;
  dashed?: boolean;
}

export interface RectangleComponent extends LabelComponentBase {
  type: "rectangle";
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  borderRadius?: number;
}

export type LabelComponent =
  | TextComponent
  | DynamicTextComponent
  | BarcodeComponent
  | QRCodeComponent
  | LineComponent
  | RectangleComponent;

export interface LabelLayout {
  components: LabelComponent[];
}

export interface DataField {
  key: string;
  label: string;
  example?: string;
  category?: string;
}

export const LABEL_DATA_FIELDS: Record<LabelContext, DataField[]> = {
  volume_label: [
    { key: "order",        label: "Número do Pedido",   example: "PED-001",     category: "Pedido" },
    { key: "customer",     label: "Nome do Cliente",     example: "Mercado ABC", category: "Pedido" },
    { key: "address",      label: "Endereço",            example: "Rua das Flores, 123", category: "Endereço" },
    { key: "neighborhood", label: "Bairro",              example: "Centro",      category: "Endereço" },
    { key: "city",         label: "Cidade",              example: "São Paulo",   category: "Endereço" },
    { key: "state",        label: "Estado (UF)",         example: "SP",          category: "Endereço" },
    { key: "vol",          label: "Volume Atual",        example: "1",           category: "Volume" },
    { key: "totalVol",     label: "Total de Volumes",    example: "3",           category: "Volume" },
    { key: "route",        label: "Código da Rota",      example: "R01",         category: "Rota" },
    { key: "routeName",    label: "Nome da Rota",        example: "Centro",      category: "Rota" },
    { key: "loadCode",     label: "Código de Carga",     example: "CARGA-001",   category: "Pedido" },
    { key: "operator",     label: "Operador",            example: "João Silva",  category: "Operação" },
    { key: "date",         label: "Data",                example: "21/04/2026",  category: "Operação" },
    { key: "time",         label: "Hora",                example: "10:30",       category: "Operação" },
    { key: "sender",       label: "Remetente",           example: "Stoker WMS",  category: "Operação" },
    { key: "sacola",       label: "Qtd Sacola",          example: "2",           category: "Contagem" },
    { key: "caixa",        label: "Qtd Caixa",           example: "1",           category: "Contagem" },
    { key: "saco",         label: "Qtd Saco",            example: "0",           category: "Contagem" },
    { key: "avulso",       label: "Qtd Avulso",          example: "3",           category: "Contagem" },
  ],
  pallet_label: [
    { key: "code",     label: "Código do Pallet",  example: "PAL-001",    category: "Pallet" },
    { key: "status",   label: "Status",            example: "alocado",    category: "Pallet" },
    { key: "address",  label: "Endereço WMS",      example: "A-01-01",    category: "Endereço" },
    { key: "items",    label: "Conteúdo",          example: "Produto A x10", category: "Pallet" },
    { key: "operator", label: "Operador",          example: "João Silva", category: "Operação" },
    { key: "date",     label: "Data",              example: "21/04/2026", category: "Operação" },
    { key: "company",  label: "Empresa",           example: "Stoker WMS", category: "Operação" },
    { key: "nf",       label: "Número da NF",      example: "NF-12345",   category: "Fiscal" },
    { key: "lot",      label: "Lote",              example: "L-001",      category: "Fiscal" },
  ],
  product_label: [
    { key: "name",        label: "Nome do Produto",   example: "Arroz 5kg",  category: "Produto" },
    { key: "erpCode",     label: "Código ERP",        example: "P001",       category: "Produto" },
    { key: "barcode",     label: "Código de Barras",  example: "7891234567890", category: "Produto" },
    { key: "unit",        label: "Unidade",           example: "UN",         category: "Produto" },
    { key: "price",       label: "Preço",             example: "R$ 24,90",   category: "Produto" },
  ],
  order_label: [
    { key: "erpOrderId",   label: "Número ERP",       example: "PED-001",    category: "Pedido" },
    { key: "customerName", label: "Cliente",          example: "Mercado ABC", category: "Pedido" },
    { key: "routeName",    label: "Rota",             example: "Centro",     category: "Pedido" },
    { key: "totalValue",   label: "Valor Total",      example: "R$ 150,00",  category: "Pedido" },
    { key: "date",         label: "Data",             example: "21/04/2026", category: "Operação" },
  ],
};

export const labelTemplates = pgTable("label_templates", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: integer("company_id"),
  name: text("name").notNull(),
  context: text("context").notNull().$type<LabelContext>(),
  groupName: text("group_name"),
  widthMm: integer("width_mm").notNull().default(100),
  heightMm: integer("height_mm").notNull().default(70),
  dpi: integer("dpi").notNull().default(203),
  active: boolean("active").notNull().default(true),
  layoutJson: jsonb("layout_json").notNull().$type<LabelLayout>().default({ components: [] }),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at"),
});

export const insertLabelTemplateSchema = createInsertSchema(labelTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type LabelTemplate = typeof labelTemplates.$inferSelect;
export type InsertLabelTemplate = z.infer<typeof insertLabelTemplateSchema>;

export const labelDefaultAssignments = pgTable("label_default_assignments", {
  companyId: integer("company_id").notNull().default(0),
  context: text("context").notNull().$type<LabelContext>(),
  templateId: text("template_id"),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
}, (table) => ({
  pk: primaryKey({ columns: [table.companyId, table.context] }),
}));

export type LabelDefaultAssignment = typeof labelDefaultAssignments.$inferSelect;
