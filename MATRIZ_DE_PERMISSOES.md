# MATRIZ DE PERMISSÕES — STOKER WMS

> Baseado na implementação real em `server/routes.ts`, `client/src/App.tsx` e `server/auth.ts`

---

## 1. PERFIS EXISTENTES

| Código | Nome de exibição | Descrição |
|---|---|---|
| `administrador` | Administrador | Acesso total. Único que gerencia outros admins |
| `supervisor` | Supervisor | Gestão operacional completa |
| `separacao` | Separação | Opera separação de produtos |
| `conferencia` | Conferência | Opera conferência por barcode |
| `balcao` | Balcão | Atende retiradas presenciais |
| `fila_pedidos` | Fila de Pedidos | Apenas visualização do painel |
| `recebedor` | Recebedor | Recebe NFs e cria pallets |
| `empilhador` | Empilhador | Movimenta pallets no armazém |
| `conferente_wms` | Conferente WMS | Contagem cíclica de estoque |

---

## 2. MATRIZ PRINCIPAL — ROTAS DE ACESSO

Legenda: ✅ Acesso completo | 👁️ Apenas visualização | ⚙️ Acesso operacional | 🔒 Somente admins | ❌ Sem acesso

| Módulo / Rota | admin | supervisor | separacao | conferencia | balcao | fila_pedidos | recebedor | empilhador | conferente_wms |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Login** `/login` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Home** `/` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Separação Desktop** `/separacao` | ✅ | ❌ | ⚙️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Separação Handheld** `/handheld/picking` | ✅ | ❌ | ⚙️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Conferência** `/conferencia` | ✅ | ✅ | ❌ | ⚙️ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Balcão** `/balcao` | ✅ | ✅ | ❌ | ❌ | ⚙️ | ❌ | ❌ | ❌ | ❌ |
| **Fila de Pedidos** `/fila-pedidos` | ✅ | ✅ | ❌ | ❌ | ❌ | 👁️ | ❌ | ❌ | ❌ |
| **Sup: Pedidos** `/supervisor/orders` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Sup: Exceções** `/supervisor/exceptions` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Sup: Auditoria** `/supervisor/audit` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Sup: Usuários** `/supervisor/users` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Sup: Rotas** `/supervisor/routes` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Sup: Relatórios** `/supervisor/reports` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Sup: Modo Sep.** `/supervisor/separation-settings` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Sup: Impressão** `/supervisor/print-settings` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Sup: Barcodes** `/supervisor/codigos-barras` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Sup: Mapping Studio** `/supervisor/mapping-studio` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Admin: KPI** `/admin/kpi-operadores` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Admin: Permissões** `/admin/permissoes` | 🔒 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Admin: Limpeza** `/admin/limpeza` | 🔒 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Admin: Print Agents** `/admin/print-agents` | 🔒 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **WMS: Endereços** `/wms/enderecos` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **WMS: Recebimento** `/wms/recebimento` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ⚙️ | ❌ | ❌ |
| **WMS: Checkin** `/wms/checkin` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ⚙️ | ⚙️ | ❌ |
| **WMS: Transferência** `/wms/transferencia` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚙️ | ❌ |
| **WMS: Retirada** `/wms/retirada` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚙️ | ❌ |
| **WMS: Adição** `/wms/adicao` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ⚙️ | ⚙️ | ❌ |
| **WMS: Contagem** `/wms/contagem` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚙️ |
| **WMS: Produtos** `/wms/produtos` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ⚙️ | ⚙️ | ⚙️ |
| **WMS: Barcodes** `/wms/codigos-barras` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |

---

## 3. MATRIZ DE AÇÕES — NÍVEL DE API

### 3.1 Gestão de Usuários

| Ação | admin | supervisor | outros |
|---|:---:|:---:|:---:|
| Listar usuários | ✅ | ✅ | ❌ |
| Criar usuário | ✅ | ✅ | ❌ |
| Editar usuário | ✅ | ✅* | ❌ |
| Desativar usuário | ✅ | ✅* | ❌ |
| Criar/editar administrador | ✅ | ❌ | ❌ |
| Rotacionar badge | ✅ | ✅ | ❌ |

*Supervisores não podem editar nem criar outros administradores.

### 3.2 Gestão de Pedidos

| Ação | admin | supervisor | separacao | conferencia | balcao | outros |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Ver pedidos da empresa | ✅ | ✅ | ✅¹ | ❌ | ❌ | ❌ |
| Lançar pedidos | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Atribuir rota | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Definir prioridade | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Forçar status | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Cancelar pedido | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Relancar pedido | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

¹Separação vê apenas pedidos em status `em_separacao`. Em modo `by_section`, filtra pelos que têm itens nas seções do operador.

### 3.3 Work Units (Operação)

