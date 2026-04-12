# Backlog Técnico — Módulo Separação (Picking)

> Originado do review técnico sênior de 2026-04-09.  
> Registro completo de riscos: `docs/separacao-modulo-tecnico.md` seção 33.  
> Homologação: `docs/homologacao-separacao.md`.

---

## Critérios de Priorização

| Critério | Peso |
|---|---|
| Perda irreversível de dados de operação | Crítico (bloqueia produção) |
| Inconsistência entre UI e banco que operador não detecta | Crítico |
| Perda silenciosa de trabalho do operador | Crítico |
| Bug esporádico que destrói confiança na contagem | Alto |
| Comportamento inesperado difícil de reproduzir | Alto |
| Fragilidade estrutural com falha condicional | Médio-Alto |

Sprints estimados em pontos de esforço relativos (1 ponto ≈ 1 turno de trabalho focado).

---

## Sprint 1 — Risco Crítico + Idempotência (Fazer antes de novo onboarding de operadores)

> Objetivo: eliminar os quatro caminhos que podem causar perda ou divergência de dados sem que ninguém perceba.  
> ⚠️ **RISK-04 (msgId persistido) foi promovido de Sprint 2 para Sprint 1** — segundo review sênior de 2026-04-09: deduplicação em memória é insuficiente para blindar duplicidade rara antes da expansão operacional.

### Regra de processo — válida para todas as tasks críticas desta sprint

> *"O risco maior deixa de ser desenho e passa a ser só execução sem disciplina."*

**Antes de escrever a primeira linha de código:**
1. Reproduzir o defeito do CT-02 da task em ambiente de teste.
2. Registrar evidência da reprodução — print, log ou vídeo curto mostrando o defeito existindo.

**Na PR da task:**
- Evidência do CT-02 **antes** da correção (defeito reproduzido).
- Evidência do CT-02 **depois** da correção (defeito eliminado).
- Evidência do fluxo feliz sem regressão (CT-04 de cada task).
- Evidência do CT-05 (caso de fronteira).

**Gate de aceitação:**
- Task considerada pronta **somente** com as quatro evidências acima. PR que passa em CT-01, CT-03 a CT-05 mas falha em CT-02 **não está homologada** — a correção pode ter alterado sintoma visual sem matar a causa.
- CT-02 deve virar teste fixo de regressão, não teste "rodado uma vez na PR".

**Ordem de execução dentro da sprint:**
1. S1-01 (conflicted state) — impacto visual mais imediato para operadores.
2. S1-03 (fila offline) — depende do ambiente de rede para reproduzir.
3. S1-04 (msgId persistido) — requer restart de servidor controlado no CT-02.
4. S1-02 (dedução de endereço) — decidir Opção A ou B antes de codar.

Não misturar refactor paralelo com as tasks desta sprint. Cada task é implementada, homologada e fechada antes de abrir a próxima.

---

### TASK-S1-01 — Marcar item como `conflicted` quando servidor retrocede (RISK-01)

**Risco:** RISK-01 (Crítico)  
**Esforço:** 3 pontos  
**Arquivos principais:**
- `client/src/lib/pendingDeltaStore.ts`
- `client/src/pages/separacao/index.tsx` (ACK handler, `handleWsScanAck`, botão Concluir)

**O que fazer:**

1. **`pendingDeltaStore.ts`** — adicionar estado `conflicted: boolean` por item no store. Modificar `reconcile()`:
   - Se `serverValue < lastConfirmedBaseline`, em vez de preservar delta, setar `conflicted = true` e zerar delta local para o item.
   - Novo método `clearConflict(scope, itemId)` — chamado após operador rebipar com sucesso (ACK `success`).

2. **`separacao/index.tsx`** — em `handleWsScanAck` no case `success`:
   - Após invalidar cache, verificar se o item estava em `conflicted` e chamar `clearConflict`.

3. **`separacao/index.tsx`** — UI por item em estado `conflicted`:
   - Badge âmbar "Rebipar" no card do item.
   - Tooltip: "Quantidade alterada externamente. Rebipar para confirmar."

4. **`separacao/index.tsx`** — botão "Concluir":
   - Desabilitar (com `title` explicativo) enquanto `anyConflicted = true`.

**Cenários de teste pré-implementação** (homologar antes de codar — review sênior 2026-04-09):

> A armadilha mais comum é testar só o caso "supervisor resetou e pronto". O caso que realmente pega operação é o reset concorrendo com delta pendente local — esse precisa existir desde o primeiro dia.

**CT-01 — Retrocesso externo simples**
- Pré-condição: item com `separated_qty = 5`, UI com `baseline` confirmado em 5.
- Ação: supervisor executa reset do item via API.
- Esperado: no próximo `reconcile`, item vira `conflicted`, delta local zera, badge "Rebipar" aparece, Concluir fica bloqueado.
- *Cenário-base do critério de aceite.*

**CT-02 — Retrocesso externo com delta pendente local** *(caso crítico)*
- Pré-condição: banco em 5, operador bipa +2, UI mostra 7 por `pendingDelta`, ACK ainda não consolidou.
- Ação: antes do ACK/refetch estabilizar, supervisor reseta o item.
- Esperado: sistema não preserva os +2 como verdade visual; item entra em `conflicted`, delta local zera, tela não exibe 7.
- *É aqui que nasce o "erro fantasma" — esse cenário deve existir antes de qualquer outra coisa.*

**CT-03 — Rebipagem limpa o conflito**
- Pré-condição: item já está em `conflicted`.
- Ação: operador rebipa corretamente o produto, recebe ACK `success`.
- Esperado: `clearConflict` roda, badge some, item volta ao fluxo normal; Concluir só reabilita se nenhum outro item estiver `conflicted`.

