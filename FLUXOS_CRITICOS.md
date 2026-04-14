# FLUXOS CRÍTICOS — STOKER WMS

> Diagramas e descrições passo a passo dos fluxos mais importantes do sistema.  
> Diagramas em Mermaid quando possível; descrição textual como complemento.

---

## FLUXO 1 — LOGIN E SELEÇÃO DE EMPRESA

```mermaid
sequenceDiagram
    actor U as Usuário
    participant FE as Frontend
    participant API as Backend /api/auth
    participant DB as PostgreSQL

    U->>FE: Acessa /login
    U->>FE: Informa username + password
    FE->>API: POST /api/auth/login
    API->>DB: SELECT user WHERE username = ?
    DB-->>API: user row
    API->>API: bcrypt.compare(password, hash)

    alt Credenciais inválidas
        API-->>FE: 401 "Credenciais inválidas"
        FE-->>U: Exibe erro
    else Usuário inativo
        API-->>FE: 401 "Usuário inativo"
    else 1 empresa na lista
        API->>DB: INSERT sessions (token, company_id)
        API-->>FE: {user, token, companyId, sessionKey}
        FE->>FE: Seta cookie authToken
        FE-->>U: Redireciona para /
    else Múltiplas empresas
        API-->>FE: {requireCompanySelection: true, companiesData}
        FE-->>U: Redireciona para /select-company
        U->>FE: Seleciona empresa
        FE->>API: POST /api/auth/select-company
        API->>DB: UPDATE sessions SET company_id = ?
        FE-->>U: Redireciona para /
    end
```

---

## FLUXO 2 — PEDIDO: DO ERP ATÉ O SISTEMA

```mermaid
flowchart TD
    A[ERP DB2\nCISSERP] -->|pyodbc ODBC| B[sync_db2.py]
    B -->|Upsert por CHAVE| C[(cache_orcamentos\nDados brutos do ERP)]
    C -->|Transformação\ncom db2_mappings| D[(orders\norder_items\nproducts)]
    D -->|Atualiza estoque| E[(product_company_stock)]
    B -->|broadcastSSE| F[sync_finished]
    F --> G[Frontend invalida\nqueries de orders]

    style A fill:#e8e8e8
    style B fill:#fff3cd
    style C fill:#f8d7da
    style D fill:#d4edda
    style E fill:#d4edda
```

**Detalhamento:**
1. Script Python `sync_db2.py` conecta via ODBC ao IBM DB2 na rede local (192.168.1.200:50000)
2. Consulta orçamentos dos últimos 31 dias
3. Faz upsert em `cache_orcamentos` usando `CHAVE` como chave única (incremental, nunca deleta)
4. Aplica mapeamento configurável (`db2_mappings.mapping_json`) para transformar campos DB2 → campos internos
5. Popula `orders`, `order_items`, `products`, `product_company_stock`
6. Emite SSE `sync_finished` ao concluir
7. Frontend invalida queries e recarrega pedidos automaticamente

---

## FLUXO 3 — LANÇAMENTO DE PEDIDO

```mermaid
sequenceDiagram
    actor S as Supervisor
    participant FE as Frontend
    participant API as Backend
    participant DB as PostgreSQL
    participant SSE as SSE Server

    S->>FE: Seleciona pedidos "pendente"
    S->>FE: Clica "Lançar"
    FE->>API: POST /api/orders/launch {orderIds, loadCode?}
    API->>DB: UPDATE orders SET status="em_separacao", is_launched=true, launched_at=now

    loop Para cada pedido
        API->>DB: SELECT DISTINCT section FROM order_items WHERE order_id = ?
        alt Modo by_order (padrão)
            API->>DB: INSERT work_units (1 por seção, type="separacao")
        else Modo by_section
            API->>DB: INSERT work_units (1 por pedido, section=null)
        end
    end

    API->>SSE: broadcastSSE("order_updated", {orderId, status}, companyId)
    API-->>FE: {success: true}
    SSE-->>FE: Evento order_updated
    FE->>FE: Invalida queries → operadores veem WUs
```

---

## FLUXO 4 — SEPARAÇÃO COMPLETA

