/* =====================================================================
   A prévia da conversa, agora em UTF-8 de verdade
   ---------------------------------------------------------------------
   A migration 62 subiu com os rótulos corrompidos. Não foi erro de SQL
   nem de banco: foi o CAMINHO ATÉ O SQL EDITOR.

   O QUE ACONTECEU, medido em 23/08/2026. O arquivo foi copiado com
   `pbcopy` num shell sem locale definido (`LANG`, `LC_ALL` e `LC_CTYPE`
   todos vazios). Sem locale, o pbcopy marca o conteúdo da área de
   transferência como MacRoman. Os bytes continuam corretos — um
   `pbpaste` no mesmo terminal devolve tudo certo, que é o que torna o
   defeito invisível —, mas quem lê a área de transferência com a
   marcação declarada, como o navegador, decodifica errado:

       F0 9F 8E A4   🎤   em UTF-8
       F0 9F 8E A4   üé§   lido como MacRoman

   Foi assim que `'🎤 Áudio'` virou `'üé§ √Åudio'` DENTRO do corpo da
   função, e o banco guardou exatamente o que recebeu. Conferido pelo
   ponto de código do que estava gravado: U+F8FF, o símbolo da Apple,
   que é como o MacRoman lê o byte F0.

   COMO EVITAR: copiar com `LC_CTYPE=UTF-8 pbcopy`. E, o que de fato
   fecha o buraco, CONFERIR o dado depois de rodar a migration em vez de
   confiar no "success" do editor — foi só ao ler o ponto de código que
   isto apareceu.

   Nada de dado real foi afetado: a única gravação com prévia até aqui
   foi de teste, e já saiu. Esta migration só reescreve a função e os
   comentários.
   ===================================================================== */

create or replace function app.wa_resumo_da_conversa()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client uuid;
begin
  select client_id into v_client
    from public.wa_conversas where id = new.conversa_id;

  if v_client is null then
    raise exception 'wa_mensagens: conversa % nao existe', new.conversa_id;
  end if;

  /* COPIADO da conversa, não confiado ao chamador: é a coluna que a
     policy de leitura usa, e um insert com o id de outra empresa a
     colocaria à vista de quem não deve. */
  new.client_id := v_client;

  update public.wa_conversas c
     set ultima_em     = greatest(coalesce(c.ultima_em, new.enviada_em), new.enviada_em),
         ultima_previa = left(
           coalesce(
             nullif(btrim(new.texto), ''),
             case new.tipo
               when 'imagem'      then '📷 Imagem'
               when 'audio'       then '🎤 Áudio'
               when 'video'       then '🎬 Vídeo'
               when 'documento'   then '📎 ' || coalesce(new.midia_nome, 'Documento')
               when 'sticker'     then 'Figurinha'
               when 'localizacao' then '📍 Localização'
               when 'contato'     then 'Contato'
               else 'Mensagem'
             end
           ), 200),
         /* Só conta como não lida a que VEIO de fora. Mensagem enviada
            pelo próprio atendente zera o contador: se ele respondeu, ele
            leu. */
         nao_lidas     = case when new.de_mim then 0 else c.nao_lidas + 1 end,
         updated_at    = now()
   where c.id = new.conversa_id;

  return new;
end;
$$;

comment on table public.wa_mensagens is
  'Mensagens de WhatsApp do número de um cliente. Conteúdo de terceiros: leitura restrita à empresa dona e à equipe que atende; escrita só por service_role, pelo webhook da Evolution.';

comment on table public.wa_conversas is
  'Uma thread de WhatsApp por (empresa, interlocutor). O resumo — última mensagem e não lidas — é mantido pelo gatilho wa_mensagens_resumo.';