**CT-04 — ACK `success` normal não cria regressão**
- Pré-condição: item sem conflito, fluxo normal de bipagem.
- Ação: operador bipa e recebe ACK `success`.
- Esperado: comportamento atual íntegro — sem badge indevido, sem bloqueio indevido de Concluir, sem limpar estado normal.
- *Evita corrigir uma ponta quebrando o fluxo feliz.*

**CT-05 — Múltiplos itens, conflito parcial**
- Pré-condição: pedido com 3 itens; 2 completos, 1 sofre retrocesso externo.
- Ação: `reconcile` após reset de apenas um item.
- Esperado: só o item afetado fica `conflicted`; os demais mantêm estado normal; mesmo assim, Concluir permanece bloqueado por `anyConflicted = true`.
- *Garante que o bloqueio é global mas a sinalização é granular por item.*

**Camadas de teste:**

| Camada | O que validar |
|---|---|
| **Unitário do store** | `reconcile()` → transição para `conflicted`, limpeza de delta, `clearConflict` |
| **Integração da página** | Badge âmbar por item, tooltip, estado do botão Concluir |
| **E2E controlado** | Operador em picking + ação externa de supervisor + refetch/reconcile |

**Critério de aceite:**
- [ ] CT-01: reset simples → badge "Rebipar" no item, Concluir bloqueado.
- [ ] CT-02: reset com delta pendente → sistema não preserva +2 como verdade visual; `conflicted` prevalece, delta zerando.
- [ ] CT-03: rebipagem com ACK `success` → `clearConflict`, badge some, Concluir liberado se nenhum outro item conflitado.
- [ ] CT-04: fluxo normal sem conflito → sem regressão (badge indevido, bloqueio indevido de Concluir).
- [ ] CT-05: reset parcial em pedido com 3 itens → apenas item afetado `conflicted`; Concluir bloqueado globalmente.

---

### TASK-S1-02 — Dedução de endereço transacional ou com fila de compensação visível (RISK-02)

**Risco:** RISK-02 (Crítico)  
**Esforço:** 2 pontos  
**Arquivos principais:**
- `server/routes.ts` (`POST /api/picking/deduct-address`, `finalizeWorkUnits`)
- `server/storage.ts`

**Decisão a tomar antes de implementar:**

| Opção | Vantagem | Desvantagem |
|---|---|---|
| **A) Transacional** — deduz dentro da mesma tx de `finalizeWorkUnits` | Garantia forte, sem tabela extra | Rollback de conclusão se endereço falhar |
| **B) Fila persistida** — `address_deduction_queue` com reprocessamento | Não bloqueia conclusão | Tabela extra, visibilidade para supervisor necessária |

**Recomendação:** Opção A se `deduct-address` raramente falha; Opção B se falhas são esperadas (ex: endereços sem saldo pré-cadastrado).

**O que fazer (Opção A):**

1. Mover a lógica de `deduct-address` para dentro da função `finalizeWorkUnits` no `storage.ts`, dentro da mesma transação Drizzle.
2. Se a dedução falhar (ex: saldo insuficiente no endereço), retornar erro HTTP 409 com mensagem clara.
3. Frontend exibe o erro e **não** marca pedido como concluído.

**O que fazer (Opção B — alternativa):**

1. Criar tabela `address_deduction_queue` com colunas: `id`, `work_unit_id`, `address_id`, `qty`, `status` (`pending | done | failed`), `created_at`, `attempts`, `last_error`.
2. Ao concluir separação, inserir registro na fila (mesma tx de `finalizeWorkUnits`).
3. Worker Express (ou rota de supervisor) processa fila e faz dedução real.
4. UI de supervisor exibe registros `failed` com botão "Reprocessar".

**Critério de aceite:**
- [ ] Simular falha em `deduct-address` → conclusão bloqueada (Opção A) ou erro visível para supervisor (Opção B).
- [ ] Fluxo normal inalterado — conclusão com endereço válido funciona sem regressão.

---

### TASK-S1-03 — Fila offline com tela de reconciliação obrigatória (RISK-03)

**Risco:** RISK-03 (Crítico)  
**Esforço:** 3 pontos  
**Arquivos principais:**
- `client/src/pages/separacao/index.tsx` (lógica de reconexão WebSocket, `offlineQueue`, `flushOfflineQueue`)

**O que fazer:**

1. **Separar scans expirados de scans descartáveis:**
   - Scans com `age < 5 min`: enviar normalmente ao reconectar (comportamento atual).
   - Scans com `age >= 5 min`: **não descartar** — mover para `expiredScanQueue` em `localStorage`.

2. **Ao reconectar com `expiredScanQueue` não vazia:**
   - Exibir banner obrigatório antes de liberar a tela de picking: "X bipagens não confirmadas da sessão anterior".
   - Listar os scans (produto, qtd, horário).
   - Botões por scan: "Rebipar manualmente" (abre produto diretamente) | "Ignorar" (com confirmação).
   - Registrar no log de auditoria (`console.warn` + futura telemetria): quem ignorou, quando, qual produto.

3. **Após o operador revisar todos os scans expirados**, limpar `expiredScanQueue` e liberar picking.

4. Adicionar `data-testid="banner-expired-scans"` e `data-testid="btn-ignore-scan-{id}"` para teste.

**Cenários de teste pré-implementação** (homologar antes de codar — review sênior 2026-04-09):

> O caso crítico não é o banner em si — é o comportamento quando há scans mistos (alguns dentro do TTL, outros expirados) e quando o operador tenta ignorar sem revisar. Sem CT-02 e CT-05 passando, a task não está homologada.

**CT-01 — Reconexão com scans recentes (age < 5 min)**
- Pré-condição: operador fica offline 3 minutos, bipa 2 produtos durante a queda.
- Ação: reconecta.
- Esperado: scans enviados normalmente ao reconectar, banner não aparece, picking não bloqueado.
- *Garante que o comportamento atual não regrediu para scans dentro do TTL.*