```mermaid
flowchart TD
    A[Operador acessa /separacao] --> B[GET /api/work-units\nFiltrado por empresa + seções]
    B --> C{WU disponível?}
    C -->|Não| D[Aguarda / Polling 30s]
    C -->|Sim| E[POST /api/work-units/lock\nworkUnitIds: ids]
    E --> F{Lock bem-sucedido?}
    F -->|409 já bloqueado| G[Exibe erro]
    F -->|200 OK| H[WU status = em_andamento\nlocked_by = userId\nlock_expires_at = now+60min]
    H --> I[Para cada produto da WU]
    I --> J[Operador informa quantidade]
    J --> K[POST /api/work-units/:id/items/:itemId/scan-separated]
    K --> L[atomicIncrementSeparatedQty]
    L --> M{separated_qty >= quantity?}
    M -->|Não| N[item status = pendente]
    M -->|Sim| O[item status = separado]
    N --> I
    O --> P{Todos itens separados/excecao?}
    P -->|Não| I
    P -->|Sim| Q[POST /api/work-units/:id/complete]
    Q --> R[WU status = concluido\ncompletedAt = now]
    R --> S{Todas WUs do pedido concluídas?}
    S -->|Não| T[Broadcast: work_unit_updated]
    S -->|Sim| U[order status = separado\nCria WU de conferência\nBroadcast: work_unit_created]
```

**Proteção de sessão:**
- `sessionStorage` persiste `{workUnitIds, orderIds}` a cada mudança
- Ao recarregar: valida `lockedBy === userId` AND `lockExpiresAt > now` AND `orderId in saved.orderIds`

---

## FLUXO 5 — CONFERÊNCIA COM BARCODE

```mermaid
sequenceDiagram
    actor C as Conferente
    participant FE as Frontend (Scanner)
    participant API as Backend
    participant DB as PostgreSQL

    C->>FE: Vê WU de conferência disponível
    FE->>API: POST /api/work-units/lock {workUnitIds}
    API->>DB: UPDATE work_units SET locked_by, lock_expires_at
    API-->>FE: {success: true}

    loop Para cada produto
        C->>FE: Escaneia código de barras
        FE->>FE: Busca produto por barcode\n(unitário → box_barcode → box_barcodes[])
        FE->>API: POST /api/work-units/:id/items/:itemId/scan-checked\n{delta: qty}
        API->>DB: atomicScanCheckedQty(itemId, delta, targetQty)

        alt checked_qty + delta > targetQty
            API-->>FE: {result: "over_quantity"}
            FE-->>C: Exibe alerta de excesso
        else checked_qty == targetQty
            API-->>FE: {result: "already_complete"}
        else OK
            API->>DB: UPDATE order_items SET checked_qty, status="conferido"
            API-->>FE: {result: "success"}
        end
    end

    C->>FE: Clica "Concluir"
    FE->>API: POST /api/work-units/:id/complete
    API->>DB: WU status = concluido
    API->>DB: checkAndUpdateOrderStatus(orderId)
    API->>DB: order status = conferido/finalizado
```

---

## FLUXO 6 — BALCÃO

```mermaid
flowchart TD
    A[Operador acessa /balcao] --> B[GET /api/queue/balcao\nFiltro por pickup_points balcão da empresa]
    B --> C[Lista pedidos em fila]
    C --> D[Operador seleciona pedido]
    D --> E[POST /api/work-units/lock]
    E --> F[WU status = em_andamento\nFila exibe operador + timer]
    F --> G[Separação dos itens\nscan-separated]
    G --> H[Conferência dos itens\nscan-checked]
    H --> I[POST /api/work-units/complete]
    I --> J[Pedido finalizado\nDesaparece da fila após 5min]

    style B fill:#fff3cd
    note1[ATENÇÃO: WUs balcão têm\ntype=separacao no banco!\nIdentificação é SOMENTE\npor pickup_point]
```

**Identificação balcão:**
```
Empresa 1 → pickup_points balcão: [1, 2]
Empresa 3 → pickup_points balcão: [52, 54]
Configurado em: server/company-config.ts
```

