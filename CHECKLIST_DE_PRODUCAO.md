# CHECKLIST DE PRODUÇÃO — STOKER WMS

> Use este checklist antes de subir uma nova versão, após atualizações ou para validação periódica.  
> ✅ OK | ❌ Falhou | ⚠️ Parcial | — Não aplicável

---

## BLOCO 1 — INFRAESTRUTURA E SERVIDOR

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 1.1 | PostgreSQL acessível (`psql $DATABASE_URL -c "SELECT 1"`) | | |
| 1.2 | Variável `DATABASE_URL` definida | | |
| 1.3 | Variável `NODE_ENV` definida como `production` | | |
| 1.4 | Script `sync_db2.py` presente na raiz do projeto | | |
| 1.5 | Dependências Python instaladas (`pyodbc`, `psycopg2`) | | |
| 1.6 | Variável `DB2_DSN` configurada (se sync ativo) | | |
| 1.7 | Servidor Node.js sobe sem erros (`npm run dev` ou start prod) | | |
| 1.8 | Log de início exibe "Servidor iniciado na porta 5000" | | |
| 1.9 | `runSafeMigrations()` concluiu sem erros críticos | | |
| 1.10 | Tabelas do banco existem (verificar com `\dt` no psql) | | |

---

## BLOCO 2 — AUTENTICAÇÃO E SESSÃO

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 2.1 | Login com admin/admin123 funciona | | |
| 2.2 | Token retornado e cookie `authToken` setado | | |
| 2.3 | `GET /api/auth/me` retorna dados do usuário logado | | |
| 2.4 | Logout limpa cookie e invalida sessão | | |
| 2.5 | Login com senha errada retorna 401 | | |
| 2.6 | Usuário inativo não consegue logar | | |
| 2.7 | Login via badge code funciona (se usado) | | |
| 2.8 | Rate limit de login ativo (20 tentativas / 15 min) | | |
| 2.9 | Sessões expiradas não permitem acesso | | |
| 2.10 | Seleção de empresa funciona para usuários multi-empresa | | |

---

## BLOCO 3 — SINCRONIZAÇÃO DB2

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 3.1 | `GET /api/sync/status` retorna `lastSyncError: null` | | |
| 3.2 | `POST /api/sync` dispara sync sem erros | | |
| 3.3 | Pedidos novos aparecem após sync | | |
| 3.4 | `cache_orcamentos` está sendo populado | | |
| 3.5 | `orders` e `order_items` são atualizados após sync | | |
| 3.6 | Sync automático a cada 10 minutos ativo | | |
| 3.7 | SSE emite `sync_finished` após conclusão | | |

---

## BLOCO 4 — PEDIDOS E LANÇAMENTO

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 4.1 | `GET /api/orders` retorna pedidos da empresa correta | | |
| 4.2 | Pedidos de outra empresa não aparecem (isolamento) | | |
| 4.3 | Lançar pedido muda status para `em_separacao` | | |
| 4.4 | WUs são criadas após lançamento | | |
| 4.5 | Pedido lançado aparece na fila de separação | | |
| 4.6 | Atribuição de rota funciona | | |
| 4.7 | Definição de prioridade funciona | | |
| 4.8 | Force status funciona (supervisor) | | |
| 4.9 | Cancelamento de pedido funciona | | |
| 4.10 | Relançamento de pedido funciona | | |

---

## BLOCO 5 — SEPARAÇÃO

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 5.1 | Operador `separacao` vê WUs das suas seções | | |
| 5.2 | Operador não vê WUs de outras seções | | |
| 5.3 | Lock de WU funciona (60 min TTL) | | |
| 5.4 | Lock retorna 409 se já bloqueado por outro | | |
| 5.5 | Renovação de lock funciona | | |
| 5.6 | Scan de item incrementa `separated_qty` | | |
| 5.7 | Item muda para `separado` ao atingir quantidade | | |
| 5.8 | Exceção pode ser registrada | | |
| 5.9 | WU concluída muda status para `concluido` | | |
| 5.10 | Pedido passa para `separado` quando todas WUs concluídas | | |
| 5.11 | WU de conferência criada automaticamente | | |
| 5.12 | Session restore funciona após recarga de página | | |
| 5.13 | Cross-order protection impede mistura de pedidos | | |

---

## BLOCO 6 — CONFERÊNCIA

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 6.1 | Conferente vê WUs de conferência disponíveis | | |
| 6.2 | Lock de WU de conferência funciona | | |
| 6.3 | Scan de barcode unitário registra `checked_qty` | | |
| 6.4 | Scan de barcode de caixa registra quantidade correta | | |
| 6.5 | Quantidade excedida retorna erro (over_quantity) | | |
| 6.6 | Item já completo retorna already_complete | | |
| 6.7 | Exceção pode ser registrada na conferência | | |
| 6.8 | WU concluída avança pedido para `conferido` / `finalizado` | | |
| 6.9 | Session restore funciona após recarga | | |
| 6.10 | Reset de conferência pelo supervisor funciona | | |

---

## BLOCO 7 — BALCÃO

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 7.1 | Fila balcão exibe apenas pedidos dos pontos balcão da empresa | | |
| 7.2 | Pedidos de separação regular não aparecem no balcão | | |
| 7.3 | Status da fila: em_fila / em_andamento / concluido | | |
| 7.4 | Operador pode iniciar atendimento | | |
| 7.5 | Scan e separação funcionam no fluxo balcão | | |
| 7.6 | Conclusão finaliza o pedido | | |
| 7.7 | Abandon / retomada de sessão funciona | | |
| 7.8 | Unlock supervisor funciona no balcão | | |
| 7.9 | SSE atualiza painel balcão em tempo real | | |

