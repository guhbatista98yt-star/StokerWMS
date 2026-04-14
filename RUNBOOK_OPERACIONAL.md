# RUNBOOK OPERACIONAL — STOKER WMS

> Guia de operação para administradores, DevOps e suporte técnico.  
> Baseado na implementação real do sistema.

---

## A. PROCEDIMENTO DE INÍCIO DO SISTEMA

### A.1 Pré-requisitos

```bash
# Verificar se PostgreSQL está acessível
psql $DATABASE_URL -c "SELECT 1"

# Verificar variáveis de ambiente obrigatórias
echo $DATABASE_URL       # deve estar definida
echo $NODE_ENV           # development ou production

# Para sync DB2 (opcional mas crítico para pedidos):
echo $DB2_DSN            # string de conexão ODBC ao IBM DB2
```

### A.2 Subir o sistema

```bash
# Desenvolvimento
npm run dev

# Produção (via PM2, systemd ou similar)
NODE_ENV=production tsx server/index.ts

# O servidor sobe na porta 5000 por padrão
# Saída esperada no log:
# [Routes] Registering routes...
# [print] [agent] WebSocket server iniciado em /ws/print-agent
# [express] [scanning-ws] WebSocket scanning server iniciado em /ws/scanning
# [express] Servidor iniciado na porta 5000
```

### A.3 Sequência de inicialização interna

```
1. Middlewares (Helmet, rate-limit, cookie-parser, json parser)
2. runSafeMigrations() — adiciona colunas novas sem recriar tabelas
3. seedDatabase() — insere dados iniciais se banco estiver vazio
4. setupSSE(app) — endpoint /api/sse
5. registerRoutes() — registra todas as rotas HTTP
6. registerWmsRoutes() — rotas do módulo WMS
7. registerPrintRoutes() — rotas de impressão
8. setupPrintAgentWS() — WebSocket de impressão em /ws/print-agent
9. setupScanningWS() — WebSocket de scanner em /ws/scanning
10. setTimeout 5s → runSync() — primeiro sync DB2
11. setInterval 10min → runSync() — sync recorrente
12. setInterval 1h → deleteExpiredSessions() — limpeza de sessões
```

---

## B. VERIFICAÇÕES DE SAÚDE

### B.1 Verificar se o servidor está respondendo

```bash
curl -s http://localhost:5000/api/auth/me
# Esperado: {"error":"Não autenticado"} com HTTP 401
# Se 502/connection refused: servidor não está rodando
```

### B.2 Verificar banco de dados

```bash
# Conexão básica
psql $DATABASE_URL -c "SELECT count(*) FROM orders"

# Verificar tabelas existentes
psql $DATABASE_URL -c "\dt"

# Verificar usuários ativos
psql $DATABASE_URL -c "SELECT username, role, active FROM users ORDER BY role"

# Verificar sessões ativas
psql $DATABASE_URL -c "SELECT count(*) FROM sessions WHERE expires_at > now()::text"
```

### B.3 Verificar login

```bash
curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
# Esperado: {"user":{...},"sessionKey":"...","companyId":...}
```

### B.4 Verificar sync DB2

```bash
# Status do último sync (requer auth)
curl -s http://localhost:5000/api/sync/status \
  -H "Authorization: Bearer SEU_TOKEN"
# Retorna: {"running":false,"lastSyncAt":"2025-...","lastSyncError":null}

# Disparar sync manual
curl -s -X POST http://localhost:5000/api/sync \
  -H "Authorization: Bearer SEU_TOKEN"
# Retorna: {"running":true,"message":"Sincronização iniciada em segundo plano"}

# Verificar se script existe
ls -la sync_db2.py

# Teste manual do script Python
python3 sync_db2.py --quiet
```

### B.5 Verificar SSE

```bash
# Conexão SSE (deve manter conexão aberta)
curl -s -N http://localhost:5000/api/sse \
  -H "Authorization: Bearer SEU_TOKEN"
# Esperado: event: connected + heartbeat : ping a cada 30s
```

### B.6 Verificar agentes de impressão

```
1. Acessar /admin/print-agents no browser
2. Listar agentes conectados — devem aparecer os computadores do armazém
3. Verificar se cada agente reportou impressoras
4. Se agente ausente: verificar se o software do agente está rodando nos PCs
```

