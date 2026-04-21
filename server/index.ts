import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { log, getErrorMessage, getDbError } from "./log";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seedDatabase } from "./seed";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { setupPrintAgentWS } from "./print-agent";
import { setupScanningWS } from "./ws-scanning";

// ── Guardas globais contra crashes ────────────────────────────────────────────
// Registra erros não capturados e encerra o processo de forma controlada,
// permitindo que o gerenciador de processos (systemd, PM2, Docker) reinicie.
process.on("uncaughtException", (err) => {
  log(`[server] Exceção não capturada — encerrando: ${err.message}\n${err.stack ?? ""}`, "express");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  log(`[server] Promise rejeitada não tratada — encerrando: ${msg}`, "express");
  process.exit(1);
});

const app = express();
const httpServer = createServer(app);

app.set('trust proxy', 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "ws:", "wss:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "2mb" }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Muitas tentativas de login. Tente novamente em 15 minutos." },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: "Limite de requisições excedido. Tente novamente em breve." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/badge-login", loginLimiter);
app.use("/api/sql-query", rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: "Limite de consultas SQL excedido." } }));
app.use("/api/", apiLimiter);



app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;

      // Special handling for auth routes
      if (path === "/api/auth/login" && res.statusCode === 200 && capturedJsonResponse?.user) {
        const username = capturedJsonResponse.user.username || capturedJsonResponse.user.name || "User";
        logLine = `${username} is log in`;
        // log(logLine);
      } else if (path === "/api/auth/logout" && (req as any).user) {
        const username = (req as any).user.username || (req as any).user.name || "User";
        logLine = `${username} is log out`;
        // log(logLine);
      } else {
        // Filter out non-critical errors (4xx) and GET/OPTIONS
        // Only log:
        // 1. Critical Errors (>= 500)
        // 2. Successful Mutations (POST, PUT, PATCH, DELETE with status < 400)
        const isCriticalError = res.statusCode >= 500;
        // Não logar mutations de sucesso (POST/PUT/DELETE com sucesso)
        const isSuccessMutation = false; // Desabilitado completamente conforme solicitado pelo usuário

        if (isCriticalError || isSuccessMutation) {
          if (isCriticalError && capturedJsonResponse) {
            logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
          }
          log(logLine);
        }
      }
    }
  });

  next();
});