**CT-02 — Reconexão com scans expirados (age ≥ 5 min)** *(caso crítico)*
- Pré-condição: operador fica offline 8 minutos, bipa 3 produtos durante a queda.
- Ação: reconecta.
- Esperado: banner obrigatório aparece com os 3 scans listados (produto, qtd, horário); picking bloqueado até revisão completa de todos; scans **não** enviados automaticamente ao servidor.
- *O scan expirado que vai direto ao servidor sem revisão é o erro que esta task existe para eliminar.*

**CT-03 — Ignorar scan expirado com confirmação**
- Pré-condição: banner com 2 scans expirados visível.
- Ação: operador clica "Ignorar" no primeiro scan.
- Esperado: diálogo de confirmação aparece; ao confirmar, scan removido da `expiredScanQueue`; log registrado (quem ignorou, quando, qual produto); banner ainda exibe o segundo scan.

**CT-04 — Rebipar manualmente scan expirado**
- Pré-condição: banner com scan expirado visível.
- Ação: operador clica "Rebipar manualmente".
- Esperado: produto aberto diretamente; operador bipa fisicamente; ACK `success` recebido; scan removido da `expiredScanQueue`; quando todos revisados, picking liberado.

**CT-05 — Scans mistos (recentes e expirados na mesma reconexão)**
- Pré-condição: operador fica offline 7 minutos; bipa produto A aos 2 min (recente) e produto B aos 6 min (expirado).
- Ação: reconecta.
- Esperado: produto A enviado normalmente (age < 5 min); produto B aparece no banner (age ≥ 5 min); nenhum dos dois é conflado com o outro; picking parcialmente bloqueado até revisar produto B.
- *Valida que a separação por TTL é correta e os dois grupos não interferem.*

**Camadas de teste:**

| Camada | O que validar |
|---|---|
| **Unitário da fila** | Separação entre `offlineQueue` e `expiredScanQueue` pela idade do scan |
| **Integração da página** | Aparecimento/desaparecimento do banner, bloqueio de picking, log de "Ignorar" |
| **E2E controlado** | Queda de rede simulada + reconexão + revisão completa + picking liberado |

**Critério de aceite:**
- [ ] CT-01: scans dentro do TTL → sem banner, enviados normalmente.
- [ ] CT-02: scans expirados → banner obrigatório, picking bloqueado, nenhum scan enviado automaticamente ao servidor.
- [ ] CT-03: "Ignorar" → confirmação + log + remoção da fila.
- [ ] CT-04: "Rebipar manualmente" → ACK success → scan removido da `expiredScanQueue`.
- [ ] CT-05: scans mistos → TTL < 5min enviados, TTL ≥ 5min no banner — sem conflação entre os grupos.

---

### TASK-S1-04 — Persistir msgId no banco como chave idempotente (RISK-04) ⬆️ promovida de Sprint 2

**Risco:** RISK-04 (Alto → promovido por review sênior 2026-04-09)  
**Esforço:** 3 pontos  
**Motivo da promoção:** Deduplicação em memória (`processedMsgIds` Set) é insuficiente para blindar duplicidade rara antes da expansão operacional. Queda de processo após gravar no banco e antes de enviar ACK causa reprocessamento sem rastreabilidade.  
**Arquivos principais:**
- `shared/schema.ts` (nova tabela `scan_log`)
- `server/ws-scanning.ts` (`atomicScanSeparatedQty`)
- `server/storage.ts`

**O que fazer:**

1. **`shared/schema.ts`** — criar tabela `scan_log`:
   ```typescript
   export const scanLog = pgTable("scan_log", {
     msg_id: text("msg_id").primaryKey(),
     work_unit_id: integer("work_unit_id").notNull(),
     item_id: integer("item_id").notNull(),
     qty: integer("qty").notNull(),
     processed_at: text("processed_at").notNull(),
   });
   ```

2. **`server/storage.ts`** — em `atomicScanSeparatedQty`, dentro da mesma transação do `UPDATE`:
   - Tentar `INSERT INTO scan_log (msg_id, ...) ON CONFLICT (msg_id) DO NOTHING`.
   - Se `rowsAffected = 0` (conflito): o scan já foi processado — retornar ACK sem novo `UPDATE`.

3. **`server/ws-scanning.ts`** — remover o `Set` em memória `processedMsgIds` (substituído pelo banco).

4. **`server/index.ts`** — cron diário: deletar registros de `scan_log` com `processed_at` mais antigo que 24h.

**Nota:** `scan_log` é o pré-requisito de TASK-S3-04 (observabilidade forense) — a tabela vai ser estendida naquele momento.

**Cenários de teste pré-implementação** (homologar antes de codar — review sênior 2026-04-09):

> O caso crítico é o restart do servidor entre os dois envios. Se só passar no CT-01 (sem restart), a deduplicação em memória já bastaria — e a task não estaria provando nada novo. CT-02 é o único cenário que distingue `processedMsgIds Set` de persistência real no banco.

**CT-01 — Replay simples sem restart de servidor**
- Pré-condição: servidor ativo, `separated_qty = 3`.
- Ação: enviar scan com `msgId = "abc-001"`, receber ACK `success`; reenviar o mesmo `msgId = "abc-001"` imediatamente.
- Esperado: banco atualizado uma única vez; segundo envio retorna ACK sem novo `UPDATE`; `scan_log` tem 1 registro com `msg_id = "abc-001"`.
- *Prova que o conflito é detectado — mas ainda pode ser explicado pelo Set em memória.*

**CT-02 — Replay após restart do servidor** *(caso crítico)*
- Pré-condição: `separated_qty = 3`.
- Ação: enviar scan com `msgId = "abc-002"`, confirmar gravação no banco; reiniciar o processo Express (Set em memória zerado); reenviar o mesmo `msgId = "abc-002"`.
- Esperado: banco permanece com a quantidade do primeiro envio; `scan_log` ainda tem 1 registro; `ON CONFLICT DO NOTHING` impede segundo `UPDATE`.
- *Este cenário é o único que prova que a deduplicação em memória era insuficiente e que o banco é a única garantia real.*