### B.7 Verificar WebSocket de scanner

```bash
# O endpoint WS está em /ws/scanning
# Usar wscat ou browser DevTools para testar:
wscat -c ws://localhost:5000/ws/scanning
```

---

## C. ROTINA DE OPERAÇÃO NORMAL

### C.1 Início do turno

```
□ Verificar se o servidor está rodando (acessar o sistema no browser)
□ Verificar se o último sync DB2 foi bem-sucedido (Supervisor → Status do Sync)
□ Verificar se há pedidos pendentes na fila (Supervisor → Pedidos)
□ Verificar se os agentes de impressão estão conectados (Admin → Print Agents)
□ Confirmar que operadores conseguem logar
```

### C.2 Lançamento de pedidos

```
1. Supervisor acessa /supervisor/orders
2. Filtra pedidos com status "pendente" 
3. (Opcional) Atribui rota: seleciona pedidos → "Atribuir Rota"
4. Seleciona pedidos para lançar → "Lançar"
5. Confirma: pedidos passam para "em_separacao"
6. Work units são criadas automaticamente
7. Operadores de separação veem as WUs na fila
```

### C.3 Acompanhamento em tempo real

```
□ Fila de pedidos (/fila-pedidos) — atualiza em tempo real via SSE
□ Supervisor/orders — mostra status atualizado
□ SSE distribui eventos: work_unit_updated, order_updated, sync_finished
```

### C.4 Fim do turno

```
□ Verificar pedidos sem finalizar (evitar WUs com lock ativo)
□ Se necessário: Supervisor faz batch unlock dos locks ativos
□ Verificar log de exceções pendentes de autorização
□ Verificar se o próximo sync automático está agendado
```

---

## D. COMO AGIR EM INCIDENTES COMUNS

### D.1 Operador travado — não consegue pegar um pedido

**Sintoma:** Operador tenta bloquear WU e recebe "Bloqueado por outro operador"

**Ação:**
```
1. Supervisor acessa /supervisor/orders
2. Identifica qual WU está com lock indevido
3. Seleciona a WU → "Desbloquear"
4. OU: POST /api/work-units/batch-unlock com os IDs
5. Broadcast SSE notifica todos automaticamente
```

### D.2 Pedido não sobe para conferência

**Sintoma:** Todas as WUs de separação estão concluídas mas status não avançou

**Diagnóstico:**
```sql
-- Verificar status das WUs do pedido
SELECT id, section, type, status FROM work_units WHERE order_id = 'ID_DO_PEDIDO';

-- Verificar se há itens pendentes
SELECT id, section, status, separated_qty, quantity 
FROM order_items WHERE order_id = 'ID_DO_PEDIDO' AND status != 'separado';
```

**Ação:**
```
1. Se há WU com status != 'concluido': concluir ou desbloquear/resetar
2. Se há order_item com status != 'separado': verificar se separação foi realizada
3. Se tudo concluído mas pedido não avançou: 
   Supervisor → Force Status → "separado"
   OU POST /api/orders/force-status
```

### D.3 Sync DB2 parou de atualizar

**Sintoma:** Novos pedidos do ERP não aparecem no sistema

**Diagnóstico:**
```bash
# Verificar status
curl /api/sync/status  # verificar lastSyncError

# Verificar se script existe
ls -la sync_db2.py

# Rodar manualmente com output
python3 sync_db2.py

# Verificar conexão com DB2
python3 -c "import pyodbc; conn = pyodbc.connect('DSN=CISSODBC;...')"
```

**Ação:**
```
1. Se DB2 inacessível: verificar rede/VPN para 192.168.1.200:50000
2. Se pyodbc não instalado: pip install pyodbc
3. Se erro de autenticação: verificar credenciais CISSODBC/CONSULTA
4. Se script tem erro: ver log detalhado python3 sync_db2.py (sem --quiet)
5. Trigger manual via Supervisor após resolver causa raiz
```

### D.4 SSE não reconecta / painel não atualiza

**Sintoma:** Fila de pedidos fica parada, não atualiza em tempo real

**Diagnóstico:**
```
1. Abrir DevTools → Network → filtrar "sse"
2. Verificar se há conexão aberta para /api/sse
3. Verificar Console por erros de autenticação (401)
4. Verificar se usuário atingiu limite de 5 conexões SSE
```

