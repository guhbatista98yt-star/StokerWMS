# MAPA DE TESTES — STOKER WMS

> Cobertura atual, lacunas críticas e plano de testes futuros.  
> Legenda: ✅ Coberto | ⚠️ Parcial | ❌ Não coberto | 🔴 Crítico sem cobertura

---

## 1. COBERTURA ATUAL

### 1.1 Testes Existentes

**Framework:** Playwright (API testing) + Vitest  
**Localização:** `tests/api/work-units.spec.ts`

| ID | Teste | Módulo | Status |
|---|---|---|:---:|
| TC-WU-01 | Batch unlock de WUs de separação limpa campos de lock | Work Units | ✅ |
| TC-WU-02 | Unlock misto (conf+sep) reverte status de pedido independentemente | Work Units | ✅ |
| TC-WU-03 | Operador recebe 403 ao tentar desbloquear WU de outro operador | Autorização | ✅ |
| TC-WU-04 | Endpoint de orders retorna apenas dados da empresa | Isolamento | ✅ |
| TC-WU-05 | Audit logs retornam 200 e são company-scoped | Auditoria | ✅ |
| TC-WU-06 | Fila balcão retorna campos corretos e status válidos | Balcão | ✅ |
| TC-WU-07 | Supervisor consegue desbloquear WU de qualquer operador | Supervisor | ✅ |
| TC-WU-08 | Tentativa concorrente de lock retorna 409 | Concorrência | ✅ |

**Total de testes automatizados:** 8 testes de API

---

## 2. MAPA COMPLETO DE COBERTURA

### 2.1 Autenticação

| Cenário | Criticidade | Cobertura |
|---|:---:|:---:|
| Login com credenciais válidas | Alta | ⚠️ (implícito nos testes) |
| Login com credenciais inválidas | Alta | ❌ |
| Login com usuário inativo | Alta | ❌ |
| Login via badge code | Média | ❌ |
| Logout invalida sessão | Alta | ❌ |
| Sessão expirada retorna 401 | Alta | ❌ |
| Rate limit de login (20 req/15min) | Média | ❌ |
| Seleção de empresa multi-tenant | Alta | ⚠️ (parcial no TC-WU) |
| Token inválido retorna 401 | Alta | ❌ |

### 2.2 Isolamento Multi-Empresa

| Cenário | Criticidade | Cobertura |
|---|:---:|:---:|
| Pedidos filtrados por empresa | Alta | ✅ (TC-WU-04) |
| WUs filtradas por empresa | Alta | ❌ |
| Exceções filtradas por empresa | Alta | ❌ |
| Audit logs filtrados por empresa | Alta | ✅ (TC-WU-05) |
| SSE não vaza eventos entre empresas | Crítica | ❌ |
| Usuário não acessa dados de outra empresa | Crítica | ❌ |

### 2.3 Work Units — Lock e Desbloqueio

| Cenário | Criticidade | Cobertura |
|---|:---:|:---:|
| Lock adquire com sucesso | Crítica | ✅ (implícito TC-WU-01) |
| Lock retorna 409 se já bloqueado | Crítica | ✅ (TC-WU-08) |
| Lock respeita TTL de 60 minutos | Crítica | ❌ |
| Unlock limpa todos os campos | Crítica | ✅ (TC-WU-01) |
| Operador não desbloqueia WU de outro | Crítica | ✅ (TC-WU-03) |
| Supervisor desbloqueia qualquer WU | Alta | ✅ (TC-WU-07) |
| Batch unlock funciona | Alta | ✅ (TC-WU-01) |
| Unlock misto sep+conf funciona | Alta | ✅ (TC-WU-02) |
| Renovação de lock funciona | Alta | ❌ |
| Lock expirado libera para outro operador | Crítica | ❌ |

### 2.4 Separação

| Cenário | Criticidade | Cobertura |
|---|:---:|:---:|
| Operador vê apenas WUs das suas seções | Crítica | ❌ |
| Scan incrementa separated_qty atomicamente | Crítica | ❌ |
| Item muda status ao atingir quantidade | Alta | ❌ |
| WU concluída avança status do pedido | Crítica | ❌ |
| Criação automática de WU de conferência | Crítica | ❌ |
| Session restore após recarga | Alta | ❌ |
| Cross-order protection | Alta | ❌ |
| Modo by_order vs by_section | Alta | ❌ |
| Exceção registrada na separação | Alta | ❌ |
| Deduplicação por msgId (handheld) | Alta | ❌ |

