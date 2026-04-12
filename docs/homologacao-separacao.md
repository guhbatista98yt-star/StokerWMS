# Homologação — Módulo Separação

**Data:** 2026-04-09  
**Versão:** commit d755ae4 → atual  
**Escopo:** Correções de risco alto/altíssimo identificadas em revisão externa

---

## 1. Correções aplicadas

### 1.1 Zero automático de `separated_qty` em excesso → REMOVIDO

**Arquivo:** `server/storage.ts`  
**Função:** `atomicScanSeparatedQty` (linha 659)  
**Interface:** `IStorage` (linha 80)

**Antes:**
```typescript
if (currentQty >= adjustedTarget) {
  // Already at or above limit — reset to 0
  await tx.update(orderItems).set({ separatedQty: 0, status: "recontagem" })...
  return { result: "over_limit" };
}
if (delta > availableQty) {
  // Requested qty exceeds what's left — reset to 0
  await tx.update(orderItems).set({ separatedQty: 0, status: "recontagem" })...
  return { result: "partial_over" };
}
```

**Depois:**
```typescript
if (currentQty >= adjustedTarget) {
  // Already complete — report without resetting progress
  return { result: "already_complete" };
}
if (delta > availableQty) {
  // Would overflow — report without resetting
  return { result: "over_quantity" };
}
```

**Resultado:** Nenhum bipe, scan duplicado ou scan acima da quantidade apaga progresso válido automaticamente. O reset só ocorre via `/reset-item-picking` quando o operador escolhe explicitamente "Recontar" no modal.

**Arquivos adicionais alterados:**
- `server/routes.ts` — handler `POST /api/work-units/:id/scan-item`: substituiu `over_limit`/`partial_over` por `already_complete`/`over_quantity`
- `server/ws-scanning.ts` — `handleScanItem`: substituiu os mesmos result types, envia ACK correto
- `client/src/pages/separacao/index.tsx` — `handleWsScanAck`: adicionado case `already_complete` (limpa delta + invalida cache sem abrir modal); `over_quantity` agora passa `serverAlreadyReset: false`
- `client/src/pages/separacao/index.tsx` — `processScanQueue`, local `alreadyComplete`: mudou de abrir modal destrutivo para mensagem suave "Produto já separado"

---

### 1.2 Fallback de restauração de sessão contaminado por locks antigos → REMOVIDO

**Arquivo:** `client/src/pages/separacao/index.tsx`  
**Hook:** `useEffect` de restore de sessão (linha 445)

**Antes:**
```typescript
// Sem sessão salva → entrava em picking com TODOS os locks do usuário no banco
const myUnit = workUnits.find(wu => wu.lockedBy === user.id && wu.status !== "concluido");
if (myUnit) {
  const myIds = workUnits.filter(wu => wu.lockedBy === user.id).map(wu => wu.id);
  setStep("picking");
  setSelectedWorkUnits(myIds);
}
```

**Depois:**
```typescript
// Sem sessão salva → permanece em seleção
// O operador re-seleciona conscientemente o que quer retomar
```

**Adicionado:** Banner amarelo no topo da tela de seleção quando `myLockedUnits.length > 0`:
```
⚠ Você tem X coleta(s) em andamento. Selecione os pedidos na lista para retomar.
```

**Resultado:** Locks orphaned de sessões anteriores (refresh, crash, aba fechada) não entram mais automaticamente em picking. O operador vê o banner e decide conscientemente.

---

### 1.3 Botão de abandono sem confirmação → CORRIGIDO

**Arquivo:** `client/src/pages/separacao/index.tsx`

**Antes:** Dois botões `X` (aba produto e aba pedidos) chamavam `handleCancelPicking()` diretamente, executando `unlockMutation.mutate({ ids, reset: true })` imediatamente sem confirmação.

**Depois:**
- Os botões `X` agora chamam `handleExitPicking()`, que abre um modal de confirmação
- `handleCancelPicking(shouldReset: boolean)` aceita parâmetro explícito
- Modal oferece **três opções** distintas:
  1. **Suspender (manter progresso)** → `unlockMutation.mutate({ ids, reset: false })` — libera os locks mas mantém `separated_qty` intacto; o operador pode retomar depois
  2. **Abandonar (apagar progresso)** → `unlockMutation.mutate({ ids, reset: true })` — apaga tudo; ação explicitamente marcada como destrutiva
  3. **Cancelar (continuar separando)** — fecha o modal sem fazer nada

---

## 2. Cenários de homologação

### Cenário 1: Iniciar coleta, dar refresh na página, retomar sessão

**Passos:**
1. Fazer login, selecionar pedido(s), entrar em picking
2. Bipar alguns itens (progresso parcial)
3. Forçar refresh (F5) na página

**Resultado esperado:**
- Sessão válida no localStorage → restore automático entra direto em picking com os mesmos pedidos (comportamento existente, não alterado)
- Se localStorage foi limpo → banner amarelo aparece na tela de seleção; operador re-seleciona; progresso no banco está intacto

**Ponto de falha antes:** sem localStorage, entrava em picking com todos os locks incluindo orphaned de outros pedidos

---

### Cenário 2: Fechar aba no meio da coleta e reabrir

**Passos:**
1. Entrar em picking com progresso parcial
2. Fechar a aba completamente
3. Reabrir o app

**Resultado esperado:**
- Se sessionStorage/localStorage ainda vivos → restore por sessionId, entra direto em picking
- Se expirados → banner amarelo; operador re-seleciona; `separated_qty` preservado no banco

**Ponto de falha antes:** idêntico ao Cenário 1