**CT-03 — Dois scans legítimos com msgIds diferentes**
- Pré-condição: `separated_qty = 0`.
- Ação: enviar `msgId = "abc-003"` (qty=2) e `msgId = "abc-004"` (qty=1).
- Esperado: ambos processados, `separated_qty = 3`, `scan_log` com 2 registros.
- *Garante que a idempotência não vira barreira para scans legítimos distintos.*

**CT-04 — Cleanup diário não remove logs recentes**
- Pré-condição: `scan_log` com registro de 12h atrás.
- Ação: disparar cron de cleanup.
- Esperado: registro preservado; a janela de idempotência de 24h é respeitada.

**CT-05 — Cleanup diário remove logs antigos e janela de idempotência expira explicitamente**
- Pré-condição: `scan_log` com registro de 25h atrás com `msg_id = "abc-999"`.
- Ação: disparar cron de cleanup; depois reenviar `msgId = "abc-999"`.
- Esperado: registro deletado pelo cleanup; segundo envio de `"abc-999"` é processado normalmente (não é mais idempotente após 24h).
- *Documenta que a janela de idempotência é 24h — decisão explícita, não comportamento implícito.*

**Camadas de teste:**

| Camada | O que validar |
|---|---|
| **Unitário do storage** | `INSERT ... ON CONFLICT DO NOTHING` + detecção de `rowsAffected = 0` |
| **Integração do servidor** | Comportamento de ACK em replay; cleanup cron por data |
| **E2E controlado** | CT-02 completo: envio → gravação → restart Express → reenvio → idempotência preservada |

**Critério de aceite:**
- [ ] CT-01: mesmo `msgId` enviado duas vezes (servidor ativo) → banco atualizado uma vez.
- [ ] CT-02: restart do servidor entre os envios → idempotência preservada pelo banco, não pela memória.
- [ ] CT-03: dois `msgId` distintos → ambos processados corretamente.
- [ ] CT-04: cleanup não remove logs com < 24h.
- [ ] CT-05: cleanup remove logs com > 24h; janela de idempotência expira explicitamente.

---

## Sprint 2 — Risco Alto + Sync (Fazer antes de escalar para mais de 3 operadores simultâneos)

> Objetivo: fechar as brechas de duplicidade de canal, roteamento errado, competição de estado e estados transitórios do sync Python.

> ~~TASK-S2-01~~ (RISK-04) foi promovida para Sprint 1 como TASK-S1-04.

---

### TASK-S2-02 — Servidor valida alvo do scan autoritativamente (RISK-05)

**Risco:** RISK-05 (Alto)  
**Esforço:** 2 pontos  
**Arquivos principais:**
- `server/ws-scanning.ts` (`handleScanItem`)
- `client/src/pages/separacao/index.tsx` (`processScanQueue`, payload do scan)

**⚠️ Ajuste de implementação (review sênior 2026-04-09):** O `orderItemId` enviado deve ser o **resolvido no momento exato do enqueue em `processScanQueue`** — quando o `targetUnit` e `targetItem` são determinados pela fila —, não o que está visualmente em foco na UI naquele instante. O módulo faz autoavanço e troca de aba automaticamente; foco visual ≠ item efetivamente escolhido pela fila em cenários de corrida.

**O que fazer:**

1. **Frontend** — em `processScanQueue`, no momento de resolução do `targetItem`, capturar `orderItemId` e incluí-lo no payload WebSocket junto com `workUnitId`.

2. **`server/ws-scanning.ts`** — em `handleScanItem`, após validar lock:
   - Buscar o item pelo `orderItemId` recebido.
   - Validar que `item.work_unit_id === workUnitId` (cliente e servidor concordam no alvo).
   - Se divergir: retornar ACK `target_mismatch` com mensagem "Pedido/item alterado externamente — sincronizando".
   - Frontend trata `target_mismatch`: invalida cache, remove scan da fila e exibe alerta.

**Critério de aceite:**
- [ ] Scan com `orderItemId` correto: fluxo normal.
- [ ] Scan com `orderItemId` de work unit diferente: ACK `target_mismatch`, scan não aplicado.
- [ ] Frontend exibe alerta e invalida cache após `target_mismatch`.

---

### TASK-S2-03 — Pipeline único de entrada com nonce temporal (RISK-06)

**Risco:** RISK-06 (Alto)  
**Esforço:** 1 ponto  
**Arquivos principais:**
- `client/src/hooks/useBarcodeScanner.ts` (ou equivalente)
- `client/src/components/ScanInput.tsx` (ou equivalente)
- `client/src/pages/separacao/index.tsx` (`handleScanInput`)

**O que fazer:**

1. Criar um `Set` de deduplicação local `recentScanNonces` (em memória, TTL 500ms) na página de separação.

2. Ao capturar um barcode por qualquer canal, gerar `nonce = "${barcode}:${Date.now().toString(36)}"` truncado por timestamp (os dois lados truncam para `100ms` de janela, ex: `Math.floor(Date.now()/100)`).
   - Nonce efetivo: `"${barcode}:${Math.floor(Date.now()/100)}"`.

3. Antes de enfileirar: verificar se `recentScanNonces.has(nonce)`. Se sim, descartar silenciosamente. Se não, adicionar ao Set e enfileirar.

4. Limpar entradas antigas do Set com `setTimeout` de 500ms.

**Critério de aceite:**
- [ ] Scanner de coletor disparando `keydown` e `ScanInput` simultaneamente: apenas 1 scan enfileirado.
- [ ] Dois barcodes diferentes em < 100ms: ambos enfileirados.

