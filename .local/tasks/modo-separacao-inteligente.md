# Troca Inteligente de Modo de Separação

## What & Why
O sistema hoje separa por pedido/rota. O modo antigo separava por seção, onde cada separador trabalha apenas na sua seção atribuída. Precisamos permitir alternar entre os dois modos de forma inteligente, detectando automaticamente se há separações em andamento antes de permitir a mudança, evitando conflitos e perda de trabalho.

## Done looks like
- Supervisores/admins podem ver e alterar o modo de separação em uma página de configurações
- O sistema mostra um aviso claro se houver sessões de picking ativas ou work units em andamento ao tentar trocar o modo
- O supervisor pode escolher: aguardar as separações concluírem ou forçar a troca (cancelando sessões ativas, com log de auditoria)
- No modo **Por Seção**: coletores veem apenas work units da sua(s) seção(ões) atribuída(s), sem visualizar pedidos de outras seções
- No modo **Por Pedido/Rota** (atual): coletores veem work units agrupados por pedido e rota, podendo pegar qualquer pedido disponível
- A interface do handheld reflete o modo ativo automaticamente (sem necessidade de reiniciar o app)
- O modo ativo é exibido visivelmente na interface do coletor para que o separador saiba em qual modo está operando

## Out of scope
- Alteração da lógica de criação de work units no sync do ERP (os work units já são criados por seção)
- Modo de separação por seção e pedido simultaneamente (são mutuamente exclusivos)
- Atribuição automática de seções a usuários (essa atribuição já existe no cadastro de usuário)

## Tasks
1. **Configuração global do modo de separação** — Criar um registro de configuração do sistema (`system_settings`) no banco ou usar uma tabela existente para armazenar `separation_mode` ('by_section' | 'by_order'). Expor endpoints GET/PATCH para leitura e alteração desse valor. Aplicar autenticação de supervisor/admin no endpoint de escrita.

2. **Lógica de verificação antes da troca** — No endpoint de troca de modo, antes de salvar, consultar sessões de picking ativas (`picking_sessions` com heartbeat recente) e work units com status `em_andamento`. Retornar um payload com a contagem de conflitos. Se houver conflitos, exigir um parâmetro `force: true` para confirmar a troca (que cancela as sessões e registra em auditoria).

3. **Página de configurações de separação** — Criar ou expandir a área de configurações do supervisor com um card dedicado ao modo de separação. Exibir o modo atual, um toggle/seletor para alternar, e um modal de confirmação que lista os conflitos ativos (separadores em andamento, seções afetadas) antes de confirmar a troca.

4. **Adaptação da lista de picking do handheld por modo** — No backend, o endpoint que retorna work units disponíveis deve filtrar conforme o modo ativo: no modo `by_section`, retornar apenas work units cuja `section` esteja atribuída ao usuário logado; no modo `by_order`, manter o comportamento atual (filtro por rota/pedido). O frontend do handheld deve exibir o modo ativo e adaptar os rótulos/filtros exibidos.

5. **Indicador de modo na interface do coletor** — Exibir de forma visível (ex: badge ou texto no cabeçalho do handheld) qual modo está ativo, para que o separador saiba se está trabalhando por seção ou por pedido.

## Relevant files
- `shared/schema.ts`
- `server/storage.ts`
- `server/routes.ts`
- `client/src/pages/handheld/picking.tsx`
- `client/src/components/handheld/PickingList.tsx`
- `client/src/pages/supervisor/users.tsx`
- `client/src/pages/supervisor/home.tsx`
- `client/src/pages/supervisor/routes.tsx`