/** Garante que colunas novas do schema existam no banco sem quebrar dados existentes. */
async function runSafeMigrations() {
  const migrations: { table: string; column: string; type: string }[] = [
    // users
    { table: "users", column: "allowed_reports",   type: "jsonb" },
    { table: "users", column: "allowed_modules",   type: "jsonb" },
    { table: "users", column: "allowed_companies", type: "jsonb" },
    { table: "users", column: "default_company_id",type: "integer" },
    { table: "users", column: "badge_code",        type: "text" },
    { table: "users", column: "settings",          type: "jsonb" },
    // pallets — colunas adicionadas em versões recentes
    { table: "pallets", column: "allocated_at",   type: "text" },
    { table: "pallets", column: "cancelled_at",   type: "text" },
    { table: "pallets", column: "cancelled_by",   type: "text" },
    { table: "pallets", column: "cancel_reason",  type: "text" },
    { table: "pallets", column: "notes",          type: "text" },
    { table: "pallets", column: "work_unit_id",   type: "text" },
    { table: "pallets", column: "nf_id",          type: "text" },
    // pallet_items
    { table: "pallet_items", column: "erp_nf_id",    type: "text" },
    { table: "pallet_items", column: "expiry_date",   type: "text" },
    { table: "pallet_items", column: "fefo_enabled",  type: "boolean DEFAULT false" },
    { table: "pallet_items", column: "company_id",    type: "integer" },
    { table: "pallet_items", column: "unit",          type: "text" },
    { table: "pallet_items", column: "nf_item_id",    type: "text" },
    { table: "pallet_items", column: "nf_id",         type: "text" },
    // pallet_movements
    { table: "pallet_movements", column: "from_pallet_id", type: "text" },
    { table: "pallet_movements", column: "company_id",     type: "integer" },
    { table: "pallet_movements", column: "movement_type",  type: "text" },
    // counting_cycles
    { table: "counting_cycles", column: "name",        type: "text" },
    { table: "counting_cycles", column: "approved_by", type: "text" },
    { table: "counting_cycles", column: "approved_at", type: "text" },
    { table: "counting_cycles", column: "notes",       type: "text" },
    { table: "counting_cycles", column: "completed_at",type: "text" },
    // counting_cycle_items
    { table: "counting_cycle_items", column: "old_lot",         type: "text" },
    { table: "counting_cycle_items", column: "old_expiry_date", type: "text" },
    { table: "counting_cycle_items", column: "divergence_pct",  type: "double precision" },
    { table: "counting_cycle_items", column: "notes",           type: "text" },
    // nf_cache — novos nomes de colunas (versão antiga usava numero/serie/emitente)
    { table: "nf_cache", column: "nf_number",     type: "text" },
    { table: "nf_cache", column: "nf_series",     type: "text" },
    { table: "nf_cache", column: "supplier_name", type: "text" },
    { table: "nf_cache", column: "supplier_cnpj", type: "text" },
    { table: "nf_cache", column: "issue_date",    type: "text" },
    { table: "nf_cache", column: "total_value",   type: "double precision" },
    { table: "nf_cache", column: "synced_at",     type: "text" },
    { table: "nf_cache", column: "received_by",   type: "text" },
    { table: "nf_cache", column: "received_at",   type: "text" },
    { table: "nf_cache", column: "notes",         type: "text" },
    // nf_items
    { table: "nf_items", column: "company_id",   type: "integer" },
    { table: "nf_items", column: "expiry_date",  type: "text" },
    { table: "nf_items", column: "unit_cost",    type: "double precision" },
    { table: "nf_items", column: "total_cost",   type: "double precision" },
    { table: "nf_items", column: "barcode",      type: "text" },
    // products
    { table: "products", column: "box_barcodes",    type: "jsonb" },
    { table: "products", column: "box_barcode",     type: "text" },
    // orders
    { table: "orders", column: "observation2",    type: "text" },
    { table: "orders", column: "pickup_points",   type: "jsonb" },
    { table: "orders", column: "separation_code", type: "text" },
    { table: "orders", column: "load_code",       type: "text" },
    // section_groups
    { table: "section_groups", column: "updated_at", type: "text" },
    // product_company_stock
    { table: "product_company_stock", column: "palletized_stock", type: "double precision" },
    { table: "product_company_stock", column: "picking_stock",    type: "double precision" },
    { table: "product_company_stock", column: "unit",             type: "text" },
    // db2_mappings
    { table: "db2_mappings", column: "extra", type: "jsonb" },
    // wms_addresses
    { table: "wms_addresses", column: "capacity",     type: "integer" },
    { table: "wms_addresses", column: "description",  type: "text" },
    // print_agents — coluna adicionada para persistir lista de impressoras entre reinicializações
    { table: "print_agents", column: "printers", type: "text" },
    // orders — suporte multi-empresa e status financeiro
    { table: "orders", column: "financial_status", type: "text DEFAULT 'pendente'" },
    { table: "orders", column: "company_id",       type: "integer" },
    // work_units — suporte multi-empresa
    { table: "work_units", column: "company_id", type: "integer" },
    // exceptions — campos de autorização adicionados como feature
    { table: "exceptions", column: "authorized_by",      type: "text" },
    { table: "exceptions", column: "authorized_by_name", type: "text" },
    { table: "exceptions", column: "authorized_at",      type: "text" },
    // sessions — suporte multi-empresa
    { table: "sessions", column: "company_id", type: "integer" },
    // companies — CNPJ
    { table: "companies", column: "cnpj", type: "text" },
    // pickup_points — flag de ativo/inativo
    { table: "pickup_points", column: "active", type: "boolean DEFAULT true" },
    // system_settings — quick_link_enabled adicionado após deploy inicial
    { table: "system_settings", column: "quick_link_enabled", type: "boolean NOT NULL DEFAULT true" },
    // users — quick_link_enabled (adicionado por engano em alguns ambientes, sem efeito)
    { table: "users", column: "quick_link_enabled", type: "boolean NOT NULL DEFAULT true" },
  ];

  for (const m of migrations) {
    try {
      await db.execute(
        sql.raw(`ALTER TABLE ${m.table} ADD COLUMN IF NOT EXISTS "${m.column}" ${m.type}`)
      );
    } catch {
      // coluna já existe ou tipo incompatível — ignorar
    }
  }

  // ── Todas as tabelas do schema (em ordem de dependência FK) ─────────────────
  const tables: string[] = [
    // Tabelas base (sem dependências)
    `CREATE TABLE IF NOT EXISTS companies (
      id integer PRIMARY KEY,
      name text NOT NULL,
      cnpj text
    )`,
    `CREATE TABLE IF NOT EXISTS sections (
      id integer PRIMARY KEY,
      name text NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS pickup_points (
      id integer PRIMARY KEY,
      name text NOT NULL,
      active boolean NOT NULL DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS routes (
      id text PRIMARY KEY,
      code text NOT NULL,
      name text NOT NULL,
      description text,
      active boolean NOT NULL DEFAULT true,
      created_at text NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS section_groups (
      id text PRIMARY KEY,
      name text NOT NULL,
      sections jsonb NOT NULL,
      created_at text NOT NULL DEFAULT '',
      updated_at text NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS cache_orcamentos (
      id serial PRIMARY KEY,
      "CHAVE" text NOT NULL UNIQUE,
      "IDEMPRESA" integer,
      "IDORCAMENTO" integer,
      "IDPRODUTO" text,
      "IDSUBPRODUTO" text,
      "NUMSEQUENCIA" integer,
      "QTDPRODUTO" double precision,
      "UNIDADE" text,
      "FABRICANTE" text,
      "VALUNITBRUTO" double precision,
      "VALTOTLIQUIDO" double precision,
      "DESCRRESPRODUTO" text,
      "IDVENDEDOR" text,
      "IDLOCALRETIRADA" integer,
      "IDSECAO" integer,
      "DESCRSECAO" text,
      "TIPOENTREGA" text,
      "NOMEVENDEDOR" text,
      "TIPOENTREGA_DESCR" text,
      "LOCALRETESTOQUE" text,
      "FLAGCANCELADO" text,
      "IDCLIFOR" text,
      "DESCLIENTE" text,
      "DTMOVIMENTO" text,
      "IDRECEBIMENTO" text,
      "DESCRRECEBIMENTO" text,
      "FLAGPRENOTAPAGA" text,
      sync_at text,
      "CODIGOINTERNOFORN" text,
      "CODBARRAS" text,
      "CODBARRAS_CAIXA" text,
      "OBSERVACAO" text,
      "OBSERVACAO2" text,
      "DESCRCIDADE" text,
      "UF" text,
      "IDCEP" text,
      "ENDERECO" text,
      "BAIRRO" text,
      "CNPJCPF" text,
      "NUMERO" text
    )`,
    // users (sem FK obrigatória para companies)
    `CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      username text NOT NULL,
      password text NOT NULL,
      name text NOT NULL,
      role text NOT NULL DEFAULT 'separacao',
      sections jsonb,
      settings jsonb DEFAULT '{}',
      active boolean NOT NULL DEFAULT true,
      badge_code text,
      default_company_id integer,
      allowed_companies jsonb DEFAULT '[1,3]',
      allowed_modules jsonb,
      allowed_reports jsonb,
      created_at text NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
    `CREATE INDEX IF NOT EXISTS idx_users_badge_code ON users(badge_code)`,
    // products
    `CREATE TABLE IF NOT EXISTS products (
      id text PRIMARY KEY,
      erp_code text NOT NULL UNIQUE,
      barcode text,
      box_barcode text,
      box_barcodes jsonb,
      name text NOT NULL,
      section text NOT NULL,
      pickup_point integer NOT NULL,
      unit text NOT NULL DEFAULT 'UN',
      manufacturer text,
      price double precision NOT NULL DEFAULT 0,
      stock_qty double precision NOT NULL DEFAULT 0,
      erp_updated_at text
    )`,
    `CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)`,
    `CREATE INDEX IF NOT EXISTS idx_products_section ON products(section)`,
    // orders (depende de routes)
    `CREATE TABLE IF NOT EXISTS orders (
      id text PRIMARY KEY,
      erp_order_id text NOT NULL UNIQUE,
      customer_name text NOT NULL,
      customer_code text,
      total_value double precision NOT NULL DEFAULT 0,
      observation text,
      observation2 text,
      city text,
      state text,
      zip_code text,
      address text,
      neighborhood text,
      cnpj_cpf text,
      address_number text,
      status text NOT NULL DEFAULT 'pendente',
      priority integer NOT NULL DEFAULT 0,
      is_launched boolean NOT NULL DEFAULT false,
      launched_at text,
      separated_at text,
      load_code text,
      route_id text REFERENCES routes(id),
      separation_code text,
      pickup_points jsonb,
      erp_updated_at text,
      financial_status text NOT NULL DEFAULT 'pendente',
      company_id integer,
      created_at text NOT NULL DEFAULT '',
      updated_at text NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_company_status ON orders(company_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_load_code ON orders(load_code)`,
    // order_items (depende de orders, products)
    `CREATE TABLE IF NOT EXISTS order_items (
      id text PRIMARY KEY,
      order_id text NOT NULL REFERENCES orders(id),
      product_id text NOT NULL REFERENCES products(id),
      quantity double precision NOT NULL,
      separated_qty double precision NOT NULL DEFAULT 0,
      checked_qty double precision NOT NULL DEFAULT 0,
      section text NOT NULL,
      pickup_point integer NOT NULL,
      qty_picked double precision DEFAULT 0,
      qty_checked double precision DEFAULT 0,
      status text DEFAULT 'pendente',
      exception_type text
    )`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id)`,
    // picking_sessions (depende de users, orders)
    `CREATE TABLE IF NOT EXISTS picking_sessions (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id),
      order_id text NOT NULL REFERENCES orders(id),
      section_id text NOT NULL,
      last_heartbeat text NOT NULL DEFAULT '',
      created_at text NOT NULL DEFAULT ''
    )`,
    // work_units (depende de orders, users)
    `CREATE TABLE IF NOT EXISTS work_units (
      id text PRIMARY KEY,
      order_id text NOT NULL REFERENCES orders(id),
      pickup_point integer NOT NULL,
      section text,
      type text NOT NULL,
      status text NOT NULL DEFAULT 'pendente',
      locked_by text REFERENCES users(id),
      locked_at text,
      lock_expires_at text,
      cart_qr_code text,
      pallet_qr_code text,
      started_at text,
      completed_at text,
      company_id integer,
      created_at text NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_work_units_order_id ON work_units(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_work_units_company_status ON work_units(company_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_work_units_locked_by ON work_units(locked_by)`,
    // exceptions (depende de work_units, order_items, users)
    `CREATE TABLE IF NOT EXISTS exceptions (
      id text PRIMARY KEY,
      work_unit_id text REFERENCES work_units(id),
      order_item_id text NOT NULL REFERENCES order_items(id),
      type text NOT NULL,
      quantity double precision NOT NULL,
      observation text,
      reported_by text NOT NULL REFERENCES users(id),
      authorized_by text REFERENCES users(id),
      authorized_by_name text,
      authorized_at text,
      created_at text NOT NULL DEFAULT ''
    )`,
    // audit_logs (depende de users)
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id text PRIMARY KEY,
      user_id text REFERENCES users(id),
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id text,
      details text,
      previous_value text,
      new_value text,
      ip_address text,
      user_agent text,
      company_id integer,
      created_at text NOT NULL DEFAULT ''
    )`,
    // sessions (depende de users)
    `CREATE TABLE IF NOT EXISTS sessions (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id),
      token text NOT NULL,
      session_key text NOT NULL,
      company_id integer,
      expires_at text NOT NULL,
      created_at text NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
    // db2_mappings (depende de users opcionalmente)
    `CREATE TABLE IF NOT EXISTS db2_mappings (
      id text PRIMARY KEY,
      dataset text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      is_active boolean NOT NULL DEFAULT false,
      mapping_json jsonb NOT NULL,
      description text,
      extra jsonb,
      created_by text REFERENCES users(id),
      created_at text NOT NULL DEFAULT '',
      updated_at text NOT NULL DEFAULT ''
    )`,
    // product_company_stock (depende de products)
    `CREATE TABLE IF NOT EXISTS product_company_stock (
      id text PRIMARY KEY,
      product_id text NOT NULL REFERENCES products(id),
      company_id integer NOT NULL,
      stock_qty double precision NOT NULL DEFAULT 0,
      palletized_stock double precision,
      picking_stock double precision,
      unit text,
      erp_updated_at text
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_product_company_stock_unique ON product_company_stock(product_id, company_id)`,
    // wms_addresses (depende de users opcionalmente)
    `CREATE TABLE IF NOT EXISTS wms_addresses (
      id text PRIMARY KEY,
      company_id integer NOT NULL,
      bairro text NOT NULL,
      rua text NOT NULL,
      bloco text NOT NULL,
      nivel text NOT NULL,
      code text NOT NULL,
      type text NOT NULL DEFAULT 'standard',
      active boolean NOT NULL DEFAULT true,
      capacity integer,
      description text,
      created_by text REFERENCES users(id),
      created_at text NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_wms_addresses_company_code ON wms_addresses(company_id, code)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_wms_addresses_company_code_unique ON wms_addresses(company_id, code)`,
    // pallets (depende de wms_addresses, users)
    `CREATE TABLE IF NOT EXISTS pallets (
      id text PRIMARY KEY,
      company_id integer NOT NULL,
      code text NOT NULL,
      status text NOT NULL DEFAULT 'sem_endereco',
      address_id text REFERENCES wms_addresses(id),
      created_by text REFERENCES users(id),
      created_at text NOT NULL DEFAULT '',
      allocated_at text,
      cancelled_at text,
      cancelled_by text REFERENCES users(id),
      cancel_reason text,
      notes text,
      work_unit_id text,
      nf_id text
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pallets_company_status ON pallets(company_id, status)`,
    // pallet_items (depende de pallets, products)
    `CREATE TABLE IF NOT EXISTS pallet_items (
      id text PRIMARY KEY,
      pallet_id text NOT NULL REFERENCES pallets(id),
      product_id text NOT NULL REFERENCES products(id),
      erp_nf_id text,
      quantity double precision NOT NULL,
      lot text,
      expiry_date text,
      fefo_enabled boolean NOT NULL DEFAULT false,
      company_id integer NOT NULL,
      unit text,
      nf_item_id text,
      nf_id text,
      created_at text NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pallet_items_pallet ON pallet_items(pallet_id)`,
    // pallet_movements (depende de pallets, wms_addresses, users)
    `CREATE TABLE IF NOT EXISTS pallet_movements (
      id text PRIMARY KEY,
      pallet_id text NOT NULL REFERENCES pallets(id),
      company_id integer NOT NULL,
      movement_type text NOT NULL,
      from_address_id text REFERENCES wms_addresses(id),
      to_address_id text REFERENCES wms_addresses(id),
      from_pallet_id text,
      user_id text REFERENCES users(id),
      notes text,
      created_at text NOT NULL DEFAULT ''
    )`,
    // nf_cache
    `CREATE TABLE IF NOT EXISTS nf_cache (
      id text PRIMARY KEY,
      company_id integer NOT NULL,
      nf_number text NOT NULL,
      nf_series text,
      supplier_name text,
      supplier_cnpj text,
      issue_date text,
      total_value double precision,
      status text NOT NULL DEFAULT 'pendente',
      synced_at text,
      received_by text,
      received_at text,
      notes text
    )`,
    `CREATE INDEX IF NOT EXISTS idx_nf_cache_company_nf ON nf_cache(company_id, nf_number)`,
    // nf_items (depende de nf_cache, products)
    `CREATE TABLE IF NOT EXISTS nf_items (
      id text PRIMARY KEY,
      nf_id text NOT NULL REFERENCES nf_cache(id),
      product_id text,
      erp_code text,
      product_name text,
      quantity double precision NOT NULL,
      unit text,
      lot text,
      expiry_date text,
      company_id integer NOT NULL,
      unit_cost double precision,
      total_cost double precision,
      barcode text
    )`,
    // counting_cycles (depende de users)
    `CREATE TABLE IF NOT EXISTS counting_cycles (
      id text PRIMARY KEY,
      company_id integer NOT NULL,
      type text NOT NULL,
      status text NOT NULL DEFAULT 'pendente',
      name text,
      created_by text REFERENCES users(id),
      approved_by text REFERENCES users(id),
      approved_at text,
      notes text,
      created_at text NOT NULL DEFAULT '',
      completed_at text
    )`,
    `CREATE INDEX IF NOT EXISTS idx_counting_cycles_company_status ON counting_cycles(company_id, status)`,
    // counting_cycle_items (depende de counting_cycles, wms_addresses, products, pallets, users)
    `CREATE TABLE IF NOT EXISTS counting_cycle_items (
      id text PRIMARY KEY,
      cycle_id text NOT NULL REFERENCES counting_cycles(id),
      company_id integer NOT NULL,
      address_id text REFERENCES wms_addresses(id),
      product_id text REFERENCES products(id),
      pallet_id text REFERENCES pallets(id),
      expected_qty double precision,
      counted_qty double precision,
      lot text,
      expiry_date text,
      old_lot text,
      old_expiry_date text,
      divergence_pct double precision,
      status text NOT NULL DEFAULT 'pendente',
      counted_by text REFERENCES users(id),
      counted_at text,
      created_at text NOT NULL DEFAULT ''
    )`,
    // Tabelas que podem não existir em bancos mais antigos
    `CREATE TABLE IF NOT EXISTS print_agents (
      id text PRIMARY KEY,
      company_id integer NOT NULL,
      name text NOT NULL,
      machine_id text NOT NULL DEFAULT '',
      token_hash text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_at text NOT NULL DEFAULT '',
      last_seen_at text,
      printers text
    )`,
    `CREATE TABLE IF NOT EXISTS product_addresses (
      id text PRIMARY KEY,
      product_id text NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      company_id integer NOT NULL,
      address_id text NOT NULL REFERENCES wms_addresses(id) ON DELETE CASCADE,
      created_at text NOT NULL DEFAULT ''
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS product_addresses_unique_idx
      ON product_addresses (product_id, company_id, address_id)`,
    `CREATE INDEX IF NOT EXISTS idx_product_addresses_product_company
      ON product_addresses (product_id, company_id)`,

    `CREATE TABLE IF NOT EXISTS address_picking_log (
      id text PRIMARY KEY,
      company_id integer NOT NULL,
      address_id text NOT NULL REFERENCES wms_addresses(id),
      address_code text NOT NULL,
      product_id text NOT NULL REFERENCES products(id),
      product_name text,
      erp_code text,
      quantity integer NOT NULL,
      order_id text,
      erp_order_id text,
      work_unit_id text,
      user_id text NOT NULL,
      user_name text,
      created_at text NOT NULL DEFAULT '',
      notes text
    )`,
    // Tabelas de features adicionadas após o deploy inicial
    `CREATE TABLE IF NOT EXISTS order_volumes (
      id text PRIMARY KEY,
      order_id text NOT NULL,
      erp_order_id text NOT NULL,
      sacola integer NOT NULL DEFAULT 0,
      caixa integer NOT NULL DEFAULT 0,
      saco integer NOT NULL DEFAULT 0,
      avulso integer NOT NULL DEFAULT 0,
      total_volumes integer NOT NULL DEFAULT 0,
      created_by text,
      created_at text NOT NULL DEFAULT '',
      updated_at text NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS system_settings (
      id text PRIMARY KEY DEFAULT 'global',
      separation_mode text NOT NULL DEFAULT 'by_order',
      updated_at text NOT NULL DEFAULT '',
      updated_by text,
      quick_link_enabled boolean NOT NULL DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS manual_qty_rules (
      id text PRIMARY KEY,
      rule_type text NOT NULL,
      value text NOT NULL,
      description text,
      active boolean NOT NULL DEFAULT true,
      created_by text,
      created_at text NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS product_barcodes (
      id text PRIMARY KEY,
      company_id integer,
      product_id text NOT NULL,
      barcode text NOT NULL,
      type text NOT NULL,
      packaging_qty integer NOT NULL DEFAULT 1,
      packaging_type text,
      active boolean NOT NULL DEFAULT true,
      is_primary boolean NOT NULL DEFAULT false,
      notes text,
      created_at text NOT NULL DEFAULT '',
      created_by text,
      updated_at text,
      updated_by text,
      deactivated_at text,
      deactivated_by text
    )`,
    `CREATE INDEX IF NOT EXISTS idx_product_barcodes_barcode ON product_barcodes(barcode)`,
    `CREATE INDEX IF NOT EXISTS idx_product_barcodes_product ON product_barcodes(product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_product_barcodes_active ON product_barcodes(active)`,
    `CREATE INDEX IF NOT EXISTS idx_product_barcodes_company ON product_barcodes(company_id)`,
    `CREATE TABLE IF NOT EXISTS barcode_change_history (
      id serial PRIMARY KEY,
      barcode_id text,
      product_id text NOT NULL,
      operation text NOT NULL,
      old_barcode text,
      new_barcode text,
      barcode_type text,
      old_qty integer,
      new_qty integer,
      user_id text,
      user_name text,
      notes text,
      created_at text NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_barcode_history_product ON barcode_change_history(product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_barcode_history_barcode_id ON barcode_change_history(barcode_id)`,
    `CREATE INDEX IF NOT EXISTS idx_barcode_history_user ON barcode_change_history(user_id)`,
    `CREATE TABLE IF NOT EXISTS scan_log (
      id serial PRIMARY KEY,
      msg_id text NOT NULL,
      user_id text NOT NULL,
      company_id_int integer NOT NULL DEFAULT -1,
      work_unit_id text NOT NULL,
      barcode text NOT NULL,
      quantity integer NOT NULL DEFAULT 1,
      ack_status text NOT NULL DEFAULT 'pending',
      created_at text NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS scan_log_dedup_idx ON scan_log(msg_id, user_id, company_id_int)`,
    `CREATE INDEX IF NOT EXISTS scan_log_created_at_idx ON scan_log(created_at)`,
    `CREATE TABLE IF NOT EXISTS label_templates (
      id text PRIMARY KEY,
      company_id integer,
      name text NOT NULL,
      context text NOT NULL,
      group_name text,
      width_mm integer NOT NULL DEFAULT 100,
      height_mm integer NOT NULL DEFAULT 70,
      dpi integer NOT NULL DEFAULT 203,
      active boolean NOT NULL DEFAULT true,
      layout_json jsonb NOT NULL DEFAULT '{"components":[]}'::jsonb,
      created_at text NOT NULL DEFAULT '',
      updated_at text
    )`,
    `ALTER TABLE label_templates ADD COLUMN IF NOT EXISTS group_name text`,
    `CREATE TABLE IF NOT EXISTS label_default_assignments (
      company_id integer NOT NULL DEFAULT 0,
      context text NOT NULL,
      template_id text,
      updated_at text NOT NULL DEFAULT '',
      PRIMARY KEY (company_id, context)
    )`,
    `CREATE TABLE IF NOT EXISTS print_media_layouts (
      id text PRIMARY KEY,
      company_id integer,
      name text NOT NULL,
      description text,
      media_width_mm integer NOT NULL DEFAULT 100,
      media_height_mm integer NOT NULL DEFAULT 150,
      rows integer NOT NULL DEFAULT 3,
      cols integer NOT NULL DEFAULT 1,
      cell_width_mm integer NOT NULL DEFAULT 100,
      cell_height_mm integer NOT NULL DEFAULT 50,
      margin_mm integer NOT NULL DEFAULT 0,
      gap_x_mm integer NOT NULL DEFAULT 0,
      gap_y_mm integer NOT NULL DEFAULT 0,
      layout_json jsonb NOT NULL DEFAULT '{"cells":[]}'::jsonb,
      created_at text NOT NULL DEFAULT '',
      updated_at text
    )`,
  ];

  for (const ddl of tables) {
    try {
      await db.execute(sql.raw(ddl));
    } catch {
      // tabela/índice já existe — ignorar
    }
  }
}

