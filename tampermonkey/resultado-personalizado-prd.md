# PRD - Resultado Personalizado / Grid Pro

## 1. Identificacao

Produto: Resultado Personalizado / Grid Pro

Arquivo Tampermonkey: `Resultado Personalizado.user.js`

Arquivo publicado: `tampermonkey/resultado-personalizado.user.js`

Versao do script: `2026-06-16.01`

Versao do documento: `2026-06-16.01`

URL de instalacao e atualizacao:
`https://raw.githubusercontent.com/fabrisouzal/Codex/main/tampermonkey/resultado-personalizado.user.js`

## 2. Visao Geral

O script Resultado Personalizado transforma a area de resultado da tela `Simples / Execucao Direta` em uma experiencia de grid moderna, com foco em leitura, filtragem, organizacao de colunas, exportacao e analise rapida dos dados retornados por consultas SQL.

A interface segue a linguagem visual do script `Simples - Editor de query`, mantendo consistencia entre a escrita da consulta e a exploracao do resultado.

## 3. Objetivos

- Melhorar a leitura e manipulacao dos resultados de consulta.
- Reduzir esforco para localizar, ordenar, filtrar, ocultar e copiar dados.
- Preservar o tema visual ja usado nos scripts SQL relacionados.
- Permitir personalizacoes de uso sem tornar o painel de configuracoes confuso.
- Manter o script atualizavel pelo Tampermonkey via GitHub.

## 4. Ambiente Alvo

- Navegadores compativeis com Tampermonkey, incluindo Chrome.
- Sistema interno em `10.200.35.7`.
- Pagina principal: `/portal/Simples/ExecucaoDireta.aspx`.
- Distribuicao via GitHub Raw no repositorio `fabrisouzal/Codex`.

## 5. Funcionalidades Existentes

### 5.1 Acordeon do Resultado

O resultado e apresentado em um componente expansivel, com estado visual claro.

Comportamentos existentes:

- Cabecalho com rotulo `Resultado`.
- Indicador textual de estado: `Expandido` ou `Oculto`.
- Seta de expansao com maior destaque visual.
- Possibilidade de recolher o bloco de resultado para liberar area de trabalho.

### 5.2 Toolbar do Resultado

A barra de acoes fica junto ao resultado e centraliza os comandos mais usados.

Comportamentos existentes:

- Alternancia de toolbar ligada/desligada.
- Remocao de comandos redundantes do toolbar.
- Acoes de copia, exportacao, configuracao, filtros, colunas e insights.
- Opcao de mostrar ou ocultar icones, reduzindo ruido visual quando necessario.

### 5.3 Grid Aprimorado

O resultado HTML original e enriquecido para funcionar como um grid de leitura e analise.

Comportamentos existentes:

- Melhor apresentacao visual da tabela.
- Cabecalhos mais funcionais.
- Destaque de estados interativos.
- Preservacao do resultado original como base da consulta.
- Melhor experiencia em tabelas largas.

### 5.4 Filtros

O script oferece filtragem direta sobre os dados apresentados no grid.

Comportamentos existentes:

- Filtros por coluna.
- Aplicacao visual do resultado filtrado.
- Botao para limpar filtros.
- Integracao entre filtros e visualizacao de colunas.

### 5.5 Ordenacao de Colunas

As colunas podem ser ordenadas diretamente pela interface.

Comportamentos existentes:

- Ordenacao ascendente e descendente.
- Indicacao visual de coluna ordenada.
- Funcao para voltar ao estado original da consulta quando a ordenacao visual deve ser desfeita.

### 5.6 Menu de Contexto

O grid possui menu de contexto para acoes rapidas sobre linhas, colunas e celulas.

Comportamentos existentes:

- Acionamento contextual no resultado.
- Opcoes relacionadas ao ponto clicado.
- Fixar linha.
- Destacar linha.
- Acoes de copia e manipulacao contextual.

### 5.7 Colunas

O script facilita trabalhar com muitas colunas no resultado.

Comportamentos existentes:

- Ocultar colunas de forma mais simples.
- Restaurar colunas ocultas.
- Renomear colunas na sessao atual.
- Evitar que nomes renomeados sejam reaplicados indevidamente em outras consultas antigas ou diferentes.

