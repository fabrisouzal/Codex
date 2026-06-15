# PRD - Historico SQL

## 1. Visao Geral

O Historico SQL e um userscript Tampermonkey para apoiar analistas e desenvolvedores que trabalham na tela `ExecucaoDireta.aspx` do portal SQL interno em `10.200.35.7`.

O produto captura queries executadas, organiza o historico em um painel lateral, permite reutilizar consultas rapidamente e oferece recursos de curadoria como nomes, favoritos, etiquetas, comentarios em Markdown, busca, filtros, ordenacao, exportacao e importacao.

## 2. Objetivo do Produto

Reduzir retrabalho e perda de conhecimento em consultas SQL usadas no dia a dia.

O script deve permitir que o usuario:

- encontre rapidamente uma query ja usada;
- cole ou cole e execute uma query salva no editor SQL;
- classifique queries com favoritos, etiquetas e comentarios;
- mantenha backups portaveis do historico;
- ajuste a interface conforme preferencia visual e volume de uso.

## 3. Publico-Alvo

- Analistas que executam consultas SQL recorrentes no portal interno.
- Desenvolvedores que precisam recuperar queries de diagnostico, validacao ou suporte.
- Usuarios avancados que compartilham consultas e precisam importar historicos de outras pessoas.

## 4. Contexto de Execucao

### Ambientes atendidos

- `http://10.200.35.7/portal/Simples/ExecucaoDireta.aspx`
- `https://10.200.35.7/portal/Simples/ExecucaoDireta.aspx`
- `http://10.200.35.7/*`
- `https://10.200.35.7/*`

### Instalacao e atualizacao

O script e distribuido pelo GitHub:

`https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/historico-sql.user.js`

As diretivas `@updateURL` e `@downloadURL` apontam para o mesmo arquivo, permitindo atualizacao pelo Tampermonkey.

## 5. Proposta de Valor

O Historico SQL transforma execucoes avulsas em uma base consultavel de conhecimento operacional.

Sem o script, o usuario depende de memoria, arquivos soltos, conversas ou copiar e colar manualmente queries antigas. Com o script, cada query relevante fica disponivel no proprio contexto de trabalho, com metadados suficientes para reaproveitamento seguro.

## 6. Funcionalidades Existentes

### 6.1 Captura de historico

O script salva queries no `localStorage` do navegador.

Comportamentos existentes:

- captura automatica ativada por padrao;
- captura ao clicar no botao Executar;
- captura ao pressionar `Ctrl+Enter`;
- ignorar duplicatas consecutivas iguais, incrementando contador de execucao;
- atualizacao de `lastUsedAt` e `runCount` quando uma query ja existente e reutilizada;
- normalizacao basica da query antes de salvar;
- limite configuravel de itens salvos, com padrao atual de `99999999`.

### 6.2 Painel lateral

O painel lateral e criado sobre a pagina e pode ser aberto ou ocultado por botao flutuante.

Elementos existentes:

- titulo do painel;
- campo de busca;
- sugestoes de buscas recentes;
- filtro por etiquetas;
- filtro "somente favoritos";
- ordenacao;
- lista rolavel de cards;
- contador de itens no rodape;
- botoes de rodape para Exportar/Importar, Etiquetas e Configuracoes.

O estado da interface e persistido, incluindo abertura do painel, busca, filtros, ordenacao e posicao de rolagem.

### 6.3 Busca, filtros e ordenacao

O usuario pode localizar queries por:

- nome;
- texto SQL;
- comentario;
- etiquetas;
- data;
- origem/tabela por busca textual.

Filtros existentes:

- todas as etiquetas;
- somente com etiquetas;
- somente sem etiquetas;
- etiqueta especifica;
- somente favoritos.

Ordenacoes existentes:

- ultimo uso decrescente;
- ultimo uso crescente;
- criacao decrescente;
- criacao crescente;
- etiqueta A-Z;
- etiqueta Z-A;
- contagem de execucoes decrescente.

### 6.4 Cards de query

Cada item do historico e exibido como card.

Informacoes exibidas:

- nome da query, quando definido;
- data de criacao;
- data de ultimo uso;
- quantidade de execucoes, quando habilitada;
- etiquetas;
- preview de comentario;
- trecho da query com realce de sintaxe SQL e numeracao de linhas.

Acoes do card:

- selecionar card;
- editar ou sugerir nome;
- marcar/desmarcar favorito;
- recolher/expandir card;
- adicionar ou editar etiquetas;
- remover etiqueta individual;
- editar comentario;
- expandir comentario completo;
- colar query no editor;
- colar e executar;
- copiar query para area de transferencia;
- excluir query.

As acoes principais do card ficam disponiveis quando o card esta selecionado, reduzindo poluicao visual.

### 6.5 Realce SQL e numeracao de linhas

O script renderiza a query salva com:

- numeracao de linhas em fonte pequena;
- realce de palavras-chave SQL;
- realce de tipos;
- realce de funcoes;
- realce de strings;
- realce de numeros;
- realce de comentarios;
- realce de operadores;
- destaque de termos pesquisados.

O objetivo e facilitar leitura rapida da query sem transformar o card em um editor completo.

### 6.6 Nomeacao de queries

O script possui sugestao local de nome para queries.

A sugestao considera:

- comentario salvo;
- primeiro comentario de bloco SQL;
- primeiro comentario de linha SQL;
- tipo de comando SQL;
- tabela principal identificada em `FROM`, `JOIN`, `UPDATE`, `INTO`, `DELETE FROM` ou `TRUNCATE TABLE`.

O usuario sempre pode editar o nome sugerido manualmente.

### 6.7 Etiquetas

O sistema de etiquetas permite classificar queries livremente.

Funcionalidades existentes:

- adicionar etiquetas por query;
- editar a lista de etiquetas de uma query;
- remover etiqueta individual de uma query;
- filtrar historico por etiqueta;
- ordenar por etiqueta;
- abrir menu dedicado de Etiquetas;
- visualizar todas as etiquetas criadas;
- ver contagem de uso por etiqueta;
- renomear etiqueta em todas as queries;
- excluir etiqueta de todas as queries.

### 6.8 Comentarios em Markdown

Cada query pode ter um comentario descritivo.

Funcionalidades existentes:

- modal de edicao de comentario;
- limite configuravel de caracteres;
- preview em tempo real;
- suporte simples a Markdown:
  - titulos;
  - listas;
  - negrito;
  - italico;
  - codigo inline;
- exibicao de resumo no card;
- expansao para comentario completo.

### 6.9 Exportacao e importacao

O script permite portabilidade do historico.

Exportacao:

- JSON;
- CSV com separador `;`;
- exportacao respeita filtros ativos.

Importacao:

- JSON;
- CSV;
- TXT interpretado como JSON ou CSV conforme conteudo;
- modo mesclar com historico atual;
- modo substituir historico atual;
- mesclagem por query normalizada;
- preservacao/merge de favoritos, etiquetas, comentario, datas e contador de execucao.

Zona de perigo:

- limpar todo o historico mediante confirmacao.

### 6.10 Configuracoes

O menu de Configuracoes organiza preferencias em secoes.

Captura:

- capturar historico automaticamente;
- capturar ao clicar em Executar;
- capturar ao pressionar `Ctrl+Enter`;
- ignorar queries repetidas em sequencia.

Historico:

- limite de itens salvos;
- limite de buscas recentes;
- limite de caracteres do comentario.

Interface:

- largura do painel;
- tema visual;
- cards expandidos por padrao;
- exibir contagem de execucoes no card;
- mostrar ou ocultar icones nos botoes.

Dados e restauracao:

- limpar buscas recentes;
- restaurar configuracoes padrao.

### 6.11 Temas visuais

Temas existentes:

- Office claro;
- Suave;
- Escuro;
- Alto contraste.

Os temas afetam painel, cards, modais, botoes, campos e realce SQL.

### 6.12 Integracao com Editor de Query

O Historico SQL tenta usar a ponte global `window.__SQL_EDITOR_QUERY_API__`, quando disponivel.

Metodos esperados:

- `getValue`;
- `setValue`;
- `execute`;
- `setValueAndExecute`.