| Ação | admin | supervisor | separacao | conferencia | balcao |
|---|:---:|:---:|:---:|:---:|:---:|
| Ver WUs da empresa | ✅ | ✅ | ✅² | ✅² | ✅² |
| Bloquear WU (lock) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Desbloquear própria WU | ✅ | ✅ | ✅ | ✅ | ✅ |
| Desbloquear WU de outro | ✅ | ✅ | ❌ | ❌ | ❌ |
| Batch unlock | ✅ | ✅ | ❌ | ❌ | ❌ |
| Scan de separação | ✅ | ✅ | ✅ | ❌ | ✅ |
| Scan de conferência | ✅ | ✅ | ❌ | ✅ | ✅ |
| Completar WU | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reset conferência | ✅ | ✅ | ❌ | ❌ | ❌ |
| Renovar lock | ✅ | ✅ | ✅ | ✅ | ✅ |

²Filtrado por seções do operador e empresa.

### 3.4 Exceções

| Ação | admin | supervisor | separacao | conferencia | balcao |
|---|:---:|:---:|:---:|:---:|:---:|
| Ver exceções | ✅ | ✅ | ❌³ | ❌³ | ❌³ |
| Registrar exceção | ✅ | ✅ | ✅ | ✅ | ✅ |
| Autorizar exceção | ✅ | ✅ | ❌⁴ | ❌⁴ | ❌⁴ |
| Deletar exceção | ✅ | ✅ | ❌ | ❌ | ❌ |

³Operadores veem apenas as exceções de suas próprias WUs (dentro do fluxo operacional).  
⁴Exceção: usuários com `settings.canAuthorizeOwnExceptions = true` podem autorizar suas próprias.

### 3.5 Configurações do Sistema

| Ação | admin | supervisor | outros |
|---|:---:|:---:|:---:|
| Ver modo de separação | ✅ | ✅ | ✅ |
| Mudar modo de separação | ✅ | ✅ | ❌ |
| Forçar troca com ops ativas | ✅ | ✅ | ❌ |
| Ver feature flags | ✅ | ✅ | ✅ |
| Editar feature flags | ✅ | ✅ | ❌ |
| Trigger sync DB2 | ✅ | ✅ | ❌ |
| Ver status do sync | ✅ | ✅ | ❌ |
| Gerenciar permissões (allowedModules) | ✅ | ❌ | ❌ |
| Limpeza de dados | ✅ | ❌ | ❌ |

### 3.6 Sync e Dados

| Ação | admin | supervisor | outros |
|---|:---:|:---:|:---:|
| Disparar sync manual | ✅ | ✅ | ❌ |
| Ver status do sync | ✅ | ✅ | ❌ |
| Batch sync (API) | ✅ | ✅ | ❌ |
| Mapping Studio | ✅ | ✅ | ❌ |
| KPI de operadores | ✅ | ✅ | ❌ |
| Logs de auditoria | ✅ | ✅ | ❌ |

---

## 4. RESTRIÇÕES IMPORTANTES POR PERFIL

### `separacao`
- Acessa **apenas** as seções atribuídas no campo `users.sections`
- Em modo `by_order`: vê WUs por seção
- Em modo `by_section`: pode receber pedido inteiro, mas filtrado pelas suas seções
- Sem seções atribuídas = não vê nenhuma WU
- Só acessa `/separacao` e `/handheld/picking`

### `supervisor`
- Não pode acessar páginas admin (`/admin/*`)  
- Pode desbloquear WUs de qualquer operador da empresa
- Pode autorizar exceções
- Pode mudar modo de separação (mesmo com ops ativas, usando `force: true`)
- Não pode criar/editar administradores

### `administrador`
- Acesso total
- Único que pode editar usuários `administrador`
- Tem acesso às páginas `/admin/*` exclusivas
- KPI disponível em `/admin/kpi-operadores`

### `fila_pedidos`
- **Somente visualização** — não executa nenhuma ação operacional
- Acessa `/fila-pedidos` que é um painel de display (TV do armazém)
- Dados atualizados via SSE + polling a cada 30s

### `balcao`
- Acesso à fila de pedidos balcão (pontos de retirada configurados em `company-config.ts`)
- Não vê pedidos de separação regular
- Opera separação + conferência num único fluxo simplificado

### Perfis WMS (`recebedor`, `empilhador`, `conferente_wms`)
- Acesso restrito ao módulo WMS (`/wms/*`)
- Cada sub-perfil acessa somente as operações pertinentes
- `empilhador` NÃO acessa recebimento
- `recebedor` NÃO acessa transferência e retirada

---

## 5. PERMISSÕES GRANULARES (CAMPO `allowedModules`)

O campo `users.allowedModules` é um array de strings que permite controle granular adicional. Gerenciado em `/admin/permissoes`.

> Observação: A implementação do filtro por `allowedModules` depende do frontend validar o campo. A proteção de backend é feita pelo `requireRole()` nas rotas.

---

## 6. MULTI-EMPRESA — ISOLAMENTO

Todo usuário tem `allowedCompanies: number[]` que define quais empresas pode acessar.

| Cenário | Comportamento |
|---|---|
| 1 empresa na lista | Login diretamente nessa empresa |
| 2+ empresas | Redireciona para `/select-company` |
| Empresa não na lista | Login retorna 403 |
| Mudança de empresa | `POST /api/auth/select-company` — requer reautenticação contextual |
| Dados de outra empresa | API retorna 403 (verificação por `companyId`) |

---

*Última atualização: baseado em leitura de `server/routes.ts`, `server/auth.ts`, `client/src/App.tsx`*
