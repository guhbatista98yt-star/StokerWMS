# Módulo Separação (Picking) — Documentação Técnica Completa

> **Destinado a:** IAs, desenvolvedores e engenheiros que precisam entender o módulo de ponta a ponta.
> **Data:** Abril 2026 — Stoker WMS v atual  
> **Última atualização:** 2026-04-09 — Sprint de correções de risco alto (3 bugs críticos corrigidos)

---

## 1. Visão Geral

O módulo **Separação** é o coração operacional do Stoker WMS. Ele permite que operadores de armazém selecionem pedidos, travem work units (unidades de trabalho), bipeiem produtos com leitores de código de barras e finalizem a separação com controle rigoroso de quantidade, exceções e locks concorrentes.

**Fluxo macro:**

```
Pedido lançado → Operator seleciona pedidos → Lock de Work Units → Picking com bipagem
   → Quantidade atingida → Conclusão → Work Unit "concluido" → Pedido vai para conferência
```

---

## 2. Localização dos Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `client/src/pages/separacao/index.tsx` | Página principal do módulo (2058 linhas) |
| `client/src/hooks/use-scan-websocket.ts` | WebSocket de bipagem (envio, ACK, fila offline) |
| `client/src/hooks/use-barcode-scanner.ts` | Detecção de scanner USB/HID via `keydown` |
| `client/src/hooks/use-sse.ts` | Server-Sent Events para atualizações em tempo real |
| `client/src/hooks/use-product-stock.ts` | Busca batch de endereços de produto |
| `client/src/lib/pendingDeltaStore.ts` | Zustand store de otimismo de UI (deltas locais) |
| `server/ws-scanning.ts` | Servidor WebSocket para scan (Node.js, `ws`) |
| `server/routes.ts` | API REST: lock, unlock, heartbeat, complete, scan-item, exceptions |
| `server/sse.ts` | `broadcastSSE` — emite eventos para todos os clientes conectados |
| `shared/schema.ts` | Drizzle ORM: `workUnits`, `pickingSessions`, `exceptions`, `orderItems` |

---

## 3. Schema do Banco de Dados

### 3.1 `work_units`

```sql
CREATE TABLE work_units (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        TEXT NOT NULL REFERENCES orders(id),
  pickup_point    INTEGER NOT NULL,
  section         TEXT,                          -- seção do armazém (ex: "01", "FRAGIL")
  type            TEXT NOT NULL,                 -- "separacao" | "conferencia"
  status          TEXT NOT NULL DEFAULT 'pendente',
                                                 -- pendente | em_andamento | concluido
  locked_by       TEXT REFERENCES users(id),     -- userId do operador atual
  locked_at       TEXT,                          -- ISO 8601
  lock_expires_at TEXT,                          -- ISO 8601 — lock expira após 60 min
  cart_qr_code    TEXT,                          -- QR Code do carrinho (opcional)
  pallet_qr_code  TEXT,                          -- QR Code do pallet (opcional)
  started_at      TEXT,
  completed_at    TEXT,
  company_id      INTEGER,
  created_at      TEXT NOT NULL
);
```

**Índices:** `order_id`, `(company_id, status)`, `locked_by`.

### 3.2 `picking_sessions` (legado parcial)

```sql
CREATE TABLE picking_sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  order_id        TEXT NOT NULL REFERENCES orders(id),
  section_id      TEXT NOT NULL,
  last_heartbeat  TEXT,
  created_at      TEXT
);
```

Usado principalmente no módulo de conferência para controle de sessão por seção. No separação, o lock é gerenciado por `work_units.locked_by`.

### 3.3 `exceptions`

```sql
CREATE TABLE exceptions (
  id                  TEXT PRIMARY KEY,
  work_unit_id        TEXT REFERENCES work_units(id),
  order_item_id       TEXT NOT NULL REFERENCES order_items(id),
  type                TEXT NOT NULL,      -- "falta" | "avaria" | "sobra" | etc.
  quantity            DOUBLE PRECISION NOT NULL,
  observation         TEXT,
  reported_by         TEXT NOT NULL REFERENCES users(id),
  authorized_by       TEXT REFERENCES users(id),
  authorized_by_name  TEXT,
  authorized_at       TEXT,
  created_at          TEXT NOT NULL
);
```

### 3.4 `order_items` (campos relevantes para separação)

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | TEXT | PK |
| `order_id` | TEXT | FK para `orders` |
| `product_id` | TEXT | FK para `products` |
| `quantity` | DOUBLE PRECISION | Quantidade solicitada |
| `separated_qty` | DOUBLE PRECISION | Quantidade já separada (commitada no banco) |
| `checked_qty` | DOUBLE PRECISION | Quantidade conferida |
| `exception_qty` | DOUBLE PRECISION | Quantidade em exceção (soma das exceptions ativas) |
| `section` | TEXT | Seção do armazém |
| `status` | TEXT | Item-level status |

---

## 4. Tipos TypeScript Principais

```typescript
// shared/schema.ts
export type WorkUnitStatus = "pendente" | "em_andamento" | "concluido";
export type WorkUnitType = "separacao" | "conferencia";
export type ExceptionType = "falta" | "avaria" | "sobra" | /* outros */;

export type WorkUnit = typeof workUnits.$inferSelect;
export type WorkUnitWithDetails = WorkUnit & {
  order: Order;
  items: OrderItem[];        // join com order_items + products + exceptions
  pickingSessions?: PickingSession[];
};

// Tipos internos do frontend (separacao/index.tsx)
interface ItemWithProduct extends OrderItem {
  product: Product;
  exceptionQty?: number;
  exceptions?: Exception[];
}

interface AggregatedProduct {
  product: Product;
  totalQty: number;        // soma de quantity de todos os items deste produto
  separatedQty: number;    // soma de separatedQty + pendingDelta
  exceptionQty: number;    // soma de exceptionQty
  items: ItemWithProduct[];
  orderCodes: string[];    // pedidos ERP que contêm este produto
  sections: string[];      // seções onde o produto aparece
}

type SeparacaoStep = "select" | "picking";
type PickingTab = "product" | "list";
```

---

## 5. Estados React da Página Principal

```typescript
// Controle de fluxo
const [step, setStep] = useState<SeparacaoStep>("select");
const [selectedWorkUnits, setSelectedWorkUnits] = useState<string[]>([]);
const [pickingTab, setPickingTab] = useState<PickingTab>("list");
const [currentProductIndex, setCurrentProductIndex] = useState(0);

// Feedback de bipagem
const [scanStatus, setScanStatus] = useState<"idle"|"success"|"error"|"warning">("idle");
const [scanMessage, setScanMessage] = useState("");
const [soundOn, setSoundOn] = useState(getSoundEnabled);

// Modais
const [showExceptionDialog, setShowExceptionDialog] = useState(false);
const [exceptionItem, setExceptionItem] = useState<ItemWithProduct | null>(null);
const [showAuthModal, setShowAuthModal] = useState(false);
const [qtyModal, setQtyModal] = useState<QtyModalData | null>(null);
const [overQtyModalOpen, setOverQtyModalOpen] = useState(false);
const [overQtyContext, setOverQtyContext] = useState<OverQtyContext | null>(null);
const [showStockModal, setShowStockModal] = useState(false);
const [abandonConfirmOpen, setAbandonConfirmOpen] = useState(false); // modal de confirmação de saída

// Filtros (tela de seleção)
const [filterOrderId, setFilterOrderId] = useState("");
const [filterRoute, setFilterRoute] = useState<string>("");
const [dateRange, setDateRange] = useState<DateRange | undefined>(getCurrentWeekRange());
const [sectionFilter, setSectionFilter] = useState<string>("all");

// Restauração de sessão
const [sessionRestored, setSessionRestored] = useState(false);

// Endereços selecionados por produto (para dedução de estoque)
const [selectedAddresses, setSelectedAddresses] = useState<Record<string, {...}|null>>({});
```

### Refs Críticas

```typescript
const scanQueueRef = useRef<string[]>([]);          // fila FIFO de barcodes a processar
const scanWorkerRunningRef = useRef(false);          // mutex: evita processamento paralelo
const syncTimerRef = useRef<...>(null);             // timer de invalidação pós-scan
const safetyRedirectTimerRef = useRef<...>(null);   // timer de redirect de segurança (15s)
const overQtyModalOpenRef = useRef(false);           // espelho de overQtyModalOpen para closures
const qtyModalRef = useRef<QtyModalData|null>(null); // espelho de qtyModal para callbacks
const allMyUnitsHeartbeatRef = useRef(allMyUnits);  // acesso a allMyUnits dentro do interval sem recriá-lo
const pendingScanContextRef = useRef<Map<string, PendingScanCtx>>(...); // contexto de cada scan em voo
const pendingInvalidateRef = useRef(false);          // flag: precisa invalidar cache após scan
const sendScanRef = useRef<any>(null);               // ref estável para sendScan (WebSocket)
```

---

## 6. Query Principal (TanStack Query v5)

```typescript
const workUnitsQueryKey = useSessionQueryKey(["/api/work-units?type=separacao"]);
// useSessionQueryKey adiciona companyId como segmento no cache key

const { data: workUnits, isLoading, isFetching } = useQuery<WorkUnitWithDetails[]>({
  queryKey: workUnitsQueryKey,
  refetchInterval: () =>
    scanWorkerRunningRef.current || scanQueueRef.current.length > 0 ? false : 5000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});
```

