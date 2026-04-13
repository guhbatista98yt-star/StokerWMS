# UI/UX Responsivo para Coletores Mobile

## What & Why
Os coletores de dados (smartphones/handhelds) usados pelos separadores exibem cards e informações que vazam da tela e menus com problemas de layout. A experiência precisa ser revisada e corrigida para que tudo caiba na tela sem overflow, com botões grandes o suficiente para uso com luvas em ambiente de armazém.

## Done looks like
- Nenhum card, tabela ou informação vaza horizontalmente da tela em dispositivos móveis
- O menu/navegação funciona corretamente em telas pequenas (sem sobreposições ou itens cortados)
- Todos os botões de ação nas páginas de coletores têm tamanho adequado para toque com dedo/luva (mínimo 48px de altura)
- As páginas do handheld (picking, separação) são completamente usáveis em telas de 360px de largura
- Textos longos (nome de produto, descrição) são truncados ou quebrados corretamente sem vazar o layout
- Inputs e formulários não causam scroll horizontal
- A página de separação desktop continua funcional em telas maiores (tablet/desktop)

## Out of scope
- Redesign visual completo (cores, tipografia, marca)
- Criação de novas funcionalidades
- Páginas de administração/supervisor (não acessadas por coletores)

## Tasks
1. **Auditoria e correção de overflow nas páginas handheld** — Revisar `PickingLayout`, `PickingList`, `ItemCard` e `PickingSession`. Garantir que nenhum elemento ultrapasse o viewport em dispositivos com 360-480px de largura. Corrigir containers com `overflow-hidden` e aplicar `min-w-0` e `truncate` onde necessário.

2. **Responsividade da página de separação principal** — A página `separacao/index.tsx` usa tabelas e filtros complexos. Criar uma visualização compacta e empilhada para mobile (esconder colunas não essenciais, usar cards em vez de linhas de tabela em telas pequenas) sem quebrar a experiência desktop.

3. **Correção do menu/navegação mobile** — Garantir que o Sidebar em modo mobile (Sheet/drawer) não sobreponha conteúdo, que o botão de abertura seja facilmente tocável, e que os itens de menu tenham altura mínima de 48px para toque fácil.

4. **Botões e inputs adaptados para coletores** — Revisar páginas de picking e recebimento para que botões primários tenham no mínimo 48px de altura, inputs de scan não disparem o teclado virtual inesperadamente, e feedback visual (confirmação de scan) seja visível sem rolar a página.

5. **Testes visuais nas páginas WMS acessadas por coletores** — Verificar `wms/recebimento.tsx` e outras páginas WMS que coletores acessam, corrigindo qualquer overflow de card, texto ou botão em viewport pequeno.

## Relevant files
- `client/src/components/handheld/ItemCard.tsx`
- `client/src/components/handheld/PickingLayout.tsx`
- `client/src/components/handheld/PickingList.tsx`
- `client/src/components/handheld/PickingSession.tsx`
- `client/src/pages/handheld/picking.tsx`
- `client/src/pages/separacao/index.tsx`
- `client/src/pages/wms/recebimento.tsx`
- `client/src/components/ui/sidebar.tsx`
- `client/src/hooks/use-mobile.tsx`
