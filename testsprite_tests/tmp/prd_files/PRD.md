# Product Requirements Document — Stoker WMS

## 1. Product Overview

**Name:** Stoker WMS (Warehouse Management System)  
**Type:** Web Application (Frontend + REST API)  
**Tech Stack:** React 18, TypeScript, Vite, Express.js, SQLite (Drizzle ORM), TanStack Query, Tailwind CSS, Radix UI, Wouter, Zustand, Zod  
**Port:** 5000 (production), 411 (development)  
**Authentication:** Cookie-based session with JWT token. Roles: `administrador`, `supervisor`, `separacao`, `conferencia`, `balcao`.

---

## 2. User Roles

| Role | Access |
|---|---|
| `administrador` | Full access to all modules, reports, and admin buttons |
| `supervisor` | Orders, exceptions, reports (except Access Cards). No: Qtd Manual, Audit, Mapping Studio, Separar/Conferir Total buttons |
| `separacao` | Only separation module |
| `conferencia` | Only conference module |
| `balcao` | Only counter module |

---

## 3. Core Modules & Features

### 3.1 Authentication (`/login`)
- Login with username + password
- QR badge scanning alternative login
- Session persistence via cookie
- API: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`

### 3.2 Orders Management (`/supervisor/orders`)
- List all orders with filters: date range, status, route, order code, load code
- **Date filter is ignored when package/load code filter is active**
- Launch orders to start separation workflow
- Cancel order launch (resets status to `pendente`, clears work units)
- Force status `separado` (admin-only, button: "Separar Total")
- Force status `conferido` (admin-only, button: "Conferir Total")
- Both force-status buttons only appear for launched orders (`isLaunched = true`)
- Assign delivery route to selected orders
- View order products with volume count in detail panel
- Generate order volumes and delete them
- Print order list
- Sync with DB2 data source
- API: `GET /api/orders`, `POST /api/orders/launch`, `POST /api/orders/cancel-launch`, `POST /api/orders/force-status`, `POST /api/orders/assign-route`

### 3.3 Separation Module (`/separacao`)
- Available to role `separacao`
- Operator selects available work units (locked to their user)
- Session restored automatically on reconnect
- Products listed **alphabetically (pt-BR locale)**
- Scan barcode to register picked item
- Manual quantity entry (when product rule allows or user has global permission)
- Create exception: `nao_encontrado`, `avariado`, `vencido`
- Auto-advance to next pending product after completing current
- Complete and unlock work unit
- Cancel/unlock in progress picking
- API: `POST /api/work-units/lock`, `POST /api/work-units/:id/scan-item`, `POST /api/exceptions`, `POST /api/work-units/:id/complete`, `POST /api/work-units/unlock`

### 3.4 Conference Module (`/conferencia`)
- Available to role `conferencia`
- Only shows orders with status `separado` or `em_conferencia`
- Products listed **alphabetically (pt-BR locale)**
- Scan barcode to verify conference
- Manual quantity entry with same permission rules as separation
- Create exceptions for divergences
- API: `POST /api/work-units/lock`, `POST /api/work-units/:id/check-item`, `POST /api/exceptions`, `POST /api/work-units/:id/complete-conference`

### 3.5 Counter Module — Balcão (`/balcao`)
- Available to role `balcao`
- Operator selects counter orders
- Scan cart QR code
- Products listed **alphabetically (pt-BR locale)**
- Scan product barcodes for balcao picking
- Create exceptions
- Elapsed time tracking
- API: `POST /api/work-units/lock`, `POST /api/work-units/batch/scan-cart`, `POST /api/work-units/:id/balcao-item`, `POST /api/work-units/:id/complete-balcao`

### 3.6 Exceptions Module (`/supervisor/exceptions`)
- List all exceptions with filters: date, order code, type
- Exception types: `nao_encontrado`, `avariado`, `vencido`
- Authorize exceptions (supervisor/admin)
- Delete pending exceptions (admin only) — resets order item to `pendente`
- Print exception report
- API: `GET /api/exceptions`, `POST /api/exceptions/authorize`, `DELETE /api/exceptions/:id`

### 3.7 Reports (`/supervisor/reports`)
- **Picking List:** filter by orders, pickup points, sections — print formatted report
- **Loading Map (Mapa de Carregamento):** by load code with volumes per order
- **Access Cards (Cartões de Acesso):** admin-only, not visible to supervisor role
- API: `POST /api/reports/picking-list`, `GET /api/reports/loading-map/:loadCode`

### 3.8 Manual Quantity Rules (`/supervisor/manual-qty`)
- Admin-only: create/delete rules allowing specific products to use manual quantity entry
- API: `GET /api/manual-qty-rules`, `POST /api/manual-qty-rules`, `DELETE /api/manual-qty-rules/:id`

### 3.9 Audit Log (`/supervisor/audit`)
- Admin-only module (hidden for supervisor)
- View all user actions with timestamps and details
- API: `GET /api/audit-logs`

### 3.10 Mapping Studio (`/supervisor/mapping`)
- Admin-only module (hidden for supervisor)
- Configure field mappings from DB2 to WMS

---

## 4. Data Sync

- **sync_db2.py:** Python script that reads from IBM DB2 and writes to local SQLite
- Auto-sync triggered every 10 minutes on server startup
- Manual sync via `POST /api/sync`
- Imported fields include: order header (customer name, city, state, address, CNPJ, observations), order items (product, qty, section, barcode), and payment info

---

## 5. Business Rules

| Rule | Detail |
|---|---|
| Launch prerequisite | Order must not already be launched and in progress |
| Force-status | Order must be `isLaunched = true` |
| Cancel launch | Only if no operator currently has it locked (open session) |
| Exception delete | Only admin; resets item status to `pendente` |
| Manual qty | Requires user global permission OR product-specific rule |
| Separation filter | Operators only see work units matching their assigned sections |
| Date filter bypass | When package/load code is used in search, date filter is ignored |
| Alphabetical product sort | All product lists in separation, conference, balcao sorted A→Z (pt-BR) |

---

## 6. Known Limitations & Fixed Bugs

| Issue | Status | Location |
|---|---|---|
| `import.meta.url` undefined crash in CJS build (production) | **FIXED** | `server/static.ts`, `server/routes.ts` |
| `python3` hardcoded in db2-query spawn (Windows uses `python`) | Open | `server/routes.ts` |
| Debug console.log logging all work unit items per render | **FIXED** | `client/src/pages/conferencia/index.tsx` |

---

## 7. API Base URL

```
http://localhost:5000
```

### Auth Headers
Session cookie: `authToken` (HTTP-only)  
Or Bearer token in `Authorization` header.

### Common Responses
- `200 OK` — success with JSON body
- `400 Bad Request` — validation error
- `401 Unauthorized` — not authenticated
- `403 Forbidden` — insufficient role
- `500 Internal Server Error` — server error