**Notas importantes:**
- `refetchInterval` de **5 segundos** (reduzido de 1s para diminuir pressão no banco durante sync Python).
- O polling é **suspenso** durante o processamento da scan queue (`scanWorkerRunningRef.current`).
- `isFetching` é `true` tanto no carregamento inicial quanto em qualquer refetch. `isLoading` é `true` apenas na carga inicial sem cache.

---

## 7. Memos Derivados

### 7.1 `myLockedUnits`
Todos os work units travados pelo usuário no banco (para exibição na lista de seleção — mostra o que está "em uso").
```typescript
const myLockedUnits = useMemo(() =>
  workUnits?.filter(wu => wu.lockedBy === user.id && wu.status !== "concluido") ?? [],
[workUnits, user]);
```

### 7.2 `allMyUnits` — **CRÍTICO**
Work units da **sessão atual** (`selectedWorkUnits`). Filtra locks de sessões anteriores abandonadas.
```typescript
const allMyUnits = useMemo(() => {
  const allLocked = workUnits?.filter(wu => wu.lockedBy === user.id && wu.status !== "concluido") ?? [];
  // Quando em picking, filtra estritamente pelos selecionados nesta sessão
  if (step === "picking" && selectedWorkUnits.length > 0) {
    return allLocked.filter(wu => selectedWorkUnits.includes(wu.id));
  }
  return allLocked;
}, [workUnits, user, step, selectedWorkUnits]);
```

**Por que isso importa:** Se um operador encerrou o app a força anteriormente (crash, queda de energia), seus locks anteriores permanecem no banco por até 60 minutos. Sem esse filtro, esses locks de sessões mortas apareceriam em `allMyUnits` e contaminariam a lista de produtos, causando "salto para outros pedidos".

### 7.3 `aggregatedProducts`
Agrega todos os itens de `allMyUnits` por produto, somando quantidades de múltiplos pedidos.
```typescript
const aggregatedProducts = useMemo((): AggregatedProduct[] => {
  const allItems = allMyUnits.flatMap(wu => wu.items);
  // deduplica por item.id, agrupa por productId
  // soma: totalQty, separatedQty + pendingDelta, exceptionQty
  // coleta: orderCodes, sections
  // ordena: alfabético por nome do produto (pt-BR)
}, [allMyUnits, user, pendingSeparacao]);
```

A quantidade separada usa `pendingSeparacao[item.id] || 0` do `usePendingDeltaStore` para mostrar bipagens otimistas ainda não confirmadas pelo banco.

### 7.4 `availableWorkUnits`
Work units disponíveis para seleção (tela `select`).
```typescript
// Filtros:
// - status === "pendente"
// - lockedBy === null || lockedBy === user.id (inclui proprios locks para re-seleção)
// - order.isLaunched === true
// - order.status !== "separado" && !== "conferido"
// - filterOrderId (busca parcial ou múltipla por vírgula)
// - filterRoute
// - dateRange (launchedAt ou createdAt dentro do intervalo)
```

---

## 8. Persistência de Sessão (localStorage)

**Chave:** `wms:separacao-session`

```typescript
interface SessionData {
  tab: PickingTab;         // "product" | "list"
  productIndex: number;    // índice do produto atual
  workUnitIds: string[];   // IDs dos work units desta sessão
}
```

**Restore logic** (roda uma única vez, quando `workUnits` carrega pela primeira vez):
```typescript
useEffect(() => {
  if (workUnits && user && !sessionRestored) {
    setSessionRestored(true);

    const saved = loadSession();
    if (saved?.workUnitIds.length > 0) {
      // Filtra apenas os IDs que ainda estão travados pelo usuário
      const stillLockedIds = saved.workUnitIds.filter(id =>
        workUnits.some(wu => wu.id === id && wu.lockedBy === user.id)
      );
      if (stillLockedIds.length > 0) {
        setStep("picking");
        setPickingTab(saved.tab);
        setCurrentProductIndex(0);  // sempre reseta para 0 no restore
        setSelectedWorkUnits(stillLockedIds);
        return;
      } else {
        clearSession(); // sessão inválida (locks expirados/liberados)
      }
    }

    // ✅ CORRIGIDO (2026-04-09): O fallback que auto-entrava em picking com TODOS os locks
    // do usuário (incluindo orphaned de sessões anteriores) foi removido.
    // Sem sessão salva válida → permanece na tela de seleção.
    // O operador vê um banner amarelo avisando que tem coletas em andamento e re-seleciona.
  }
}, [workUnits, user, sessionRestored]);
```

**Banner de coletas em andamento:**

Quando `myLockedUnits.length > 0` na tela de seleção (sem sessão ativa), exibe:

```jsx
{myLockedUnits.length > 0 && (
  <div className="banner-yellow">
    ⚠ Você tem {myLockedUnits.length} coleta(s) em andamento.
    Selecione os pedidos na lista para retomar.
  </div>
)}
```

**Por que o fallback foi removido:** Sem uma sessão identificada por `sessionId` + `workUnitIds`, restaurar todos os locks do usuário no banco era indistinguível de um operador que tinha pedidos em curso em outra sessão, outro turno, ou outro dispositivo. Esse fallback introduzia locks de sessões mortas na listagem ativa, causando "salto para outros pedidos" e mistura de contextos.

**Save logic** (salva sempre que muda tab, productIndex ou allMyUnits):
```typescript
useEffect(() => {
  if (step === "picking" && allMyUnits.length > 0) {
    saveSession({ tab: pickingTab, productIndex: currentProductIndex,
                  workUnitIds: allMyUnits.map(wu => wu.id) });
  }
}, [step, pickingTab, currentProductIndex, allMyUnits]);
```

---

## 9. Sistema de Lock

### Constantes
```typescript
const LOCK_TTL_MINUTES = 60;    // server/routes.ts
// Heartbeat: a cada 4 minutos do lado do cliente
```

### Adquirir lock (`POST /api/work-units/lock`)
```typescript
const lockMutation = useMutation({
  mutationFn: async (workUnitIds: string[]) => {
    const res = await apiRequest("POST", "/api/work-units/lock", { workUnitIds });
    return res.json();
  },
});
```

**Servidor:**
1. Verifica se cada work unit pertence à empresa do usuário e se o usuário tem permissão de seção.
2. Chama `storage.lockWorkUnits(workUnitIds, userId, expiresAt)` — operação atômica, falha com `LOCK_CONFLICT` se já travado por outro.
3. `expiresAt = agora + 60 min`.

### Heartbeat (`POST /api/work-units/:id/heartbeat`)
```typescript
// Dispara ao entrar em picking e a cada 4 min
// Também dispara ao: reconectar (online event), app voltar ao foco (visibilitychange)
useEffect(() => {
  if (step !== "picking") return;
  const sendHeartbeat = () => {
    allMyUnitsHeartbeatRef.current.forEach(wu => {
      apiRequest("POST", `/api/work-units/${wu.id}/heartbeat`, {}).catch(() => {});
    });
  };
  sendHeartbeat(); // imediato ao entrar em picking
  const interval = setInterval(sendHeartbeat, 4 * 60 * 1000);
  return () => clearInterval(interval);
}, [step]);
```

**Servidor:** Renova `lock_expires_at` para `agora + 60 min` se o caller for o dono ou supervisor.

### Liberar lock (`POST /api/work-units/unlock`)

Chamado em três contextos:

1. **Suspender coleta** (`handleCancelPicking(false)`): `{ ids, reset: false }` — libera os locks mas preserva todo `separated_qty` no banco. O operador pode retomar depois via banner na tela de seleção.
2. **Abandonar coleta** (`handleCancelPicking(true)`): `{ ids, reset: true }` — zera o progresso do work unit e o pedido volta para "pendente". Ação destrutiva, requer confirmação explícita no modal.
3. **Conclusão parcial** (`finalizeWorkUnits`): `{ ids, reset: false }` — quando `complete` falha com "Existem itens pendentes" (outras seções), libera sem resetar para outros operadores continuarem.

> ⚠️ **`reset: true` é a única ação que apaga `separated_qty`.** Toda saída da coleta que não seja conclusão passa primeiro pelo modal `AbandonConfirmDialog` (seção 21).

### Fluxo de saída da coleta (`handleExitPicking` → modal → `handleCancelPicking`)

```typescript
// Botão X no header → abre modal de confirmação
const handleExitPicking = () => setAbandonConfirmOpen(true);

// Modal apresenta três opções:
// 1. "Suspender (manter progresso)" → handleCancelPicking(false)
// 2. "Abandonar (apagar progresso)" → handleCancelPicking(true)
// 3. "Cancelar (continuar separando)" → fecha modal

const handleCancelPicking = (shouldReset: boolean) => {
  setAbandonConfirmOpen(false);
  // Limpa estado local (fila de scans, pendingDelta, localStorage session)
  unlockMutation.mutate({ ids: allMyUnits.map(wu => wu.id), reset: shouldReset });
};
```

---

## 10. Safety Redirect (Proteção contra tela morta)

