# Exibir Separação, Conferência e Balcão nas Permissões

## What & Why
Os módulos Separação, Conferência e Balcão existem no sistema com rotas e páginas funcionais, mas não aparecem na tela de Permissões de Acesso (`/admin/permissoes`). Isso impede que administradores concedam ou revoguem acesso granular a esses módulos por usuário. A tarefa é adicioná-los à lista de módulos visíveis no gerenciamento de permissões.

## Done looks like
- Na tela de Permissões de Acesso, os módulos "Separação", "Conferência" e "Balcão" aparecem como opções selecionáveis para cada usuário.
- Administradores podem marcar/desmarcar esses módulos para controlar o acesso dos usuários.

## Out of scope
- Alterações na lógica de rotas protegidas (ProtectedRoute) no App.tsx.
- Mudanças na tela Home ou no menu de navegação.
- Criação de novas páginas ou funcionalidades.

## Tasks
1. Adicionar os módulos `/separacao` (Separação), `/conferencia` (Conferência) e `/balcao` (Balcão) à constante `ALL_MODULES` no arquivo de permissões, dentro de uma seção apropriada (ex: "Operação" ou uma nova seção).

## Relevant files
- `client/src/pages/admin/permissoes.tsx:36-54`
