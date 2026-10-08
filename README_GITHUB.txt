NEXO GESTÃO — PACOTE GITHUB PAGES
=================================

ESTRUTURA PROPOSITALMENTE PLANA
--------------------------------
Todos os arquivos necessários ficam na RAIZ deste ZIP. Não mova logo.png, style.css,
script.js, manifest.json ou sw.js para subpastas.

Arquivos:
- index.html       página principal
- style.css        visual/responsivo
- script.js        funcionamento do sistema
- logo.png         logo NEXO Gestão
- manifest.json    instalação como PWA
- sw.js            cache/offline básico

COMO PUBLICAR NO GITHUB PELO IPHONE
------------------------------------
1. Descompacte este ZIP no app Arquivos.
2. Entre no seu repositório do GitHub pelo Safari.
3. Abra a opção para adicionar/upload files.
4. Envie os ARQUIVOS DA RAIZ, principalmente index.html, style.css, script.js,
   logo.png, manifest.json e sw.js.
5. Faça o commit na branch que será usada pelo Pages (normalmente main).
6. No GitHub: Settings > Pages.
7. Em Build and deployment, escolha "Deploy from a branch".
8. Escolha a branch (ex.: main) e a pasta "/ (root)".
9. Salve e aguarde o GitHub publicar.

IMPORTANTE: NÃO CRIE UMA PASTA "nexo-gestao" DENTRO DO REPOSITÓRIO.
O index.html precisa ficar na raiz do repositório para o caminho mais simples.

SE O GITHUB NO IPHONE NÃO DEIXAR ENVIAR VÁRIOS ARQUIVOS
-------------------------------------------------------
Use o Safari em "Solicitar Site para Computador" e tente o upload novamente.
Se ainda assim ficar ruim, envie primeiro index.html e depois os outros arquivos,
sempre mantendo TODOS na raiz do repositório.

COMO USAR
---------
- Na primeira abertura, use "Entrar com demonstração" para testar.
- O app salva dados no localStorage do navegador.
- O mês atual é selecionável no topo; meses anteriores continuam salvos.
- Serviços, despesas e comissões ficam separados.
- A análise mostra os 12 meses do ano selecionado.
- Há exportação JSON para backup e CSV para análise.
- O botão "Apagar lançamentos" remove os dados deste navegador.

LIMITAÇÃO IMPORTANTE DO GITHUB PAGES
-------------------------------------
Este pacote é uma aplicação FRONT-END estática. Ele não tem servidor/banco de dados.
Por isso o login é apenas uma porta de entrada local e os dados ficam no dispositivo.
Não use esse login para guardar uma senha real ou dados sensíveis.

PARA A VERSÃO PROFISSIONAL ONLINE
---------------------------------
A próxima evolução pode trocar o armazenamento local por Supabase/PostgreSQL +
autenticação real + RLS, mantendo praticamente a mesma interface.