```typescript
const safetyRedirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

useEffect(() => {
  // Só redireciona se TODOS os critérios forem verdadeiros POR 15 SEGUNDOS CONSECUTIVOS:
  const shouldRedirect = step === "picking"
    && allMyUnits.length === 0
    && !isLoading    // não está no carregamento inicial
    && !isFetching;  // não está num refetch (sync do banco, SSE, polling)

  if (shouldRedirect) {
    if (!safetyRedirectTimerRef.current) {
      safetyRedirectTimerRef.current = setTimeout(() => {
        safetyRedirectTimerRef.current = null;
        setStep("select");
        setSelectedWorkUnits([]);
      }, 15000);
    }
  } else {
    // Qualquer dado voltando cancela o timer
    if (safetyRedirectTimerRef.current) {
      clearTimeout(safetyRedirectTimerRef.current);
      safetyRedirectTimerRef.current = null;
    }
  }
}, [step, allMyUnits.length, isLoading, isFetching]);
```

**Por que 15 segundos:** O sync Python (`sync_db2.py`) pode temporariamente zerar/reescrever dados de work units. Janelas de 3–5 segundos eram comuns. 15s garante que transições reais (ex: supervisor desbloqueou remotamente) ainda sejam detectadas, mas sincronizações transitórias não disparam redirect.

---

## 11. Pipeline de Bipagem (Barcode Scanning)

O módulo usa **dois canais paralelos** para capturar barcodes:

### 11.1 Canal 1: `useBarcodeScanner` (USB HID / teclado)

Arquivo: `client/src/hooks/use-barcode-scanner.ts`

```typescript
const SCANNER_GAP_MS = 120;   // intervalo máximo entre teclas de um scan
const ENTER_GRACE_MS = 300;   // janela após última tecla para aceitar Enter como fim do barcode
```

**Algoritmo:**
1. Escuta `keydown` globalmente (capture phase — antes de qualquer handler da UI).
2. Acumula caracteres em `bufferRef` quando o gap entre teclas é `< 120ms` (padrão de scanner, não digitação humana).
3. Quando `Enter` chega dentro de `300ms` da última tecla e o buffer tem `> 2 chars`, dispara `onScan(barcode)`.
4. Se o foco estiver num `ScanInput` (marcado com `data-scan-input="true"`), limpa o valor do input via setter do protótipo (bypass React synthetic events).
5. Inputs editáveis comuns (não scan) são ignorados para o buffer — previne conflito com busca de texto.

**Ativado condicionalmente:**
```typescript
useBarcodeScanner(globalScanHandler, step === "picking" && !showStockModal);
```

### 11.2 Canal 2: `ScanInput` (componente de input de scan)

O `ScanInput` (`client/src/components/ui/scan-input.tsx`) é um input com `inputMode="none"` (sem teclado virtual), apenas para receber dados do scanner. Ele redireciona o `onScan` para o mesmo `handleScanItem`. Esse canal é redundante/backup para o canal 1.

> ⚠️ **IMPORTANTE:** Inputs de scan da separação **NUNCA** devem ter `showKeyboardToggle`. São read-only por design — o operador não digita, apenas bipa.

### 11.3 `handleScanItem` — Entrada da Fila

```typescript
const handleScanItem = useCallback((barcode: string) => {
  if (step !== "picking") return;
  if (barcode.trim()) {
    scanQueueRef.current.push(barcode.trim());
    processScanQueue();
  }
}, [step, processScanQueue]);
```

### 11.4 `processScanQueue` — Worker da Fila

A fila `scanQueueRef` é processada em série pelo worker. Isso garante que bipes rápidos não criem race conditions.

**Lógica completa:**

```
while (queue não vazia):
  1. Se overQtyModalOpen → para (aguarda operador fechar modal)
  2. Pega próximo barcode da fila
  3. Busca no cache local (queryClient) os work units travados pelo usuário
  4. Busca work units que têm item com este barcode (produto, caixa, ou boxBarcodes[])
  5. Se nenhum encontrado → beep warning + mensagem "não encontrado"
  6. Escolhe targetUnit: prefere unidade que ainda tem quantidade a separar
  7. Detecta se é box barcode (multiplier > 1)
  8. Verifica se item já está completo (server+delta+exception >= quantity) → overQty local
  9. Acumula no QtyModal:
     a. Se já existe modal do MESMO produto → incrementa accumulated
     b. Se existe modal de OUTRO produto → submete o modal anterior via sendScan, abre novo
     c. Se não existe modal → abre novo modal com accumulated=0, aguarda próxima bipagem
  10. Atualiza currentProductIndex e muda tab para "product"
  11. Após o loop: agenda invalidação de cache em 300ms (via syncTimerRef)
```

### 11.5 `QtyModal` — Acumulação de Quantidade

A UI exibe um modal `ScanQuantityModal` enquanto o operador está bipando o mesmo produto. O modal mostra a quantidade acumulada e um multiplier configurável.

**Confirmar modal** (`handleConfirmQtyModal`):
```
1. Incrementa delta local via pendingDeltaStore.inc(qty acumulado)
2. Cria msgId único
3. Adiciona contexto ao pendingScanContextRef (para tratar ACK)
4. Chama sendScan(workUnitId, barcode, qty, msgId) → WebSocket
5. Fecha modal
6. Agenda invalidação de cache
```

---

## 12. WebSocket de Scan

### 12.1 Cliente (`use-scan-websocket.ts`)

```typescript
const wsNamespace = `separacao:${user.id}:${companyId}`;
const { status, sendScan, clearQueue } = useScanWebSocket(
  step === "picking",   // enabled: só quando em picking
  handleWsScanAck,      // callback para ACK
  wsNamespace           // namespace para fila offline isolada
);
```

**Funcionalidades:**
- Conecta em `ws[s]://<host>/ws/scanning` (ws em HTTP, wss em HTTPS).
- Reconexão automática com backoff exponencial (1s × 1.5^tentativa, máx 10s).
- Ping a cada 30 segundos para manter a conexão viva.
- **Fila offline em localStorage** (`ws_scan_pending_queue_<namespace>`): se o WebSocket estiver desconectado ao bipar, o scan é salvo localmente e reenviado quando reconectar.
- Mensagens com `> 5 min` de idade são descartadas da fila offline ao reconectar.

**Payload enviado:**
```json
{
  "type": "scan",
  "msgId": "1714900000000-abc123",
  "workUnitId": "uuid-da-work-unit",
  "barcode": "7891234567890",
  "quantity": 3
}
```

**ACK recebido:**
```json
{
  "type": "scan_ack",
  "msgId": "1714900000000-abc123",
  "status": "success" | "already_complete" | "not_found" | "over_quantity" | "over_quantity_with_exception" | "error",
  "message": "...",
  "quantity": 3,
  "availableQty": 2        // presente apenas em "over_quantity"
}
```

### 12.2 Servidor (`server/ws-scanning.ts`)

**Autenticação:** JWT via query string `?token=` ou cookie `authToken`. Usuário não autenticado recebe `auth_error` e conexão é fechada.

**Deduplicação de mensagens:** `processedMsgIds` (Map em memória, TTL 5min). Se um `msgId` já foi processado, o servidor reenvia o ACK cacheado sem re-processar. Isso protege contra reenvios da fila offline.

**Serialização de mensagens por cliente:** Cada conexão WebSocket tem sua própria `Promise` chain em `messageChains`. Mensagens do mesmo cliente são processadas em série — nunca em paralelo — evitando race conditions no banco.

**`handleScanItem` no servidor:**
1. Verifica dedup por `msgId`.
2. Busca work unit no banco (sempre fresco, não cacheado).
3. Verifica autorização: empresa + seção.
4. Verifica ownership do lock (`locked_by === client.userId` e lock não expirado).
5. Resolve barcode → produto → item do work unit.
6. Detecta multiplier (caixa).
7. Chama `storage.atomicScanSeparatedQty(itemId, qty, target, workUnitId, orderId)`:
   - Operação atômica no PostgreSQL (`SELECT ... FOR UPDATE` + `UPDATE`).
   - Incrementa `separated_qty` se a soma não exceder `target` → retorna `"success"`.
   - ✅ **CORRIGIDO (2026-04-09):** Se `currentQty >= target` (item já completo) → retorna `"already_complete"` **sem alterar nada no banco**.
   - ✅ **CORRIGIDO (2026-04-09):** Se `delta > availableQty` (scan excederia a quantidade) → retorna `"over_quantity"` **sem alterar nada no banco**.
   - O banco só é modificado em caso de `"success"`. Reset de `separated_qty` a 0 só ocorre via `POST /api/work-units/:id/reset-item-picking` quando o operador confirma explicitamente.
8. Emite SSE `item_picked` para todos os clientes (apenas em `"success"`).
9. Envia ACK diferenciado para o cliente WebSocket:
   - `"success"` → ACK normal
   - `"already_complete"` → ACK informativo sem modal
   - `"over_quantity"` → ACK com quantidade disponível para exibição no modal
10. Registra audit log assíncronamente.

---

## 13. Tratamento de ACK no Frontend (`handleWsScanAck`)

