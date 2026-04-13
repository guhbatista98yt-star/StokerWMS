# Sinais Sonoros Personalizados para Leitura

## What & Why
Adicionar feedback sonoro distinto para cada resultado de leitura de código de barras no coletor (Zebra TC21 e similares). Hoje o sistema usa apenas notificações visuais (toasts e status do input). Com sons diferentes, o operador saberá imediatamente o resultado da leitura sem precisar olhar para a tela — aumentando velocidade e reduzindo erros.

## Done looks like
- Ao bipar com sucesso (item encontrado e quantidade válida), toca um bip curto agudo de confirmação.
- Ao bipar um produto não encontrado, toca um som grave/duplo de alerta.
- Ao exceder a quantidade permitida, toca um som triplo rápido de aviso.
- Ao ocorrer um erro desconhecido/sincronização, toca um som contínuo grave de erro.
- Ao concluir toda a coleta (todos os itens separados), toca uma melodia curta de conclusão (tipo "tarefa completa").
- Os sons funcionam no navegador do coletor TC21 sem precisar de arquivos de áudio externos (gerados via Web Audio API).
- Os sons devem respeitar uma configuração global que permita ao usuário ativar/desativar o áudio.

## Out of scope
- Configuração de volume ou personalização dos sons pelo usuário na interface.
- Integração direta com a API DataWedge da Zebra (os sons são do app web, não do hardware).
- Vibração do dispositivo (pode ser adicionada futuramente).

## Tasks
1. Criar um módulo utilitário de áudio usando a Web Audio API que gere tons programáticos (sem arquivos .mp3/.wav). Definir funções para cada tipo de som: `playSuccess()`, `playNotFound()`, `playQtyExceeded()`, `playError()`, `playCollectionComplete()`. Cada som deve ter frequência, duração e padrão distintos para fácil identificação auditiva.

2. Criar um hook React (`useScanSound`) que encapsule o módulo de áudio e respeite uma flag de ativação/desativação armazenada em localStorage.

3. Integrar os sons nos fluxos de separação, conferência e balcão — disparando o som correto em cada ponto onde `scanStatus` muda ou onde toasts de erro/aviso são exibidos. Garantir que o som toca junto com o feedback visual existente (não substituí-lo).

4. Adicionar um toggle de "Sons de leitura" nas configurações ou no header do layout handheld, permitindo ativar/desativar os sinais sonoros.

## Relevant files
- `client/src/pages/separacao/index.tsx`
- `client/src/pages/conferencia/index.tsx`
- `client/src/pages/balcao/index.tsx`
- `client/src/components/ui/scan-input.tsx`
- `client/src/components/handheld/PickingSession.tsx`
- `client/src/hooks/use-barcode-scanner.ts`
- `client/src/hooks/use-scan-websocket.ts`
