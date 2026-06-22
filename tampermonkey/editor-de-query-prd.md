# PRD - Editor de Query

## 1. Identificacao

Produto: Editor de Query

Arquivo Tampermonkey: `Editor de Query.user.js`

Arquivo publicado: `tampermonkey/editor-de-query.user.js`

Versao do script: `2026-06-22.03`

Versao do documento: `2026-06-22.03`

URL de instalacao e atualizacao:
`https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/editor-de-query.user.js`

## 2. Visao Geral

O Editor de Query e um userscript Tampermonkey que substitui e aprimora a experiencia de escrita SQL na tela de execucao direta do portal interno em `10.200.35.7`.

O script transforma o campo de texto original da pagina em um editor CodeMirror com sintaxe SQL, temas, lint simples, barra de acoes em estilo Microsoft Office, configuracoes persistentes, timer de execucao, importacao/exportacao de arquivos `.sql` e integracao local com outros scripts SQL relacionados.

## 3. Objetivos

- Melhorar a produtividade na escrita e execucao de consultas SQL.
- Reduzir erros comuns antes da execucao.
- Preservar a compatibilidade com a pagina original ASP.NET.
- Oferecer uma interface visual mais organizada e consistente com os demais userscripts SQL.
- Permitir personalizacao sem exigir alteracao manual no codigo.
- Manter o script versionado e atualizavel pelo Tampermonkey via GitHub.

## 4. Ambiente Alvo

- Navegadores compativeis com Tampermonkey, incluindo Google Chrome.
- Sistema interno em `10.200.35.7`.
- Pagina principal: `/portal/Simples/ExecucaoDireta.aspx`.
- Cobertura adicional para rotas em `http://10.200.35.7/*` e `https://10.200.35.7/*`.
- Distribuicao via GitHub Raw no repositorio `fabrisouzal/Codex`.

## 5. Publico-Alvo

- Analistas que escrevem e executam SQL no portal interno.
- Desenvolvedores que usam a tela de execucao direta para diagnostico, validacao e suporte.
- Usuarios avancados que precisam de melhor ergonomia para consultas longas ou recorrentes.

## 6. Proposta de Valor

Sem o script, o usuario depende do campo de texto original da pagina, com poucos recursos de edicao e baixa ergonomia para SQL. Com o Editor de Query, o usuario passa a ter uma experiencia mais parecida com um editor dedicado, mantendo o mesmo fluxo de execucao da pagina original.

O produto melhora a legibilidade, facilita a execucao parcial, reduz riscos de comandos mal formados e centraliza configuracoes de interface em um painel proprio.

## 7. Funcionalidades Existentes

### 7.1 Editor CodeMirror

O campo SQL original e transformado em um editor CodeMirror.

Comportamentos existentes:

- Realce basico de sintaxe SQL.
- Numeracao de linhas.
- Quebra de linha visual.
- Indentacao configurada para 4 espacos.
- Fechamento automatico de parenteses e colchetes.
- Suporte a fold gutter.
- Gutter dedicado para alertas de lint.
- Preservacao do campo `textarea` original como mecanismo de envio para a pagina.

### 7.2 Temas

O editor possui selecao de tema visual.

Temas existentes:

- Sistema.
- Dark Pro.
- Light SQL.
- Dracula.
- Monokai.

Os temas CodeMirror externos sao carregados sob demanda, reduzindo carregamento desnecessario.

### 7.3 Ribbon de Acoes

A barra principal usa uma organizacao visual inspirada no Microsoft Office.

Grupos existentes:

- Executar.
- Timer.
- Editar.
- Revisao.
- Tema.
- Config.

A ribbon oferece botoes e seletores para as principais acoes do editor, com icones tematicos e opcao para ocultar icones ou comandos individuais.

### 7.4 Execucao SQL

O script mantem o botao de execucao original da pagina como mecanismo final de envio.

Comportamentos existentes:

- Executar query completa.
- Executar selecao.
- Selecionar bloco SQL automaticamente por linhas vazias.
- Atalho `Ctrl+Enter` para executar.
- Remocao de ponto e virgula antes da execucao.
- Uso de texto temporario para executar selecao sem substituir permanentemente a query inteira.
- Restauracao do conteudo apos execucao parcial quando aplicavel.

### 7.5 Importacao e Exportacao `.sql`

O editor permite trabalhar com arquivos SQL locais.

Comportamentos existentes:

