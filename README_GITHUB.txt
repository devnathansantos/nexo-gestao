NEXO GESTÃO — V4.2
===================

ESTRUTURA
---------
Todos os arquivos ficam diretamente na raiz de propósito, para facilitar o upload pelo iPhone no GitHub.

index.html
style.css
script.js
logo.png
icon-192.png
icon-192-maskable.png
icon-512.png
icon-512-maskable.png
apple-touch-icon.png
manifest.json
sw.js
README_GITHUB.txt

COMO PUBLICAR PELO IPHONE
--------------------------
1. Baixe e descompacte este ZIP no app Arquivos.
2. Abra o repositório do GitHub.
3. Faça upload dos ARQUIVOS, não de uma pasta externa.
4. Confirme que index.html está na raiz do repositório.
5. Vá em Settings > Pages.
6. Em Source, selecione Deploy from a branch.
7. Escolha a branch main e a pasta / (root).
8. Salve e abra o endereço do GitHub Pages.

PWA / TELA INICIAL DO IPHONE
----------------------------
A logo completa fica em logo.png. Os ícones do app são separados para uso normal e maskable. O apple-touch-icon agora tem fundo opaco para evitar fundo preto no iOS.

No iPhone: Safari > Compartilhar > Adicionar à Tela de Início.
Se o atalho antigo mostrar um ícone antigo, remova-o e adicione novamente depois de publicar esta versão.

DADOS E BACKUP
--------------
Esta edição continua sendo um protótipo estático: login e dados ficam no armazenamento local do navegador. A mesma conta não sincroniza automaticamente entre aparelhos.

O NEXO pede armazenamento persistente quando o navegador oferece essa API e mostra um aviso para instalar o app na Tela de Início. Também registra lastBackupAt e mostra lembrete quando o backup mais recente tem 7 dias ou mais. Isso é um lembrete local: o NEXO NÃO cria um arquivo de backup automático na nuvem.

Faça backup JSON regularmente. O armazenamento local não substitui um banco online e não permite sincronização automática entre dispositivos.

ARQUITETURA E COMPATIBILIDADE
-----------------------------
- schemaVersion foi atualizado para 6; a migração preserva os campos anteriores e adiciona catálogo, orçamentos e metas com coleções vazias quando ausentes.
- amountCents continua sendo a fonte monetária.
- IDs estáveis continuam sendo preservados quando são válidos; IDs inválidos ou duplicados de backups são regenerados com segurança.
- createdAt / updatedAt permanecem.
- Soft-deactivation para clientes, veículos e funcionários.
- Anulação de lançamentos sem destruir histórico.
- clientId / vehicleId / employeeId + snapshots preservam o histórico.
- Camada StorageRepository isola localStorage para futura API/Supabase.
- Código organizado em funções de domínio, renderização, persistência e eventos para facilitar manutenção no Cursor e outros assistentes de código.
- Datas não têm limite fixo: 2027, 2028, 2029, 2030 e anos posteriores usam a mesma estrutura.

ROADMAP 2027–2030
-----------------
2027 — Supabase/PostgreSQL + Auth, recuperação de senha, RLS e sincronização entre iPhone/computador.
2028 — multiusuário, convites, permissões, histórico de alterações e governança por empresa.
2029 — relatórios avançados, contas a receber, pagamentos parciais e importações.
2030 — integrações externas, automações e novos módulos sobre o mesmo núcleo de clientes, veículos, funcionários e lançamentos.

ESCOPO FUNCIONAL
----------------
- Login e criação de conta personalizada.
- Sem modo demonstração.
- Dashboard mensal e análise anual.
- Faturamento, recebido, a receber, despesas, pagamentos a funcionários, resultado, ticket médio e serviços.
- Clientes permanentes com vários veículos.
- Histórico por cliente e por funcionário.
- Edição em serviços, despesas, clientes, veículos e funcionários.
- Inativação/reativação sem apagar histórico.
- Anulação de lançamentos.
- Botão rápido para marcar serviço pendente como recebido, pedindo forma de pagamento.
- Backup/restore JSON e CSV.
- PWA com cache versionado, network-first para HTML/CSS/JS e cache seguro somente de respostas OK.
- Menu lateral mobile com fechamento explícito e sobreposição acima da barra inferior.