---

### TASK-S2-04 — Epoch de item para invalidar ACKs antigos após reset (RISK-07)

**Risco:** RISK-07 (Alto)  
**Esforço:** 3 pontos  
**Arquivos principais:**
- `shared/schema.ts` (coluna `item_epoch` nos order items)
- `server/storage.ts` (`atomicScanSeparatedQty`, `resetItemPicking`)
- `server/ws-scanning.ts` (payload e validação)
- `client/src/pages/separacao/index.tsx` (incluir epoch no scan, tratar `stale_epoch`)

**O que fazer:**

1. **`shared/schema.ts`** — adicionar coluna `item_epoch integer default 0` na tabela de itens de picking.

2. **`server/storage.ts`** — em `resetItemPicking`: incrementar `item_epoch += 1` na mesma transação do reset.

3. **`server/ws-scanning.ts`** — ao validar scan:
   - Comparar `scan.epoch` (enviado pelo cliente) com `item.item_epoch` do banco.
   - Se `scan.epoch < item.item_epoch`: retornar ACK `stale_epoch` — scan não aplicado.

4. **Frontend** — ao enfileirar scan, incluir `epoch` atual do item (do cache local).
   - Tratar ACK `stale_epoch`: limpar delta local + invalidar cache + exibir "Produto foi recontado — contexto atualizado".

**Critério de aceite:**
- [ ] Operador recontou → envia scan antigo → ACK `stale_epoch` → banco inalterado.
- [ ] Operador recontou → rebipar normalmente → ACK `success` → banco atualizado com epoch novo.

---

### TASK-S2-05 — Blindagem explícita contra estados transitórios do sync Python (RISK-11) 🆕

**Risco:** RISK-11 (Alto — novo, adicionado por review sênior 2026-04-09)  
**Esforço:** 2 pontos  
**Arquivos principais:**
- `server/index.ts` (flag `syncRunning`, SSE emitter)
- `client/src/pages/separacao/index.tsx` (handler SSE, suspensão de fila)

**Contexto:** A documentação admite que durante o sync Python, work units podem desaparecer transitoriamente das queries (`DELETE + INSERT` para atualizar dados). As proteções atuais (safety redirect 15s, suspensão de polling durante bipagem, atraso de invalidação SSE) são reativas — respondem após a UI já ter visto o estado transitório. Não existe sinalização proativa de "sync em andamento".

**O que fazer:**

1. **`server/index.ts`** — ao iniciar sync (Express ou Python), emitir evento SSE `sync_started` para todos os clientes conectados antes de qualquer alteração. Ao terminar, emitir `sync_ended`.

2. **`server/routes.ts`** — endpoint `GET /api/sync-status` retorna `{ syncing: boolean, startedAt: string | null }` — útil para clientes que reconectam durante sync.

3. **`client/src/pages/separacao/index.tsx`** — no handler SSE, tratar `sync_started` e `sync_ended`:
   - `sync_started`: setar flag `syncInProgress = true`, suspender polling (refetchInterval → 0), exibir chip discreto "Sincronizando dados..." no header.
   - `sync_ended`: setar `syncInProgress = false`, retomar polling, limpar chip, invalidar cache de work units.

4. Em `processScanQueue()`, se `syncInProgress = true`: pausar processamento da fila (como faz com `overQtyModalOpen`), retomando automaticamente ao receber `sync_ended`.

5. **Caminhos laterais que também precisam respeitar `syncInProgress`** (refinamento review sênior 2026-04-09):
   - **`ScanQuantityModal` aberto — contexto congelado** (refinamento review sênior 2026-04-09): não basta segurar o despacho ao WebSocket. Quando o operador confirmar quantidade no modal, o contexto resolvido naquele momento deve ser serializado junto do scan na fila. Campos obrigatórios do pacote congelado (refinamento final review sênior 2026-04-09): `msgId`, `workUnitId`, `orderItemId`, `itemEpoch`, `barcode`, `multiplier`, `quantity`, `resolvedAt` (timestamp ISO UTC no cliente), `syncGeneration` (contador de syncs conhecidos pelo cliente até aquele momento). Com todos os campos no pacote, o worker não precisa "pensar de novo" — ele só despacha ou rejeita; a lógica de resolução do alvo já aconteceu antes da confirmação do modal, e transformá-la em pacote imutável é a continuação natural dessa arquitetura. Os campos `resolvedAt` e `syncGeneration` provam ordem temporal; `msgId` garante idempotência do dispatch; `quantity` evita que o worker precise acessar estado de UI para montar o scan. Ao receber `sync_ended`, o worker despacha exatamente esse contexto congelado — **nunca re-resolver** item/workUnit após o sync, pois o sync pode ter alterado IDs, posições ou quantidades. Se o contexto congelado já não for mais válido ao despachar (ex: lock expirou, workUnit mudou), o scan deve ser rejeitado com `ack_status = "sync_blocked"` e logado no `scan_log` com `validation_result` completo (ver tabela TASK-S3-04).
   - **Flush de fila offline** (`flushOfflineQueue` na reconexão WebSocket): se reconectar durante `syncInProgress = true`, segurar o flush até `sync_ended`. Sem isso, scans offline reintroduzidos durante sync operam sobre visão transitória do banco.
   - **Ordem de precedência de pausa**: `overQtyModalOpen` > `syncInProgress` > normal — o worker já respeita o modal; `syncInProgress` deve ser a próxima condição verificada antes de despachar qualquer scan.