---

## FLUXO 7 — EXCEÇÃO E AUTORIZAÇÃO

```mermaid
sequenceDiagram
    actor O as Operador
    actor S as Supervisor
    participant API as Backend
    participant DB as PostgreSQL

    O->>API: POST /api/exceptions\n{workUnitId, orderItemId, type, quantity}
    API->>DB: INSERT exceptions (reported_by = userId, authorized_by = null)
    API-->>O: {success: true, exceptionId}

    Note over O: Operador não consegue\nconcluir WU com exceção\nsem autorização

    S->>API: GET /api/exceptions (supervisor)
    API->>DB: SELECT exceptions WHERE authorized_by IS NULL
    API-->>S: Lista de exceções pendentes

    S->>API: PATCH /api/exceptions/:id/authorize
    API->>DB: UPDATE exceptions SET authorized_by, authorized_at
    API-->>S: {success: true}

    Note over O: Agora pode concluir a WU
```

**Exceção sem autorização:**
- Operador com `settings.canAuthorizeOwnExceptions = true` pode autorizar a própria exceção
- Tipos: `nao_encontrado`, `avariado`, `vencido`

---

## FLUXO 8 — UNLOCK E RESET

### 8A — Operador desbloqueia própria WU

```
1. Operador clica "Abandonar" / "Desbloquear"
2. POST /api/work-units/unlock {workUnitIds: [id]}
3. Backend: assertLockOwnership → validado
4. UPDATE work_units SET locked_by=null, lock_expires_at=null
5. WU volta para status anterior (pendente se estava em_andamento)
6. broadcastSSE("work_units_unlocked", ...)
```

### 8B — Supervisor desbloqueia WU de outro operador

```
1. Supervisor seleciona WUs na interface
2. POST /api/work-units/batch-unlock {workUnitIds: [...]}
3. Backend: role supervisor/admin → sem verificação de ownership
4. Para cada WU: locked_by=null, lock_expires_at=null
5. Se status era em_andamento → volta para pendente
6. Cria audit_log com ação "batch_unlock"
7. broadcastSSE → todos os operadores são notificados
```

### 8C — Session Restore ao recarregar

```
1. Operador recarrega a página
2. Frontend: loadSession() do sessionStorage
3. Valida cada WU salva:
   a. lockedBy === userId ✓
   b. lockExpiresAt > now ✓
   c. orderId ∈ saved.orderIds ✓
4. Se válido → restaura step="checking", workUnitIds
5. Se inválido → clearSession(), operador começa do zero
6. Fallback: busca qualquer WU com lockedBy === userId na API
```

---

## FLUXO 9 — SSE / ATUALIZAÇÃO EM TEMPO REAL

```mermaid
flowchart LR
    A[Frontend A\nEmpresa 1] -- EventSource GET /api/sse --> S[SSE Server\nMap de clients]
    B[Frontend B\nEmpresa 1] -- EventSource GET /api/sse --> S
    C[Frontend C\nEmpresa 3] -- EventSource GET /api/sse --> S

    S -- company_id=1 filter --> A
    S -- company_id=1 filter --> B
    S -. NÃO entrega .-> C

    D[Qualquer operação\nno backend] -- broadcastSSE\ntype, data, companyId=1 --> S
```

**Eventos e reações no frontend:**

| Evento SSE | Quem escuta | Reação |
|---|---|---|
| `work_unit_updated` | Separação, Conferência, Balcão | Invalida query de WUs |
| `work_unit_created` | Conferência, Supervisor | Invalida query de WUs |
| `order_updated` | Fila de Pedidos, Supervisor | Invalida query de orders |
| `work_units_unlocked` | Separação, Conferência | Invalida query de WUs |
| `sync_finished` | Supervisor, Fila | Invalida queries de pedidos |
| `picking_update` | Handheld | Atualiza estado do picking |
| `lock_acquired` | Handheld | Notifica lock adquirido |
| `lock_released` | Handheld | Notifica lock liberado |

**Heartbeat:** `: ping\n\n` a cada 30s para manter conexão via proxies  
**Reconexão:** EventSource reconecta automaticamente se a conexão cair