SEM MODO DEMONSTRAÇÃO.


V4.2 — Lembrete de backup: o dashboard exibe um card de BACKUP URGENTE quando não existe backup ou quando já se passaram 7 dias desde o último backup. O contador só é reiniciado após iniciar a exportação e confirmar que o arquivo foi localizado e guardado. O navegador não consegue verificar por conta própria onde o arquivo foi salvo. O lembrete é local e não envia notificações push.


NEXO Gestão V4.2 — módulos e correções
- Perfil da empresa com contato e logotipo local.
- Catálogo de pacotes sem preços fixos.
- Orçamentos vinculados aos clientes e veículos existentes, com impressão/PDF pelo navegador, WhatsApp manual e conversão protegida em serviço.
- Retorno de clientes por tempo desde o último serviço registrado.
- Meta mensal de faturamento.
- Backup JSON inclui catálogo, orçamentos e metas. A exportação inicia um download local e pede confirmação explícita antes de reiniciar o lembrete; o navegador não confirma onde o arquivo foi guardado.

Limitações importantes: os dados continuam apenas no armazenamento local deste navegador/aparelho. O logotipo também fica local. A conversão de orçamento cria um serviço pendente de recebimento, usando a data atual. A lista de retorno interpreta cada serviço não anulado como atendimento realizado porque o modelo atual não tem um estado separado de conclusão do serviço.


ATUALIZAR E REVERTER
--------------------
Para testar, publique estes arquivos em um repositório/branch de teste separado ou faça um backup JSON antes de substituir os arquivos estáveis. Para atualizar, envie todos os arquivos deste ZIP para a raiz do repositório de teste. Para reverter, restaure os arquivos da versão anterior; não limpe o armazenamento do navegador. A V4.2 mantém as mesmas chaves locais de conta e dados da V3.6 e executa migração de schema ao carregar. Faça um backup JSON antes de testar a nova versão.


V4.2: compartilhamento de orçamento como arquivo PDF via menu de compartilhamento do dispositivo quando suportado; prévia PDF com retorno pelo navegador; foto de perfil e logotipo recortados em quadrado com zoom/posicionamento; cor de destaque configurável; pacote aplicado como um único serviço com lista de itens incluídos.

V4.2 — ajustes de estabilidade, dados multilinha, foto de perfil no avatar lateral, orçamento/PDF/WhatsApp, recorte quadrado de foto e logotipo, e cor configurável dos PDFs. A geração e o compartilhamento de PDF utilizam jsPDF carregado pela CDN; a primeira geração exige conexão com a internet.


V4.2 — correções desta versão de teste
- A foto de perfil recortada em Configurações aparece no avatar quadrado do administrador no menu lateral; o logotipo da empresa é separado e usado nos orçamentos. Sem foto de perfil, permanecem as iniciais do administrador.
- Migração preserva nomes comerciais já preenchidos e quebras de linha em descrições, observações e condições.
- Ao aplicar um pacote em um orçamento novo, a linha vazia inicial é preenchida em vez de exigir sua remoção manual. Itens digitados com marcador ‘•’ não recebem um marcador duplicado.
- Operações de gravação tentam restaurar a versão anterior em memória caso o navegador recuse a gravação, por exemplo quando o armazenamento estiver cheio.
- Validação estrita de datas de calendário e erro de leitura de backup tratados de forma controlada.
- O Service Worker remove somente caches antigos identificados como caches do NEXO, preservando caches de outros aplicativos no mesmo domínio.

Limitação de retenção: o sistema atual registra estado de pagamento (recebido/pendente), não um estado separado de conclusão do trabalho. A lista de retorno usa registros de serviço não anulados/cancelados como atendimentos realizados; um serviço com pagamento pendente continua contando como atendimento registrado.
