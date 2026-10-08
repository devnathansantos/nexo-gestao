NEXO GESTÃO — GITHUB PAGES
===========================

ESTRUTURA INTENCIONAL
----------------------
Todos os arquivos ficam na raiz do projeto para facilitar o upload pelo iPhone:

index.html
style.css
script.js
logo.png
manifest.json
sw.js
README_GITHUB.txt

Não mova logo.png, style.css ou script.js para subpastas.

COMO PUBLICAR PELO IPHONE
--------------------------
1. Extraia este ZIP no app Arquivos.
2. Abra o repositório no GitHub.
3. Faça upload dos arquivos diretamente na raiz do repositório.
4. O arquivo index.html precisa ficar na raiz.
5. Não crie uma pasta intermediária "nexo-gestao" dentro do repositório.
6. Vá em Settings > Pages.
7. Em Source, selecione Deploy from a branch.
8. Branch: main.
9. Folder: / (root).
10. Salve e abra a URL do GitHub Pages.

LOGIN E CONTAS
--------------
A versão é estática para funcionar diretamente no GitHub Pages.
Cada usuário cria sua própria conta por e-mail e senha. Os dados ficam separados por conta neste navegador/dispositivo.

Importante: isso NÃO substitui autenticação com servidor. Para sincronizar a mesma conta entre iPhone, computador e outros aparelhos, a próxima etapa é usar backend/autenticação (por exemplo Supabase).

REGRAS DO APP
-------------
- O botão + da barra superior e o + flutuante do celular criam somente SERVIÇOS/ENTRADAS.
- Despesas são criadas exclusivamente na aba Despesas.
- Funcionários são criados exclusivamente na aba Funcionários.
- Cada funcionário é cadastrado uma vez e depois recebe novas comissões dentro do próprio perfil.
- Serviços exigem Cliente, Carro, Valor e Data. A descrição é opcional.
- Todos os serviços, despesas e comissões possuem editar e excluir.
- Funcionários possuem editar e excluir.
- Backup/restore fica em Configurações.