```typescript
const handleWsScanAck = useCallback((ack: any) => {
  const ctx = pendingScanContextRef.current.get(ack.msgId);
  if (!ctx) return;
  pendingScanContextRef.current.delete(ack.msgId);

  switch (ack.status) {
    case "success":
      // Invalidar cache para buscar novo separatedQty do banco
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      break;

    // ✅ NOVO (2026-04-09): Item já estava totalmente separado quando o scan chegou.
    // O banco NÃO foi alterado. Limpa delta local e invalida cache silenciosamente.
    // Nenhum modal é aberto — apenas uma mensagem na barra de status.
    case "already_complete":
      usePendingDeltaStore.getState().clearItem("separacao", ctx.itemId);
      usePendingDeltaStore.getState().resetBaseline("separacao", ctx.itemId);
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      setScanStatus("success");
      setScanMessage(ack.message || "Produto já separado");
      break;

    case "over_quantity":
    case "over_quantity_with_exception":
      // ✅ CORRIGIDO (2026-04-09): O servidor JÁ NÃO MAIS zera separated_qty.
      // O banco está intacto. Apenas o delta local é limpo.
      // 1. Limpa delta local do item
      usePendingDeltaStore.getState().clearItem("separacao", ctx.itemId);
      usePendingDeltaStore.getState().resetBaseline("separacao", ctx.itemId);
      // 2. Invalida cache
      queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
      // 3. Abre modal — serverAlreadyReset: false (banco preservado, operador escolhe recontar)
      setOverQtyContext({ ..., serverAlreadyReset: false });
      setOverQtyModalOpen(true);
      break;

    case "not_found":
      // Produto não pertence ao pedido (bipagem errada)
      usePendingDeltaStore.getState().dec("separacao", ctx.itemId, ctx.qty);
      setScanStatus("warning");
      setScanMessage("Produto não encontrado neste pedido");
      break;

    case "error":
      // Verifica se é lock expirado — tenta 1 retry após renovar heartbeat
      if (isLockExpired && retryCount < 1) {
        // Renova heartbeat e reenvia após 700ms
        setTimeout(() => { sendScanRef.current(ctx.workUnitId, ctx.barcode, ctx.qty, newMsgId) }, 700);
        return;
      }
      // Desfaz delta local
      usePendingDeltaStore.getState().dec("separacao", ctx.itemId, ctx.qty);
      setScanStatus("error");
      setScanMessage(ack.message || "Erro ao processar scan");
      break;
  }
}, [queryClient, workUnitsQueryKey]);
```

---

## 14. `pendingDeltaStore` — Otimismo de UI

Arquivo: `client/src/lib/pendingDeltaStore.ts` — Zustand store global.

**Propósito:** Permite que a UI mostre a quantidade bipada imediatamente, sem esperar o banco confirmar (latência da rede / banco). O "delta" é a diferença entre o que o banco tem e o que o operador já bipou localmente.

```typescript
type Namespace = "separacao" | "conferencia" | "balcao";

// Estado por namespace
{
  separacao: Record<string, number>,   // itemId → delta pendente
  _lastServer: { separacao: Record<string, number> },  // último valor do banco
  conflicts: Set<ConflictKey>,          // itens onde o servidor retroagiu
}

// API
inc(ns, itemId, qty)          // adiciona delta (chamado antes de enviar WebSocket)
dec(ns, itemId, qty)          // subtrai delta (chamado quando ACK falha)
get(ns, itemId)               // retorna delta atual
clear(ns)                     // limpa todos os deltas do namespace
clearItem(ns, itemId)         // limpa delta de um item específico
resetBaseline(ns, itemId)     // remove do _lastServer (usado ao concluir/exception)
reconcile(ns, serverValues)   // chamado ao receber novos dados do banco — reconcilia deltas
```

**`reconcile`:** Chamado no `useEffect` toda vez que `workUnits` muda. Detecta quanto o servidor avançou desde o último reconcile, subtrai do delta local. Se o servidor **retroagiu** (supervisor resetou), sinaliza conflito mas preserva o delta local para proteger o trabalho do operador.

**Uso na UI:**
```typescript
map[pid].separatedQty += Number(item.separatedQty) + (pendingSeparacao[item.id] || 0);
```

---

## 15. SSE (Server-Sent Events)

Arquivo: `client/src/hooks/use-sse.ts`

```typescript
useSSE("/api/sse", [
  "picking_update",        // atualização genérica de picking
  "lock_acquired",         // outro operador adquiriu lock
  "lock_released",         // lock liberado
  "picking_started",       // separação iniciada por outro operador
  "item_picked",           // item bipado por qualquer operador
  "exception_created",     // exceção registrada
  "picking_finished",      // work unit concluído
  "orders_launched",       // admin lançou novos pedidos
  "orders_relaunched",     // admin relançou pedidos
  "work_units_unlocked",   // work units desbloqueadas (ex: supervisor desbloqueou)
  "orders_launch_cancelled",
  "work_unit_created",     // nova work unit criada (conferência após separação)
], handleSSEMessage);
```

**`handleSSEMessage`:**
```typescript
const handleSSEMessage = useCallback((type: string, _data: any) => {
  // Durante bipagem, não invalida agora — marca flag para invalidar depois
  if (scanWorkerRunningRef.current || scanQueueRef.current.length > 0) {
    pendingInvalidateRef.current = true;
    return;
  }
  queryClient.invalidateQueries({ queryKey: workUnitsQueryKey });
  // Notificação extra para exception_created
}, [queryClient, workUnitsQueryKey, toast]);
```

---

## 16. Mutações CRUD

| Mutação | Endpoint | Otimismo |
|---|---|---|
| `lockMutation` | `POST /api/work-units/lock` | Atualiza cache localmente (status → em_andamento) |
| `unlockMutation` | `POST /api/work-units/unlock` | Atualiza cache localmente (limpa locked_by) |
| `completeWorkUnitMutation` | `POST /api/work-units/:id/complete` | Nenhum |
| `createExceptionMutation` | `POST /api/exceptions` | Nenhum (refetch após sucesso) |
| `clearExceptionsMutation` | `DELETE /api/exceptions/item/:itemId` | Nenhum (refetch após sucesso) |

---

## 17. Fluxo de Conclusão (`handleCompleteAll` → `finalizeWorkUnits`)

```
1. Verifica exceções não autorizadas
   a. Se user.canAuthorizeOwnExceptions → auto-autoriza via POST /api/exceptions/auto-authorize
   b. Senão → abre ExceptionAuthorizationModal (supervisor digita senha ou usa crachá)

2. Verifica itens pendentes na UI (server + pending delta < quantity)
   → Se há pendentes → toast de aviso, bloqueia conclusão

3. Envia deduções de endereço:
   POST /api/picking/deduct-address { deductions: [...] }
   (best-effort — falha não impede conclusão)

4. Para cada work unit em allMyUnits:
   a. POST /api/work-units/:id/complete
      → Backend: atomically verifica todos os itens completos → marca status="concluido"
      → Emite SSE "picking_finished"
      → Verifica se todos WUs do pedido estão concluídos → cria work unit de conferência
      → Emite SSE "work_unit_created"
   b. Se falhar com "Existem itens pendentes" (seção parcial):
      POST /api/work-units/:id/unlock (sem reset)
      → Libera WU para outros operadores/seções concluírem

5. Limpa: pendingDeltaStore, localStorage session
6. setStep("select"), setSelectedWorkUnits([])
7. beep("complete")
```

---

## 18. Exceções

**Tipos disponíveis:** `"falta"` | `"avaria"` | `"sobra"` | outros definidos em schema.

**Criar exceção:**
- Operador abre `ExceptionDialog` para o produto atual.
- Informa tipo, quantidade e observação.
- `createExceptionMutation` → `POST /api/exceptions`.
- Após sucesso: limpa delta local do item, refetch queries.

**Autorização de exceção:**
- Para concluir a separação, todas as exceções devem estar autorizadas.
- `ExceptionAuthorizationModal` exibe as exceções pendentes e pede que um supervisor autentique:
  - Com senha (`POST /api/exceptions/authorize`) ou
  - Com crachá de RF (`POST /api/exceptions/authorize-by-badge`).
- Usuários com `canAuthorizeOwnExceptions: true` nas settings são auto-autorizados.

---

## 19. Avanço Automático de Produto

Quando um produto atinge 100% (separatedQty + exceptionQty >= totalQty), após 500ms o componente automaticamente avança para o próximo produto incompleto:

```typescript
useEffect(() => {
  if (currentProduct && step === "picking" && !overQtyModalOpenRef.current) {
    const remaining = currentProduct.totalQty - currentProduct.separatedQty - currentProduct.exceptionQty;
    if (remaining <= 0 && currentProduct.separatedQty > 0) {
      // Busca próximo incompleto à frente do índice atual
      const nextIdx = filteredAggregatedProducts.findIndex((ap, idx) =>
        idx > currentProductIndex && ap.totalQty - ap.separatedQty - ap.exceptionQty > 0
      );
      if (nextIdx >= 0) {
        setTimeout(() => setCurrentProductIndex(nextIdx), 500);
      } else {
        // Wrap: busca desde o início
        const wrapIdx = filteredAggregatedProducts.findIndex(ap =>
          ap.totalQty - ap.separatedQty - ap.exceptionQty > 0
        );
        if (wrapIdx >= 0 && wrapIdx !== currentProductIndex) {
          setTimeout(() => setCurrentProductIndex(wrapIdx), 500);
        }
      }
    }
  }
}, [currentProduct?.separatedQty, currentProduct?.totalQty, step, filteredAggregatedProducts, currentProductIndex]);
```

---

## 20. Modal de Quantidade Excedida

Disparado apenas quando o servidor retorna `over_quantity` (scan excederia a quantidade disponível). O scan duplicado em item já completo não abre mais este modal — é tratado silenciosamente via `already_complete`.