---

### Cenário 3: Cair conexão por alguns minutos e voltar

**Passos:**
1. Em picking ativo
2. Desconectar rede (ex: puxar cabo) por 3–4 min
3. Bipar alguns itens no estado offline (fila local)
4. Reconectar

**Resultado esperado:**
- Scans na fila local (< 5 min) são enviados ao servidor ao reconectar via WebSocket
- ACKs chegam normalmente
- Scans > 5 min na fila são descartados silenciosamente (risco residual documentado)

**Observação:** Este cenário é de risco médio em LAN. Operadores devem ser orientados a não bipar por mais de 5 min sem conectividade.

---

### Cenário 4: Bipar muito rápido o mesmo item várias vezes

**Passos:**
1. Item com quantidade-alvo = 5
2. Bipar o mesmo item 10 vezes rapidamente (simular scanner com trigger preso)

**Resultado esperado com as correções:**
- Scans 1–5: `result: "success"`, qty sobe de 0 a 5
- Scan 6: servidor vê `currentQty (5) >= adjustedTarget (5)` → retorna `already_complete`
- Frontend recebe ACK `already_complete` → limpa delta local, invalida cache, mostra "Produto já separado" — **sem modal, sem reset**
- Scans 7–10: idêntico ao scan 6 (dedup do msgId já tratou os mais rápidos)

**Ponto de falha antes:** scan 6 apagava o progresso inteiro (reset para 0) e abria modal de recontagem

---

### Cenário 5: Bipar acima da quantidade disponível (caixa > restante)

**Passos:**
1. Item com quantidade-alvo = 10, já separado = 8 (faltam 2)
2. Bipar uma caixa de 6 unidades

**Resultado esperado com as correções:**
- Servidor vê `delta (6) > availableQty (2)` → retorna `over_quantity`
- Frontend recebe ACK `over_quantity` → limpa delta local, invalida cache, abre modal "Quantidade excedida"
- Modal mostra dois botões: "Recontar" (chama `/reset-item-picking` explicitamente) e fechar
- `separated_qty` **permanece em 8** até o operador escolher recontar

**Ponto de falha antes:** servidor apagava os 8 já separados imediatamente

---

### Cenário 6: Locks antigos no banco, abrir o módulo

**Passos:**
1. Simular crash (encerrar processo com lock ativo no banco)
2. Reabrir o app com o mesmo usuário

**Resultado esperado:**
- Banner amarelo: "Você tem 1 coleta(s) em andamento. Selecione os pedidos para retomar."
- Nenhuma entrada automática em picking
- Operador seleciona o pedido correto na lista → lock renova → entra em picking normalmente

**Ponto de falha antes:** entrava automaticamente em picking com todos os locks, potencialmente misturando pedidos de sessões diferentes

---

### Cenário 7: Clicar sem querer em sair/abandonar coleta

**Passos:**
1. Em picking ativo com progresso significativo
2. Clicar no botão X (vermelho) por engano

**Resultado esperado com as correções:**
- Modal aparece com três opções claramente distintas
- "Cancelar (continuar separando)" fecha o modal sem nenhuma ação
- O operador escolhe: Suspender (mantém progresso) ou Abandonar (apaga)
- Para abandonar, o operador precisa clicar em um botão explicitamente marcado como destrutivo (vermelho)

**Ponto de falha antes:** um clique no X apagava imediatamente todo o progresso sem confirmação

---

### Cenário 8: Dois operadores no mesmo conjunto de pedidos/seções

**Passos:**
1. Operador A e Operador B estão na mesma seção
2. Operador A está em picking com Pedido 123
3. Operador B tenta selecionar Pedido 123

**Resultado esperado:**
- Pedido 123 aparece como "Em coleta por [nome do operador A]" na tela de seleção de B
- B não consegue fazer lock do pedido (API retorna 409/lock conflict)
- `allMyUnits` de A só contém os pedidos da sessão de A (não contamina com locks de B)

**Nota:** Este cenário não foi alterado pelas correções atuais. A proteção existe via `FOR UPDATE` no banco e lock por workUnit. Validar em ambiente com dois usuários simultâneos.

---

## 3. Risco residual documentado

| Risco | Classificação | Mitigação atual |
|-------|--------------|-----------------|
| Scans offline > 5 min descartados sem alerta | Médio | TTL generoso para LAN; operadores devem ser orientados |
| Conflito pendingDeltaStore não surfaceado na UI | Médio | Detecção existe no `reconcile()`, falta indicador visual |
| Deduplicação de msgId só em memória | Médio | TTL 5 min; em restart do servidor, scans duplicados recentes podem ser reprocessados — mas com as correções de não-reset, o impacto é apenas `already_complete` (sem perda de dados) |
| Redirect automático ao select | Baixo | Mitigado pelo banner; a causa (locks desaparecendo) deve ser investigada se ocorrer |

---

## 4. Arquivos alterados nesta sprint

| Arquivo | Natureza da alteração |
|---------|----------------------|
| `server/storage.ts` | Remove reset automático em `atomicScanSeparatedQty`; atualiza interface `IStorage` |
| `server/routes.ts` | Handler `scan-item` usa novos result types |
| `server/ws-scanning.ts` | `handleScanItem` usa novos result types, ACK diferenciado |
| `client/src/pages/separacao/index.tsx` | Remove fallback de restore; banner de coleta em andamento; modal de confirmação de saída com três opções; `handleWsScanAck` trata `already_complete`; `processScanQueue` não abre modal destrutivo em `alreadyComplete` |
| `docs/homologacao-separacao.md` | Este documento |