Quando a ponte nao esta disponivel, o script usa fallback via CodeMirror ou textarea da pagina.

Essa integracao permite:

- capturar conteudo atual do editor;
- colar query salva no editor;
- executar query apos colar;
- manter compatibilidade com o script Editor de Query.

## 7. Dados e Persistencia

### Armazenamento

O script usa `localStorage`.

Chaves principais:

- `sql_helper_history_execucao_direta_v6_export_import`;
- `sql_helper_execucao_direta_settings_v3`;
- `sql_helper_execucao_direta_ui_state_v1`;
- `sql_helper_recent_searches_v1`.

### Modelo de item do historico

Cada item possui:

- `id`;
- `query`;
- `name`;
- `createdAt`;
- `lastUsedAt`;
- `runCount`;
- `isFavorite`;
- `tags`;
- `comment`.

## 8. Requisitos Nao Funcionais Existentes

### Compatibilidade

- Tampermonkey.
- Chrome e navegadores compativeis com userscripts.
- Paginas HTTP e HTTPS no host `10.200.35.7`.
- Integra com CodeMirror quando disponivel.

### Performance

- Renderizacao da lista limitada a `250` itens visiveis por vez.
- Historico persistido pode ser maior, conforme configuracao.
- Busca e filtros atuam sobre o historico local.

### Confiabilidade

- Evita inicializacao duplicada por flag global.
- Usa fallbacks para localizar editor e botao Executar.
- Possui tratamento de erro em leitura/escrita de `localStorage`.
- Importacao valida estrutura minima antes de salvar.

### UX

- Layout lateral compacto.
- Acoes menos usadas ficam em modais.
- Acoes dos cards aparecem de forma contextual.
- Temas e controle de icones reduzem fadiga visual.
- Feedback visual em copiar/colar.

## 9. Limitacoes Conhecidas

- O historico fica restrito ao navegador/perfil onde o script esta instalado.
- Sem sincronizacao remota nativa.
- Sem banco de dados externo.
- Sem IA remota ativa; sugestoes de nome sao heuristicas locais.
- Realce SQL e leve, focado em leitura, nao em parsing SQL completo.
- O limite alto de historico pode aumentar consumo de `localStorage` e impactar performance em bases muito grandes.
- Exportacao CSV depende do formato produzido pelo proprio script para melhor compatibilidade de reimportacao.

## 10. Criterios de Aceite do Estado Atual

- O painel deve abrir e fechar sem bloquear a tela original.
- Uma query executada deve ser salva no historico quando captura automatica estiver habilitada.
- Queries repetidas devem atualizar contador e ultimo uso, sem duplicar quando a protecao estiver habilitada.
- O usuario deve conseguir buscar por texto, filtrar por favoritos e filtrar por etiquetas.
- O usuario deve conseguir colar e colar/executar uma query salva no editor SQL.
- O usuario deve conseguir favoritar, renomear, etiquetar, comentar, copiar e excluir uma query.
- O menu Etiquetas deve permitir renomear e excluir etiquetas globalmente.
- O menu Configuracoes deve salvar preferencias e restaurar padroes.
- Exportacao JSON/CSV deve gerar arquivo baixavel.
- Importacao JSON/CSV deve mesclar ou substituir conforme modo escolhido.
- Os temas Office claro, Suave, Escuro e Alto contraste devem ser aplicaveis.
- O script deve passar em `node --check`.

## 11. Fora de Escopo Atual

- Sincronizacao em nuvem.
- Login ou permissao por usuario.
- Compartilhamento multiusuario em tempo real.
- Editor SQL proprio dentro do painel.
- Execucao SQL independente da pagina original.
- Classificacao por IA externa.
- Testes automatizados end-to-end.

## 12. Indicadores de Sucesso

- Menor tempo para recuperar consultas recorrentes.
- Menos consultas perdidas entre sessoes.
- Maior reaproveitamento de queries com comentarios e etiquetas.
- Menor necessidade de manter arquivos paralelos de SQL.
- Atualizacoes via Tampermonkey sem copiar e colar codigo manualmente.