```typescript
// Contexto do modal
interface OverQtyContext {
  productName: string;
  itemIds: string[];
  workUnitId: string;
  barcode: string;
  targetQty: number;
  message: string;
  serverAlreadyReset: boolean;
  // ✅ CORRIGIDO (2026-04-09): sempre false — o servidor nunca mais zera automaticamente.
  // O reset só acontece se o operador clicar "Recontar".
}
```

**Detecção local `alreadyComplete` no `processScanQueue`:**

✅ **CORRIGIDO (2026-04-09):** Quando a detecção local indica que o item já está completo (`serverSeparated + delta + exceptionQty >= quantity`), o scan é silenciosamente ignorado com mensagem "Produto já separado" — sem abrir modal, sem resetar nada.

**Ao confirmar "Recontar produto" (operador escolhe explicitamente):**
1. Limpa delta local dos itens.
2. Como `serverAlreadyReset` é sempre `false`, chama `POST /api/work-units/:id/reset-item-picking { itemIds }`.
3. Banco zera `separated_qty` e marca `status = "recontagem"`.
4. Libera a scan queue para continuar.

**Quando o modal é aberto vs não aberto:**

| Situação | Comportamento |
|---|---|
| Scan em item já 100% completo (mesmo produto, qualquer qty) | ACK `already_complete` → mensagem suave, **sem modal** |
| Scan com qty > quantidade restante (ex: caixa de 10, só 3 faltam) | ACK `over_quantity` → **abre modal** com opção de recontar |
| Detecção local `alreadyComplete` no processamento da fila | Mensagem suave, scan ignorado, **sem modal** |

---

## 21. Consulta de Estoque (modal)

Durante o picking, o operador pode consultar estoque de qualquer produto.

```
- Botão BarChart2 abre o modal
- Input de busca: desativa o useBarcodeScanner globalmente
- Busca debounced (350ms) por: código ERP exato, código de barras, ou descrição com % como wildcard
- API: GET /api/products/search?q=<query>
- Exibe: nome, erpCode, barcode, fabricante, estoque total, endereços de coleta
```

---

## 22. Endereços de Coleta

```typescript
const productIds = useMemo(() => aggregatedProducts.map(ap => ap.product.id), [aggregatedProducts]);
const { data: addressesMap } = useProductAddressesBatch(productIds);
// addressesMap: Record<productId, ProductAddress[]>
// ProductAddress: { code: string; addressId: string; quantity: number; type: string }
```

O operador pode selecionar um endereço clicando nele na aba "Produto". A seleção é opcional (o operador pode concluir sem selecionar). Ao finalizar a separação, o endereço selecionado gera uma dedução de estoque:

```typescript
POST /api/picking/deduct-address {
  deductions: [{
    productId, addressId, quantity: ap.separatedQty,
    orderId, erpOrderId, workUnitId
  }]
}
```

---

## 23. Filtro por Seção

Na aba "Lista" do picking, o operador pode filtrar produtos por seção do armazém:

```typescript
const [sectionFilter, setSectionFilter] = useState<string>("all");
const filteredAggregatedProducts = useMemo(() => {
  if (sectionFilter === "all") return aggregatedProducts;
  return aggregatedProducts.filter(ap => ap.sections.includes(sectionFilter));
}, [aggregatedProducts, sectionFilter]);
```

`currentProduct` sempre aponta para `filteredAggregatedProducts[currentProductIndex]`.

---

## 24. Controle de Acesso (RBAC)

A `GET /api/work-units?type=separacao` aplica o filtro de RBAC no servidor:

```typescript
if (requestingUser?.role === "separacao") {
  const userSections: string[] = requestingUser.sections || [];
  if (userSections.length === 0) {
    launched = [];  // sem seções → sem acesso
  } else {
    // Filtra WUs e seus itens pela seção do usuário
    launched = launched.filter(wu => userSections.includes(wu.section));
    launched = launched.map(wu => ({
      ...wu,
      items: wu.items.filter(item => userSections.includes(item.section))
    }));
  }
}
// supervisores e administradores recebem tudo
```

Roles disponíveis: `"separacao"` | `"conferencia"` | `"balcao"` | `"supervisor"` | `"administrador"`.

---

## 25. UI — Duas Abas de Picking

### Aba "Produto" (`pickingTab === "product"`)
Exibe o produto atual em destaque:
- Informações do produto (nome, código ERP, fabricante, barcode, código de fábrica).
- Endereços de coleta (clicáveis, opcional).
- Número grande com quantidade a separar.
- Barra de progresso.
- Botões: Exceção (AlertTriangle), Estoque (BarChart2), Sair (X) → abre `AbandonConfirmDialog` (seção 31), Próximo (ArrowRight).
- Botão verde "Concluir" (habilitado apenas quando `allItemsComplete`).

### Aba "Lista" (`pickingTab === "list"`)
Exibe todos os produtos como cards scrolláveis:
- Indicador colorido: verde (completo), âmbar (com exceção), cinza (pendente).
- Círculo com quantidade restante ou ✓.
- Nome, código, barcode, fabricante, pedido ERP, endereços.
- Barra de progresso por item.
- Filtro de seção no topo.
- Contador "X/Y ok" no canto superior.

**Bipagem funciona em ambas as abas.** Ao bipar um produto, muda automaticamente para a aba "Produto" no índice correto.

---

## 26. Feedback de Áudio

```typescript
import { beep, getSoundEnabled, setSoundEnabled } from "@/lib/audio-feedback";

beep("scan");      // bip curto: scan registrado
beep("error");     // bip de erro: quantidade excedida, produto não encontrado
beep("warning");   // bip de aviso
beep("complete");  // melodia de conclusão
```

Estado salvo em localStorage via `getSoundEnabled` / `setSoundEnabled`. Toggle no ícone de Volume na header do picking.

---

## 27. Indicador de Conexão WebSocket

`ConnectionStatusIndicator` exibe um badge colorido com o status da conexão WebSocket:

| Status | Cor | Descrição |
|---|---|---|
| `connected` | Verde | WebSocket ativo |
| `connecting` | Amarelo | Tentando conectar |
| `reconnecting` | Âmbar | Reconectando após queda |
| `disconnected` | Cinza | Desconectado (modo offline) |
| `error` | Vermelho | Erro de conexão |

---

## 28. Observações Críticas de Operação

### 28.1 Sync Python (`sync_db2.py`)

O sistema roda num servidor local Windows com `python sync_db2.py --serve`. O sync:
- Roda a cada **5 minutos** no processo Python e a cada **10 minutos** pelo Express.
- Remove registros antigos e reinsere/upserta orçamentos e pedidos.
- Durante o sync, work units podem temporariamente desaparecer da query (FK invalida temporariamente ou refetch pega estado intermediário).

**Proteções implementadas contra o sync:**
1. Safety redirect com debounce de 15s.
2. Guard de `isFetching` no safety redirect.
3. Polling suspenso durante bipagem.
4. `pendingInvalidateRef` adia invalidação SSE durante bipagem.

### 28.2 Lock TTL e Perda de Conexão

- Lock expira em **60 minutos** sem heartbeat.
- Heartbeat roda a cada **4 minutos**.
- Se o app fechar a força: 60 min de TTL antes de liberação automática.
- Na reconexão de rede: heartbeat imediato + toast "Conexão restaurada".
- Na queda de rede: toast "Sem conexão — lock ativo por 60 min".

### 28.3 Fila Offline de Scans

Bipes feitos sem conexão WebSocket são salvos em localStorage e reenviados quando reconectar. Mensagens com mais de 5 minutos são descartadas. O namespace da fila é `ws_scan_pending_queue_separacao:<userId>:<companyId>`.

### 28.4 `assertLockOwnership` — Barreira de Segurança

Todo endpoint que modifica dados do WU verifica:
1. `lockedBy === userId` (ou role supervisor/administrador).
2. `lockExpiresAt > now`.

Se falhar: `403 Forbidden` com mensagem "Lock expirado" ou "Unidade bloqueada por outro operador".

### 28.5 Timestamps como `TEXT`

Todos os campos de data/hora no banco são armazenados como `TEXT` (ISO 8601), não como `TIMESTAMPTZ`. Isso é uma decisão técnica deliberada (compatibilidade com o sync Python). **Não altere para TIMESTAMPTZ sem coordenar com o sync.**

---

## 29. Diagrama de Sequência — Bipagem Completa

```
Operador (scanner) → keydown → useBarcodeScanner → handleScanItem → scanQueueRef.push()
                                                                          ↓
                                                               processScanQueue() (mutex)
                                                                          ↓
                                                            Verifica cache local (queryClient)
                                                                          ↓
                                                              Detecta produto + work unit
                                                                          ↓
                                                              Abre/acumula QtyModal
                                                                          ↓
                                                      Operador confirma (ou auto-confirma se 1 un)
                                                                          ↓
                                            pendingDeltaStore.inc() → UI atualiza imediatamente
                                                                          ↓
                                               sendScan(workUnitId, barcode, qty, msgId)
                                                                          ↓
                                                         WebSocket → servidor ws-scanning.ts
                                                                          ↓
                                              storage.atomicScanSeparatedQty() → PostgreSQL
                                                                          ↓
                                                   broadcastSSE("item_picked") → todos clientes
                                                                          ↓
                                                            scan_ack { status: "success" }
                                                                          ↓
                                                   handleWsScanAck() → queryClient.invalidate()
                                                                          ↓
                                              React Query refetch → dados do banco chegam
                                                                          ↓
                                                     pendingDeltaStore.reconcile() → delta = 0
```