**Critério de aceite:**
- [ ] Trigger de sync → chip "Sincronizando dados..." visível em todos os clientes conectados.
- [ ] Bipagem durante sync: fila pausa, retoma após `sync_ended`, scans processados normalmente.
- [ ] Cliente que reconecta durante sync: `GET /api/sync-status` retorna `syncing: true`, chip exibido.
- [ ] Safety redirect de 15s não dispara durante `syncInProgress` (work units ausentes são esperados).
- [ ] Confirmar quantidade no `ScanQuantityModal` durante sync: pacote congelado serializado na fila com todos os 9 campos — `msgId`, `workUnitId`, `orderItemId`, `itemEpoch`, `barcode`, `multiplier`, `quantity`, `resolvedAt`, `syncGeneration`; despacho aguarda `sync_ended`.
- [ ] Contexto congelado invalida após sync: scan rejeitado com `sync_blocked`; `validation_result` contém `resolved_at`, `sync_generation_at_freeze`, `sync_generation_current`, `lock_expires_at_at_dispatch`, `lock_valid_at_dispatch` — não re-resolvido silenciosamente.
- [ ] `lock_valid_at_dispatch = false` distingue "scan atravessou sync" de "scan atravessou sync e lock também havia morrido" — raízes distintas, investigação distinta.
- [ ] Log de `sync_blocked` permite provar em análise de incidente que o scan foi resolvido antes do sync e despachado após.
- [ ] Reconexão WebSocket durante sync: flush offline segurado até `sync_ended`, scans enviados em seguida.

---

## Sprint 3 — Risco Médio-Alto (Qualidade e robustez de produção)

> Objetivo: solidificar a base de infraestrutura para operação de longo prazo e múltiplos turnos.

---

### TASK-S3-01 — Watchdog do worker de fila com timeout e alerta (RISK-08)

**Risco:** RISK-08 (Alto)  
**Esforço:** 1 ponto  
**Arquivos principais:**
- `client/src/pages/separacao/index.tsx` (`scanWorkerRunning`, worker de fila)

**O que fazer:**

1. Ao setar `scanWorkerRunning = true`, registrar `workerStartedAt = Date.now()`.

2. Ao setar `scanWorkerRunning = false`, limpar `workerStartedAt`.

3. `useEffect` com `setInterval` de 5 segundos verifica:
   - Se `scanWorkerRunning && Date.now() - workerStartedAt > 30000`:
     - Forçar `scanWorkerRunning = false`.
     - `queryClient.invalidateQueries(workUnitsQueryKey)`.
     - `setScanStatus("warning")` + `setScanMessage("Fila de bipagem travada — sincronizando...")`.
     - `console.warn("[scanWorker] watchdog: worker travado, forçando reset")`.

**Critério de aceite:**
- [ ] Simular `overQtyModalOpen` preso por >30s (via DevTools): watchdog reseta worker e exibe alerta.
- [ ] Fluxo normal: watchdog não interfere.

---

### TASK-S3-02 — Helper centralizado de timestamp para locks (RISK-09)

**Risco:** RISK-09 (Médio-Alto)  
**Esforço:** 1 ponto  
**Arquivos principais:**
- `server/storage.ts` (heartbeat, lock_expires_at)
- `server/routes.ts` (qualquer gravação de lock)
- `sync_db2.py` (lado Python)

**O que fazer:**

1. **Node** — criar helper em `server/utils/timestamps.ts`:
   ```typescript
   export function nowUtcIso(): string {
     return new Date().toISOString(); // sempre YYYY-MM-DDTHH:mm:ss.sssZ
   }
   export function addMinutesUtcIso(minutes: number): string {
     return new Date(Date.now() + minutes * 60 * 1000).toISOString();
   }
   ```

2. Substituir todos os `new Date().toISOString()` relacionados a lock por `nowUtcIso()` ou `addMinutesUtcIso(LOCK_TTL_MINUTES)`.

3. Adicionar validação na borda do heartbeat: se o formato recebido não for `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`, rejeitar com log.

4. **`sync_db2.py`** — padronizar `datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.') + f'{datetime.utcnow().microsecond // 1000:03d}Z'` em todos os writes de lock. Ou usar `datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')`.

**Critério de aceite:**
- [ ] Grep no codebase Node: zero ocorrências de `new Date().toISOString()` fora do helper em contexto de lock.
- [ ] Heartbeat com formato inválido: rejeitado com `400`.

---

### TASK-S3-03 — Entidade `picking_session` no servidor (RISK-10)

**Risco:** RISK-10 (Médio-Alto)  
**Esforço:** 4 pontos  
**Dependências:** RISK-01 (TASK-S1-01) e RISK-07 (TASK-S2-04) devem estar concluídas — sem elas, a sessão persistida herda inconsistências de época e conflito.  
**Arquivos principais:**
- `shared/schema.ts` (nova tabela `picking_sessions`)
- `server/storage.ts` (CRUD de sessão)
- `server/routes.ts` (endpoints de sessão)
- `client/src/pages/separacao/index.tsx` (restore via servidor, não só localStorage)

**O que fazer:**

1. **`shared/schema.ts`** — criar tabela:
   ```typescript
   export const pickingSessions = pgTable("picking_sessions", {
     id: text("id").primaryKey(), // UUID gerado no cliente no início da sessão
     user_id: integer("user_id").notNull(),
     device_id: text("device_id"),           // user-agent hash ou localStorage fingerprint
     work_unit_ids: integer("work_unit_ids").array().notNull(),
     started_at: text("started_at").notNull(),
     last_heartbeat: text("last_heartbeat").notNull(),
     status: text("status").notNull().default("active"), // active | suspended | completed | expired
   });
   ```

2. **`server/routes.ts`** — novos endpoints:
   - `POST /api/picking-sessions` — criar sessão ao iniciar picking.
   - `PUT /api/picking-sessions/:id/heartbeat` — atualizar `last_heartbeat` (chamado junto com o lock heartbeat).
   - `PUT /api/picking-sessions/:id/suspend` — ao "Suspender".
   - `PUT /api/picking-sessions/:id/complete` — ao concluir.
   - `GET /api/picking-sessions/mine` — retorna sessão `active` do usuário atual (para restore).