---

## BLOCO 8 — FILA DE PEDIDOS

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 8.1 | Painel `/fila-pedidos` carrega | | |
| 8.2 | Cards exibem status correto | | |
| 8.3 | Timer ao vivo atualiza a cada segundo | | |
| 8.4 | SSE atualiza cards sem recarregar página | | |
| 8.5 | Pedidos finalizados somem após 5 minutos | | |
| 8.6 | Pedidos com mais de 2 dias são ocultados | | |
| 8.7 | Status financeiro exibido corretamente | | |
| 8.8 | Som de alerta togglável funciona | | |

---

## BLOCO 9 — SUPERVISOR

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 9.1 | Lista de pedidos carrega com filtros | | |
| 9.2 | Lista de exceções carrega (empresa isolada) | | |
| 9.3 | Autorização de exceção funciona | | |
| 9.4 | Log de auditoria carrega | | |
| 9.5 | Criação de usuário funciona | | |
| 9.6 | Edição de usuário funciona | | |
| 9.7 | Criação de rota funciona | | |
| 9.8 | Atribuição de rota a pedidos funciona | | |
| 9.9 | Modo de separação pode ser alterado | | |
| 9.10 | Batch unlock de WUs funciona | | |

---

## BLOCO 10 — RELATÓRIOS

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 10.1 | Lista de separação carrega | | |
| 10.2 | Mapa de carregamento carrega | | |
| 10.3 | KPI de operadores carrega | | |
| 10.4 | Seleção de período no KPI funciona | | |
| 10.5 | Gráficos renderizam corretamente | | |
| 10.6 | Relatório de volumes carrega | | |
| 10.7 | Relatório de movimentações WMS carrega | | |

---

## BLOCO 11 — SSE E TEMPO REAL

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 11.1 | `GET /api/sse` retorna 200 com headers SSE | | |
| 11.2 | Heartbeat `: ping` enviado a cada 30s | | |
| 11.3 | Evento `connected` recebido ao conectar | | |
| 11.4 | Mudança de WU dispara `work_unit_updated` | | |
| 11.5 | Eventos não vazam entre empresas | | |
| 11.6 | Limite de 5 conexões por usuário retorna 429 | | |
| 11.7 | EventSource reconecta automaticamente | | |

---

## BLOCO 12 — IMPRESSÃO

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 12.1 | Agente de impressão conectado (/admin/print-agents) | | |
| 12.2 | Impressoras listadas pelo agente | | |
| 12.3 | Impressão de etiqueta de volume funciona | | |
| 12.4 | Impressão de etiqueta de pallet funciona | | |
| 12.5 | Configuração de impressora por seção salva | | |

---

## BLOCO 13 — HANDHELD (COLETOR)

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 13.1 | `/handheld/picking` carrega no dispositivo | | |
| 13.2 | Lock de seção funciona | | |
| 13.3 | Heartbeat mantém lock vivo | | |
| 13.4 | Submit de itens funciona | | |
| 13.5 | Deduplicação por msgId funciona (retry sem duplicar) | | |
| 13.6 | Unlock de seção funciona | | |
| 13.7 | WebSocket de scanner funciona (/ws/scanning) | | |

---

## BLOCO 14 — WMS

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 14.1 | Criação de endereço WMS funciona | | |
| 14.2 | Recebimento de NF funciona | | |
| 14.3 | Criação de pallet funciona | | |
| 14.4 | Checkin de pallet funciona | | |
| 14.5 | Transferência de pallet funciona | | |
| 14.6 | Retirada de pallet funciona | | |
| 14.7 | Contagem cíclica funciona | | |
| 14.8 | Consulta de produtos WMS funciona | | |

---

## BLOCO 15 — MULTI-EMPRESA

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 15.1 | Usuário empresa 1 não vê dados da empresa 3 | | |
| 15.2 | Usuário empresa 3 não vê dados da empresa 1 | | |
| 15.3 | Seleção de empresa ao login funciona | | |
| 15.4 | Troca de empresa durante sessão funciona | | |
| 15.5 | SSE isola broadcasts por empresa | | |
| 15.6 | Pontos balcão corretos por empresa | | |
| 15.7 | Sync DB2 popula ambas as empresas | | |

---

## BLOCO 16 — SEGURANÇA

| # | Verificação | Status | Observação |
|---|---|:---:|---|
| 16.1 | Endpoint protegido sem token retorna 401 | | |
| 16.2 | Operador sem acesso a rota retorna 403 | | |
| 16.3 | Operador não acessa dados de outra empresa | | |
| 16.4 | Senha em hash bcrypt no banco | | |
| 16.5 | Cookie httpOnly (não acessível via JS) | | |
| 16.6 | Cookie secure em produção (HTTPS only) | | |
| 16.7 | Headers de segurança Helmet ativos | | |
| 16.8 | Rate limiting ativo no login | | |
| 16.9 | Admin não pode ser criado por supervisor | | |
| 16.10 | Audit log registra ações críticas | | |

---

## ASSINATURA DO CHECKLIST

| Campo | Valor |
|---|---|
| Data da verificação | |
| Responsável | |
| Versão do sistema | |
| Ambiente | (dev / staging / prod) |
| Resultado geral | ✅ Aprovado / ❌ Reprovado / ⚠️ Aprovado com ressalvas |
| Observações | |

---

*Este checklist deve ser executado integralmente antes de qualquer go-live ou atualização crítica em produção.*
