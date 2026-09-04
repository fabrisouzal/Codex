# Zendesk — exportação de eventos de auditoria

Versão: `2026.09.04.01`.

## Uso

1. Atualize o userscript pelo endereço Raw configurado no Tampermonkey.
2. Abra o extrator em uma aba autenticada do Zendesk.
3. Mantenha **Incluir eventos de auditoria (uso interno)** selecionado.
4. Escolha PDF, Markdown ou ambos e a pasta de saída.
5. Recomenda-se validar inicialmente com um ticket conhecido e limite 1.

O histórico é obtido por `GET /api/v2/tickets/{id}/audits.json`, com paginação, usando a sessão existente. Nenhum ticket é alterado. Os mesmos mecanismos de retry e pausa por rate limit são utilizados. Mantidos 4 workers por padrão e máximo de 8.

## Conteúdo

Os eventos são apresentados em ordem cronológica de auditoria, preservando a ordem interna de cada atualização. Incluem ID do evento e da auditoria, data ISO, autor, canal, tipo, valores anteriores/novos e propriedades estruturadas retornadas pela API. Nomes de usuários, grupos, status personalizados e campos são resolvidos quando disponíveis; os IDs originais são preservados. Tipos novos ou desconhecidos permanecem nos dados estruturados.

No Markdown, a seção `Eventos de auditoria — Uso interno` é acrescentada após a conversa. No PDF, o histórico começa em uma nova página. Não é produzido arquivo JSON adicional: os dados estruturados são incorporados ao documento.

Arquivos com eventos recebem `-com-eventos` antes da extensão. Isso preserva arquivos anteriores sem histórico. Reexecutar o mesmo perfil sem retomada mantém o comportamento existente de gravar o mesmo nome. O perfil de retomada distingue presença de eventos e inclusão de notas internas; registros das versões anteriores não são tratados como exportações completas com eventos.

## Privacidade

- Documentos com eventos são marcados `access_scope: internal`, mesmo quando a conversa contém apenas comentários públicos. O histórico administrativo não é um documento público.
- Eventos de comentário exportam referências ao comentário atual, não seu corpo histórico. Isso evita restaurar texto anterior à redação ou mudança de privacidade. Referências a comentários indisponíveis/excluídos são omitidas e contabilizadas.
- Com **Incluir notas internas** desativado, referências privadas são omitidas. Alterações de campos administrativos conhecidos preservam seus valores; notificações, campos personalizados/livres e outros eventos mantêm apenas ID, tipo e aviso de detalhes omitidos. Metadados de auditoria também são omitidos nesse modo.
- Com notas internas ativadas, notificações e outros eventos não relacionados diretamente a comentários podem conter dados pessoais e conteúdo histórico da API. Trate esses arquivos como material interno; esta versão não implementa anonimização ou enriquecimento por IA.

## Integridade e manifesto

O frontmatter usa `schema_version: 2` e acrescenta `inclui_eventos`, `eventos_status`, `auditorias`, `eventos_recebidos`, `eventos_exportados`, `eventos_comentarios_omitidos` e `eventos_detalhes_restritos`. Esses campos também estão no manifesto CSV.

`eventos_status: complete` significa que a coleta de auditorias foi concluída; as restrições de privacidade continuam indicadas nos campos e no documento. `not_requested` indica opção desmarcada. Uma falha na coleta não gera documento parcial: o ticket não é concluído e pode ser tentado novamente. Falhas de autenticação/permissão interrompem o lote, como no fluxo anterior.

Paginação incompleta, repetida, registros inválidos ou URLs externas são rejeitados. Tickets arquivados com resposta de página única são suportados.

## Validação automatizada

Em ambiente de testes com Node.js e `jsdom@26.1.0` disponível:

```powershell
node --check ./zendesk-exportar-tickets-n2-resolvidos.user.js
node --test ./tests/zendesk-ticket-events.test.cjs
```

Os testes usam DOM simulado e um substituto do jsPDF para validar texto, paginação e chamadas de gravação. Cobrem paginação cursor/offset, tickets arquivados, privacidade, respostas inválidas, cancelamento, geração Markdown/PDF, retomada parcial, falhas de API/disco, UI e limite de workers. Não substituem uma exportação real na sessão do Zendesk.

Referência: [Ticket Audits — documentação oficial do Zendesk](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_audits/).