- Importar arquivo `.sql`.
- Confirmar substituicao quando o editor ja possui conteudo.
- Exportar query atual para arquivo `.sql`.
- Gerar nome de arquivo a partir da primeira linha util da query.
- Incluir timestamp no nome exportado.

### 7.6 Timer de Execucao

O script acompanha a duracao da execucao.

Comportamentos existentes:

- Inicio do timer ao clicar no botao de executar.
- Calculo do tempo da execucao atual.
- Registro do tempo desde a ultima execucao.
- Exibicao do tempo na area de estatisticas.
- Tempo de alerta configuravel.
- Timeout de restauracao configuravel para execucao parcial.
- Integracao com evento `endRequest` do ASP.NET AJAX para detectar conclusao.

### 7.7 Toast de Execucao

Durante a execucao, o usuario recebe feedback visual em uma caixa flutuante.

Opcoes existentes:

- Posicao do toast.
- Tema do toast: escuro, claro ou Office.
- Tamanho: compacto, normal ou grande.
- Ocultar automaticamente apos conclusao.
- Mostrar ou ocultar detalhes.
- Mostrar ou ocultar barra de progresso.

### 7.8 Accordion do Editor

O editor fica dentro de um bloco expansivel.

Comportamentos existentes:

- Cabecalho `Query (Editor SQL)`.
- Indicador de estado `Expandido` ou `Oculto`.
- Botao para mostrar ou ocultar a toolbar.
- Botao para maximizar o editor.
- Botao para abrir configuracoes.
- Persistencia do estado aberto/fechado.
- Opcao de ocultar a query apos execucao.

### 7.9 Modo Janela

O editor pode ser aberto em um modal de trabalho.

Comportamentos existentes:

- Maximizar editor em uma janela sobreposta.
- Restaurar o editor para a posicao original.
- Seletor de tamanho do modal: medio, grande, tela.
- Persistencia do estado do modal.
- Refresh do CodeMirror apos movimentacao no DOM.
- Aproveitamento flexivel da altura disponivel na janela maximizada.
- Foco automatico no editor ao abrir o modo janela.
- Fechamento do modo janela pela tecla `Esc`.
- Preservacao do texto, cursor, selecao e posicao de rolagem durante a execucao.
- Manutencao do modal dentro do formulario ASP.NET para que o campo SQL participe do `POST`.
- Recuperacao temporaria da query por `sessionStorage` apos recarga completa da pagina.

### 7.10 Painel de Configuracoes

O script possui painel dedicado para preferencias.

Grupos existentes:

- Execucao.
- Toast.
- Editor.
- Barra.

Configuracoes disponiveis:

- Alerta de execucao lenta.
- Restauracao apos execucao parcial.
- Ocultar query apos executar.
- Posicao, tema, tamanho e comportamento do toast.
- Tema do editor.
- Mostrar ou ocultar toolbar.
- Ativar ou desativar lint SQL.
- Mostrar ou ocultar icones.
- Mostrar ou ocultar comandos da ribbon.
- Restaurar configuracoes padrao.

### 7.11 Lint SQL Simples

O editor possui validacoes locais e leves para identificar problemas comuns.

Validacoes existentes:

- Parenteses desequilibrados.
- `SELECT` sem `FROM`.
- `JOIN` sem `ON`.

O resultado do lint aparece em texto abaixo do editor e em marcadores na gutter.

### 7.12 Estatisticas do Editor

O rodape do editor exibe informacoes operacionais.

Informacoes existentes:

- Quantidade de linhas.
- Quantidade de caracteres.
- Linha e coluna do cursor.
- Tempo da ultima execucao.
- Tempo desde o ultimo comando Executar.

### 7.13 Redimensionamento

O editor pode ser redimensionado diretamente na interface.

Comportamentos existentes:

- Ajuste vertical.
- Ajuste horizontal.
- Ajuste diagonal.
- Persistencia de largura e altura.
- Protecao contra conflito com outras superficies redimensionaveis da pagina.

### 7.14 Integracao com Outros Scripts

O Editor de Query expoe uma API global para integracao local.

Objeto exposto:

`window.__SQL_EDITOR_QUERY_API__`

Metodos existentes:

- `setValue(text)`.
- `execute()`.
- `setValueAndExecute(text)`.
- `getValue()`.

Essa API permite que scripts como Historico SQL colem ou executem queries no editor sem depender diretamente da estrutura interna do CodeMirror.

### 7.15 Compatibilidade com Chrome e Tampermonkey

O script usa `@require` para carregar dependencias do CodeMirror no Tampermonkey.

Dependencias externas:

- CodeMirror core.
- Modo SQL.
- Close brackets.
- Fold code.
- Fold gutter.
- Brace fold.
- Comment fold.

O carregador dinamico permanece como fallback quando o CodeMirror nao estiver disponivel no momento da inicializacao.

### 7.16 Menu de Snippets SQL (novo)

O editor possui uma biblioteca de trechos SQL reutilizaveis, acessivel pela ribbon ou pelo atalho `Ctrl+Alt+S`.

Funcionalidades existentes:

- Busca e filtro por categoria.
- Catalogo padrao ATTUS N2 com 39 snippets organizados por categoria (novo).
- Remocao do catalogo generico inicial de 15 snippets (novo).
- Todos os snippets padrao podem ser editados ou excluidos (novo).
- Carga inicial versionada, sem recriar automaticamente itens excluidos pelo usuario (novo).
- Insercao no cursor ou substituicao da selecao.
- Placeholders `${NOME}` e `${NOME:valor}`.
- Navegacao com `Tab` e `Shift+Tab`.
- Placeholders especiais `${SELECAO}` e `${CURSOR}`.
- Favoritos persistentes.
- Cadastro, edicao e exclusao de snippets personalizados por formulario dedicado (novo).
- Campos de nome, categoria, descricao, tags e codigo SQL (novo).
- Preenchimento inicial do codigo a partir da selecao atual do editor (novo).
- Exportacao e importacao em JSON.

## 8. Persistencia e Estado

O script usa `localStorage` com chaves separadas por host, caminho e query string.

Estados persistidos:

- Tamanho do editor.
- Tema.
- Cursor.
- Estado do lint.
- Visibilidade da toolbar.
- Estado do accordion.
- Estado e tamanho do modal.
- Configuracoes do timer.
- Configuracoes do toast.
- Visibilidade de icones.
- Visibilidade de itens da ribbon.
- Versao de schema de configuracoes.
- Snippets personalizados.
- Favoritos de snippets.

## 9. Requisitos Nao Funcionais

- Baixo impacto sobre a pagina original.
- Nenhuma dependencia de servidor proprio.
- Nenhum envio de dados para servicos externos alem do carregamento de dependencias estaticas via CDN.
- Compatibilidade com Tampermonkey.
- Compatibilidade com Chrome.
- Interface consistente com os scripts `Historico SQL` e `Resultado Personalizado`.
- Atualizacao via `@updateURL` e `@downloadURL`.
- Validacao sintatica antes de publicacao.
- Publicacao versionada no GitHub.

## 10. Fora de Escopo Atual

- Substituir o mecanismo de execucao SQL do sistema.
- Alterar o backend ou a resposta da consulta.
- Gerenciar multiplas abas internas de query.
- Persistir historico completo de execucoes.
- Substituir o script Historico SQL.
- Implementar IA externa ou envio de queries para APIs.
- Modificar diretamente o grid de resultado.

## 11. Riscos e Cuidados

- O carregamento do CodeMirror depende de acesso ao CDN `cdnjs.cloudflare.com`.
- Mudancas de HTML na pagina interna podem exigir ajuste de seletores.
- A remocao de ponto e virgula antes da execucao deve preservar a intencao do usuario.
- Execucao parcial precisa manter o conteudo original do editor visivel e recuperavel.
- Recursos de modal e accordion precisam chamar `refresh()` no CodeMirror apos mudancas no DOM.

## 12. Criterios de Atualizacao

Cada nova entrega do script deve seguir este fluxo:

1. Criar backup local do arquivo atual quando a mudanca for funcional.
2. Incrementar `// @version`.
3. Atualizar este PRD quando houver alteracao relevante de escopo, comportamento ou documentacao.
4. Validar o script com `node --check`.
5. Atualizar o arquivo publicado em `tampermonkey/editor-de-query.user.js`.
6. Publicar tambem o PRD no repositorio.
7. Confirmar que a URL Raw do GitHub retorna a nova versao.

## 13. Evolucoes Futuras Sugeridas

- Formatador SQL.
- Buscar e substituir dentro do editor.
- Confirmacao reforcada para `UPDATE`, `DELETE`, `DROP` e `TRUNCATE`.
- Visualizacao do SQL exato enviado para execucao.
- Destaque visual do bloco ou selecao que sera executado.
- Deteccao e listagem de parametros `:PARAM`.
- Explicacao local de erros `ORA-xxxxx`.
- Biblioteca de snippets SQL.
- Backup e restauracao das configuracoes.
- Melhorias incrementais no lint SQL.
