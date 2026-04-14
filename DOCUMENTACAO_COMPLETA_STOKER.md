# DOCUMENTAÇÃO COMPLETA — STOKER WMS
> Versão do documento: Abril 2025 | Baseado em leitura completa do código-fonte

---

## ÍNDICE

1. [Visão Geral](#1-visão-geral)
2. [Perfis de Usuário](#2-perfis-de-usuário)
3. [Mapa Funcional do Sistema](#3-mapa-funcional-do-sistema)
4. [Fluxo Geral de Navegação](#4-fluxo-geral-de-navegação)
5. [Estrutura Técnica do Projeto](#5-estrutura-técnica-do-projeto)
6. [Estrutura de Pastas](#6-estrutura-de-pastas)
7. [Frontend](#7-frontend)
8. [Backend](#8-backend)
9. [Banco de Dados](#9-banco-de-dados)
10. [APIs e Rotas](#10-apis-e-rotas)
11. [Regras de Negócio](#11-regras-de-negócio)
12. [Fluxos Críticos](#12-fluxos-críticos)
13. [Dashboards, Relatórios e Indicadores](#13-dashboards-relatórios-e-indicadores)
14. [Permissões e Segurança](#14-permissões-e-segurança)
15. [Tempo Real — SSE e WebSocket](#15-tempo-real--sse-e-websocket)
16. [Integrações Externas](#16-integrações-externas)
17. [Variáveis de Ambiente e Configurações](#17-variáveis-de-ambiente-e-configurações)
18. [Dependências Principais](#18-dependências-principais)
19. [Pontos Sensíveis e Observações Importantes](#19-pontos-sensíveis-e-observações-importantes)
20. [Resumo Executivo Final](#20-resumo-executivo-final)

---

## 1. Visão Geral

### O que é o Stoker

**Stoker** é um **WMS (Warehouse Management System)** — sistema de gerenciamento de armazém — desenvolvido em Node.js + React + PostgreSQL. O nome completo é "Stoker WMS" e ele resolve o problema de controle operacional de separação de pedidos, conferência e atendimento balcão em depósitos/armazéns multi-empresa.

### Qual problema resolve

Antes do Stoker, o processo de separação de pedidos era manual ou gerenciado por planilhas. O sistema substitui esse processo oferecendo:

- Controle em tempo real de quais operadores estão trabalhando em quais pedidos
- Rastreamento passo a passo da separação de produtos por seção/corredor
- Conferência digital com leitura de código de barras
- Fila de atendimento ao balcão (walk-in pickup)
- Indicadores de performance (KPI) por operador
- Gestão de exceções (produtos avariados, não encontrados, vencidos)
- Sincronização automática com o ERP legado (sistema DB2/IBM)

### Quem usa

O sistema é usado por distribuidoras/atacadistas com operações de armazém. Há suporte a **múltiplas empresas** (multi-tenant) isoladas por `company_id`. As empresas configuradas são: **Empresa 1** e **Empresa 3**.

### Módulos principais

| Módulo | Perfil principal | Função |
|---|---|---|
| Separação Desktop | separacao | Separar produtos por seção em pedidos lançados |
| Separação Handheld | separacao | Idem, via leitor de código de barras portátil |
| Conferência | conferencia | Conferir produtos já separados via barcode |
| Balcão | balcao | Separar pedidos de retirada presencial |
| Fila de Pedidos | fila_pedidos | Painel de acompanhamento em tempo real |
| Supervisor | supervisor | Gestão de pedidos, rotas, usuários, relatórios |
| Administrador | administrador | Configurações globais, permissões, KPI, limpeza |
| WMS | recebedor/empilhador | Gestão de endereços, pallets, recebimento de NFs |

---

## 2. Perfis de Usuário

O sistema possui **9 perfis** definidos no enum `userRoleEnum` em `shared/schema.ts`.

### 2.1 `administrador`
- Acesso total ao sistema
- Único que pode criar/editar outros administradores
- Acessa: KPI de operadores, limpeza de dados, permissões globais, agentes de impressão
- Pode forçar mudança de modo de separação mesmo com operações ativas
- Rota principal: `/admin/kpi-operadores`, `/admin/permissoes`, `/admin/limpeza`, `/admin/print-agents`

### 2.2 `supervisor`
- Gerencia pedidos, rotas, usuários, exceções, relatórios
- Pode desbloquear work units de outros operadores
- Pode lançar pedidos para separação
- Pode mudar modo de separação (por seção ou por pedido/rota)
- Rotas: `/supervisor/*`

### 2.3 `separacao`
- Opera a separação de produtos por seção
- Acessa apenas as **seções atribuídas** a ele (campo `sections` do usuário)
- Em modo `by_section`, recebe um pedido inteiro; em modo `by_order`, trabalha por seção
- Pode usar versão desktop (`/separacao`) ou handheld (`/handheld/picking`)
- Não pode acessar pedidos de outras seções ou outras empresas

### 2.4 `conferencia`
- Opera a conferência dos produtos já separados
- Acesso automático a todas as seções
- Usa leitura de código de barras (câmera ou scanner USB) para conferir itens
- Rota: `/conferencia`

### 2.5 `balcao`
- Atende pedidos de retirada presencial (walk-in)
- Trabalha com pedidos cujo `pickupPoint` é um dos pontos balcão da empresa
- Rota: `/balcao`

### 2.6 `fila_pedidos`
- Apenas visualização — painel de acompanhamento em tempo real
- Vê o status dos pedidos, operadores atuando, timers ao vivo
- Não executa ações operacionais
- Rota: `/fila-pedidos`

### 2.7 `recebedor`
- Módulo WMS: recebimento de notas fiscais, check-in de pallets
- Rotas: `/wms/recebimento`, `/wms/checkin`, `/wms/adicao`, `/wms/produtos`

### 2.8 `empilhador`
- Módulo WMS: movimentação física de pallets (transferência, retirada, adição)
- Rotas: `/wms/checkin`, `/wms/transferencia`, `/wms/retirada`, `/wms/adicao`, `/wms/produtos`

### 2.9 `conferente_wms`
- Módulo WMS: contagem cíclica de estoque por endereço/produto/pallet
- Rotas: `/wms/contagem`, `/wms/produtos`

---

## 3. Mapa Funcional do Sistema

### 3.1 Módulo de Separação (`/separacao`)

**O que faz:** Permite que operadores separem produtos de pedidos lançados pelo supervisor, seção por seção (modo padrão `by_order`) ou pedido inteiro por rota (`by_section`).

**Como funciona:**
1. O operador vê uma fila de work units (`pendente`) correspondentes às suas seções
2. Ele bloqueia (lock) um ou mais work units com TTL de 60 minutos
3. Para cada produto da WU, digita ou escaneia a quantidade separada
4. O sistema valida: quantidade separada, exceções (não encontrado, avariado, vencido)
5. Ao concluir todos os produtos, a WU é marcada `concluido`
6. Quando todas as WUs de separação de um pedido são concluídas, o pedido passa para `separado` e o sistema cria automaticamente uma WU de conferência

**Arquivos principais:**
- `client/src/pages/separacao/index.tsx`
- `server/routes.ts` — endpoints `/api/work-units/*`
- `server/storage.ts` — `getWorkUnits()`, `lockWorkUnits()`, `checkAndCompleteWorkUnit()`

**Tabelas envolvidas:** `work_units`, `order_items`, `orders`, `exceptions`

**Regras importantes:**
- Um operador pode ter lock em múltiplas WUs simultaneamente (desde que sejam do mesmo pedido)
- Session restore: ao recarregar a página, o sistema restaura o estado se o lock ainda for válido
- Cross-order protection: impede restaurar WUs de pedidos diferentes

### 3.2 Módulo de Conferência (`/conferencia`)

**O que faz:** Operadores conferem os produtos já separados escaneando os códigos de barras, validando quantidade e registrando exceções.

**Como funciona:**
1. Pedidos em status `separado` têm WUs de conferência `pendente`
2. O conferente bloqueia uma ou mais WUs
3. Para cada produto, escaneia o barcode — o sistema valida contra `orderItems.checkedQty`
4. Suporte a códigos de caixa (múltiplas unidades por scan) via `boxBarcodes`
5. Itens com problema viram exceção
6. Ao concluir, o pedido passa para `conferido` → `finalizado`

**Arquivos principais:**
- `client/src/pages/conferencia/index.tsx`
- `server/routes.ts` — endpoints `/api/work-units/scan-checked`

**Tabelas envolvidas:** `work_units`, `order_items`, `exceptions`, `orders`

**Regras:**
- Mesma proteção de lock e session restore da separação
- `orderIds` salvo na sessão local para impedir mistura de pedidos ao restaurar

### 3.3 Módulo Balcão (`/balcao`)

**O que faz:** Atende pedidos de retirada presencial (clientes que vêm buscar na loja). Combina separação + conferência em um único fluxo simplificado.

**Como funciona:**
1. Fila balcão lista pedidos cujo `pickupPoints` inclui um ponto balcão da empresa
2. O operador seleciona o pedido e inicia o atendimento
3. Separa e confere os produtos no mesmo ato
4. Ao concluir, o pedido é finalizado

**Identificação balcão:**
- WUs balcão são armazenadas com `type="separacao"` no banco (não há `type="balcao"`)
- A identificação balcão é feita **exclusivamente** pelo `pickupPoint` da order
- Empresa 1: pontos balcão = `[1, 2]` | Empresa 3: pontos balcão = `[52, 54]`

**Arquivos principais:**
- `client/src/pages/balcao/index.tsx`
- `server/routes.ts` — `/api/queue/balcao`
- `server/company-config.ts`

**Tabelas:** `work_units`, `orders`, `order_items`

### 3.4 Módulo Fila de Pedidos (`/fila-pedidos`)

**O que faz:** Painel de exibição em tempo real do status de todos os pedidos. Pensado para ser exibido em televisões no armazém.

**Como funciona:**
- Consulta a fila de pedidos da empresa a cada 30 segundos (polling)
- SSE para atualizações em tempo real
- Cada card mostra: número do pedido, cliente, status, operador, timer ao vivo, status financeiro
- **Regra de visibilidade (100% client-side):**
  - Pedidos `finalizado` são ocultados após 5 minutos
  - Pedidos com mais de 2 dias são ocultados (para não poluir a tela)
- Som de alerta (beep) quando um novo pedido entra na fila (configurável)

**Arquivos:** `client/src/pages/fila-pedidos/index.tsx`

### 3.5 Módulo Supervisor (`/supervisor/*`)

**O que faz:** Gerenciamento operacional completo.

**Subpáginas:**
| Rota | Função |
|---|---|
| `/supervisor/orders` | Listar, lançar, cancelar pedidos; atribuir rotas e prioridade |
| `/supervisor/exceptions` | Ver e autorizar exceções registradas pelos operadores |
| `/supervisor/audit` | Log de auditoria de todas as ações |
| `/supervisor/users` | Criar, editar, ativar/desativar usuários |
| `/supervisor/routes` | Gerenciar rotas de entrega |
| `/supervisor/route-orders` | Atribuir pedidos a rotas em lote |
| `/supervisor/reports` | Hub de relatórios |
| `/supervisor/separation-settings` | Mudar modo de separação |
| `/supervisor/print-settings` | Configurações de impressoras por seção |
| `/supervisor/codigos-barras` | Gestão de regras de código de barras |
| `/supervisor/mapping-studio` | Editor de mapeamento DB2 → PostgreSQL |

### 3.6 Módulo Admin (`/admin/*`)

| Rota | Função |
|---|---|
| `/admin/kpi-operadores` | Dashboard de KPIs por operador com período customizável |
| `/admin/permissoes` | Gerenciar permissões de módulos/relatórios por usuário |
| `/admin/limpeza` | Ferramentas de limpeza de dados (orders, WUs, logs) |
| `/admin/print-agents` | Gerenciar agentes de impressão conectados via WebSocket |

### 3.7 Módulo WMS (`/wms/*`)

Gestão do armazém físico:

| Rota | Quem acessa | Função |
|---|---|---|
| `/wms/enderecos` | supervisor/admin | Criar e gerenciar endereços físicos do armazém |
| `/wms/recebimento` | recebedor | Receber notas fiscais e criar pallets |
| `/wms/checkin` | empilhador/recebedor | Confirmar entrada física de pallets |
| `/wms/transferencia` | empilhador | Mover pallet de um endereço para outro |
| `/wms/retirada` | empilhador | Retirar pallet de um endereço |
| `/wms/adicao` | empilhador/recebedor | Adicionar itens a um pallet existente |
| `/wms/contagem` | conferente_wms | Contagem cíclica de estoque por endereço/produto/pallet |
| `/wms/produtos` | todos WMS | Consultar produtos, estoque, endereços |
| `/wms/codigos-barras` | todos | Consultar e gerenciar barcodes de produtos |

---

## 4. Fluxo Geral de Navegação

### 4.1 Fluxo de Login

```
1. Usuário acessa /login → POST /api/auth/login
2. Backend valida credenciais (bcrypt), verifica se user.active = true
3. Se usuário tem allowedCompanies com múltiplas empresas → redireciona para /select-company
4. Se só 1 empresa → seleciona automaticamente
5. Token JWT-like (UUID) salvo como cookie httpOnly + enviado no header Authorization
6. TTL da sessão: 12 horas
7. Limpeza automática de sessões expiradas a cada 1 hora (server-side)
```

### 4.2 Fluxo de Pedido — Ciclo Completo

```
ERP/DB2 → sync_db2.py → cache_orcamentos → 
[batch-sync] → orders + order_items + products →
pendente → [supervisor lança] → em_separacao →
[operadores separam WUs] → separado →
[conferente confere WUs] → conferido →
finalizado
```

### 4.3 Fluxo de Separação Detalhado

```
1. Supervisor lança pedido → POST /api/orders/launch
   - Pedido: status "em_separacao", is_launched = true, launched_at = now
   - Sistema cria work_units (1 por seção que tem itens no pedido)
   
2. Operador vê WU pendente → GET /api/work-units
   - Filtrado por company, sections do usuário (modo by_order)
   
3. Operador bloqueia WU → POST /api/work-units/lock
   - lock_expires_at = now + 60 min
   - locked_by = user.id
   - WU status: "em_andamento"
   
4. Operador separa produto → POST /api/work-units/:id/items/:itemId/scan-separated
   - Atualiza separated_qty via atomic increment
   - Se separated_qty >= quantity → item status "separado"
   
5. (Opcional) Exceção → POST /api/exceptions
   - type: "nao_encontrado" | "avariado" | "vencido"
   - Necessita autorização do supervisor
   
6. Operador finaliza WU → POST /api/work-units/:id/complete
   - WU status: "concluido"
   - Sistema verifica se TODAS as WUs do pedido estão concluídas
   - Se sim: order status → "separado" + cria WU de conferência
   
7. Conferente bloqueia WU de conferência → mesmo fluxo de lock
   
8. Conferente confere itens → POST /api/work-units/:id/items/:itemId/scan-checked
   
9. Conferente finaliza → order status → "conferido" → "finalizado"
```

---

## 5. Estrutura Técnica do Projeto

### Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js (tsx para TypeScript) |
| Framework Backend | Express.js |
| ORM | Drizzle ORM |
| Banco de dados | PostgreSQL |
| Framework Frontend | React 18 |
| Build Frontend | Vite |
| Roteamento Frontend | wouter |
| Estado servidor | TanStack Query v5 |
| UI Components | shadcn/ui (Radix UI) |
| Styling | Tailwind CSS |
| Formulários | react-hook-form + zod |
| Gráficos | Recharts |
| Tempo real | Server-Sent Events (SSE) + WebSocket |
| Autenticação | Token Bearer + cookie httpOnly |
| Integração ERP | Python (pyodbc + psycopg2) |
| Impressão | WebSocket Agent (print-agent) |

### Modo de desenvolvimento

- `npm run dev` → inicia Express (backend) + Vite (frontend) na mesma porta 5000
- Vite serve o frontend em modo proxy reverso — tudo na mesma origem
- `tsx server/index.ts` = ponto de entrada do backend

---

## 6. Estrutura de Pastas

```
/
├── client/                    # Frontend React
│   └── src/
│       ├── App.tsx            # Router principal, ProtectedRoute, PublicRoute
│       ├── pages/             # Páginas organizadas por módulo
│       │   ├── login.tsx
│       │   ├── home.tsx       # Hub de navegação pós-login
│       │   ├── company-select.tsx
│       │   ├── separacao/     # Módulo de separação desktop
│       │   ├── conferencia/   # Módulo de conferência
│       │   ├── balcao/        # Módulo balcão
│       │   ├── fila-pedidos/  # Painel de fila
│       │   ├── handheld/      # Separação via coletor de dados
│       │   ├── supervisor/    # Gestão operacional
│       │   ├── admin/         # Configurações e KPIs
│       │   ├── wms/           # Módulo WMS
│       │   └── print/         # Páginas de impressão (label)
│       ├── components/        # Componentes reutilizáveis
│       │   └── ui/            # shadcn/ui components
│       ├── hooks/             # Custom hooks (use-sse, use-toast, use-scanning)
│       └── lib/               # Utilitários (auth, queryClient, theme, audio)
│
├── server/                    # Backend Express
│   ├── index.ts               # Entry point: Helmet, rate-limit, middlewares
│   ├── routes.ts              # Todas as rotas da API (~4500 linhas)
│   ├── storage.ts             # Camada de acesso ao banco (~2500 linhas)
│   ├── auth.ts                # Autenticação: token, session, bcrypt
│   ├── sse.ts                 # Server-Sent Events: broadcast, heartbeat
│   ├── company-config.ts      # Configuração de pontos de retirada por empresa
│   ├── data-contracts.ts      # Contratos de dados para mapeamento DB2
│   ├── wms-routes.ts          # Rotas específicas do módulo WMS
│   ├── print-routes.ts        # Rotas de impressão de etiquetas
│   ├── print-agent.ts         # WebSocket server para agentes de impressão
│   ├── ws-scanning.ts         # WebSocket server para scanners USB
│   ├── db.ts                  # Configuração Drizzle + PostgreSQL
│   ├── seed.ts                # Seed inicial do banco (usuários, seções, etc.)
│   └── log.ts                 # Utilitário de log
│
├── shared/
│   └── schema.ts              # Tipos, enums, tabelas Drizzle, schemas Zod
│
├── sync_db2.py                # Sincronizador DB2 → PostgreSQL (Python)
├── docs/                      # Documentação existente (parcial)
├── tests/                     # Testes de API (Vitest)
├── print-agent/               # Código do agente de impressão local (cliente)
└── scripts/                   # Scripts utilitários
```

---

## 7. Frontend

### 7.1 Organização

O frontend é uma **SPA (Single Page Application)** React servida pelo Vite. O roteamento é feito pelo `wouter` — biblioteca leve de roteamento.

### 7.2 Autenticação no Frontend

**Arquivo:** `client/src/lib/auth.tsx`

- `AuthProvider`: contexto global com `user`, `companyId`, `allowedCompanies`, `status`
- `useAuth()`: hook para consumir o contexto
- Na inicialização, faz GET `/api/auth/me` para restaurar a sessão
- `ProtectedRoute`: redireciona para `/login` se não autenticado; para `/select-company` se multi-empresa sem seleção

### 7.3 Queries e Mutações

- Todas as queries usam **TanStack Query v5** com `queryKey` baseado na empresa (`useSessionQueryKey`)
- `queryClient` configurado em `client/src/lib/queryClient.ts` com fetcher padrão que inclui o token no header
- Mutações usam `apiRequest()` — wrapper que inclui token + faz JSON parsing

### 7.4 Tempo Real no Frontend

- Hook `useSSE` (`client/src/hooks/use-sse.ts`): abre `EventSource` para `/api/sse`
- Escuta eventos: `work_unit_updated`, `order_updated`, `sync_finished`, `picking_update`, etc.
- Ao receber evento, invalida queries relevantes via `queryClient.invalidateQueries`
- Polling de fallback: algumas páginas também fazem refetch a cada 30 segundos

### 7.5 Session Restore (Separação, Conferência, Balcão)

Cada módulo operacional persiste seu estado no `sessionStorage` do browser:
```typescript
interface SessionData {
  workUnitIds: string[];   // IDs das WUs bloqueadas
  orderIds?: string[];     // IDs dos pedidos (proteção cross-order)
  tab?: string;            // aba ativa (conferência)
  productIndex?: number;   // produto atual (conferência)
}
```

Ao recarregar, o sistema valida:
1. `lockedBy === user.id` — pertence ao operador atual
2. `lockExpiresAt > now` — lock não expirou
3. `orderId ∈ saved.orderIds` — pertence ao mesmo pedido (prevenção de mistura)

### 7.6 Páginas Principais

| Página | Arquivo | Função |
|---|---|---|
| Home | `pages/home.tsx` | Hub com cards de módulos disponíveis por perfil |
| Separação | `pages/separacao/index.tsx` | Interface de separação desktop |
| Conferência | `pages/conferencia/index.tsx` | Interface de conferência com barcode |
| Balcão | `pages/balcao/index.tsx` | Interface de atendimento balcão |
| Fila Pedidos | `pages/fila-pedidos/index.tsx` | Painel de TV, cards em tempo real |
| Handheld | `pages/handheld/picking.tsx` | Interface touch para coletor |
| Orders | `pages/supervisor/orders.tsx` | Gestão de pedidos |
| KPI | `pages/admin/kpi-dashboard.tsx` | Dashboard de performance operadores |

---

## 8. Backend

### 8.1 Ponto de Entrada (`server/index.ts`)

- Configura **Helmet** (CSP, XSS protection, etc.)
- **Rate limiting**: 
  - Login: 20 tentativas por 15 minutos
  - API geral: 200 req/min
  - SQL query: 30 req/min
- Registra middlewares de logging (apenas erros 500+ e mutações críticas)
- Executa `runSafeMigrations()` — adiciona colunas novas sem quebrar dados existentes
- Inicia seed do banco se necessário
- Sobe WebSocket servers: `print-agent` e `scanning`
- Registra rotas via `registerRoutes()`

### 8.2 Rotas (`server/routes.ts`)

Arquivo central com ~4500 linhas contendo todas as rotas HTTP da aplicação. Organizado em seções:

- Auth routes
- User management routes
- Company routes
- Order routes (incluindo lançamento, batch-sync, force-status)
- Work Unit routes (lock, unlock, scan, complete, batch-unlock)
- Exception routes
- Section routes + Section Groups
- Route (delivery) routes
- Product routes
- Sync routes (DB2)
- KPI routes
- Manual Qty Rules
- System Settings
- Balcão queue
- Handheld picking

### 8.3 Storage (`server/storage.ts`)

Camada de acesso ao banco com ~2500 linhas. Implementa a interface `IStorage` com todos os métodos CRUD. Usa Drizzle ORM com queries compostas (joins, transações atômicas).

**Métodos críticos:**
- `lockWorkUnits()` — adquire lock com TTL de 60 min
- `checkAndCompleteWorkUnit()` — verifica se WU está completa e avança status
- `checkAndUpdateOrderStatus()` — verifica se todos WUs do pedido estão concluídos
- `atomicIncrementSeparatedQty()` / `atomicIncrementCheckedQty()` — incremento atômico para evitar race conditions
- `atomicScanSeparatedQty()` — usado no handheld, inclui deduplicação por `msgId`
- `finalizeWorkUnitsWithDeductions()` — finaliza WUs e aplica deduções de estoque

### 8.4 Funções de Autorização

Helpers inline em `routes.ts`:

```typescript
authorizeWorkUnit(wu, req, mode)  // Valida empresa + seções do operador
assertLockOwnership(wu, req)       // Valida que o lock pertence ao usuário
authorizeOrder(order, req)         // Valida empresa do pedido
```

### 8.5 Cache de Modo de Separação

```typescript
let _sepModeCache: { mode: string; expiry: number } | null = null;
```
- TTL: 30 segundos
- Invalidado em `PATCH /api/system-settings/separation-mode`
- Fallback: `"by_order"` em caso de erro

### 8.6 Jobs e Timers

| Job | Intervalo | Função |
|---|---|---|
| Sync DB2 | 10 minutos | `runSync()` via spawn de `sync_db2.py` |
| Sync inicial | 5s após start | Primeira sincronização ao subir o servidor |
| Limpeza sessões | 1 hora | `storage.deleteExpiredSessions()` |

---

## 9. Banco de Dados

**SGBD:** PostgreSQL. ORM: Drizzle. Timestamps armazenados como `text` em formato ISO 8601.

### 9.1 Tabelas do Núcleo Operacional

#### `companies`
| Campo | Tipo | Descrição |
|---|---|---|
| id | integer PK | ID da empresa |
| name | text | Nome da empresa |
| cnpj | text | CNPJ |

#### `users`
| Campo | Tipo | Descrição |
|---|---|---|
| id | text UUID PK | ID do usuário |
| username | text | Login |
| password | text | Hash bcrypt |
| name | text | Nome de exibição |
| role | text | Perfil (enum 9 valores) |
| sections | jsonb | Array de IDs de seções permitidas |
| settings | jsonb | Configurações individuais (allowMultiplier, printConfig) |
| active | boolean | Se pode logar |
| badgeCode | text | Código de crachá (hex 32 chars) |
| defaultCompanyId | integer | Empresa padrão |
| allowedCompanies | jsonb | Empresas que pode acessar |
| allowedModules | jsonb | Módulos liberados (controle granular) |
| allowedReports | jsonb | Relatórios liberados |

#### `orders`
| Campo | Tipo | Descrição |
|---|---|---|
| id | text UUID PK | ID interno |
| erpOrderId | text UNIQUE | ID do ERP (orçamento no DB2) |
| customerName | text | Nome do cliente |
| customerCode | text | Código do cliente no ERP |
| totalValue | double | Valor total do pedido |
| status | text | pendente → em_separacao → separado → em_conferencia → conferido → finalizado / cancelado |
| priority | integer | Prioridade (0 = normal) |
| isLaunched | boolean | Se foi lançado para separação |
| launchedAt | text | Timestamp do lançamento |
| separatedAt | text | Timestamp da separação completa |
| loadCode | text | Código de carga/romaneio |
| routeId | text FK routes | Rota de entrega |
| separationCode | text | Código de separação |
| pickupPoints | jsonb | Array de IDs de pontos de retirada |
| financialStatus | text | Status financeiro (do ERP) |
| companyId | integer | Empresa |

#### `order_items`
| Campo | Tipo | Descrição |
|---|---|---|
| id | text UUID PK | |
| orderId | text FK orders | |
| productId | text FK products | |
| quantity | double | Quantidade solicitada |
| separatedQty | double | Quantidade separada (incremento atômico) |
| checkedQty | double | Quantidade conferida (incremento atômico) |
| section | text | Seção do produto |
| pickupPoint | integer | Ponto de retirada |
| qtyPicked | double | Qtd picked (handheld) |
| status | text | pendente → separado → conferido → excecao → recontagem |
| exceptionType | text | Tipo de exceção |

#### `work_units` (WU)
| Campo | Tipo | Descrição |
|---|---|---|
| id | text UUID PK | |
| orderId | text FK orders | Pedido ao qual pertence |
| pickupPoint | integer | Ponto de retirada |
| section | text | Seção (modo by_order) |
| type | text | "separacao" ou "conferencia" — **balcão sempre usa "separacao"** |
| status | text | pendente → em_andamento → concluido → recontagem → excecao |
| lockedBy | text FK users | Operador com lock ativo |
| lockedAt | text | Timestamp do lock (preservado após conclusão — usado em timer) |
| lockExpiresAt | text | Expiração do lock (now + 60 min) |
| cartQrCode | text | QR code do carrinho associado |
| palletQrCode | text | QR code do pallet |
| startedAt | text | Início da operação |
| completedAt | text | Conclusão |
| companyId | integer | Empresa |

**CRÍTICO — Campos de lock são sempre zerados juntos:** `lockedBy = null`, `lockedAt` pode ser preservado, `lockExpiresAt = null`. Em qualquer reset/unlock.

#### `exceptions`
| Campo | Tipo | Descrição |
|---|---|---|
| id | text UUID PK | |
| workUnitId | text FK work_units | |
| orderItemId | text FK order_items | |
| type | text | nao_encontrado / avariado / vencido |
| quantity | double | Quantidade com problema |
| observation | text | Observação livre |
| reportedBy | text FK users | Quem registrou |
| authorizedBy | text FK users | Supervisor que autorizou |
| authorizedByName | text | Nome do autorizador |
| authorizedAt | text | Timestamp da autorização |

### 9.2 Tabelas de Controle

#### `sessions`
- Sessões de autenticação com token UUID
- TTL via campo `expiresAt`
- `companyId` para contexto da sessão

#### `picking_sessions`
- Lock exclusivo para separação via handheld
- TTL via `lastHeartbeat` (2 minutos de inatividade = lock liberado)
- Diferente das WUs: é para o handheld que usa o sistema legado de lock por seção

#### `audit_logs`
- Registro de todas as ações relevantes do sistema
- Campos: `action`, `entityType`, `entityId`, `details`, `previousValue`, `newValue`, `ipAddress`, `userAgent`

#### `sessions` (auth)
- `token` indexado para lookup rápido

### 9.3 Tabelas de Cadastro

#### `products`
- `erpCode` — código único do produto no ERP
- `barcode` — código de barras unitário
- `boxBarcode` — código de barras da caixa
- `boxBarcodes` — jsonb com array de `{code, qty}` para múltiplas embalagens
- `section` — seção onde o produto fica
- `pickupPoint` — ponto de retirada

#### `sections`
- Seções do armazém (corredores/departamentos). Ex: "PERECÍVEIS", "LIMPEZA"

#### `routes` (delivery)
- Rotas de entrega. Cada pedido pode ter uma rota atribuída

#### `pickupPoints`
- Pontos de retirada físicos (balcão, expedição, etc.)

#### `sectionGroups`
- Agrupamentos de seções para atribuição em lote a operadores

### 9.4 Tabelas WMS

#### `wmsAddresses`
- Endereços físicos do armazém: bairro/rua/bloco/nível/código
- Tipos: `standard`, `picking`, `recebimento`, `expedicao`

#### `pallets`
- Pallets físicos com status: `sem_endereco`, `alocado`, `em_transferencia`, `cancelado`

#### `palletItems`
- Itens em cada pallet: produto, quantidade, lote, validade

#### `palletMovements`
- Histórico de movimentações de pallets

#### `nfCache`
- Cache de notas fiscais do ERP para processamento de recebimento

#### `countingCycles` / `countingCycleItems`
- Contagem cíclica de estoque

### 9.5 Tabelas de Integração

#### `cacheOrcamentos`
- Cache bruto do DB2 com os orçamentos do ERP
- Colunas com nomes em maiúsculo (padrão DB2): `CHAVE`, `IDEMPRESA`, `IDORCAMENTO`, etc.
- Chave única = `CHAVE` (combina empresa + orçamento + produto + sequência)

#### `db2Mappings`
- Mapeamentos configuráveis de campos DB2 → campos internos
- Permite ajustar o schema de integração sem alterar código
- Usado pelo Mapping Studio no supervisor

#### `productCompanyStock`
- Estoque por produto × empresa
- Separação entre `stockQty`, `palletizedStock`, `pickingStock`

### 9.6 Tabelas Auxiliares

#### `manualQtyRules`
- Regras para forçar entrada manual de quantidade (sem barcode)
- Tipos de regra: `product_code`, `barcode`, `description_keyword`, `manufacturer`

#### `systemSettings`
- Tabela singleton (id = "global")
- `separationMode`: `by_order` ou `by_section`
- `quickLinkEnabled`: habilita/desabilita acesso rápido na home

#### `orderVolumes`
- Registro de volumes por pedido: sacola, caixa, saco, avulso

---

## 10. APIs e Rotas

### 10.1 Autenticação

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/api/auth/login` | Público | Login com username/password. Retorna token, user, companies |
| POST | `/api/auth/logout` | Token | Invalida sessão |
| GET | `/api/auth/me` | Token | Retorna user atual e companyId da sessão |
| POST | `/api/auth/select-company` | Token | Muda empresa ativa da sessão |
| POST | `/api/auth/badge-login` | Público | Login via código de crachá |

### 10.2 Usuários

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/users` | supervisor+ | Lista todos os usuários |
| POST | `/api/users` | supervisor+ | Cria usuário |
| PATCH | `/api/users/:id` | supervisor+ | Atualiza usuário |
| DELETE | `/api/users/:id` | supervisor+ | Desativa usuário |
| POST | `/api/users/:id/reset-badge` | supervisor+ | Rotaciona código de crachá |

### 10.3 Pedidos (Orders)

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/orders` | Token + company | Lista pedidos da empresa |
| GET | `/api/orders/:id` | Token | Detalhes do pedido com itens |
| POST | `/api/orders` | supervisor+ | Cria pedido manual |
| PATCH | `/api/orders/:id` | supervisor+ | Atualiza pedido |
| POST | `/api/orders/launch` | supervisor+ | Lança pedidos para separação (body: `{orderIds}`) |
| POST | `/api/orders/assign-route` | supervisor+ | Atribui rota a pedidos |
| POST | `/api/orders/set-priority` | supervisor+ | Define prioridade de pedidos |
| POST | `/api/orders/force-status` | supervisor+ | Força mudança de status |
| POST | `/api/orders/batch-sync` | supervisor+ | Sincroniza pedidos vindos do ERP (payload grande) |
| POST | `/api/orders/:id/relaunch` | supervisor+ | Relança pedido cancelado/conferido |

### 10.4 Work Units

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/work-units` | Token + company | Lista WUs da empresa (com filtro de tipo) |
| GET | `/api/work-units/:id` | Token | Detalhes da WU com itens |
| POST | `/api/work-units/lock` | Token | Bloqueia WUs (body: `{workUnitIds}`) |
| POST | `/api/work-units/unlock` | Token | Desbloqueia WUs |
| POST | `/api/work-units/batch-unlock` | supervisor+ | Desbloqueia lote de WUs |
| POST | `/api/work-units/:id/complete` | Token | Conclui WU |
| POST | `/api/work-units/:id/items/:itemId/scan-separated` | Token | Registra separação de item |
| POST | `/api/work-units/:id/items/:itemId/scan-checked` | Token | Registra conferência de item |
| POST | `/api/work-units/:id/renew-lock` | Token | Renova TTL do lock |
| PATCH | `/api/work-units/:id` | supervisor+ | Atualiza WU (ex: force status) |
| POST | `/api/work-units/:id/reset-conferencia` | supervisor+ | Reseta conferência de WU |

### 10.5 Exceções

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/exceptions` | supervisor+ | Lista exceções da empresa |
| POST | `/api/exceptions` | Token | Registra exceção |
| PATCH | `/api/exceptions/:id/authorize` | supervisor+ | Autoriza exceção |
| DELETE | `/api/exceptions/:id` | supervisor+ | Remove exceção (company-scoped) |

### 10.6 Balcão

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/queue/balcao` | Token + company | Fila de pedidos balcão da empresa |

### 10.7 Sincronização

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/api/sync` | supervisor+ | Dispara sync DB2 em background |
| GET | `/api/sync/status` | supervisor+ | Estado atual do sync |

### 10.8 Sistema

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/system-settings/separation-mode` | Token | Modo de separação atual |
| PATCH | `/api/system-settings/separation-mode` | supervisor+ | Muda modo |
| GET | `/api/system-settings/features` | Token | Feature flags (quickLinkEnabled) |
| PATCH | `/api/system-settings/features` | supervisor+ | Atualiza feature flags |
| GET | `/api/sections` | Token | Lista seções |
| GET | `/api/pickup-points` | Token | Lista pontos de retirada |
| GET | `/api/routes` | Token | Lista rotas de entrega |
| GET | `/api/sse` | Token | Conexão SSE (Server-Sent Events) |

### 10.9 KPI

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/kpi/operators` | supervisor+ | KPIs de operadores por período |
| GET | `/api/kpi/sections` | supervisor+ | KPIs por seção |

### 10.10 Handheld (Coletor)

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/api/lock` | Token + company | Lock de seção (picking session) |
| POST | `/api/unlock` | Token + company | Unlock de seção |
| POST | `/api/heartbeat` | Token + company | Mantém lock vivo |
| POST | `/api/picking/submit` | Token + company | Envia itens separados em lote |

---

## 11. Regras de Negócio

### 11.1 Sistema de Lock (Bloqueio de Work Units)

O sistema de lock impede que dois operadores trabalhem no mesmo work unit simultaneamente.

**Campos envolvidos:** `lockedBy`, `lockedAt`, `lockExpiresAt` em `work_units`

**Regras:**
- TTL: 60 minutos (`LOCK_TTL_MINUTES = 60`)
- Operador pode renovar o lock via `/api/work-units/:id/renew-lock`
- Supervisor/admin pode desbloquear qualquer WU
- Ao desbloquear, TODOS os três campos são zerados: `lockedBy = null`, `lockExpiresAt = null`
- `lockedAt` é PRESERVADO após conclusão (usado para exibir timer no painel)
- Se lock expirou → WU volta a ser visível para outros operadores
- Lock retorna 409 se já bloqueada por outro operador com lock válido

### 11.2 Modos de Separação

**Configurável em:** `system_settings.separationMode`

**`by_order` (Padrão — "Por Seção"):**
- Cada WU corresponde a uma seção do pedido
- Operador de separação só vê WUs das suas seções
- Um pedido tem N WUs (uma por seção com itens)

**`by_section` ("Por Pedido/Rota"):**
- Cada WU corresponde a um pedido inteiro
- Operador pega um pedido completo, não há restrição por seção
- Usado quando o operador percorre o armazém inteiro para um único pedido

**Troca de modo:**
- Retorna 409 se há separações em andamento (a menos que `force: true`)
- Com `force: true`: cancela todas as `picking_sessions` e reseta WUs ativas para `pendente`

### 11.3 Fluxo de Status do Pedido

```
pendente 
  → em_separacao (ao ser lançado pelo supervisor)
  → separado (quando TODAS as WUs de separação são concluídas)
  → em_conferencia (quando uma WU de conferência é bloqueada)
  → conferido (quando TODAS as WUs de conferência são concluídas)
  → finalizado (etapa final)
  → cancelado (qualquer ponto, por supervisor)
```

### 11.4 Balcão — Identificação

O tipo balcão **não é** determinado pelo campo `type` da WU. A identificação é feita pelo `pickupPoint`:

- **Empresa 1**: pontos balcão = `[1, 2]`
- **Empresa 3**: pontos balcão = `[52, 54]`

A configuração está em `server/company-config.ts`. O endpoint `/api/queue/balcao` filtra pedidos pela intersecção de `order.pickupPoints` com os pontos balcão da empresa.

### 11.5 Status da Fila Balcão

| Status calculado | Condição |
|---|---|
| `em_andamento` | WU tem `lockedBy` e `status != "concluido"` |
| `em_fila` | WU `pendente` ou sem WU |
| `concluido` | WU `status == "concluido"` |

Ordenação: `em_andamento → em_fila → aguardando → concluido`

### 11.6 Exceções

Tipos: `nao_encontrado`, `avariado`, `vencido`

**Fluxo:**
1. Operador registra exceção (POST `/api/exceptions`)
2. Exceção fica pendente de autorização
3. Supervisor vê lista e autoriza (PATCH `/api/exceptions/:id/authorize`)
4. Com exceção autorizada, o item pode ser marcado como concluído mesmo sem atingir a quantidade total

**Regra especial `canAuthorizeOwnExceptions`:** Se configurado em `user.settings`, o operador pode autorizar suas próprias exceções (útil para conferentes com autonomia).

### 11.7 Fila de Pedidos — Regras de Visibilidade

100% client-side, recalculado a cada 30 segundos:
- Pedidos `finalizado` completados há mais de **5 minutos** → ocultos
- Pedidos com mais de **2 dias** desde a criação → ocultos (independente do status)

### 11.8 Proteção Cross-Order (Session Restore)

Em todos os três módulos (separação, conferência, balcão):
- `SessionData.orderIds` registra quais pedidos estão associados ao estado salvo
- Ao restaurar: WUs de pedidos diferentes dos salvos são descartadas
- Impede que crash + restauração misture WUs de pedidos distintos

### 11.9 Isolamento Multi-Empresa

- Todas as queries filtram por `companyId` do usuário autenticado
- SSE: broadcasts são filtrados por `companyId` (cada empresa só recebe seus eventos)
- Users com `allowedCompanies: [1, 3]` podem alternar empresa via `POST /api/auth/select-company`
- A empresa ativa fica armazenada na sessão do banco

### 11.10 Códigos de Barras

- Produto tem: `barcode` (unitário), `boxBarcode` (caixa simples), `boxBarcodes` (array de embalagens com `{code, qty}`)
- Na conferência/separação, ao escanear: primeiro busca unitário, depois caixa, depois `boxBarcodes`
- `manualQtyRules`: regras que forçam entrada manual mesmo que o produto tenha barcode

### 11.11 Deduplicação no Handheld

Endpoint `atomicScanSeparatedQty` aceita `msgId` (UUID gerado no cliente). Se o mesmo `msgId` for enviado duas vezes (retry de rede), o segundo é ignorado. Isso previne dupla separação por falha de conexão.

---

## 12. Fluxos Críticos

### 12.1 Login Multi-Empresa

```
1. POST /api/auth/login { username, password, companyId? }
2. Valida credenciais com bcrypt
3. Se allowedCompanies tem 1 empresa → companyId = esse
   Se tem múltiplas e nenhuma foi passada → { requireCompanySelection: true }
4. Cria sessão com o companyId selecionado
5. Seta cookie httpOnly "authToken" (12h)
6. Retorna user (sem password), sessionKey, companiesData
7. Frontend: se requireCompanySelection → /select-company
              senão → /
```

### 12.2 Lançamento de Pedidos

```
1. Supervisor seleciona pedidos com status "pendente"
2. POST /api/orders/launch { orderIds, loadCode? }
3. Para cada pedido:
   - status → "em_separacao"
   - is_launched = true, launched_at = now
   - Cria work_units:
     - Modo by_order: 1 WU por seção que tem itens (status "pendente")
     - Modo by_section: 1 WU por pedido (section = null)
4. broadcastSSE("order_updated", ...) para a empresa
```

### 12.3 Conclusão de Work Unit e Avanço de Pedido

```
1. POST /api/work-units/:id/complete
2. Valida lock ownership
3. Verifica se todos os itens da WU têm status "separado" ou "excecao"
4. WU → status "concluido", completedAt = now
5. Verifica se TODAS as WUs de separação do pedido estão concluídas:
   a. Se sim:
      - order → status "separado", separated_at = now
      - Cria WU de conferência (type="conferencia")
      - broadcastSSE("work_unit_created", ...)
   b. Se não: apenas broadcast de atualização
```

### 12.4 Scan de Item (Conferência via Barcode)

```
1. Operador escaneia barcode
2. Frontend busca produto pelo código:
   - Tenta barcode unitário → produto.barcode
   - Tenta boxBarcode → produto.boxBarcode (qty = qty na caixa)
   - Tenta boxBarcodes[] → cada {code, qty}
3. Se encontrado: POST /api/work-units/:id/items/:itemId/scan-checked
4. Backend:
   a. atomicScanCheckedQty(itemId, delta, targetQty)
   b. Se checked_qty + delta > targetQty → result: "over_quantity" (não aplica)
   c. Se checked_qty já == targetQty → result: "already_complete"
   d. Se ok → atualiza, verifica conclusão da WU
```

### 12.5 Sincronização DB2

```
1. Trigger: automático a cada 10min OU POST /api/sync
2. spawn("python3", ["sync_db2.py", "--quiet"])
3. sync_db2.py:
   a. Conecta ao DB2 via ODBC (pyodbc)
   b. Consulta orçamentos dos últimos 31 dias
   c. Upsert em cache_orcamentos (CHAVE como chave única)
   d. Transforma dados usando mapeamento ativo (db2_mappings)
   e. Upsert em orders + order_items + products
   f. Atualiza product_company_stock
4. broadcastSSE("sync_finished", { success, finishedAt })
5. refreshPrinterCache()
```

### 12.6 Desbloqueio em Lote pelo Supervisor

```
1. POST /api/work-units/batch-unlock { workUnitIds }
2. Requer role supervisor ou administrador
3. Para cada WU:
   - Verifica se WU pertence à empresa do supervisor
   - Zera: lockedBy = null, lockExpiresAt = null
   - Se WU estava "em_andamento" → volta para "pendente"
4. Cria audit log
5. broadcastSSE("work_units_unlocked", { workUnitIds })
```

---

## 13. Dashboards, Relatórios e Indicadores

### 13.1 KPI de Operadores (`/admin/kpi-operadores`)

**Endpoint:** `GET /api/kpi/operators?from=&to=&companyId=`

**Dados por operador:**
- `secoesSeparadas` — total de seções (WUs) separadas no período
- `pedidosSeparados` — pedidos únicos separados
- `tempoMedioSepMin` — tempo médio de separação em minutos (p50, min, max)
- `pedidosConferidos` — WUs de conferência concluídas
- `tempoMedioConfMin` — tempo médio de conferência
- `totalItens` — itens trabalhados
- `totalQtyPicked` / `totalQtyEsperada` — qtds separadas vs esperadas
- `itensExcedidos` — itens separados acima do pedido
- `totalExcecoes` — total de exceções registradas
- `taxaExcecao` — % de itens com exceção
- `diario[]` — breakdown diário com sep, conf e tempo médio

**Cálculo de tempo:** `completedAt - startedAt` usando `::timestamptz` cast no PostgreSQL. Nulo se algum dos dois campos não tiver valor.

**Gráficos:** ComposedChart (Recharts) com barras (sep/conf) + linha (tempo médio)

### 13.2 Relatórios do Supervisor (`/supervisor/reports`)

| Relatório | Arquivo | Função |
|---|---|---|
| Lista de Separação | `reports/picking-list` | Mapa de picking por produto/seção |
| Mapa de Carregamento | `reports/loading-map` | Resumo por rota/carga |
| Mapa de Carregamento (Produtos) | `reports/loading-map-products` | Detalhe de produtos por carga |
| Volumes por Pedido | `reports/order-volumes` | Contagem de volumes (sacola, caixa, etc.) |
| Ciclos de Contagem | `reports/counting-cycles` | Relatório de inventário |
| Endereços WMS | `reports/wms-addresses` | Mapa de endereços do armazém |
| Movimentações de Pallet | `reports/pallet-movements` | Histórico de movimentações |
| Divergência de Estoque | `reports/stock-discrepancy` | Diff entre estoque ERP e WMS |
| Geração de Crachás | `reports/badge-generation` | Gera QR codes de crachá |

### 13.3 Fila de Pedidos (Display)

Dados mostrados por pedido:
- Status operacional (em fila, em andamento, finalizado)
- Status financeiro (badge colorido: liberado/pago/pendente/bloqueado)
- Nome do operador atuando
- Timer ao vivo (elapsed desde `startedAt`)
- Horário de lançamento

---

## 14. Permissões e Segurança

### 14.1 Autenticação

- **Mecanismo:** Token UUID armazenado na tabela `sessions`
- **Transporte:** HTTP-only cookie `authToken` + header `Authorization: Bearer <token>`
- **TTL:** 12 horas
- **Logout:** DELETE da sessão no banco + clear cookie
- **Login alternativo:** Badge code (código de crachá hex 32 chars)

### 14.2 Proteções no Servidor

- **Helmet:** CSP, XSS protection, frame-ancestors: none
- **Rate limiting:**
  - Login: 20 req / 15 min
  - API: 200 req / 1 min
  - SQL Query: 30 req / 1 min
- **Cookie httpOnly:** inacessível ao JavaScript do browser
- **Cookie secure:** apenas HTTPS em produção
- **Cookie sameSite: strict:** proteção CSRF

### 14.3 Autorização por Role

| Role | Pode acessar |
|---|---|
| administrador | Tudo |
| supervisor | Supervisor/* + Conferência + Balcão (sem admin/*) |
| separacao | /separacao, /handheld/picking |
| conferencia | /conferencia |
| balcao | /balcao |
| fila_pedidos | /fila-pedidos |
| recebedor | /wms/recebimento, /wms/checkin, /wms/adicao, /wms/produtos |
| empilhador | /wms/checkin, /wms/transferencia, /wms/retirada, /wms/adicao, /wms/produtos |
| conferente_wms | /wms/contagem, /wms/produtos |

Middleware `requireRole(...roles)` aplicado em cada rota protegida.

### 14.4 Isolamento de Empresa

- Middleware `requireCompany`: garante que `req.companyId` está presente
- Toda query operacional filtra por `companyId`
- SSE: `broadcastSSE(type, data, companyId)` — só envia para clientes da mesma empresa
- Exceptions: listadas e deletadas apenas dentro da empresa do supervisor

### 14.5 Permissões Granulares

- `allowedModules[]`: array de módulos que o usuário pode acessar
- `allowedReports[]`: array de relatórios visíveis
- Gerenciados na página `/admin/permissoes`

### 14.6 Auditoria

Todas as ações relevantes geram registro em `audit_logs`:
- Login / logout
- Criação/edição de usuários
- Lançamento de pedidos
- Mudança de modo de separação
- Desbloqueios forçados
- Autorização de exceções

---

## 15. Tempo Real — SSE e WebSocket

### 15.1 Server-Sent Events (SSE)

**Arquivo:** `server/sse.ts`

**Endpoint:** `GET /api/sse`

**Comportamento:**
- Autenticado via token (mesmo mecanismo das demais rotas)
- Máximo 5 conexões por usuário (proteção contra loop de reconexão)
- Heartbeat a cada 30 segundos (`: ping\n\n`) para manter conexão viva através de proxies
- Broadcast company-scoped: `broadcastSSE(type, data, companyId)`
- Target específico: `sendToUserSSE(userId, type, data)` para notificações individuais
- `EventSource` no frontend reconecta automaticamente se a conexão cair

**Eventos emitidos:**
| Evento | Quando |
|---|---|
| `connected` | Ao estabelecer conexão |
| `order_updated` | Atualização de status de pedido |
| `work_unit_updated` | Atualização de WU |
| `work_unit_created` | Nova WU criada (ex: conferência após separação) |
| `work_units_unlocked` | Lote de WUs desbloqueado |
| `picking_update` | Items atualizados no handheld |
| `lock_acquired` | Lock adquirido (handheld) |
| `lock_released` | Lock liberado (handheld) |
| `sync_finished` | Sincronização DB2 concluída |
| `route_updated` | Rota de entrega atualizada |

### 15.2 WebSocket — Agente de Impressão

**Arquivo:** `server/print-agent.ts`

- Servidor WebSocket em `/ws/print-agent`
- Agentes de impressão (software local nos computadores) conectam via WS
- Quando uma etiqueta precisa ser impressa, o servidor envia o job ao agente correto
- Agentes reportam as impressoras disponíveis
- Cache de impressoras (`refreshPrinterCache()`) atualizado após cada sync

### 15.3 WebSocket — Scanner USB

**Arquivo:** `server/ws-scanning.ts`

- Servidor WebSocket em `/ws/scanning`
- Scanners USB (HID) conectam via agente local
- Leituras são encaminhadas em tempo real para o frontend correspondente
- Alternativa ao uso de câmera para leitura de barcodes

---

## 16. Integrações Externas

### 16.1 ERP DB2 / IBM (Principal)

**Arquivo:** `sync_db2.py` (~2200 linhas)

**O que é:** Script Python que sincroniza dados do ERP legado (IBM DB2) para o PostgreSQL do Stoker.

**Conexão:**
- Protocolo: ODBC via `pyodbc`
- DSN: `CISSODBC` (configurável via env `DB2_DSN`)
- Usuário: `CONSULTA` (somente leitura)
- Host: `192.168.1.200:50000`
- Database: `CISSERP`

**O que sincroniza:**
- Orçamentos (pedidos) dos últimos 31 dias
- Itens dos orçamentos
- Dados do cliente (nome, cidade, CNPJ, endereço)
- Status financeiro
- Estoque por empresa por produto

**Estratégia:**
- Modo **incremental**: usa `CHAVE` única para upsert em `cache_orcamentos`
- Somente insere/atualiza, nunca deleta
- Após popular o cache, transforma e popula `orders`, `order_items`, `products`

**Agendamento:**
- Automático: a cada 10 minutos (timer em `routes.ts`)
- Manual: POST `/api/sync` pelo supervisor
- Inicial: 5 segundos após subida do servidor

**Mapeamento configurável:**
- `db2_mappings` armazena o mapeamento de campos DB2 → campos internos
- O Mapping Studio (`/supervisor/mapping-studio`) permite editar sem alterar código

### 16.2 Impressoras (Local)

- Impressão de etiquetas de volume (`/print/volume-label`) e pallet (`/print/pallet-label`)
- Via agente WebSocket local instalado nos computadores do armazém
- Configuração por seção: qual impressora usar para qual tipo de etiqueta

---

## 17. Variáveis de Ambiente e Configurações

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | Sim | Connection string PostgreSQL do Stoker |
| `DB2_DSN` | Para sync | String de conexão ODBC para o DB2 |
| `DATABASE_URL_LOCAL` | Para sync Python | Connection string psycopg2 para o PostgreSQL |
| `NODE_ENV` | Sim | `development` ou `production` |
| `PORT` | Não | Porta do servidor (padrão: 5000) |

**Configurações hardcoded em `server/company-config.ts`:**
```typescript
// Empresa 1
operations: [4, 58],   // pontos de operação
reports: [1, 2, 4, 58], // pontos de relatório
balcao: [1, 2]          // pontos balcão

// Empresa 3
operations: [60, 61],
reports: [52, 54, 60, 61],
balcao: [52, 54]
```

Para adicionar uma nova empresa, é necessário alterar `company-config.ts` e fazer redeploy.

---

## 18. Dependências Principais

### Backend
| Pacote | Função |
|---|---|
| express | Servidor HTTP |
| drizzle-orm | ORM type-safe para PostgreSQL |
| @neondatabase/serverless | Driver PostgreSQL (Neon compatível) |
| bcrypt | Hash de senhas |
| helmet | Headers de segurança HTTP |
| express-rate-limit | Rate limiting |
| cookie-parser | Parsing de cookies |
| zod | Validação de schemas |
| tsx | Execução de TypeScript sem compilação |

### Frontend
| Pacote | Função |
|---|---|
| react / react-dom | Framework UI |
| wouter | Roteamento leve |
| @tanstack/react-query | Cache e sincronização de estado servidor |
| @radix-ui/* | Componentes acessíveis (base do shadcn) |
| tailwindcss | Utility-first CSS |
| lucide-react | Ícones |
| recharts | Gráficos |
| react-hook-form | Formulários |
| date-fns | Manipulação de datas |
| zod | Validação compartilhada |

### Python (sync)
| Pacote | Função |
|---|---|
| pyodbc | Conexão ODBC com DB2 |
| psycopg2 | Conexão PostgreSQL |

---

## 19. Pontos Sensíveis e Observações Importantes

### 19.1 Tipo Balcão — Armadilha Crítica

WUs de balcão são armazenadas com `type="separacao"` no banco. A identificação de um pedido como "balcão" é feita **somente** pelo `pickupPoint`. Nunca filtrar por `type="balcao"` — esse valor pode existir como enum mas não é usado no banco para registros reais.

### 19.2 Timestamps como Texto

Todos os timestamps são armazenados como `text` em ISO 8601. Comparações de datas no backend usam `new Date(str)`. Queries SQL de KPI fazem cast explícito `::timestamptz`. Risco: inconsistência se alguma string não for ISO válida.

### 19.3 Campos de Lock — Zeragem Obrigatória em Trio

Em qualquer operação de reset/unlock/rollback, os campos de lock devem ser zerados juntos:
- `lockedBy = null`
- `lockExpiresAt = null`
- `lockedAt` → pode ser preservado (usado para timer de conclusão)

Se `lockExpiresAt` não for zerado, o sistema pode continuar bloqueando outros operadores mesmo após desbloquear.

### 19.4 company-config.ts — Configuração Estática

A configuração de empresas (quais pickup points são balcão, quais são operacionais) está hardcoded. Adicionar uma nova empresa requer edição de código e redeploy.

### 19.5 Migração Incremental Segura

O `runSafeMigrations()` em `server/index.ts` adiciona colunas com `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. É uma abordagem de migração sem rollback — adequada para ambiente de produção contínua mas não rastreável como Drizzle migrations formais.

### 19.6 SSE — Limite de Conexões

Máximo 5 conexões SSE por usuário. Se o usuário tiver múltiplas abas abertas, a 6ª retorna 429. O EventSource auto-reconecta, então loops de reconexão em caso de erros de autenticação seriam contidos por esse limite.

### 19.7 Sync DB2 — Processo Externo

O sync é feito via `spawn` de processo Python separado. Se o Python não estiver instalado ou o script não existir, o sync silencia (apenas loga). O script `sync_db2.py` tem ~2200 linhas e contém lógica complexa de transformação. Qualquer mudança no schema do DB2 precisa de ajuste no script.

### 19.8 Deduplicação de Mensagens no Handheld

O campo `msgId` (UUID v4 gerado no cliente) previne dupla contagem por retry de rede. É armazenado em `scanLog`. Se o banco de `scanLog` crescer muito, pode impactar performance das consultas de deduplicação.

### 19.9 Session Restore — Dependência do sessionStorage

O estado do operador (qual pedido está separando) é salvo no `sessionStorage` do browser. Trocar de browser, abrir em anônimo ou limpar dados do browser perde o estado salvo. O sistema recupera via lock ativo no banco (fallback), mas com proteção de cross-order.

### 19.10 Modo de Separação — Cache 30s

O modo de separação (`by_order` / `by_section`) é cacheado por 30 segundos no servidor. Em janelas de troca de modo, operadores podem ver comportamento inconsistente por até 30 segundos.

### 19.11 Impressão — Dependência de Agente Local

A impressão de etiquetas requer o agente de impressão instalado nos computadores do armazém. Sem o agente conectado, a impressão falha silenciosamente ou com erro. A lista de agentes conectados está na página `/admin/print-agents`.

---

## 20. Resumo Executivo Final

### O que o sistema é

O **Stoker WMS** é um sistema de gestão de armazém multi-empresa que controla o fluxo completo de pedidos: desde a sincronização com o ERP legado (IBM DB2) até a entrega ou retirada pelo cliente. É uma aplicação web full-stack, operada em tempo real por múltiplos operadores simultaneamente.

### Módulos centrais

1. **Separação** — core operacional. Operadores separam produtos por seção em pedidos lançados
2. **Conferência** — validação por barcode de tudo que foi separado
3. **Balcão** — separação simplificada para retirada presencial
4. **Sync DB2** — alimenta o sistema com dados do ERP automaticamente a cada 10 minutos
5. **Supervisor** — controle, lançamento e visibilidade de toda a operação

### Fluxos mais críticos

1. **Lançamento → Separação → Conferência → Finalização** — o ciclo principal do pedido
2. **Sync DB2** — sem ele, não chegam novos pedidos ao sistema
3. **Sistema de lock** — impede conflitos entre operadores em tempo real
4. **SSE** — atualiza todos os painéis em tempo real sem polling excessivo

### Pontos que exigem mais atenção futura

1. **company-config.ts hardcoded** — adicionar empresas requer redeploy
2. **Timestamps como text** — pode causar problemas em comparações e ordenações
3. **sync_db2.py monolítico** — 2200 linhas de Python com lógica crítica de negócio fora do controle do ORM
4. **Migração incremental manual** — sem sistema formal de migrations versionadas
5. **scanLog sem rotação** — pode crescer indefinidamente
6. **Mapeamento por empresa fixo** — integração com mais de 2 empresas não está prevista sem refatoração

---

*Documento gerado por leitura completa do código-fonte. Todas as afirmações são baseadas no que está implementado.*