3. **`server/storage.ts`** — job periódico (junto ao `session-gc`): marcar como `expired` sessões com `last_heartbeat` mais antigo que `LOCK_TTL_MINUTES`.

4. **Frontend** — substituir restore por `localStorage` por chamada a `GET /api/picking-sessions/mine`:
   - Sessão `active` com `work_unit_ids` válidos → restaurar picking com banner "Sessão retomada do servidor".
   - Sem sessão ativa → tela de seleção normal.
   - `localStorage` de backup permanece como fallback com aviso visual.

**Critério de aceite:**
- [ ] Iniciar picking em dispositivo A, fechar browser, abrir em dispositivo B: sessão restaurada corretamente.
- [ ] Sessão expirada (sem heartbeat por >60min): não restaurada, tela de seleção normal.
- [ ] "Suspender" encerra sessão com `status = suspended`, não `active`.

---

### TASK-S3-04 — Observabilidade forense ponta a ponta (RISK-12) 🆕

**Risco:** RISK-12 (Médio-Alto — novo, adicionado por review sênior 2026-04-09)  
**Esforço:** 2 pontos  
**Dependências:** TASK-S1-04 deve estar concluída — a tabela `scan_log` é a base.  
**Arquivos principais:**
- `shared/schema.ts` (`scan_log` — extensão de colunas)
- `server/ws-scanning.ts` (gravação de campos adicionais)
- `server/routes.ts` (endpoint de consulta de log)

**Contexto:** Para bug raro de operação ("o operador diz que bipou, o sistema não registrou"), log genérico não basta. Falta correlação ponta a ponta: `msgId → barcode → itemId → workUnitId → epoch → canal de scan → enqueue_at → ack_at → ack_status → reset_at → finalized_at`. Sem esses campos, a prova de "o que aconteceu" é anedótica.

**O que fazer:**

1. **`shared/schema.ts`** — estender `scan_log` com colunas adicionais:
   ```typescript
   export const scanLog = pgTable("scan_log", {
     msg_id:              text("msg_id").primaryKey(),
     work_unit_id:        integer("work_unit_id").notNull(),
     item_id:             integer("item_id"),              // null se scan rejeitado antes de resolver item
     barcode:             text("barcode").notNull(),
     qty:                 integer("qty").notNull(),
     scan_channel:        text("scan_channel"),            // "websocket" | "offline_flush"
     item_epoch_at_scan:  integer("item_epoch_at_scan"),
     enqueue_at:          text("enqueue_at"),              // timestamp no cliente (ISO UTC)
     processed_at:        text("processed_at").notNull(),
     ack_status:          text("ack_status").notNull(),    // "success" | "already_complete" | "over_quantity" | "stale_epoch" | "target_mismatch" | "not_found" | "error"
     validation_result:   text("validation_result"),      // JSON com razão de rejeição quando ack_status ≠ "success"
     user_id:             integer("user_id"),
   });
   ```

2. **`server/ws-scanning.ts`** — ao processar scan, gravar todos os campos acima. O campo `validation_result` deve ser preenchido para **todos os `ack_status` que não sejam `success`** (refinamento review sênior 2026-04-09 — consistência de schema no log vale ouro em incidente real):

   | `ack_status` | `validation_result` (JSON) |
   |---|---|
   | `success` | `null` |
   | `already_complete` | `{ "reason": "already_complete", "separated_qty": N, "quantity": N }` |
   | `over_quantity` | `{ "reason": "over_quantity", "separated_qty": N, "quantity": N, "available": N, "requested": N }` |
   | `target_mismatch` | `{ "reason": "target_mismatch", "client_work_unit_id": N, "client_order_item_id": N, "server_work_unit_id": N, "epoch_client": N, "epoch_server": N }` |
   | `stale_epoch` | `{ "reason": "stale_epoch", "epoch_client": N, "epoch_server": N }` |
   | `sync_blocked` | `{ "reason": "sync_blocked", "frozen_epoch": N, "current_epoch": N, "resolved_at": "ISO", "sync_generation_at_freeze": N, "sync_generation_current": N, "lock_expires_at_at_dispatch": "ISO", "lock_valid_at_dispatch": true/false }` |
   | `lock_expired` | `{ "reason": "lock_expired", "locked_by": "user_id", "expired_at": "ISO" }` |
   | `not_found` | `{ "reason": "not_found", "barcode": "...", "work_unit_id": N }` |
   | `error` | `{ "reason": "error", "message": "..." }` |

   Nunca gravar texto livre em `validation_result` — sempre JSON com `reason` como campo obrigatório. O `message` livre (já existente no ACK) é para exibição ao operador; `validation_result` é para investigação técnica.

3. **`server/routes.ts`** — endpoint de supervisor `GET /api/scan-log?workUnitId=&itemId=&barcode=&ack_status=&from=&to=` (somente roles `supervisor` e `admin`). Retorna lista de eventos ordenados por `processed_at`, com `validation_result` decodificado como objeto (não string). Útil para auditoria pós-incidente.

4. **Não expor `scan_log` ao operador** — é ferramenta de supervisor/admin, não de operação.

**Critério de aceite:**
- [ ] Após bipagem com sucesso: `validation_result = null`.
- [ ] Scan `already_complete`: `validation_result.reason = "already_complete"` com `separated_qty` e `quantity`.
- [ ] Scan `over_quantity`: `validation_result` contém `available` e `requested`.
- [ ] Scan `target_mismatch`: `validation_result` contém IDs de workUnit do cliente e do servidor.
- [ ] Scan `stale_epoch`: `validation_result` contém epoch cliente e servidor.
- [ ] Scan `sync_blocked`: `validation_result` contém `frozen_epoch` e `current_epoch`.
- [ ] Scan `lock_expired`: `validation_result` contém `locked_by` e `expired_at`.
- [ ] Nenhum `validation_result` contém texto livre — sempre JSON com `reason`.
- [ ] Supervisor consulta `/api/scan-log?workUnitId=X&ack_status=target_mismatch` e vê apenas rejeições desse tipo.
- [ ] Operador sem role supervisor/admin recebe 403.

