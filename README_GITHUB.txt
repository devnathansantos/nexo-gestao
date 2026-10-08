NEXO GESTÃO — V3.6
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
- schemaVersion permanece 4.
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


V3.6 — Lembrete de backup: o dashboard exibe um card de BACKUP URGENTE quando não existe backup ou quando já se passaram 7 dias desde o último backup. Ao exportar o JSON, o contador é reiniciado. O lembrete é local e não envia notificações push.