(async () => {
  // Migrações seguras antes do seed
  await runSafeMigrations();

  // Seed database on startup
  try {
    await seedDatabase();
  } catch (error) {
    log("Seeding error (non-critical): " + (error as Error).message);
  }

  await registerRoutes(httpServer, app);

  try {
    setupPrintAgentWS(httpServer);
  } catch (e) {
    log(`[agent] Falha ao iniciar WebSocket (não crítico): ${getErrorMessage(e)}`, "print");
  }

  try {
    setupScanningWS(httpServer);
  } catch (e) {
    log(`[scanning-ws] Falha ao iniciar WebSocket (não crítico): ${getErrorMessage(e)}`, "express");
  }

  // Limpeza periódica de sessões expiradas — a cada hora
  setInterval(async () => {
    try {
      const removed = await storage.deleteExpiredSessions();
      if (removed > 0) log(`[session-gc] ${removed} sessão(ões) expirada(s) removida(s)`);
    } catch (e) {
      log(`[session-gc] Erro ao limpar sessões: ${getErrorMessage(e)}`);
    }
  }, 60 * 60 * 1000);

  // Limpeza diária de scan_log antigos — S1-04
  setInterval(async () => {
    try {
      const removed = await storage.cleanupOldScanLogs(1);
      if (removed > 0) log(`[scan-log-gc] ${removed} registro(s) de scan_log removido(s) (>24h)`);
    } catch (e) {
      log(`[scan-log-gc] Erro ao limpar scan_log: ${getErrorMessage(e)}`);
    }
  }, 24 * 60 * 60 * 1000);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    log(`Internal Server Error: ${err?.message ?? err}`, "error");

    if (res.headersSent) {
      return next(err);
    }

    const message = status >= 500 ? "Erro interno do servidor" : (err.message || "Erro desconhecido");
    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  if (process.env.NODE_ENV !== "test") {
    const port = parseInt(process.env.PORT || "5000", 10);
    httpServer.listen(
      {
        port,
        host: "0.0.0.0",
      },
      () => {
        log(`Servidor iniciado na porta ${port}`);
      },
    );
  }
})();

export { app, httpServer };

