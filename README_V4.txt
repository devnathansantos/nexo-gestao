NEXO GESTÃO V4.1 — PACOTE COMPLETO CORRIGIDO

Este pacote contém:
- index.html — aplicação principal
- manifest.json, sw.js, nexo-icon.svg — suporte PWA e instalação na Tela de Início
- README_V4.txt — instruções, limitações e roteiro de teste

Correções incorporadas dos comentários
1. ID de orçamento existe antes da prévia e a prévia aceita ID ausente com fallback.
2. “Usar no orçamento” navega para a aba Orçamentos.
3. CSV com BOM real, decimal com vírgula, status traduzido e download com link anexado/revogação atrasada.
4. Quebras de linha de pacote e histórico corrigidas.
5. Data local brasileira sem desvio UTC.
6. Campos em 16px para evitar zoom automático do Safari.
7. Áreas seguras do iPhone no topo e no menu.
8. Backup tenta abrir a folha de compartilhamento do iOS e mantém download como alternativa.
9. Importação automática opcional dos dados V3 no mesmo navegador e com o mesmo e-mail, se o armazenamento antigo ainda existir.
10. Solicitação de armazenamento persistente quando suportada pelo navegador.
11. PWA com manifest, ícone SVG e service worker.
12. Status de orçamento rascunho/enviado/aprovado/recusado e funil no dashboard.
13. Conversão de orçamento para atendimento com bloqueio de duplicação.
14. Edição de orçamento salvo em cópia para evitar alteração não salva do original.
15. Layout de tabelas transforma linhas em cartões no celular.
16. Lembrete de manutenção/retorno em data futura por atendimento.
17. Recibo imprimível por atendimento e duplicação de atendimento.
18. Logotipo com limite menor e validação de tipo para reduzir risco de lotar armazenamento local.

COMO PUBLICAR
1. Na versão antiga, exporte primeiro um backup JSON e guarde-o fora do navegador.
2. Guarde uma cópia dos arquivos atuais do repositório.
3. Envie/substitua na raiz do repositório os quatro arquivos: index.html, manifest.json, sw.js e nexo-icon.svg. O README é instrução opcional.
4. Aguarde o GitHub Pages publicar. Abra primeiro no Safari, atualize e faça os testes. O service worker pode manter cache; se visualizar versão antiga, feche e reabra o site, ou limpe os dados do site somente depois de guardar backup.
5. A V4.1 tenta localizar o armazenamento V3 no mesmo navegador/origem e oferece importar. Se o site/app instalado tiver armazenamento separado ou os dados V3 já não existirem, importe o JSON manualmente nas Configurações.
6. Confira cuidadosamente os totais e os vínculos de veículos após a importação.

IMPORTANTE
- O navegador do Safari e o ícone instalado podem, em algumas situações, ter armazenamento separado. A migração automática só funciona se a V3 estiver acessível na mesma origem/armazenamento.
- O service worker permite carregar a interface em cache, mas não substitui backup. Os dados continuam locais; não há sincronização, login seguro ou cópia automática na nuvem.
- A senha local é um mecanismo simples de conveniência, não autenticação de produção. Não guarde dados altamente sensíveis.
- O backup e o orçamento podem usar a folha de compartilhamento do iOS, mas o usuário deve escolher o destino e confirmar a ação. A mensagem de WhatsApp não é enviada automaticamente.
- A prévia do orçamento/recibo usa a função de impressão do navegador; no iPhone, escolha Compartilhar/Salvar em Arquivos ou imprimir, conforme as opções exibidas pelo iOS.
- Antes do uso diário, teste criar cliente/veículo, pacote, orçamento com vários itens, prévia PDF, conversão, pagamento, despesa, funcionário, CSV, backup e restauração.
- Fotos antes/depois em IndexedDB, criptografia de backup e modo escuro não foram incluídos nesta rodada para evitar ampliar demais a mudança antes dos testes de estabilidade.