**Ação:**
```
1. Hard refresh (Ctrl+F5) — reconecta EventSource automaticamente
2. Se limite de conexões: fechar abas desnecessárias
3. Se sessão expirada: fazer login novamente
4. Polling de fallback está ativo: sistema continua funcionando sem SSE (30s de delay)
```

### D.5 Lock expirado — operador não consegue continuar

**Sintoma:** Operador recebe "Lock expirado. Bloqueie novamente"

**Ação:**
```
1. Operador clica "Renovar Lock" na interface (se disponível)
2. OU: Sair da WU e bloquear novamente
3. Estado da WU é preservado (itens já separados não são perdidos)
4. Se WU foi tomada por outro: Supervisor desbloqueia e devolve
```

### D.6 Exceção não aparece para supervisor

**Sintoma:** Operador registrou exceção mas supervisor não vê

**Diagnóstico:**
```sql
SELECT id, type, quantity, reported_by, authorized_by 
FROM exceptions WHERE work_unit_id = 'ID_DA_WU';
```

**Ação:**
```
1. Verificar se supervisor está na empresa correta (isolamento multi-empresa)
2. Verificar se exceção foi registrada na WU correta
3. Acessar /supervisor/exceptions com filtros corretos
```

---

## E. VALIDAÇÃO DE ESTABILIDADE

### E.1 Checklist rápido de saúde

```
□ GET /api/auth/me retorna 401 (servidor respondendo)
□ Login admin funciona
□ GET /api/orders retorna lista (banco acessível)
□ GET /api/sync/status retorna lastSyncError: null
□ SSE conecta e envia heartbeat
□ Fila de pedidos carrega (/fila-pedidos)
□ Painel balcão carrega (/balcao)
```

### E.2 Métricas a monitorar

| Métrica | Onde verificar | Alarme |
|---|---|---|
| Sync DB2 | `GET /api/sync/status` | `lastSyncError != null` |
| Sessões expiradas | `audit_logs` | Excesso de `login_failed` |
| WUs com lock eterno | `work_units` | `lock_expires_at < now() AND status = 'em_andamento'` |
| Exceções sem autorização | `exceptions` | `authorized_by IS NULL` há mais de 1h |
| Audit log de erros 500 | `server logs` | Frequência de `[server] 5xx` |

---

## F. REINICIALIZAÇÃO SEGURA

### F.1 Quando reiniciar

- Após deploy de nova versão de código
- Após mudança de variáveis de ambiente
- Após instalação/remoção de pacotes npm
- Se o processo travar (uncaughtException → process.exit(1))

### F.2 Procedimento de reinicialização

```
1. AVISAR operadores que o sistema vai reiniciar (ou aguardar turno vazio)
2. Verificar WUs com lock ativo:
   SELECT locked_by, order_id FROM work_units WHERE locked_by IS NOT NULL
3. Se houver operações ativas:
   a. Aguardar conclusão OU
   b. Supervisor faz batch unlock (WUs voltam para pendente)
4. Reiniciar processo (SIGTERM → aguarda → SIGKILL se necessário)
5. Aguardar mensagem "Servidor iniciado na porta 5000"
6. Validar com checklist E.1
7. Disparar sync manual se último sync foi há mais de 10 minutos
```

### F.3 Recuperação de estado

- **Locks:** Ao reiniciar, locks com TTL expirado são automaticamente ignorados
- **Sessões:** Sessões válidas continuam ativas (armazenadas no banco)
- **Session restore:** Operadores recuperam o estado ao recarregar a página (sessionStorage + lock ativo)
- **SSE:** Clientes reconectam automaticamente via EventSource

---

## G. SENHAS E CREDENCIAIS DE TESTE

| Usuário | Senha | Role | Empresa |
|---|---|---|---|
| admin | admin123 | administrador | 1 e 3 |
| joao | 1234 | separacao | empresa padrão |
| maria | 1234 | separacao | empresa padrão |
| pedro | 1234 | separacao | empresa padrão |

> **IMPORTANTE:** Alterar senhas de teste antes de ir para produção real.

---

*Baseado na implementação em `server/index.ts`, `server/routes.ts`, `server/auth.ts`*
