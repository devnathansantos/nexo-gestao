# NEXO Gestão V5.5 — atualização incremental

Aplicativo gratuito de gestão operacional para estética automotiva. Funciona em GitHub Pages com HTML, CSS e JavaScript, mantendo os dados localmente no navegador.

## Arquivos

Todos os arquivos ficam diretamente na raiz do ZIP, prontos para enviar ao repositório:

- `index.html` — estrutura da aplicação
- `style.css` — aparência e responsividade
- `script.js` — funcionalidades e armazenamento local
- `sw.js` — cache/offline e atualização da aplicação
- `manifest.json` e arquivos PNG — instalação como PWA
- `logo.png` — identidade visual padrão

## Publicar no GitHub Pages

1. Baixe e descompacte o ZIP.
2. Antes de atualizar uma instalação existente, exporte um backup JSON e guarde-o fora do navegador.
3. Envie os arquivos do ZIP para a raiz do repositório, substituindo os arquivos de mesmo nome.
4. No GitHub, abra **Settings → Pages** e confirme `main` e `/(root)`.
5. Aguarde a publicação e abra o site. Se a versão antiga continuar aparecendo, feche e reabra o site; no iPhone, pode ser necessário fechar a PWA e abri-la novamente.

## PDF e WhatsApp

O NEXO tenta gerar o PDF com jsPDF. Se a biblioteca externa não carregar, a prévia continua disponível e oferece a impressão nativa do navegador: escolha **Salvar como PDF**. No iPhone, use o menu de compartilhamento para salvar em Arquivos ou enviar o arquivo pelo WhatsApp quando essa opção estiver disponível. O navegador não permite que um site envie um arquivo silenciosamente.

## Foto e logotipo

Em **Configurações**, a foto do administrador é recortada em formato quadrado e aparece no avatar do menu lateral. O logotipo da empresa é independente, também pode ser recortado e aparece nos orçamentos. A cor principal dos documentos pode ser personalizada.

## Pacotes e orçamentos

Cadastre pacotes reutilizáveis no Catálogo, por exemplo **Lavagem padrão**, com a lista de serviços incluídos. Ao usar o pacote no orçamento, o nome e os itens são preenchidos automaticamente; o preço é definido para cada orçamento. Clientes e veículos são escolhidos dos cadastros existentes. O WhatsApp exige confirmação manual.

## Backup e dados

- O armazenamento é local ao navegador/aparelho; não existe sincronização automática entre dispositivos nem backup automático na nuvem.
- O cartão de backup urgente aparece quando não há backup confirmado ou quando já passaram sete dias.
- O lembrete só é reiniciado após iniciar a exportação e confirmar que o arquivo foi localizado e guardado.
- Para restaurar, selecione um JSON exportado pelo NEXO e confirme a substituição dos dados atuais.
- O armazenamento local pode ser apagado pelo navegador ou pelo sistema. Faça backups regulares e mantenha-os em local seguro.

## V5.5 — estabilidade de PDF

- A prévia de orçamento abre dentro do NEXO, sem depender de uma nova janela ou pop-up.
- Se a biblioteca de PDF estiver disponível, o botão de compartilhamento gera o arquivo PDF e usa o menu nativo quando suportado.
- Se a biblioteca não carregar, a prévia oferece **Imprimir / Salvar PDF** pelo navegador. No iPhone, escolha a opção de compartilhar/salvar da interface de impressão.
- O logotipo na prévia preserva a proporção (`object-fit: contain`).
- Cache do Service Worker atualizado para V5.5.1.

## O que há nesta versão

- Dashboard mensal e análises anuais.
- Clientes com múltiplos veículos e histórico.
- Serviços, despesas e pagamentos a funcionários.
- Catálogo de pacotes personalizáveis.
- Orçamentos com desconto, validade, observações, condições, impressão/PDF e conversão protegida em serviço.
- Retorno de clientes por tempo desde o último serviço registrado.
- Meta mensal de faturamento.
- Foto de perfil, logotipo quadrado e cor configurável para documentos.
- Backup JSON, exportação CSV e lembrete semanal.
- PWA, navegação responsiva e cache versionado.

## Teste e reversão

Teste primeiro com um backup guardado. Confira login, cadastros existentes, criação de orçamento, PDF, compartilhamento, avatar, catálogo, exportação e restauração. Para reverter, publique novamente os arquivos da versão anterior; não limpe os dados do navegador.

**Limitação:** a autenticação é local e não equivale a login seguro de produção. O NEXO não usa PostgreSQL nem sincroniza os dados entre dispositivos nesta versão.


## V5.1 — impressão de orçamentos

- O botão `PDF / Imprimir` voltou ao fluxo de impressão nativa em uma janela própria, sem depender do gerador jsPDF para baixar/imprimir o documento.
- A impressão usa o layout HTML do orçamento e respeita a cor principal e o logotipo configurados.
- No iPhone, use o menu Compartilhar da prévia de impressão para salvar em Arquivos ou compartilhar quando o Safari oferecer essa opção.
- O botão `Compartilhar PDF` continua tentando compartilhar um arquivo PDF pelo menu nativo do dispositivo; se não for suportado, baixa o arquivo para anexação manual. O navegador não permite envio silencioso/automático ao WhatsApp.
- O cache do Service Worker foi atualizado para V5.1.


## Atualização incremental V5.5.1

- Mantém a linha V5.5 e a estrutura original do projeto.
- Renderização seletiva: atualiza a tela ativa após alterações; as demais telas são atualizadas ao serem abertas.
- A navegação renderiza a tela de destino para evitar conteúdo antigo ao alternar de seção.
- Cache do Service Worker atualizado para V5.5.1.
- Os dados continuam locais no navegador; faça backup JSON antes de substituir os arquivos publicados.