---

## 30. API Endpoints Completa do Módulo

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/api/work-units?type=separacao` | Lista WUs de separação (com RBAC por seção) |
| `POST` | `/api/work-units/lock` | Trava WUs para o usuário atual |
| `POST` | `/api/work-units/unlock` | Libera WUs (com reset opcional) |
| `POST` | `/api/work-units/:id/heartbeat` | Renova TTL do lock |
| `POST` | `/api/work-units/:id/scan-item` | Registra bipagem (REST fallback) |
| `POST` | `/api/work-units/:id/reset-item-picking` | Zera separatedQty de itens específicos |
| `POST` | `/api/work-units/:id/complete` | Conclui WU (verifica todos os itens) |
| `POST` | `/api/exceptions` | Registra exceção |
| `DELETE` | `/api/exceptions/item/:orderItemId` | Remove exceções de um item (supervisor+) |
| `POST` | `/api/exceptions/authorize` | Autoriza exceções com senha |
| `POST` | `/api/exceptions/authorize-by-badge` | Autoriza com crachá RF |
| `POST` | `/api/exceptions/auto-authorize` | Auto-autoriza (usuário com permissão) |
| `POST` | `/api/picking/deduct-address` | Deduz estoque de endereço após conclusão |
| `GET` | `/api/products/search?q=` | Busca de produto para consulta de estoque |
| `GET` | `/api/routes` | Lista rotas para filtro |
| `GET` | `/api/sections` | Lista seções para filtro de produtos |
| `WS` | `/ws/scanning` | WebSocket de bipagem (principal canal) |
| `SSE` | `/api/sse` | Server-Sent Events para atualizações em tempo real |

---

## 31. Modal de Confirmação de Saída (`AbandonConfirmDialog`) ✅ NOVO (2026-04-09)

Criado para substituir o comportamento anterior em que o botão `X` destruía o progresso imediatamente sem qualquer confirmação.

**Gatilho:** Qualquer um dos dois botões `X` da tela de picking (aba Produto e aba Lista) chama `handleExitPicking()`, que seta `abandonConfirmOpen = true`.

**Estrutura do modal:**

```
┌─────────────────────────────────────────┐
│  ⚠ Sair da coleta                       │
│                                          │
│  Escolha o que fazer com o progresso:    │
│                                          │
│  Suspender — sai e mantém tudo que foi  │
│  separado. Pode retomar depois.          │
│                                          │
│  Abandonar — apaga TODO o progresso.    │
│  Essa ação não pode ser desfeita.        │
│                                          │
│  [  Suspender (manter progresso)  ]      │  ← outline, neutro
│  [  Abandonar (apagar progresso)  ]      │  ← destructive (vermelho)
│  [    Cancelar (continuar)        ]      │  ← ghost
└─────────────────────────────────────────┘
```

**Comportamento de cada botão:**

| Botão | Chama | `reset` | Efeito no banco |
|---|---|---|---|
| Suspender | `handleCancelPicking(false)` | `false` | `lockedBy = null`, `separated_qty` inalterado |
| Abandonar | `handleCancelPicking(true)` | `true` | `lockedBy = null`, `separated_qty = 0`, pedido → pendente |
| Cancelar | fecha modal | — | nenhum |

**Atributo `data-scan-exclude="true"` no `DialogContent`:** Garante que o scanner não dispara scan ao fechar o modal clicando fora.

---

## 32. Tabela de Invariantes de Segurança de Dados

Esta tabela documenta o que **nunca deve acontecer** no módulo, como referência para futuras modificações:

| Invariante | Garantia atual | Quebra se... |
|---|---|---|
| `separated_qty` nunca é zerado por scan | `atomicScanSeparatedQty` retorna `already_complete` ou `over_quantity` sem UPDATE | Alguém reverter a correção de 2026-04-09 |
| `separated_qty` só é zerado com confirmação | `POST /reset-item-picking` só é chamado após o operador clicar "Recontar" | Modal `overQtyContext.serverAlreadyReset` for setado como `true` |
| Nenhum lock orphaned entra em picking automaticamente | Fallback removido de session restore | Alguém reintroduzir o bloco `const myUnit = workUnits.find(...)` |
| Saída da coleta exige confirmação | `handleExitPicking` sempre abre o modal | Botão `X` chamar `handleCancelPicking` diretamente |
| allMyUnits inclui só os IDs da sessão ativa | Filtro por `selectedWorkUnits` quando `step === "picking"` | `selectedWorkUnits` for limpo antes de `allMyUnits` ser calculado |

---

*Documento atualizado a partir do código-fonte atual do Stoker WMS — Abril 2026.*  
*Sprint 2026-04-09: 3 correções de risco alto aplicadas (zero automático removido, fallback de sessão removido, abandono exige confirmação).*

---

## 33. Registro de Riscos Técnicos Conhecidos

> Levantamento realizado em 2026-04-09. Cada risco tem ID único para rastreabilidade no backlog.  
> Documento de sprint: `docs/backlog-tecnico-separacao.md`.

### Severidade Crítica

---

#### RISK-01 — Divergência entre estado otimista (pendingDelta) e banco

**Componentes afetados:** `client/src/lib/pendingDeltaStore.ts`, `client/src/pages/separacao/index.tsx` (`handleWsScanAck`, `reconcile`)

**Descrição:** O frontend calcula progresso, bloqueio de conclusão e status visual como `serverSeparated + pendingDelta + exceptionQty`. O `reconcile()` foi desenhado para **preservar** o delta local quando o valor do servidor retrocede, com o objetivo de proteger o trabalho do operador. Porém, esse retrocesso pode ser legítimo: reset de supervisor, unlock remoto, rollback por erro transacional ou correção manual. Neste caso a UI continua exibindo uma quantidade que o banco já não tem — o operador crê que concluiu, o próximo operador vê saldo diferente, a conferência encontra divergência.

**Impacto operacional:** Erro operacional "fantasma" — difícil de reproduzir, impossível de atribuir causa depois.

**Correção necessária:**
- Quando `serverSeparated < (última baseline confirmada)`, não preservar delta silenciosamente.
- Marcar o item como `conflicted: true` no store.
- Bloquear botão "Concluir" enquanto qualquer item estiver em `conflicted`.
- Exibir aviso visual por item: "Quantidade no servidor foi alterada externamente — bipagem necessária para confirmar".

**Status:** Não corrigido. Backlog sprint 1.

---

#### RISK-02 — Dedução de endereço é best-effort (não bloqueia conclusão)

**Componentes afetados:** `server/routes.ts` (`POST /api/picking/deduct-address`), `handleCompleteAll`

**Descrição:** A dedução de saldo por endereço de coleta (`deduct-address`) é chamada ao concluir a separação, mas uma falha nessa chamada não impede a conclusão. O pedido entra em conferência com saldo de endereço intacto no sistema, criando divergência entre o físico (produto saiu do endereço) e o digital (endereço ainda registra saldo).

**Impacto operacional:** Endereçamento com saldo fantasma → operador é mandado a endereço vazio → reabastecimento incorreto → ruptura artificial.

**Correção necessária (escolher uma):**
- **Transacional:** incluir a dedução de endereço na mesma transação de `finalizeWorkUnits`, fazendo-a bloqueante.
- **Compensação persistida:** registrar a dedução pendente numa tabela `address_deduction_queue`, com `status = pending | done | failed`, processamento assíncrono e visibilidade para supervisor quando `failed`.

**Status:** Não corrigido. Backlog sprint 1.

---

#### RISK-03 — Fila offline descarta scans operacionais silenciosamente

**Componentes afetados:** `client/src/pages/separacao/index.tsx` (reconexão WebSocket, `offlineQueue`)

**Descrição:** Ao reconectar, scans salvos em `localStorage` com mais de 5 minutos são descartados sem notificação. O operador pode ter bipado normalmente durante uma queda de rede, continuar o fluxo e, ao reconectar, parte dos scans evaporar sem qualquer alerta.

**Impacto operacional:** Perda silenciosa de produtividade e divergência entre o que o operador "jura que bipou" e o que entrou no banco. Indetectável até a conferência.

**Correção necessária:**
- Scans expirados não devem ser descartados — devem ser movidos para uma fila de reconciliação persistida.
- Exibir tela/banner obrigatório: "X bipagens não confirmadas da sessão anterior — revise antes de continuar".
- Operador decide: rebipar ou ignorar (com log de auditoria da decisão).

**Status:** Não corrigido. Backlog sprint 1.

---

### Severidade Alta

---

#### RISK-04 — Deduplicação de msgId apenas em memória

**Componentes afetados:** `server/ws-scanning.ts` (`processedMsgIds`, Set em memória, TTL 5 min)

**Descrição:** O servidor usa um `Set` em memória para deduplicar scans por `msgId`. Se o processo reiniciar, se houver crash após gravar no banco mas antes de enviar o ACK, ou se existir mais de uma instância Node, o mesmo scan pode ser reaplicado.

**Impacto operacional:** Duplicidade rara, intermitente e quase impossível de provar depois. Destrói confiança na contagem.

**Correção necessária:** `msgId` deve ser persistido no banco (tabela `scan_idempotency_keys` ou coluna na tabela de itens) na **mesma transação** do `UPDATE separated_qty`. Qualquer scan com `msgId` já gravado retorna ACK de sucesso sem novo `UPDATE`.

**Status:** Não corrigido. ⬆️ **Promovido para sprint 1** por review sênior de 2026-04-09 — deduplicação em memória é insuficiente antes da expansão operacional. Ver TASK-S1-04.

---

#### RISK-05 — Roteamento do scan usa visão local do cache para escolher alvo

**Componentes afetados:** `client/src/pages/separacao/index.tsx` (`processScanQueue`, `targetUnit` decision logic)

**Descrição:** O `processScanQueue()` busca no cache local do `queryClient` qual `workUnit` deve receber o scan, priorizando unidades com quantidade restante. Quando o mesmo produto aparece em múltiplos pedidos/work units, ou quando há SSE atrasado/sync em andamento, a decisão pode ser feita com visão desatualizada.

**Impacto operacional:** Scan entrar no pedido/unidade errada. O operador não percebe — a bipagem parece correta na tela.

**Correção necessária:** O cliente deve incluir no payload do scan o `orderItemId` **resolvido no momento exato do enqueue em `processScanQueue`** — não o que está em foco visual na UI. O módulo faz autoavanço e troca de aba automaticamente; foco visual ≠ item efetivamente escolhido pela fila em cenários de corrida. O servidor valida autoritativamente que `item.work_unit_id === workUnitId`, retornando `target_mismatch` se divergir.

**Status:** Parcialmente mitigado (servidor valida lock). Validação de `orderItemId` autoritativa não implementada. Backlog sprint 2.

---

#### RISK-06 — Dois canais de entrada de barcode sem exclusão mútua garantida

**Componentes afetados:** `useBarcodeScanner` (global keydown), `ScanInput` (componente de fallback)

**Descrição:** O módulo captura barcodes por dois caminhos: o hook global `useBarcodeScanner` via eventos `keydown`, e o componente `ScanInput` como fallback. Em certos dispositivos/webviews/coletores, ambos podem capturar o mesmo evento físico de leitura, gerando scan duplicado antes mesmo da deduplicação por `msgId`.

**Impacto operacional:** Bipagem duplicada esporádica, especialmente difícil de reproduzir em coletores. Aparece como sobressoma sem causa aparente.

**Correção necessária:** Pipeline único de entrada. Se ambos os canais forem mantidos, cada leitura física deve receber um `nonce` temporal gerado no momento da captura, e o cliente deve deduplicar por `nonce` antes de enfileirar no `processScanQueue`.

**Status:** Não corrigido. Backlog sprint 2.

---

#### RISK-07 — Reset/recontagem pode competir com scans em voo (falta epoch de item)

**Componentes afetados:** `server/routes.ts` (`POST /reset-item-picking`), `server/ws-scanning.ts` (`atomicScanSeparatedQty`), `handleWsScanAck`

**Descrição:** Ao o operador confirmar "Recontar", o servidor zera `separated_qty`. Porém, se existir scan já enviado pela fila offline ou em trânsito no WebSocket, o ACK desse scan pode chegar depois do reset e somar quantidade em cima do item recontado. Não existe mecanismo de versão/epoch para invalidar ACKs anteriores ao reset.

**Impacto operacional:** Item recontado "volta" com quantidade antiga. Comportamento aparentemente sobrenatural para o operador, impossível de reproduzir sem logs de sequência exatos.

**Correção necessária:** Cada reset deve incrementar `item_epoch` (inteiro) no banco. Todo scan deve incluir o `epoch` que a UI viu no momento da bipagem. O servidor rejeita scans com `epoch` menor que o atual, retornando `stale_epoch` como status de ACK.

**Status:** Não corrigido. Backlog sprint 2.

---

#### RISK-08 — Worker de fila + modal aberto pode deixar tela congelada com dados velhos

**Componentes afetados:** `client/src/pages/separacao/index.tsx` (`scanWorkerRunning`, `overQtyModalOpen`, `pendingInvalidateRef`)

**Descrição:** O worker de scan é pausado quando `overQtyModalOpen = true` ou durante processamento de SSE. `pendingInvalidateRef` acumula invalidações para depois. Qualquer descompasso de estado — modal preso por erro não tratado, ref não descarregada, flag não resetada — pode deixar a tela operacional mas consumindo dados de um cache congelado.

**Impacto operacional:** Operador continua bipando olhando um contexto vencido. Especialmente grave em produção com rede instável.

**Correção necessária:** Watchdog explícito: se `scanWorkerRunning = true` por mais de N segundos (ex: 30s) sem completar ciclo, forçar reset da flag + re-sync de cache + exibir alerta "Fila de bipagem travada — sincronizando...". Instrumentar com `console.warn` + futura telemetria.

**Status:** Não corrigido. Backlog sprint 3.

---

#### RISK-11 — Sync Python cria estados transitórios que invalidam a visão do módulo 🆕

**Componentes afetados:** `server/index.ts` (flag `syncRunning`), `client/src/pages/separacao/index.tsx` (SSE handler, polling, `processScanQueue`)

**Descrição:** Durante o sync (Express interno a cada 10 min, Python `--serve` a cada 5 min), work units podem desaparecer temporariamente das queries enquanto o Python faz `DELETE + INSERT` para atualizar dados. As proteções atuais (safety redirect com 15s de debounce, suspensão de polling durante bipagem, atraso de invalidação via `pendingInvalidateRef`) são reativas — já agiram após a UI ter visto o estado transitório. Não existe sinalização proativa do tipo "sync em andamento" que permita ao cliente pausar proativamente a fila e suprimir o safety redirect.

**Impacto operacional:** Em condições de coincidência (sync + scan rápido + item repetido), a UI pode processar scans sobre uma visão transitória com work units ausentes, ou o safety redirect pode disparar durante sync e expulsar o operador sem motivo legítimo.

**Correção necessária:** Sinalizar proativamente o início e fim de sync via SSE (`sync_started` / `sync_ended`). O módulo de separação suspende polling e fila ao receber `sync_started`, suprime o safety redirect durante `syncInProgress`, e retoma tudo ao receber `sync_ended`. Expor `GET /api/sync-status` para clientes que reconectam durante sync.

**Refinamento rev2 (review sênior 2026-04-09):** A pausa de `syncInProgress` deve cobrir também (a) `ScanQuantityModal` — scan confirmado durante sync deve ser enfileirado mas não despachado; (b) flush de fila offline — reconexão WebSocket durante sync deve segurar o replay até `sync_ended`. Ordem de precedência: `overQtyModalOpen > syncInProgress > normal`.

**Refinamento rev3 (review sênior 2026-04-09):** Não basta segurar o despacho do `ScanQuantityModal` — o contexto resolvido naquele momento deve ser serializado junto do scan na fila. Campos obrigatórios do pacote congelado (9 campos, refinamento final): `msgId`, `workUnitId`, `orderItemId`, `itemEpoch`, `barcode`, `multiplier`, `quantity`, `resolvedAt` (timestamp ISO UTC no cliente), `syncGeneration` (contador de syncs conhecidos pelo cliente até aquele momento). Com todos os campos no pacote, o worker não "pensa de novo" — apenas despacha ou rejeita. `msgId` garante idempotência do dispatch; `quantity` evita que o worker precise acessar estado de UI; `resolvedAt` + `syncGeneration` provam ordem temporal. Ao receber `sync_ended`, o worker despacha exatamente esse contexto congelado, nunca re-resolvendo item/workUnit após o sync. Se o contexto congelado já não for mais válido, o scan é rejeitado com `ack_status = "sync_blocked"` e logado com `validation_result = { reason: "sync_blocked", frozen_epoch, current_epoch, resolved_at, sync_generation_at_freeze, sync_generation_current, lock_expires_at_at_dispatch, lock_valid_at_dispatch }`. O campo `lock_valid_at_dispatch` (booleano) permite distinguir "scan atravessou ciclo de sync" de "scan atravessou ciclo de sync e o lock também havia expirado" — raízes distintas que exigem investigações distintas. Re-resolver silenciosamente seria equivalente a permitir que o sync invalide o scan sem deixar rastro.

**Status:** Não corrigido. Novo risco — backlog sprint 2. Ver TASK-S2-05.

---

### Severidade Média-Alta

---

#### RISK-09 — Timestamps de lock em TEXT (ISO 8601) são frágeis para comparações críticas

**Componentes afetados:** `shared/schema.ts` (`lock_expires_at`), `server/storage.ts` (heartbeat, verificação de expiração), `sync_db2.py`

**Descrição:** `lock_expires_at` e demais timestamps são gravados como `TEXT` em ISO 8601. Comparações de expiração dependem de ordenação lexicográfica correta, o que funciona apenas se **todos** os escritores gravarem no mesmo formato UTC com Z. Node e Python podem divergir em fuso, precisão de milissegundos ou presença do `Z`.

**Impacto operacional:** Lock vencendo antes ou depois do esperado, unlock indevido, sessão considerada "expirada" quando ainda estava ativa — ou o inverso.

**Correção necessária (sem migrar tipo do banco):** Criar helper central `formatLockTimestamp(date: Date): string` no backend Node, e equivalente no Python, que **sempre** produza `YYYY-MM-DDTHH:mm:ss.sssZ`. Proibir gravação de timestamp de lock fora desse helper. Adicionar validação de formato na borda do heartbeat.

**Status:** Parcialmente mitigado (Node usa `new Date().toISOString()` que já inclui Z). Risco de divergência com Python não auditado. Backlog sprint 3.

---

#### RISK-10 — Restauração de sessão sem entidade `picking_session` no servidor

**Componentes afetados:** `client/src/pages/separacao/index.tsx` (restore via `localStorage`), `server/storage.ts` (sem tabela de sessão)

**Descrição:** A retomada de sessão funciona por `workUnitIds` gravados em `localStorage`. Não existe no banco uma entidade "sessão de picking" que associe `sessionId`, `deviceId`, `userId`, `workUnitIds` e `heartbeat`. Isso torna a retomada frágil em múltiplos dispositivos, trocas de turno e comportamento diferente entre browser novo e tab reutilizada.

**Impacto operacional:** Operador acha que "voltou certo" mas está num subconjunto incorreto de pedidos, ou retomando sessão de outro dispositivo.

**Correção necessária:** Criar tabela `picking_sessions` no banco com `id`, `user_id`, `device_id`, `work_unit_ids[]`, `started_at`, `last_heartbeat`, `status`. O cliente só restaura sessão cujo `status = active` e `user_id` bate. Sessões sem heartbeat por >LOCK_TTL são encerradas automaticamente.

**Status:** Não corrigido. Backlog sprint 3 (pré-requisito para RISK-10 é estabilizar RISK-01 e RISK-07 antes).

---

#### RISK-12 — Falta de observabilidade forense ponta a ponta 🆕

**Componentes afetados:** `server/ws-scanning.ts`, `server/routes.ts`, tabela `scan_log` (a ser criada em RISK-04)

**Descrição:** Para um bug raro de operação do tipo "o operador diz que bipou X vezes, o banco mostra Y", o log genérico atual não produz prova. Falta correlação de eventos ponta a ponta: `msgId → barcode → itemId → workUnitId → epoch_at_scan → scan_channel → enqueue_at (cliente) → processed_at → ack_status → reset_at → finalized_at`. Sem essa cadeia de campos indexada por `msgId`, a reconstituição de um incidente depende de interpretação, não de dados.

**Impacto operacional:** Bugs raros de contagem se tornam impossíveis de provar ou refutar, corroendo a confiança de supervisores e gerência no sistema. Disputas operacionais "foi bipado / não foi bipado" ficam sem resolução objetiva.

**Correção necessária:** Estender a tabela `scan_log` (criada em RISK-04/TASK-S1-04) com campos adicionais: `barcode`, `scan_channel`, `item_epoch_at_scan`, `enqueue_at`, `ack_status`, `user_id`. Expor endpoint de supervisor `GET /api/scan-log?workUnitId=&itemId=&barcode=&from=&to=` (somente roles `supervisor`/`admin`). Não expor ao operador.

**Refinamento rev2 (review sênior 2026-04-09):** Adicionar coluna `validation_result TEXT` (JSON) para capturar a razão exata de rejeições. Quando `target_mismatch` (RISK-05): gravar `{ reason, client_work_unit_id, client_order_item_id, server_work_unit_id, epoch_client, epoch_server }`. Quando `stale_epoch`: gravar `{ reason, epoch_client, epoch_server }`. Sem esse campo, o log prova que o scan foi rejeitado mas não prova se foi corrida de UI/cache ou erro operacional — distinção essencial para fechar incidentes.

**Refinamento rev3 (review sênior 2026-04-09 — padronização completa):** `validation_result` deve cobrir **todos** os `ack_status` que não sejam `success` — não apenas os dois primeiros. Deixar metade dos casos com JSON rico e a outra metade sem payload estruturado elimina a utilidade do campo em incidente real. Schema padronizado completo:

| `ack_status` | `validation_result` obrigatório |
|---|---|
| `success` | `null` |
| `already_complete` | `{ reason, separated_qty, quantity }` |
| `over_quantity` | `{ reason, separated_qty, quantity, available, requested }` |
| `target_mismatch` | `{ reason, client_work_unit_id, client_order_item_id, server_work_unit_id, epoch_client, epoch_server }` |
| `stale_epoch` | `{ reason, epoch_client, epoch_server }` |
| `sync_blocked` | `{ reason, frozen_epoch, current_epoch, resolved_at, sync_generation_at_freeze, sync_generation_current, lock_expires_at_at_dispatch, lock_valid_at_dispatch }` |
| `lock_expired` | `{ reason, locked_by, expired_at }` |
| `not_found` | `{ reason, barcode, work_unit_id }` |
| `error` | `{ reason, message }` |

Invariante de implementação: `reason` é sempre o primeiro campo e é idêntico ao `ack_status`, permitindo query por `validation_result::json->>'reason'` sem join. O campo `message` livre no ACK (para exibição ao operador) é separado e não substitui `validation_result` (para investigação técnica).

**Status:** Não corrigido. Novo risco — backlog sprint 3. Depende de TASK-S1-04. Ver TASK-S3-04.

---

### Resumo da Matriz de Risco

| ID | Descrição curta | Severidade | Sprint | Task | Arquivos principais |
|---|---|---|---|---|---|
| RISK-01 | pendingDelta vs banco — item `conflicted` | **Crítico** | 1 | S1-01 | `pendingDeltaStore.ts`, `separacao/index.tsx` |
| RISK-02 | Dedução de endereço não-transacional | **Crítico** | 1 | S1-02 | `routes.ts`, `storage.ts` |
| RISK-03 | Fila offline descarta scans silenciosamente | **Crítico** | 1 | S1-03 | `separacao/index.tsx` |
| RISK-04 | Dedup msgId só em memória | Alto | 1 ⬆️ | S1-04 | `ws-scanning.ts`, `storage.ts` |
| RISK-05 | Roteamento de scan via cache local | Alto | 2 | S2-02 | `separacao/index.tsx`, `ws-scanning.ts` |
| RISK-06 | Dois canais de barcode sem exclusão mútua | Alto | 2 | S2-03 | `useBarcodeScanner`, `ScanInput` |
| RISK-07 | Reset concorre com scans em voo (sem epoch) | Alto | 2 | S2-04 | `routes.ts`, `ws-scanning.ts` |
| RISK-08 | Worker travado deixa tela com dados velhos | Alto | 3 | S3-01 | `separacao/index.tsx` |
| RISK-11 | Sync Python cria estados transitórios 🆕 | Alto | 2 | S2-05 | `index.ts`, `separacao/index.tsx` |
| RISK-09 | Lock timestamp TEXT frágil a divergência UTC | Médio-Alto | 3 | S3-02 | `schema.ts`, `storage.ts`, `sync_db2.py` |
| RISK-10 | Sessão de picking sem entidade no servidor | Médio-Alto | 3 | S3-03 | `storage.ts`, `separacao/index.tsx` |
| RISK-12 | Falta de observabilidade forense 🆕 | Médio-Alto | 3 | S3-04 | `ws-scanning.ts`, `routes.ts` |

---

*Documento atualizado a partir do código-fonte atual do Stoker WMS — Abril 2026.*  
*Sprint 2026-04-09: 3 correções de risco alto aplicadas (zero automático removido, fallback de sessão removido, abandono exige confirmação).*  
*Seção 33 adicionada 2026-04-09: 10 riscos registrados a partir de review técnico sênior.*  
*Seção 33 revisada 2026-04-09 (2ª revisão): RISK-04 promovido para sprint 1; RISK-05 com ajuste de implementação; RISK-11 e RISK-12 adicionados. Total: 12 riscos.*  
*Seção 33 refinada 2026-04-09 (3ª revisão): RISK-11 estendido com pausa de QtyModal e flush offline; RISK-12 estendido com campo `validation_result` para rejeições de scan (target_mismatch, stale_epoch).*  
*Seção 33 refinada 2026-04-09 (4ª revisão): RISK-11 estendido com invariante de contexto congelado no QtyModal (workUnitId/orderItemId/epoch serializados na fila, nunca re-resolvidos pós-sync; rejeição explícita sync_blocked se contexto expirar). RISK-12 estendido com schema padronizado completo de `validation_result` para todos os ack_status — invariante: reason sempre igual ao ack_status, message livre separado do campo estruturado.*  
*Seção 33 refinada 2026-04-09 (5ª revisão): RISK-11 — pacote congelado do QtyModal estendido com `resolvedAt` e `syncGeneration`; payload de `sync_blocked` estendido com `resolved_at`, `sync_generation_at_freeze`, `sync_generation_current`. RISK-12 — tabela de validation_result atualizada: sync_blocked agora inclui resolved_at e sync_generation.*  
*Seção 33 refinada 2026-04-09 (revisão final): RISK-11 — pacote congelado fechado com 9 campos obrigatórios (`msgId`, `workUnitId`, `orderItemId`, `itemEpoch`, `barcode`, `multiplier`, `quantity`, `resolvedAt`, `syncGeneration`); payload `sync_blocked` estendido com `lock_expires_at_at_dispatch` e `lock_valid_at_dispatch` para distinguir "atravessou sync" de "atravessou sync com lock também morto". RISK-12 — tabela de validation_result: sync_blocked atualizado com os dois novos campos de lock.*