---

## Tabela de Resumo do Backlog

| Task | RISK | Sprint | Esforço | Dependências | Status |
|---|---|---|---|---|---|
| TASK-S1-01 | RISK-01 | 1 | 3 pt | — | Pendente |
| TASK-S1-02 | RISK-02 | 1 | 2 pt | — | Pendente |
| TASK-S1-03 | RISK-03 | 1 | 3 pt | — | Pendente |
| TASK-S1-04 | RISK-04 | 1 ⬆️ | 3 pt | — | Pendente |
| TASK-S2-02 | RISK-05 | 2 | 2 pt | — | Pendente |
| TASK-S2-03 | RISK-06 | 2 | 1 pt | — | Pendente |
| TASK-S2-04 | RISK-07 | 2 | 3 pt | — | Pendente |
| TASK-S2-05 | RISK-11 | 2 🆕 | 2 pt | — | Pendente |
| TASK-S3-01 | RISK-08 | 3 | 1 pt | — | Pendente |
| TASK-S3-02 | RISK-09 | 3 | 1 pt | — | Pendente |
| TASK-S3-03 | RISK-10 | 3 | 4 pt | S1-01, S2-04 | Pendente |
| TASK-S3-04 | RISK-12 | 3 🆕 | 2 pt | S1-04 | Pendente |

**Total estimado:** Sprint 1 = 11 pt · Sprint 2 = 8 pt · Sprint 3 = 8 pt

---

## Recomendação de Ordem de Execução

```
Sprint 1 (crítico + idempotência, antes de novos operadores)
  ├── TASK-S1-01 (RISK-01: conflicted state)     ← mais impacto visual imediato
  ├── TASK-S1-02 (RISK-02: endereço transacional)
  ├── TASK-S1-03 (RISK-03: fila expirada visível)
  └── TASK-S1-04 (RISK-04: msgId no banco) ⬆️    ← promovida; cria scan_log base para S3-04

Sprint 2 (alto + sync, antes de escalar para >3 operadores)
  ├── TASK-S2-03 (RISK-06: nonce cliente)        ← menor esforço, executa primeiro
  ├── TASK-S2-05 (RISK-11: sync Python) 🆕       ← proteção proativa de sync
  ├── TASK-S2-04 (RISK-07: epoch de item)
  └── TASK-S2-02 (RISK-05: validação alvo)       ← depende de S2-04 (usa epoch no payload)

Sprint 3 (médio-alto, qualidade de longo prazo)
  ├── TASK-S3-01 (RISK-08: watchdog)             ← menor esforço, executa primeiro
  ├── TASK-S3-02 (RISK-09: helper timestamp)
  ├── TASK-S3-04 (RISK-12: observabilidade forense) 🆕 ← depende de S1-04
  └── TASK-S3-03 (RISK-10: picking_session)      ← depende de S1-01 e S2-04
```

---

*Backlog criado em 2026-04-09 a partir de review técnico sênior do módulo de separação.*  
*Revisão 2 (2026-04-09): RISK-04 promovido para Sprint 1; RISK-05 ajuste de implementação; RISK-11 e RISK-12 adicionados.*  
*Revisão 3 (2026-04-09): TASK-S2-05 estendida com pausa de QtyModal e flush offline durante sync; TASK-S3-04 estendida com coluna `validation_result` para log forense de rejeições.*  
*Revisão 4 (2026-04-09): TASK-S2-05 — invariante de contexto congelado: workUnitId/orderItemId/epoch serializados na fila ao confirmar QtyModal, nunca re-resolvidos pós-sync; rejeição explícita `sync_blocked` com log se contexto expirar. TASK-S3-04 — schema `validation_result` padronizado para todos os ack_status (tabela completa de 9 casos), invariante `reason == ack_status`.*  
*Revisão 5 (2026-04-09): TASK-S2-05 — pacote congelado estendido com `resolvedAt` e `syncGeneration`; payload de `sync_blocked` estendido com `resolved_at`, `sync_generation_at_freeze`, `sync_generation_current`. TASK-S3-04 — tabela validation_result: sync_blocked atualizado com os mesmos campos.*  
*Revisão final (2026-04-09): TASK-S2-05 — pacote congelado fechado com 9 campos obrigatórios (`msgId` + 8 anteriores); payload `sync_blocked` estendido com `lock_expires_at_at_dispatch` e `lock_valid_at_dispatch` para distinguir "atravessou sync" de "atravessou sync com lock morto"; critérios de aceite atualizados. TASK-S3-04 — tabela validation_result: sync_blocked atualizado com os dois campos de lock.*  
*Cenários de teste adicionados (2026-04-09): TASK-S1-01, S1-03 e S1-04 — 5 cenários pré-implementação (CT-01 a CT-05) e 3 camadas de teste por task. CT-02 é o gate de homologação em todas: S1-01 (reset com delta pendente), S1-03 (scan expirado nunca vai automaticamente ao servidor), S1-04 (replay após restart — banco garante, memória não). CT-05 define fronteira testável em S1-03 (scans mistos) e S1-04 (janela de idempotência de 24h explícita).*  
*Regra de processo adicionada (2026-04-09): bloco "Regra de processo" inserido no cabeçalho da Sprint 1 — evidência de CT-02 antes e depois da correção é requisito obrigatório de PR; CT-02 vira teste fixo de regressão; ordem sequencial de execução S1-01 → S1-03 → S1-04 → S1-02; nenhum refactor paralelo durante a sprint.*  
*Atualizar `Status` nesta tabela conforme tasks forem concluídas em cada sprint.*
