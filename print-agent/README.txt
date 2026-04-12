================================================================
  Stoker WMS — Agente de Impressão Local
================================================================

REQUISITOS:
  - Windows 7/8/10/11
  - Python 3.8 ou superior (https://www.python.org/downloads/)
    → Marque "Add Python to PATH" na instalação
  - SumatraPDF (opcional, melhora a impressão)
    → Baixe em: https://www.sumatrapdfreader.org/

INSTALAÇÃO:
  1. Copie esta pasta inteira para a máquina com impressoras
  2. Abra o painel Admin do Stoker WMS no navegador
  3. Vá em Admin → Agentes de Impressão
  4. Crie um novo agente e copie o TOKEN exibido
  5. Edite o arquivo config.ini:
       server_url = https://seu-servidor.replit.app
       token      = TOKEN_COPIADO_DO_SISTEMA
  6. Execute instalar.bat (primeira vez) ou iniciar.bat (depois)

DEPENDÊNCIAS:
  O instalar.bat instala automaticamente:
    - websocket-client  (comunicação com servidor)
    - reportlab         (geração de PDFs nativos — etiquetas)
    - xhtml2pdf         (fallback para PDFs via HTML)
    - pywin32           (detecção de impressoras Windows)

NOMES DAS IMPRESSORAS NO SISTEMA:
  Após o agente conectar, as impressoras aparecerão no WMS
  com o formato:  NOME_MAQUINA\Nome da Impressora
  Exemplo:       COMPUTADOR01\Zebra ZT420

  Ao configurar a impressora de um usuário, selecione o
  formato MAQUINA\Impressora para rotear pelo agente.

LOGS:
  O arquivo agent.log registra todas as atividades.
  Em caso de problema, verifique este arquivo.

RODAR COMO SERVIÇO WINDOWS (opcional):
  Para iniciar automaticamente com o Windows, use NSSM:
  1. Baixe NSSM em: https://nssm.cc/
  2. Execute: nssm install StokerPrintAgent
  3. Configure:
       Path:            C:\caminho\para\python.exe
       Arguments:       C:\caminho\para\print-agent\agent.py
       Startup dir:     C:\caminho\para\print-agent\

SEGURANÇA:
  - O agente conecta DO computador local PARA o servidor
  - Não é necessário abrir portas no firewall
  - O token é armazenado como hash SHA-256 no servidor
  - Cada agente tem um token único — revogue pelo painel se necessário

================================================================