---

## FLUXO 10 — WMS BÁSICO (Recebimento e Movimentação)

```mermaid
flowchart TD
    A[NF chega da ERP\nem nf_cache] --> B[Recebedor acessa\n/wms/recebimento]
    B --> C[Seleciona NF pendente]
    C --> D[POST /api/wms/pallets\nCria pallet com itens da NF]
    D --> E[Pallet status: sem_endereco\nItems: produto+qtd+lote+validade]

    E --> F[Empilhador acessa\n/wms/checkin]
    F --> G[Escaneia QR code do pallet]
    G --> H[POST /api/wms/pallets/:id/allocate\n{addressId}]
    H --> I[Pallet status: alocado\nPallet vinculado ao endereço WMS]
    I --> J[INSERT pallet_movements\ntype: allocated]

    I --> K[Empilhador: Transferência]
    K --> L[POST /api/wms/pallets/:id/transfer\n{toAddressId}]
    L --> M[Pallet muda de endereço\nINSERT pallet_movements: transferred]
```

---

## FLUXO 11 — IMPRESSÃO DE ETIQUETAS

```mermaid
sequenceDiagram
    actor O as Operador
    participant FE as Frontend
    participant API as Backend
    participant WS as Print Agent WS
    participant AG as Agente Local\n(no PC do armazém)
    participant PR as Impressora

    O->>FE: Clica "Imprimir Etiqueta"
    FE->>API: POST /api/print/volume-label\n{orderId, volumes}
    API->>API: Monta job de impressão\n(impressora configurada para seção)
    API->>WS: Envia job ao agente via WebSocket
    WS->>AG: {type: "print_job", printer, content}
    AG->>PR: Envia para impressora física
    PR-->>AG: Confirmação
    AG-->>WS: {type: "print_result", success: true}
    WS-->>API: Resultado
    API-->>FE: {success: true}
    FE-->>O: Confirmação de impressão
```

---

## FLUXO 12 — HANDHELD (COLETOR DE DADOS)

```mermaid
sequenceDiagram
    actor H as Operador\n(Handheld)
    participant FE as Frontend /handheld/picking
    participant API as Backend
    participant DB as PostgreSQL

    H->>FE: Seleciona pedido + seção
    FE->>API: POST /api/lock {orderId, sectionId}
    API->>DB: INSERT picking_sessions\n(userId, orderId, sectionId, heartbeat=now)
    API-->>FE: {sessionId}

    loop Separação de itens
        H->>FE: Escaneia produto (scanner USB via WS)
        FE->>FE: Incrementa qty no estado local
        FE->>API: POST /api/heartbeat {sessionId}
        Note over API: TTL = 2 min sem heartbeat\nLock liberado se expirar
    end

    H->>FE: Conclui seção
    FE->>API: POST /api/picking/submit {orderId, sectionId, items[]}
    API->>DB: Transação atômica:
    API->>DB: UPDATE order_items SET qty_picked, status
    API->>DB: storage.checkAndUpdateOrderStatus(orderId)
    API-->>FE: {success: true}
    FE->>API: POST /api/unlock {orderId, sectionId}
```

**Deduplicação:** Cada item enviado tem um `msgId` UUID. Se o mesmo `msgId` chegar 2x (retry de rede), o segundo é ignorado via `scanLog`.

---

## RESUMO — MAPA DE DEPENDÊNCIAS ENTRE FLUXOS

```
sync_db2.py
    └── popula: cache_orcamentos → orders → order_items → products
                                                                ↓
                                                    Supervisor lança pedidos
                                                                ↓
                                                    WUs criadas (separacao)
                                                                ↓
                                                    Operador separa (lock → scan → complete)
                                                                ↓
                                                    WU conf criada automaticamente
                                                                ↓
                                                    Conferente confere (lock → scan → complete)
                                                                ↓
                                                    Pedido finalizado
                                                                ↓
                                                    Fila de pedidos oculta após 5min
```

---

*Diagramas baseados na implementação real de `server/routes.ts`, `server/storage.ts` e módulos do frontend*
