# DOCUMENTAÇÃO COMPLETA — STOKER WMS — V2
> Versão 2.0 | Abril 2025 | Documentação de nível profissional para manutenção, onboarding e auditoria

---

## ÍNDICE

1. [Visão Geral](#1-visão-geral)
2. [Objetivo do Sistema](#2-objetivo-do-sistema)
3. [Perfis de Usuário](#3-perfis-de-usuário)
4. [Matriz de Permissões](#4-matriz-de-permissões)
5. [Mapa Funcional dos Módulos](#5-mapa-funcional-dos-módulos)
6. [Fluxo Geral de Navegação](#6-fluxo-geral-de-navegação)
7. [Fluxos Críticos](#7-fluxos-críticos)
8. [Estrutura Técnica do Projeto](#8-estrutura-técnica-do-projeto)
9. [Estrutura de Pastas](#9-estrutura-de-pastas)
10. [Frontend](#10-frontend)
11. [Backend](#11-backend)
12. [Banco de Dados](#12-banco-de-dados)
13. [ERD Simplificado](#13-erd-simplificado)
14. [APIs e Rotas](#14-apis-e-rotas)
15. [Regras de Negócio](#15-regras-de-negócio)
16. [Tempo Real — SSE / WebSocket / Polling](#16-tempo-real--sse--websocket--polling)
17. [Integrações Externas](#17-integrações-externas)
18. [Variáveis de Ambiente](#18-variáveis-de-ambiente)
19. [Dependências Principais](#19-dependências-principais)
20. [Arquivos Mais Críticos do Projeto](#20-arquivos-mais-críticos-do-projeto)
21. [Runbook Operacional](#21-runbook-operacional)
22. [Troubleshooting — Problemas Comuns](#22-troubleshooting--problemas-comuns)
23. [Checklist de Produção](#23-checklist-de-produção)
24. [Mapa de Testes e Cobertura](#24-mapa-de-testes-e-cobertura)
25. [Dependências Críticas e Impacto de Falha](#25-dependências-críticas-e-impacto-de-falha)
26. [Pontos Sensíveis e Riscos Técnicos](#26-pontos-sensíveis-e-riscos-técnicos)
27. [Melhorias Futuras Recomendadas](#27-melhorias-futuras-recomendadas)
28. [Resumo Executivo Final](#28-resumo-executivo-final)

**Arquivos complementares:**
- `ERD_ESTRUTURA_BANCO.md` — ERD completo com Mermaid e detalhamento de cada tabela
- `MATRIZ_DE_PERMISSOES.md` — Matriz detalhada de permissões por perfil e ação
- `RUNBOOK_OPERACIONAL.md` — Procedimentos operacionais completos
- `CHECKLIST_DE_PRODUCAO.md` — 100+ verificações para go-live
- `MAPA_DE_TESTES.md` — Cobertura atual, lacunas e plano futuro
- `FLUXOS_CRITICOS.md` — Diagramas Mermaid de todos os fluxos

---

## 1. Visão Geral

**Stoker WMS** é um sistema de gerenciamento de armazém (Warehouse Management System) multi-empresa desenvolvido com Node.js + React + PostgreSQL. Opera em tempo real, controlando o ciclo completo de separação, conferência e atendimento balcão de pedidos oriundos de um ERP IBM DB2.

**Nome do sistema:** Stoker  
**Tipo:** WMS (Warehouse Management System)  
**Multi-tenant:** Sim — isolamento por `company_id`  
**Empresas ativas:** 1 e 3  
**Ambiente de desenvolvimento:** `npm run dev` → porta 5000  

---

## 2. Objetivo do Sistema

### Problema que resolve

Distribuidoras e atacadistas que operam armazéns precisam controlar, em tempo real, qual operador está separando qual produto de qual pedido. Antes do Stoker, isso era feito com planilhas ou sistemas legados sem visibilidade em tempo real.

### O que o Stoker entrega

| Necessidade | Solução |
|---|---|
| Controle de operadores em tempo real | Sistema de lock por Work Unit com TTL |
| Rastreamento de separação por seção | Work Units por seção + scan atômico |
| Conferência digital de produtos | Leitura de barcode com validação de quantidade |
| Atendimento de balcão (walk-in) | Módulo balcão com fila própria |
| Visibilidade para gestão | Painel em tempo real (fila de pedidos) + KPIs |
| Registro de problemas | Sistema de exceções com autorização |
| Dados atualizados do ERP | Sync automático com IBM DB2 a cada 10 minutos |
| Rastreabilidade total | Audit log de todas as ações |
| Gestão física do armazém | Módulo WMS: endereços, pallets, recebimento, contagem |

---

## 3. Perfis de Usuário

O sistema possui **9 perfis** definidos no enum `userRoleEnum` em `shared/schema.ts`.

| Perfil | Acesso principal | Observação |
|---|---|---|
| `administrador` | Tudo | Único que gerencia outros admins |
| `supervisor` | Gestão operacional | Pode desbloquear qualquer WU |
| `separacao` | `/separacao`, `/handheld/picking` | Restrito às suas seções |
| `conferencia` | `/conferencia` | Acesso a todas as seções |
| `balcao` | `/balcao` | Apenas pedidos balcão da empresa |
| `fila_pedidos` | `/fila-pedidos` | Somente visualização |
| `recebedor` | `/wms/recebimento`, `/wms/checkin`, `/wms/adicao` | Módulo WMS |
| `empilhador` | `/wms/checkin`, `/wms/transferencia`, `/wms/retirada`, `/wms/adicao` | Módulo WMS |
| `conferente_wms` | `/wms/contagem`, `/wms/produtos` | Contagem cíclica |

> Detalhamento completo em **`MATRIZ_DE_PERMISSOES.md`**

---

## 4. Matriz de Permissões

Resumo executivo da matriz (completa em `MATRIZ_DE_PERMISSOES.md`):

| Ação | admin | supervisor | separacao | conferencia | balcao | fila_pedidos | WMS* |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Login | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ver pedidos | ✅ | ✅ | ✅¹ | ❌ | ❌ | ❌ | ❌ |
| Lançar pedidos | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Lock de WU | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Unlock de outro | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Registrar exceção | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Autorizar exceção | ✅ | ✅ | ❌² | ❌² | ❌² | ❌ | ❌ |
| Criar usuário | ✅ | ✅³ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Criar admin | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| KPI operadores | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sync DB2 manual | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Mudar modo sep. | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Permissões globais | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Limpeza de dados | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

¹Apenas pedidos `em_separacao` nas suas seções  
²Exceto se `settings.canAuthorizeOwnExceptions = true`  
³Não pode criar administradores

---

## 5. Mapa Funcional dos Módulos

### 5.1 Separação Desktop (`/separacao`)

**Quem:** `separacao`, `administrador`  
**O que faz:** Operadores separam produtos de pedidos lançados, seção por seção  
**Como:** Bloqueiam WUs → informam quantidade por produto → registram exceções → concluem  
**Arquivos principais:** `client/src/pages/separacao/index.tsx`  
**APIs:** `/api/work-units`, `/api/work-units/lock`, `/api/work-units/:id/items/:itemId/scan-separated`  
**Tabelas:** `work_units`, `order_items`, `orders`, `exceptions`  
**Regra crítica:** Operador acessa apenas seções atribuídas no campo `users.sections`

### 5.2 Separação Handheld (`/handheld/picking`)

**Quem:** `separacao`, `administrador`  
**O que faz:** Mesma função da separação desktop, mas otimizada para coletores de dados com scanner USB  
**Como:** Lock por seção via `picking_sessions` → heartbeat a cada requisição → submit em lote  
**Diferença do desktop:** Usa `picking_sessions` em vez de `work_units.lockedBy`. Deduplicação por `msgId`  
**APIs:** `/api/lock`, `/api/heartbeat`, `/api/picking/submit`, `/api/unlock`

### 5.3 Conferência (`/conferencia`)

**Quem:** `conferencia`, `supervisor`, `administrador`  
**O que faz:** Valida produtos separados escaneando barcodes  
**Como:** Bloqueia WU de conferência → escaneia barcode → sistema valida quantidade → registra exceções → conclui  
**Arquivos:** `client/src/pages/conferencia/index.tsx`  
**APIs:** `/api/work-units/lock`, `/api/work-units/:id/items/:itemId/scan-checked`  
**Suporte a embalagens:** barcode unitário → box_barcode → box_barcodes[] (múltiplas embalagens com quantidade)

### 5.4 Balcão (`/balcao`)

**Quem:** `balcao`, `supervisor`, `administrador`  
**O que faz:** Atende pedidos de retirada presencial combinando separação + conferência  
**Identificação:** Pedidos cujo `pickup_points` contém pontos balcão da empresa (config estática)  
**CRÍTICO:** WUs balcão têm `type="separacao"` no banco. Identificação É SOMENTE pelo `pickup_point`  
**Empresa 1:** pontos balcão `[1, 2]` | **Empresa 3:** pontos balcão `[52, 54]`  
**APIs:** `/api/queue/balcao`, `/api/work-units/lock`, `/api/work-units/:id/complete`

### 5.5 Fila de Pedidos (`/fila-pedidos`)

**Quem:** `fila_pedidos`, `supervisor`, `administrador`  
**O que faz:** Painel de display em tempo real — projetado para TVs no armazém  
**Dados:** Status, operador, timer ao vivo, status financeiro por pedido  
**Regras de visibilidade (100% client-side):**
- Pedidos `finalizado` somem após 5 minutos
- Pedidos com mais de 2 dias ficam ocultos  
**Atualização:** SSE + polling de fallback a cada 30s

### 5.6 Supervisor (`/supervisor/*`)

**Quem:** `supervisor`, `administrador`  
**Subpáginas:** orders, exceptions, audit, users, routes, route-orders, reports, separation-settings, print-settings, codigos-barras, mapping-studio  
**Ações críticas:** Lançar pedidos, desbloquear WUs, autorizar exceções, mudar modo de separação

### 5.7 Admin (`/admin/*`)

**Quem:** `administrador` exclusivamente  
**Subpáginas:** kpi-operadores, permissoes, limpeza, print-agents  
**Ações:** KPI por período e operador, controle de módulos/relatórios, limpeza de dados, agentes de impressão

### 5.8 WMS (`/wms/*`)

**Quem:** Perfis WMS (recebedor, empilhador, conferente_wms) + supervisor + admin  
**Módulos:**
| Rota | Perfil | Função |
|---|---|---|
| `/wms/enderecos` | supervisor+ | Endereços físicos do armazém |
| `/wms/recebimento` | recebedor+ | Receber NFs e criar pallets |
| `/wms/checkin` | empilhador/recebedor | Confirmar entrada física |
| `/wms/transferencia` | empilhador+ | Mover pallet entre endereços |
| `/wms/retirada` | empilhador+ | Retirar pallet de endereço |
| `/wms/adicao` | empilhador/recebedor | Adicionar itens a pallet |
| `/wms/contagem` | conferente_wms+ | Contagem cíclica de estoque |
| `/wms/produtos` | todos WMS | Consulta de produtos e estoque |

---

## 6. Fluxo Geral de Navegação

```
/login
  ↓ autenticado
  ↓ 1 empresa → /
  ↓ múltiplas → /select-company → /
  
/ (Home)
  → /separacao          (perfil: separacao, admin)
  → /handheld/picking   (perfil: separacao, admin)
  → /conferencia        (perfil: conferencia, supervisor, admin)
  → /balcao             (perfil: balcao, supervisor, admin)
  → /fila-pedidos       (perfil: fila_pedidos, supervisor, admin)
  → /supervisor/*       (perfil: supervisor, admin)
  → /admin/*            (perfil: admin)
  → /wms/*              (perfis WMS)
```

**Proteção de rotas:** `ProtectedRoute` em `client/src/App.tsx` — redireciona para `/login` se não autenticado, para `/select-company` se multi-empresa sem seleção, e para `/` se role não autorizado.

---

## 7. Fluxos Críticos

> Diagramas Mermaid completos em **`FLUXOS_CRITICOS.md`**. Resumo abaixo.

### 7.1 Ciclo Principal de Pedido

```
ERP DB2 ──(sync_db2.py)──▶ cache_orcamentos
                                 │
                          ┌──────▼──────┐
                          │   orders    │  status: pendente
                          │ order_items │
                          └──────┬──────┘
                                 │ Supervisor lança
                          ┌──────▼──────┐
                          │   orders    │  status: em_separacao
                          │ work_units  │  type: separacao
                          └──────┬──────┘
                                 │ Operadores separam WUs
                          ┌──────▼──────┐
                          │   orders    │  status: separado
                          │ work_units  │  type: conferencia (criada automaticamente)
                          └──────┬──────┘
                                 │ Conferentes validam WUs
                          ┌──────▼──────┐
                          │   orders    │  status: conferido → finalizado
                          └─────────────┘
```

### 7.2 Lock de Work Unit

```
Operador → POST /api/work-units/lock
         ↓
         Verifica: WU livre? empresa correta? seção permitida?
         ↓ 409 se já bloqueada por outro com lock válido
         ↓ OK
         locked_by = userId
         lock_expires_at = now + 60 min
         status = em_andamento
         ↓
         Broadcast SSE → todos os clientes atualizam
```

### 7.3 Scan Atômico (Separação/Conferência)

```
Operador scan → POST /api/work-units/:id/items/:itemId/scan-{separated|checked}
              → atomicIncrement (UPDATE ... RETURNING)
              → Se qty atingida → item status = separado/conferido
              → checkAndCompleteWorkUnit()
              → checkAndUpdateOrderStatus()
              → Broadcast SSE
```

### 7.4 Session Restore

```
Recarga da página
  → loadSession() from sessionStorage
  → Para cada WU salva:
      lockedBy === userId? ✓
      lockExpiresAt > now? ✓
      orderId ∈ saved.orderIds? ✓ (cross-order protection)
  → Se todas válidas: restaura estado (step, tab, productIndex)
  → Se nenhuma válida: clearSession() → começa do zero
  → Fallback: busca WU com lockedBy === userId na API
```

---

## 8. Estrutura Técnica do Projeto

### Stack

| Camada | Tecnologia | Versão/Detalhes |
|---|---|---|
| Runtime | Node.js | tsx (TypeScript sem build) |
| Framework Backend | Express.js | Porta 5000 |
| ORM | Drizzle ORM | PostgreSQL dialect |
| Banco de dados | PostgreSQL | Neon-compatible driver |
| Framework Frontend | React 18 | JSX transform automático (Vite) |
| Build Frontend | Vite | Serve no mesmo processo via proxy |
| Roteamento | wouter | Leve, sem react-router |
| Estado servidor | TanStack Query v5 | Objeto form obrigatório |
| UI Components | shadcn/ui + Radix UI | Tailwind CSS |
| Formulários | react-hook-form + zod | zodResolver |
| Gráficos | Recharts | ComposedChart (KPI) |
| Ícones | lucide-react + react-icons/si | |
| Tempo real | SSE (nativo) + WebSocket | `/api/sse`, `/ws/print-agent`, `/ws/scanning` |
| Autenticação | Token Bearer + cookie httpOnly | TTL 12h |
| Segurança | Helmet + express-rate-limit | CSP, XSS, rate-limit |
| Integração ERP | Python 3 (pyodbc + psycopg2) | sync_db2.py |
| Impressão | WebSocket Agent | print-agent local |

### Inicialização do servidor

```
server/index.ts
  ├── Helmet (CSP, XSS, headers)
  ├── Rate limiting (login: 20/15min, API: 200/min)
  ├── Logging middleware (apenas erros 5xx)
  ├── runSafeMigrations() — ADD COLUMN IF NOT EXISTS
  ├── seedDatabase() — dados iniciais se banco vazio
  ├── setupSSE(app)
  ├── registerRoutes(httpServer, app) — routes.ts
  │     ├── registerWmsRoutes() — wms-routes.ts
  │     └── registerPrintRoutes() — print-routes.ts
  ├── setupPrintAgentWS(httpServer) — /ws/print-agent
  ├── setupScanningWS(httpServer) — /ws/scanning
  ├── setTimeout 5s → runSync() — sync inicial DB2
  ├── setInterval 10min → runSync() — sync recorrente
  └── setInterval 1h → deleteExpiredSessions()
```

---

## 9. Estrutura de Pastas

```
/
├── client/src/
│   ├── App.tsx                    ← Router, ProtectedRoute, ErrorBoundary
│   ├── main.tsx                   ← Ponto de entrada React
│   ├── index.css                  ← Variáveis CSS + Tailwind
│   ├── pages/
│   │   ├── login.tsx
│   │   ├── home.tsx               ← Hub pós-login
│   │   ├── company-select.tsx
│   │   ├── separacao/index.tsx    ← ★ CRÍTICO
│   │   ├── conferencia/index.tsx  ← ★ CRÍTICO
│   │   ├── balcao/index.tsx       ← ★ CRÍTICO
│   │   ├── fila-pedidos/index.tsx
│   │   ├── handheld/picking.tsx   ← ★ CRÍTICO (coletor)
│   │   ├── supervisor/
│   │   │   ├── orders.tsx         ← ★ CRÍTICO
│   │   │   ├── exceptions.tsx
│   │   │   ├── audit.tsx
│   │   │   ├── users.tsx
│   │   │   ├── routes.tsx
│   │   │   ├── separation-settings.tsx
│   │   │   ├── reports/           ← Múltiplos relatórios
│   │   │   └── mapping-studio.tsx
│   │   ├── admin/
│   │   │   ├── kpi-dashboard.tsx  ← ★ Dashboard principal
│   │   │   ├── permissoes.tsx
│   │   │   ├── limpeza.tsx
│   │   │   └── print-agents.tsx
│   │   ├── wms/                   ← Módulo WMS completo
│   │   └── print/                 ← Páginas de impressão
│   ├── components/ui/             ← shadcn components
│   ├── hooks/
│   │   ├── use-sse.ts             ← ★ Hook SSE
│   │   ├── use-toast.ts
│   │   └── use-scanning.ts        ← Scanner WebSocket
│   └── lib/
│       ├── auth.tsx               ← ★ AuthProvider, useAuth
│       ├── queryClient.ts         ← ★ TanStack Query + apiRequest
│       ├── theme.tsx
│       └── audio-feedback.ts
│
├── server/
│   ├── index.ts                   ← ★★ Ponto de entrada
│   ├── routes.ts                  ← ★★★ MAIS CRÍTICO (~4500 linhas)
│   ├── storage.ts                 ← ★★★ MAIS CRÍTICO (~2500 linhas)
│   ├── auth.ts                    ← ★★ Autenticação
│   ├── sse.ts                     ← ★★ Tempo real
│   ├── company-config.ts          ← ★★ Configuração por empresa
│   ├── db.ts                      ← Conexão Drizzle/PostgreSQL
│   ├── wms-routes.ts              ← ★ Rotas WMS (~3600 linhas)
│   ├── print-routes.ts            ← Rotas de impressão
│   ├── print-agent.ts             ← WebSocket agente impressão
│   ├── ws-scanning.ts             ← WebSocket scanner
│   ├── data-contracts.ts          ← Contratos de mapeamento DB2
│   ├── log.ts                     ← Utilitário de log
│   └── seed.ts                    ← Seed inicial do banco
│
├── shared/
│   └── schema.ts                  ← ★★★ Schema Drizzle + tipos Zod
│
├── sync_db2.py                    ← ★★★ Integração ERP (~2200 linhas Python)
├── server/company-config.ts       ← ★★ Configuração de pickup points
├── tests/api/work-units.spec.ts   ← Testes E2E (8 testes)
└── docs/                          ← Documentação adicional
```

---

## 10. Frontend

### 10.1 Autenticação no Frontend

**Arquivo:** `client/src/lib/auth.tsx`

- `AuthProvider`: contexto global com `user`, `companyId`, `allowedCompanies`, `status`
- `useAuth()`: acesso ao contexto em qualquer componente
- Inicialização: `GET /api/auth/me` para restaurar sessão existente
- `useSessionQueryKey()`: gera queryKey incluindo `companyId` — garante que queries são por empresa

### 10.2 Queries e Cache

- **TanStack Query v5**: apenas forma objeto (`useQuery({ queryKey: [...] })`)
- `apiRequest()`: wrapper com token automático no header Authorization
- Fetcher padrão configurado em `queryClient.ts` — queries não precisam definir `queryFn`
- Invalidação de cache após mutações: `queryClient.invalidateQueries({ queryKey: [...] })`
- Loading states: `.isLoading` para queries, `.isPending` para mutations

### 10.3 Tempo Real no Frontend

```typescript
// Hook use-sse.ts
const { connected } = useSSE({
  onEvent: (type, data) => {
    if (type === "work_unit_updated") {
      queryClient.invalidateQueries({ queryKey: ["/api/work-units"] });
    }
  }
});
```

### 10.4 Session Restore (3 módulos operacionais)

Interface `SessionData` (localStorage do browser):
```typescript
interface SessionData {
  workUnitIds: string[];    // IDs das WUs bloqueadas
  orderIds?: string[];      // IDs dos pedidos (cross-order protection)
  tab?: string;             // aba ativa (apenas conferência)
  productIndex?: number;    // produto atual (apenas conferência)
}
```

Validação ao restaurar: `lockedBy === userId` AND `lockExpiresAt > now` AND `orderId ∈ orderIds`

### 10.5 Modo de Separação no Frontend

- `GET /api/system-settings/separation-mode` — cached 30s no servidor
- Modo `by_order` (padrão): operador vê WUs por seção
- Modo `by_section`: operador vê pedidos inteiros (1 WU por pedido)

---

## 11. Backend

### 11.1 Segurança e Middlewares

```typescript
// server/index.ts
app.use(helmet({ /* CSP restrito */ }));
app.use("/api/auth/login", loginLimiter);     // 20 req / 15 min
app.use("/api/", apiLimiter);                  // 200 req / 1 min
app.use("/api/sql-query", sqlLimiter);         // 30 req / 1 min
app.use(express.json({ limit: "2mb" }));
```

### 11.2 Funções de Autorização

```typescript
// server/routes.ts (funções inline usadas em toda a API)

authorizeWorkUnit(wu, req, mode)
// Valida: empresa da WU === empresa da sessão
// Valida: seções do operador incluem a seção da WU (modo by_order)

assertLockOwnership(wu, req)
// Valida: lockedBy === userId (ou supervisor/admin bypassam)
// Valida: lockExpiresAt > now

authorizeOrder(order, req)
// Valida: company_id do pedido === company_id da sessão
```

### 11.3 Cache de Modo de Separação

```typescript
// server/routes.ts
let _sepModeCache: { mode: string; expiry: number } | null = null;

async function getCachedSeparationMode(): Promise<string> {
  if (_sepModeCache && Date.now() < _sepModeCache.expiry) return _sepModeCache.mode;
  // Busca do banco...
  _sepModeCache = { mode, expiry: Date.now() + 30_000 }; // TTL 30s
}
export function invalidateSeparationModeCache() { _sepModeCache = null; }
```

### 11.4 Jobs e Timers do Servidor

| Job | Intervalo | Função | Arquivo |
|---|---|---|---|
| Sync DB2 inicial | 5s após start | Primeiro sync | `routes.ts` |
| Sync DB2 automático | 10 minutos | Sync recorrente | `routes.ts` |
| Limpeza de sessões | 1 hora | `deleteExpiredSessions()` | `routes.ts` |

### 11.5 Storage Layer (`server/storage.ts`)

Implementa interface `IStorage` com ~2500 linhas. Métodos mais críticos:

| Método | Função |
|---|---|
| `lockWorkUnits()` | Adquire lock com TTL, retorna quantidade bloqueada |
| `unlockWorkUnits()` | Zera `lockedBy` + `lockExpiresAt` |
| `atomicIncrementSeparatedQty()` | UPDATE... RETURNING sem race condition |
| `atomicScanCheckedQty()` | Idem para conferência, com validação de over_quantity |
| `atomicScanSeparatedQty()` | Handheld: com deduplicação por `msgId` via scanLog |
| `checkAndCompleteWorkUnit()` | Verifica se WU está completa e avança status |
| `checkAndUpdateOrderStatus()` | Verifica todas WUs e avança status do pedido |
| `finalizeWorkUnitsWithDeductions()` | Finaliza WUs e aplica deduções de estoque |

---

## 12. Banco de Dados

**SGBD:** PostgreSQL  
**ORM:** Drizzle ORM  
**Timestamps:** Armazenados como `text` em formato ISO 8601 (não tipo TIMESTAMP nativo)  
**PKs:** UUID (`crypto.randomUUID()`) para entidades do sistema; integer para entidades do ERP  
**Migrations:** `runSafeMigrations()` com `ADD COLUMN IF NOT EXISTS` — sem versionamento formal  

### Tabelas por categoria

**Núcleo operacional:** `companies`, `users`, `sessions`, `orders`, `order_items`, `products`, `work_units`, `exceptions`, `audit_logs`

**Configuração:** `sections`, `pickup_points`, `routes`, `section_groups`, `system_settings`, `manual_qty_rules`

**Integração ERP:** `cache_orcamentos`, `db2_mappings`, `product_company_stock`

**Handheld:** `picking_sessions` (lock por seção), `scan_log` (deduplicação de scans)

**WMS:** `wms_addresses`, `pallets`, `pallet_items`, `pallet_movements`, `nf_cache`, `nf_items`, `counting_cycles`, `counting_cycle_items`

**Impressão:** `print_agents` (agentes conectados e suas impressoras)

> Detalhamento completo com ERD Mermaid em **`ERD_ESTRUTURA_BANCO.md`**

---

## 13. ERD Simplificado

```
companies ──────────────────────────────────────────────────────┐
    │                                                            │
    ├── users ──────────────────────────────────────────────┐   │
    │      │                                                │   │
    │      ├── sessions                                     │   │
    │      └── audit_logs                                   │   │
    │                                                        │   │
    ├── orders ─────────────────────────────────────────┐  │   │
    │      │                                            │  │   │
    │      ├── order_items ──── products                │  │   │
    │      │         │                                  │  │   │
    │      │         └── exceptions ◄── work_units ◄───┘  │   │
    │      │                                   │           │   │
    │      └── order_volumes                   └─── users ◄┘   │
    │                                                            │
    ├── routes (entrega)                                         │
    │                                                            │
    └── [WMS] wms_addresses ◄── pallets ── pallet_items         │
                                    └── pallet_movements         │
              nf_cache ── nf_items                              │
              counting_cycles ── counting_cycle_items            │
              product_company_stock ── products                  │
```

---

## 14. APIs e Rotas

### Autenticação
- `POST /api/auth/login` — login (público)
- `POST /api/auth/logout` — logout
- `GET /api/auth/me` — sessão atual
- `POST /api/auth/select-company` — troca empresa ativa
- `POST /api/auth/badge-login` — login por crachá

### Pedidos
- `GET /api/orders` — lista pedidos (company-scoped)
- `GET /api/orders/:id` — detalhes com itens
- `POST /api/orders/launch` — lança pedidos
- `POST /api/orders/batch-sync` — upsert em lote (do ERP)
- `POST /api/orders/force-status` — força mudança de status
- `POST /api/orders/assign-route` — atribui rota
- `POST /api/orders/set-priority` — define prioridade
- `POST /api/orders/:id/relaunch` — relança pedido

### Work Units
- `GET /api/work-units` — lista WUs (filtrado por empresa + tipo)
- `GET /api/work-units/:id` — detalhes da WU
- `POST /api/work-units/lock` — adquire lock
- `POST /api/work-units/unlock` — libera lock
- `POST /api/work-units/batch-unlock` — unlock em lote (supervisor)
- `POST /api/work-units/:id/complete` — conclui WU
- `POST /api/work-units/:id/renew-lock` — renova TTL
- `POST /api/work-units/:id/items/:itemId/scan-separated` — scan separação
- `POST /api/work-units/:id/items/:itemId/scan-checked` — scan conferência
- `POST /api/work-units/:id/reset-conferencia` — reseta conferência

### Exceções
- `GET /api/exceptions` — lista (company-scoped, supervisor+)
- `POST /api/exceptions` — registra exceção
- `PATCH /api/exceptions/:id/authorize` — autoriza (supervisor+)
- `DELETE /api/exceptions/:id` — remove (company-scoped)

### Balcão
- `GET /api/queue/balcao` — fila de pedidos balcão

### Handheld
- `POST /api/lock` — lock de seção
- `POST /api/unlock` — unlock de seção
- `POST /api/heartbeat` — mantém lock vivo
- `POST /api/picking/submit` — envia itens separados

### Sistema
- `GET /api/sse` — conexão SSE
- `GET/PATCH /api/system-settings/separation-mode` — modo de separação
- `GET/PATCH /api/system-settings/features` — feature flags
- `POST /api/sync` — dispara sync DB2
- `GET /api/sync/status` — status do sync
- `GET /api/sections` — seções
- `GET /api/pickup-points` — pontos de retirada
- `GET /api/routes` — rotas de entrega
- `GET /api/kpi/operators` — KPI de operadores
- `GET /api/stats` — estatísticas gerais

---

## 15. Regras de Negócio

### 15.1 Sistema de Lock

- **TTL:** 60 minutos (`LOCK_TTL_MINUTES = 60` em `routes.ts`)
- **Concorrência:** Retorna 409 se WU já bloqueada por outro com lock válido
- **Zeragem obrigatória:** Em qualquer unlock/reset, sempre zerar `lockedBy` E `lockExpiresAt` juntos
- **`lockedAt` preservado:** Após conclusão, mantém timestamp para timer de display
- **Quem pode desbloquear qualquer WU:** supervisor e administrador

### 15.2 Modos de Separação

| Modo | Valor | Comportamento |
|---|---|---|
| Por Seção (padrão) | `by_order` | 1 WU por seção que tem itens. Operador vê só suas seções |
| Por Pedido/Rota | `by_section` | 1 WU por pedido. Operador recebe pedido inteiro |

**Troca de modo:** retorna 409 se há ops ativas. `force: true` cancela sessões e reseta WUs.

### 15.3 Status do Pedido

```
pendente → em_separacao → separado → em_conferencia → conferido → finalizado
                                                               ↓
                                                          cancelado (qualquer ponto)
```

### 15.4 Status da Work Unit

```
pendente → em_andamento → concluido
                      ↓
                 recontagem
                 excecao
```

### 15.5 Balcão — Regra de Identificação

A identificação de pedido balcão é feita **exclusivamente** pelo `pickup_point`:
```typescript
// server/company-config.ts
company 1: balcao = [1, 2]
company 3: balcao = [52, 54]
```
Pedido.`pickupPoints` (jsonb) contém ao menos um desses IDs → aparece na fila balcão.

### 15.6 Fila de Pedidos — Visibilidade (client-side)

Calculado a cada 30 segundos no frontend:
- `finalizado` + `completedAt` < now - 5 min → oculto
- `createdAt` < now - 2 dias → oculto (independente do status)

### 15.7 Exceções

- Registradas pelo operador com: tipo + quantidade + observação opcional
- Bloqueiam conclusão da WU até autorização (exceto `canAuthorizeOwnExceptions`)
- Autorizadas pelo supervisor via `PATCH /api/exceptions/:id/authorize`
- Deletáveis apenas pelo supervisor dentro da mesma empresa

### 15.8 Deduplicação de Scan (Handheld)

```typescript
// atomicScanSeparatedQty aceita msgId (UUID v4 do cliente)
// Se mesmo msgId chegar 2x → second result: "duplicate"
// Armazenado em scanLog para lookup futuro
```

---

## 16. Tempo Real — SSE / WebSocket / Polling

### 16.1 Server-Sent Events (SSE)

| Aspecto | Detalhe |
|---|---|
| Endpoint | `GET /api/sse` |
| Autenticação | Token Bearer ou cookie |
| Limite | 5 conexões por usuário (429 se ultrapassar) |
| Heartbeat | `: ping\n\n` a cada 30 segundos |
| Reconexão | EventSource reconecta automaticamente |
| Isolamento | `broadcastSSE(type, data, companyId)` — por empresa |

**Eventos emitidos:** `work_unit_updated`, `order_updated`, `work_unit_created`, `work_units_unlocked`, `sync_finished`, `picking_update`, `lock_acquired`, `lock_released`, `route_updated`

### 16.2 WebSocket — Agente de Impressão

| Aspecto | Detalhe |
|---|---|
| Endpoint | `/ws/print-agent` |
| Função | Impressão de etiquetas via agente local nos PCs |
| Persistência | Agentes listados em `/admin/print-agents` |

### 16.3 WebSocket — Scanner USB

| Aspecto | Detalhe |
|---|---|
| Endpoint | `/ws/scanning` |
| Função | Leituras de barcode via scanner HID |
| Alternativa | Câmera do dispositivo (conferência mobile) |

### 16.4 Polling de Fallback

- Fila de Pedidos: refetch a cada 30s mesmo sem SSE ativo
- Separação: refetch a cada N segundos via TanStack Query `refetchInterval`
- Handheld: heartbeat a cada requisição mantém lock vivo

---

## 17. Integrações Externas

### 17.1 ERP IBM DB2 — Principal

**Script:** `sync_db2.py` (~2200 linhas Python)  
**Protocolo:** ODBC via `pyodbc`  
**Host:** `192.168.1.200:50000` (rede local/intranet)  
**Database:** `CISSERP`  
**Usuário:** `CONSULTA` (somente leitura)  
**Gatilhos:** Automático a cada 10min + manual via `POST /api/sync`

**Pipeline de dados:**
```
DB2 → cache_orcamentos (upsert por CHAVE) 
    → orders + order_items (transformação por db2_mappings)
    → products (upsert por erp_code)
    → product_company_stock (estoque por empresa)
```

**Mapeamento configurável:** Editado via Mapping Studio (`/supervisor/mapping-studio`) sem alterar código.

### 17.2 Impressoras Locais

**Mecanismo:** Agente WebSocket instalado nos PCs do armazém  
**Configuração:** Impressora por seção em `/supervisor/print-settings`  
**Tipos de etiqueta:** Volume (`/print/volume-label`) e Pallet (`/print/pallet-label`)

---

## 18. Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | ✅ Sim | Connection string PostgreSQL |
| `NODE_ENV` | ✅ Sim | `development` ou `production` |
| `DB2_DSN` | Para sync | ODBC connection string ao DB2 |
| `DATABASE_URL_LOCAL` | Para sync Python | psycopg2 connection string |
| `PORT` | Não | Porta do servidor (default: 5000) |

**Configurações hardcoded em `server/company-config.ts`:**
```typescript
// ATENÇÃO: Adicionar nova empresa requer edição de código + redeploy
company 1: operations=[4,58], reports=[1,2,4,58], balcao=[1,2]
company 3: operations=[60,61], reports=[52,54,60,61], balcao=[52,54]
```

---

## 19. Dependências Principais

### Backend
| Pacote | Função |
|---|---|
| express | Servidor HTTP |
| drizzle-orm + @neondatabase/serverless | ORM + driver PostgreSQL |
| bcrypt | Hash de senhas (cost 10) |
| helmet | Headers de segurança |
| express-rate-limit | Rate limiting |
| cookie-parser | Parse de cookies |
| zod | Validação de schemas |
| tsx | TypeScript execution sem build |

### Frontend
| Pacote | Função |
|---|---|
| react + react-dom | UI |
| wouter | Roteamento |
| @tanstack/react-query v5 | Cache de dados |
| @radix-ui/* + shadcn/ui | Componentes |
| tailwindcss | Styling |
| lucide-react | Ícones |
| recharts | Gráficos |
| react-hook-form + zod | Formulários |
| date-fns | Datas |

### Python (sync)
| Pacote | Função |
|---|---|
| pyodbc | Conexão ODBC ao DB2 |
| psycopg2-binary | Conexão PostgreSQL |

---

## 20. Arquivos Mais Críticos do Projeto

| # | Arquivo | Criticidade | Por que é crítico |
|---|---|:---:|---|
| 1 | `server/routes.ts` | 🔴 Máxima | ~4500 linhas. Toda a lógica de API. Autorização, locks, scan, balcão, sync. Qualquer bug aqui afeta tudo |
| 2 | `server/storage.ts` | 🔴 Máxima | ~2500 linhas. Toda persistência de dados. Operações atômicas. Erro aqui = perda ou corrupção de dados |
| 3 | `shared/schema.ts` | 🔴 Máxima | Tipos e enums compartilhados entre frontend e backend. Mudança quebra tipagem em cascata |
| 4 | `sync_db2.py` | 🔴 Máxima | ~2200 linhas Python. Única fonte de dados do ERP. Sem este script, não chegam novos pedidos |
| 5 | `server/company-config.ts` | 🔴 Alta | Define quais pedidos são balcão por empresa. Erro aqui oculta ou expõe pedidos errados |
| 6 | `server/auth.ts` | 🔴 Alta | Autenticação, geração de tokens, middleware `isAuthenticated`. Erro = acesso indevido |
| 7 | `server/sse.ts` | 🟡 Alta | Broadcast em tempo real. Erro no isolamento por empresa = vazamento de dados entre empresas |
| 8 | `client/src/pages/separacao/index.tsx` | 🟡 Alta | Módulo operacional principal. Session restore, lock, scan, cross-order protection |
| 9 | `client/src/pages/conferencia/index.tsx` | 🟡 Alta | Idem para conferência. Lógica de barcode, session restore, cross-order |
| 10 | `client/src/pages/balcao/index.tsx` | 🟡 Alta | Módulo balcão. Fluxo simplificado mas crítico para clientes presenciais |
| 11 | `client/src/lib/auth.tsx` | 🟡 Alta | AuthProvider, contexto global de usuário e empresa |
| 12 | `client/src/lib/queryClient.ts` | 🟡 Média | TanStack Query config. `apiRequest` com token automático |
| 13 | `server/index.ts` | 🟡 Média | Setup do servidor. Helm, rate-limit, migrations, seed |
| 14 | `server/wms-routes.ts` | 🟡 Média | ~3600 linhas. Todo o módulo WMS |

### Cuidados por arquivo

**`server/routes.ts`:**
- Arquivo enorme — leitura difícil sem navegação por seção
- Funções de autorização `authorizeWorkUnit`, `assertLockOwnership`, `authorizeOrder` são críticas
- Qualquer mudança no fluxo de lock deve manter coerência entre `lockedBy`, `lockedAt`, `lockExpiresAt`
- Risco de regressão alta em qualquer alteração

**`server/storage.ts`:**
- Operações atômicas (`atomicIncrement*`) não devem ser substituídas por read-modify-write
- Transações Drizzle devem ser usadas para operações multi-step
- `checkAndCompleteWorkUnit` e `checkAndUpdateOrderStatus` são a "cola" que avança o ciclo

**`shared/schema.ts`:**
- Enums devem sempre incluir todos os valores — ausência causa erro de validação Zod em runtime
- Alteração de tipo de coluna requer migration cuidadosa (timestamps como text é intencional)

**`sync_db2.py`:**
- Lógica de transformação de campos DB2 → PostgreSQL
- Dependência de `db2_mappings` ativo no banco
- Fora do controle do ORM — mudanças no schema podem não ser detectadas
- Conexão ODBC depende de driver instalado no SO e rede interna

**`server/company-config.ts`:**
- Alterar sem redeploy não tem efeito
- Erro nos IDs de pickup points oculta pedidos balcão ou exibe pedidos errados

---

## 21. Runbook Operacional

> Conteúdo completo em **`RUNBOOK_OPERACIONAL.md`**

### Início rápido

```bash
# 1. Verificar banco
psql $DATABASE_URL -c "SELECT 1"

# 2. Subir servidor
npm run dev  # ou: NODE_ENV=production tsx server/index.ts

# 3. Verificar saúde
curl http://localhost:5000/api/auth/me
# → {"error":"Não autenticado"} = OK

# 4. Login teste
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# 5. Disparar sync
curl -X POST http://localhost:5000/api/sync \
  -H "Authorization: Bearer TOKEN"
```

---

## 22. Troubleshooting — Problemas Comuns

### Pedido não aparece na separação

| Causa | Verificar | Solução |
|---|---|---|
| Pedido não lançado | `orders.is_launched = false` | Supervisor lança o pedido |
| WU não criada | `SELECT * FROM work_units WHERE order_id = '...'` | Force-status ou relançar |
| Seção do operador diferente | `users.sections` vs `work_units.section` | Atualizar seções do usuário |
| Empresa errada | `companyId` da sessão vs `orders.company_id` | Trocar empresa na sessão |
| Sync não rodou | `GET /api/sync/status` | Disparar sync manual |

### Pedido não sobe para conferência

| Causa | Verificar | Solução |
|---|---|---|
| Há WU de separação não concluída | `SELECT status FROM work_units WHERE order_id = '...'` | Concluir ou desbloquear WU |
| Item não separado | `SELECT status FROM order_items WHERE order_id = '...'` | Completar separação |
| Bug no `checkAndUpdateOrderStatus` | Ver logs do servidor por erros 500 | Reportar como bug |
| WU com status incorreto | Consulta direta no banco | Supervisor: force-status do pedido |

### Fila balcão não atualiza

| Causa | Verificar | Solução |
|---|---|---|
| SSE desconectado | DevTools → Network → /api/sse | Hard refresh |
| Sessão expirada | `GET /api/auth/me` retorna 401 | Refazer login |
| Pedido não tem pickup_point balcão | `orders.pickup_points` | Verificar configuração de sync |
| Empresa errada | `companyId` da sessão | Confirmar empresa selecionada |

### SSE não reconecta / painel travado

| Causa | Verificar | Solução |
|---|---|---|
| 5 conexões ativas (limite) | DevTools → Network | Fechar abas desnecessárias |
| Token expirado | `GET /api/auth/me` | Refazer login |
| Proxy timeout | Logs do servidor | Hard refresh reconecta EventSource |

### Operador não consegue lock

| Causa | Verificar | Solução |
|---|---|---|
| WU já bloqueada | `work_units.locked_by` | Supervisor desbloqueia |
| Lock expirado mas não zerado | `lock_expires_at < now` | Verificar código — deve ser ignorado |
| Seção não permitida | `users.sections` | Atualizar seções do usuário |
| Empresa diferente | `company_id` | Confirmar empresa da sessão |

### Sync DB2 não atualiza

| Causa | Verificar | Solução |
|---|---|---|
| DB2 inacessível | Ping em 192.168.1.200 | Verificar rede/VPN |
| pyodbc não instalado | `python3 -c "import pyodbc"` | `pip install pyodbc` |
| DSN inválido | Variável `DB2_DSN` | Verificar string de conexão |
| Script não existe | `ls sync_db2.py` | Restaurar arquivo |
| Erro de mapeamento | `GET /api/sync/status` | Ver `lastSyncError` |

### Usuário não consegue logar

| Causa | Verificar | Solução |
|---|---|---|
| Senha incorreta | — | Supervisor redefine senha |
| Usuário inativo | `users.active = false` | Supervisor ativa usuário |
| Rate limit atingido | Logs do servidor (429) | Aguardar 15 minutos |
| Banco inacessível | Servidor retorna 500 | Verificar DATABASE_URL |

### Impressora não responde

| Causa | Verificar | Solução |
|---|---|---|
| Agente não conectado | `/admin/print-agents` | Iniciar software do agente no PC |
| Impressora não listada | Agente conectado mas sem impressoras | Reiniciar software do agente |
| Impressora errada configurada | `/supervisor/print-settings` | Reconfigurar por seção |

### Handheld duplica scan

| Causa | Verificar | Solução |
|---|---|---|
| msgId diferente em cada tentativa | Código do handheld | Garantir mesmo msgId em retentativas |
| scanLog cheio ou com erro | Logs do servidor | Verificar erros na tabela scanLog |

---

## 23. Checklist de Produção

> Checklist completo com 100+ verificações em **`CHECKLIST_DE_PRODUCAO.md`**

Blocos: Infraestrutura (10), Autenticação (10), Sync DB2 (7), Pedidos (10), Separação (13), Conferência (10), Balcão (9), Fila Pedidos (8), Supervisor (10), Relatórios (7), SSE (7), Impressão (5), Handheld (7), WMS (8), Multi-empresa (7), Segurança (10)

---

## 24. Mapa de Testes e Cobertura

> Análise completa em **`MAPA_DE_TESTES.md`**

### Resumo atual

| Módulo | Cobertura |
|---|:---:|
| Work Units / Lock | 60% (6/10 cenários) |
| Balcão (fila) | 50% |
| Isolamento multi-empresa | 33% |
| Autenticação | 11% |
| Separação | **0%** |
| Conferência | **0%** |
| Exceções | **0%** |
| SSE | **0%** |
| Sync DB2 | **0%** |
| **TOTAL ESTIMADO** | **~15%** |

### 8 testes existentes (Playwright API)

`TC-WU-01` a `TC-WU-08` em `tests/api/work-units.spec.ts`

### Fluxos críticos sem cobertura (prioridade máxima)

1. Ciclo completo: lançar → separar → conferir → finalizar
2. Isolamento SSE entre empresas
3. Lock TTL expirado libera para outro operador
4. Scan atômico sem race condition
5. Session restore com cross-order protection
6. Identificação de pedido balcão por pickup_point
7. Exceção: autorização necessária antes de concluir WU

---

## 25. Dependências Críticas e Impacto de Falha

| Componente | Falha | Impacto | Operação alternativa |
|---|---|---|---|
| **PostgreSQL** | Banco inacessível | Sistema totalmente inoperante. Servidor não sobe. Dados perdidos na sessão atual | Restaurar backup. Verificar DATABASE_URL |
| **DB2 (ERP)** | DB2 inacessível | Novos pedidos não chegam. Dados existentes no banco continuam funcionando | Operação manual com pedidos já existentes |
| **sync_db2.py** | Script com erro | Pedidos novos não aparecem. Sistema operacional continua com dados existentes | Rodar sync manualmente após correção |
| **SSE** | Conexão cai | Painéis não atualizam em tempo real. Polling de 30s como fallback | Fazer refresh manual; polling continua |
| **Print Agent** | Agente desconectado | Impressão de etiquetas falha silenciosamente | Imprimir manualmente; operação continua |
| **Scanner WS** | WS desconectado | Scanner USB perde integração. Câmera como fallback (conferência) | Usar câmera do dispositivo |
| **Sessão expirada** | Usuário deslogado | Operador perde contexto atual | Session restore via banco (lock ativo) |
| **Empresa configurada errada** | pickup_point errado em company-config | Pedidos balcão ficam invisíveis ou pedidos errados aparecem no balcão | Corrigir company-config.ts + redeploy |
| **Lock com TTL infinito** | lock_expires_at não zerado no unlock | WU bloqueada para sempre | Supervisor faz batch-unlock |
| **Modo de separação incorreto** | by_order vs by_section errado | Operadores veem WUs erradas | Supervisor muda modo via settings |

---

## 26. Pontos Sensíveis e Riscos Técnicos

### 26.1 Críticos — Risco Operacional Imediato

**A) `company-config.ts` hardcoded**
- Adicionar empresa 4+ requer edição de código e redeploy
- Erro na lista de pickup points = pedidos balcão invisíveis ou dados errados na fila
- **Risco:** Médio | **Impacto:** Alto

**B) Identificação balcão por pickup_point (não por type)**
- WUs balcão são `type="separacao"` no banco
- Confusão pode levar a filtros incorretos
- **Risco:** Médio | **Impacto:** Alto

**C) Campos de lock — zeragem não atômica**
- `lockedBy` e `lockExpiresAt` devem ser zerados sempre juntos
- Se `lockExpiresAt` ficar com valor antigo e `lockedBy` for zerado: comportamento imprevisível
- **Risco:** Baixo (código está correto) | **Impacto:** Alto se ocorrer

**D) Timestamps como `text`**
- Comparações de datas dependem de strings ISO válidas
- Índices não são usados para range queries em texto
- Ordenação pode ser incorreta se formato variar
- **Risco:** Baixo | **Impacto:** Médio

### 26.2 Estruturais — Risco de Manutenção

**E) `server/routes.ts` com 4500 linhas**
- Arquivo monolítico dificulta manutenção e revisão de código
- Alta chance de efeitos colaterais em mudanças
- **Risco:** Alto para manutenção | **Impacto:** Progressivo

**F) `sync_db2.py` com 2200 linhas de Python fora do ORM**
- Lógica crítica de negócio em arquivo Python sem testes
- Mudanças no schema do DB2 exigem manutenção manual aqui
- Sem versionamento de mapeamentos além do `db2_mappings`
- **Risco:** Alto | **Impacto:** Alto

**G) Migrations informais (`runSafeMigrations()`)**
- Sem versionamento formal (Drizzle migrations ou Flyway)
- Impossível rastrear histórico de alterações no schema
- Rollback de schema não é possível
- **Risco:** Médio | **Impacto:** Alto em caso de incidente

**H) `audit_logs` sem rotação**
- Tabela cresce indefinidamente
- Sem particionamento por data
- **Risco:** Baixo no curto prazo | **Impacto:** Performance no longo prazo

**I) Cache de separationMode em memória (30s)**
- Em multiprocesso/cluster, caches ficam dessincronizados
- Atualmente sem problema (processo único), mas não escala
- **Risco:** Baixo | **Impacto:** Médio em escala horizontal

**J) sessionStorage para session restore**
- Trocar de browser, abrir anônimo ou limpar dados = perde estado
- Fallback existe (lock ativo no banco) mas sem `orderIds` em sessões antigas
- **Risco:** Baixo | **Impacto:** Baixo (operador reinicia WU)

---

## 27. Melhorias Futuras Recomendadas

> Listadas por prioridade e impacto. Nenhuma altera o comportamento atual.

### Alta Prioridade

1. **Migrar company-config para banco de dados**
   - Tabela `company_configs` com configuração de pickup points por empresa
   - Elimina necessidade de redeploy para adicionar empresa

2. **Formalizar migrations com Drizzle Kit**
   - Substituir `runSafeMigrations()` por `drizzle-kit generate` + `migrate`
   - Histórico rastreável de alterações de schema

3. **Quebrar `server/routes.ts` em módulos**
   - `auth-routes.ts`, `order-routes.ts`, `work-unit-routes.ts`, etc.
   - Reduz risco de efeito colateral e facilita code review

4. **Ampliar cobertura de testes para >60%**
   - Ciclo completo de pedido (prioridade máxima)
   - Isolamento multi-empresa no SSE
   - Lock TTL e session restore

5. **Adicionar rotação do audit_logs**
   - Particionamento por mês ou DELETE de logs com mais de 6 meses
   - Índice em `created_at` para queries de KPI

### Média Prioridade

6. **Timestamps como TIMESTAMPTZ nativo**
   - Migrar de `text` para tipo nativo do PostgreSQL
   - Melhora performance de queries de range e ordenação

7. **Testes unitários para `storage.ts`**
   - Especialmente operações atômicas e `checkAndCompleteWorkUnit`

8. **Documentar `sync_db2.py` com docstrings e tipos**
   - Arquivo crítico sem documentação interna

9. **Dashboard de monitoramento operacional**
   - WUs com lock expirado, pedidos presos, exceptions não autorizadas
   - Alertas proativos para supervisores

10. **Suporte a múltiplos bancos DB2**
    - Hoje: CISSERP fixo. Multi-ERP exigiria refatoração do script

### Baixa Prioridade

11. **Cache de SSE com Redis**
    - Para escala horizontal (múltiplos processos)
    - Hoje funciona bem com processo único

12. **Logging estruturado (JSON)**
    - Facilita integração com ferramentas de log (Datadog, Splunk)

13. **Health check endpoint**
    - `GET /health` com status de DB, último sync, conexões SSE ativas

---

## 28. Resumo Executivo Final

### O que é

**Stoker WMS** é o sistema operacional de armazém de uma distribuidora. Controla em tempo real todo o ciclo de pedidos: desde a entrada via ERP (IBM DB2) até a entrega ou retirada pelo cliente.

### Os 3 fluxos que mais importam

1. **Separação:** Operadores recebem work units, bloqueiam, separam produtos e concluem. Sistema avança automaticamente para conferência.
2. **Conferência:** Conferentes validam por barcode tudo que foi separado. Pedido vai para finalizado.
3. **Sync DB2:** A cada 10 minutos, novos pedidos entram no sistema automaticamente via script Python.

### Os 5 arquivos mais críticos

1. `server/routes.ts` — toda a API e lógica de negócio
2. `server/storage.ts` — toda a persistência e operações atômicas
3. `shared/schema.ts` — tipos que conectam frontend e backend
4. `sync_db2.py` — única fonte de dados do ERP
5. `server/company-config.ts` — identifica pedidos balcão por empresa

### Os 5 pontos mais críticos do sistema hoje

1. **Isolamento multi-empresa:** SSE, queries e exceções são filtrados por `company_id`. Erro aqui vaza dados entre empresas.
2. **Sistema de lock:** `lockedBy`, `lockExpiresAt` devem ser zerados juntos. `lockedAt` é intenccionalmente preservado.
3. **Identificação balcão:** Feita por `pickup_point`, nunca por `type`. WUs balcão têm `type="separacao"` no banco.
4. **Sync DB2:** Sem conectividade à rede 192.168.1.200, novos pedidos não chegam. Sistema existente continua operando.
5. **Cobertura de testes ~15%:** Fluxos críticos como ciclo completo, scan atômico e isolamento SSE não têm testes automatizados.

### Estabilidade atual

O sistema é funcional, auditado e operacional. As principais fragilidades são de manutenabilidade (arquivos grandes, migrations informais, testes insuficientes), não de corretude operacional. Para produção estável, priorizar: company-config para banco, migrations formais e cobertura de testes do ciclo principal.

---

*Documentação V2 gerada em Abril 2025. Baseada integralmente na leitura do código-fonte.*  
*Arquivos complementares: `ERD_ESTRUTURA_BANCO.md`, `MATRIZ_DE_PERMISSOES.md`, `RUNBOOK_OPERACIONAL.md`, `CHECKLIST_DE_PRODUCAO.md`, `MAPA_DE_TESTES.md`, `FLUXOS_CRITICOS.md`*