### 5.8 Insights do Resultado

O componente `Insights do resultado` apresenta uma leitura resumida e mais intuitiva dos dados retornados.

Comportamentos existentes:

- Interface visual moderna integrada ao tema do script.
- Resumo da estrutura do resultado.
- Apoio a analise rapida do retorno.
- Jornada visual mais clara para explorar os dados sem sair do grid.

### 5.9 Exportacao e Copia

O script melhora as formas de reutilizar os dados retornados.

Comportamentos existentes:

- Copiar celula.
- Copiar linha.
- Copiar coluna.
- Copiar tabela ou grid.
- Exportar em CSV, HTML, TXT, XLSX e imagem JPG, conforme disponibilidade do recurso.

### 5.10 Resize e Layout

A area de resultado e a area do editor possuem ajustes de tamanho independentes.

Comportamentos existentes:

- Resize do resultado separado do resize do CodeMirror.
- Melhor aproveitamento do espaco vertical.
- Reducao de conflito entre escrita da query e leitura do resultado.

### 5.11 Configuracoes

O painel de configuracoes organiza preferencias do grid e da experiencia visual.

Comportamentos existentes:

- Organizacao por grupos de uso.
- Instalar com icones da toolbar ocultos por padrao, mantendo a opcao para reativar.
- Restaurar padrao.
- Ajustes visuais preservando o tema atual.
- Comandos agrupados para reduzir confusao e excesso de botoes.
- `Salvar JPG` e `Reset completo` ocultos por padrao na toolbar, com possibilidade de reativacao no painel.

## 6. Persistencia e Estado

O script utiliza armazenamento local do navegador para manter preferencias de uso quando isso faz sentido.

Diretrizes atuais:

- Preferencias visuais podem persistir entre sessoes.
- Ajustes ligados ao conteudo especifico de uma consulta devem ter escopo limitado.
- Renomeacoes de coluna devem ficar restritas a sessao ou ao resultado atual, evitando reaparecer em consultas futuras sem relacao.
- Acoes reversiveis devem preservar o estado original da consulta sempre que tecnicamente possivel.

## 7. Requisitos Nao Funcionais

- Interface consistente com o `Simples - Editor de query`.
- Baixo impacto sobre a pagina original.
- Compatibilidade com Tampermonkey.
- Compatibilidade com Chrome.
- Atualizacao via `@updateURL` e `@downloadURL`.
- Validacao sintatica antes de publicacao.
- Publicacao versionada no GitHub.

## 7.1 Padrao de Instalacao

A instalacao nova e a acao `Restaurar padrao` devem carregar a configuracao base abaixo:

- Mostrar painel de insights: ligado.
- Mostrar insights de status: ligado.
- Atualizar insights ao filtrar: ligado.
- Atalho Ctrl+C na selecao: ligado.
- Mostrar icones nos botoes: desligado.
- Mostrar toasts: ligado.
- Tamanho do toast: grande.
- Tempo do toast: 2,5 segundos.
- Copiar grid como tabela alinhada: ligado.
- Confirmar reset completo: ligado.
- Botoes da toolbar: todos ligados, exceto `Salvar JPG` e `Reset completo`.

## 8. Criterios de Atualizacao

Cada nova entrega do script deve seguir este fluxo:

1. Criar backup local do arquivo atual.
2. Incrementar `// @version`.
3. Validar o script com `node --check`.
4. Atualizar o arquivo publicado em `tampermonkey/resultado-personalizado.user.js`.
5. Publicar tambem este PRD quando houver alteracao de escopo, comportamento ou documentacao.
6. Confirmar que a URL Raw do GitHub retorna a nova versao.

## 9. Fora de Escopo Atual

- Alterar a logica da query SQL executada pelo sistema.
- Substituir o CodeMirror ou o editor principal.
- Enviar dados para servicos externos.
- Persistir transformacoes de conteudo que deveriam valer apenas para o resultado atual.

## 10. Evolucoes Futuras Sugeridas

- Perfis de visualizacao por tipo de consulta.
- Historico local de configuracoes aplicadas por resultado.
- Painel de insights com comparacoes e estatisticas adicionais.
- Busca global dentro do grid.
- Presets de colunas ocultas por contexto.