### 2.5 Conferência

| Cenário | Criticidade | Cobertura |
|---|:---:|:---:|
| Scan de barcode unitário | Crítica | ❌ |
| Scan de barcode de caixa | Alta | ❌ |
| Scan de boxBarcodes (array) | Alta | ❌ |
| Over_quantity retorna erro sem aplicar | Crítica | ❌ |
| Already_complete retorna estado correto | Alta | ❌ |
| Conclusão de WU conf avança pedido | Crítica | ❌ |
| Session restore (conf) | Alta | ❌ |
| Cross-order protection (conf) | Alta | ❌ |
| Reset de conferência pelo supervisor | Média | ❌ |

### 2.6 Balcão

| Cenário | Criticidade | Cobertura |
|---|:---:|:---:|
| Fila retorna apenas pedidos dos pontos balcão | Crítica | ✅ (TC-WU-06) |
| Status calculado corretamente (em_fila/em_andamento/concluido) | Alta | ✅ (TC-WU-06) |
| Campos obrigatórios presentes | Alta | ✅ (TC-WU-06) |
| Lock no balcão funciona | Alta | ⚠️ (implícito TC-WU-03/07/08) |
| Ordenação da fila correta | Média | ❌ |
| Isolation por empresa no balcão | Crítica | ❌ |

### 2.7 Exceções

| Cenário | Criticidade | Cobertura |
|---|:---:|:---:|
| Registro de exceção | Alta | ❌ |
| Exceção aparece para supervisor | Alta | ❌ |
| Autorização de exceção pelo supervisor | Alta | ❌ |
| Operador não autoriza própria exceção (padrão) | Alta | ❌ |
| canAuthorizeOwnExceptions ativo | Média | ❌ |
| Delete de exceção (company scoped) | Alta | ❌ |

### 2.8 Pedidos

| Cenário | Criticidade | Cobertura |
|---|:---:|:---:|
| Lançamento de pedido | Crítica | ❌ |
| Criação de WUs ao lançar | Crítica | ❌ |
| Pedido passa por ciclo completo de status | Crítica | ❌ |
| Force status funciona | Alta | ❌ |
| Cancelamento de pedido | Alta | ❌ |
| Batch sync popula orders/items | Alta | ❌ |

### 2.9 Sync DB2

| Cenário | Criticidade | Cobertura |
|---|:---:|:---:|
| Sync manual dispara processo | Alta | ❌ |
| Status do sync retorna estado correto | Alta | ❌ |
| Upsert em cache_orcamentos | Alta | ❌ |
| SSE emite sync_finished | Média | ❌ |

### 2.10 SSE

| Cenário | Criticidade | Cobertura |
|---|:---:|:---:|
| Conexão SSE estabelecida com auth | Alta | ❌ |
| Limite de 5 conexões retorna 429 | Média | ❌ |
| Heartbeat enviado a cada 30s | Baixa | ❌ |
| Evento work_unit_updated emitido | Alta | ❌ |
| Broadcast isolado por empresa | Crítica | ❌ |

### 2.11 Configurações do Sistema

| Cenário | Criticidade | Cobertura |
|---|:---:|:---:|
| Mudança de modo de separação | Alta | ❌ |
| 409 retornado quando ops ativas | Alta | ❌ |
| Force mode change cancela sessões | Alta | ❌ |
| Cache de modo invalidado ao mudar | Alta | ❌ |

### 2.12 WMS

| Cenário | Criticidade | Cobertura |
|---|:---:|:---:|
| Criação de endereço | Média | ❌ |
| Criação de pallet | Média | ❌ |
| Transferência de pallet | Média | ❌ |
| Contagem cíclica | Média | ❌ |
| Recebimento de NF | Média | ❌ |

---

## 3. RESUMO DE COBERTURA

| Módulo | Cenários totais | Cobertos | Cobertura % |
|---|:---:|:---:|:---:|
| Autenticação | 9 | 1 | ~11% |
| Multi-empresa | 6 | 2 | ~33% |
| Work Units / Lock | 10 | 6 | 60% |
| Separação | 10 | 0 | 0% |
| Conferência | 9 | 0 | 0% |
| Balcão | 6 | 3 | 50% |
| Exceções | 6 | 0 | 0% |
| Pedidos | 6 | 0 | 0% |
| Sync DB2 | 4 | 0 | 0% |
| SSE | 5 | 0 | 0% |
| Sistema/Settings | 4 | 0 | 0% |
| WMS | 5 | 0 | 0% |
| **TOTAL** | **80** | **12** | **~15%** |

---

## 4. FLUXOS CRÍTICOS SEM COBERTURA (PRIORIDADE MÁXIMA)

Estes fluxos são os mais críticos para a operação e devem ser priorizados:

| Prioridade | Fluxo | Por que é crítico |
|:---:|---|---|
| 🔴 1 | Ciclo completo: lançar → separar → conferir → finalizar | É o fluxo principal da aplicação |
| 🔴 2 | Isolamento multi-empresa (SSE + dados) | Risco de vazamento de dados entre empresas |
| 🔴 3 | Lock: TTL expirado libera para outro operador | Prevenção de bloqueio eterno |
| 🔴 4 | Scan atômico: sem race condition na quantidade | Risco de dupla contagem |
| 🔴 5 | Session restore com cross-order protection | Prevenção de mistura de pedidos |
| 🔴 6 | Balcão: identificação por pickup_point (não por type) | Bug de identificação pode esconder pedidos |
| 🔴 7 | Exceção: autorização necessária antes de concluir | Workflow de exceção pode travar operação |

---

## 5. PLANO DE TESTES RECOMENDADO

### 5.1 Testes de Regressão Obrigatórios (antes de qualquer deploy)

```
1. TC-WU-01: Batch unlock limpa campos de lock
2. TC-WU-03: Operador não desbloqueia WU de outro (403)
3. TC-WU-07: Supervisor desbloqueia qualquer WU
4. TC-WU-08: Lock concorrente retorna 409
5. TC-AUTH-01 (a criar): Login válido retorna sessão
6. TC-COMPANY-01 (a criar): Dados isolados por empresa
7. TC-CYCLE-01 (a criar): Ciclo completo de pedido
```

### 5.2 Testes a Criar — Fase 1 (alta prioridade)

```javascript
// TC-AUTH-01: Login completo
test('Login com credenciais válidas retorna token e user', ...)
test('Login com senha errada retorna 401', ...)
test('Usuário inativo não consegue logar', ...)

// TC-COMPANY-01: Isolamento
test('Empresa A não vê pedidos da empresa B', ...)
test('SSE não entrega eventos de outra empresa', ...)

// TC-CYCLE-01: Ciclo de pedido
test('Ciclo completo: lançar → WU criada → separar → conferir → finalizar', ...)

// TC-LOCK-01: Lock TTL
test('Lock expirado não bloqueia novo operador', ...)
test('Renovação de lock estende TTL', ...)

// TC-EXCEPTION-01: Exceções
test('Exceção registrada aparece para supervisor', ...)
test('Autorização de exceção pelo supervisor', ...)
```

### 5.3 Testes a Criar — Fase 2 (média prioridade)

```javascript
// TC-SCAN-01: Scan atômico
test('Scan duplicado com mesmo msgId não duplica quantidade', ...)
test('Scan acima da quantidade retorna over_quantity', ...)

// TC-SESSION-01: Session restore
test('Session restore ignora WU com lock expirado', ...)
test('Session restore filtra por orderIds (cross-order protection)', ...)

// TC-SSE-01: SSE
test('SSE retorna 429 acima de 5 conexões', ...)
test('work_unit_updated emitido após scan', ...)

// TC-BALCAO-01: Balcão
test('Pedido sem pickup_point balcão não aparece na fila', ...)
test('Pedido com pickup_point balcão aparece na fila', ...)
```

---

## 6. CONFIGURAÇÃO DOS TESTES

### Executar testes existentes

```bash
# Testes de API com Playwright
npx playwright test tests/api/work-units.spec.ts

# Ver relatório
npx playwright show-report playwright-report/

# Testes unitários (Vitest)
npx vitest run --config vitest.api.config.ts
```

### Usuários de teste disponíveis

| Usuário | Senha | Role |
|---|---|---|
| admin | admin123 | administrador |
| joao | 1234 | separacao |
| maria | 1234 | separacao |
| pedro | 1234 | separacao |

---

*Cobertura calculada com base nos testes em `tests/api/work-units.spec.ts` e análise do código em `server/routes.ts`*
