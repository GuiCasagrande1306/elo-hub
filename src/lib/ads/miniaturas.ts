import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* =====================================================================
   Guardar a miniatura do criativo antes que ela expire
   ---------------------------------------------------------------------
   O QUE ISTO CONSERTA. `ad_creatives.thumbnail_url` aponta para o CDN da
   Meta, e aquele endereço é ASSINADO COM PRAZO — os parâmetros `oh=` e
   `oe=` no fim da URL são assinatura e validade. Depois de algumas
   semanas ele devolve 403 e a imagem morre.

   O atraso é o que torna o defeito traiçoeiro: o relatório sai perfeito
   no dia em que é gerado e a tabela de anúncios fica com quadrados
   cinzas quando o cliente reabre o mesmo arquivo um mês depois. Ninguém
   liga a falha ao dia da geração — o PDF já foi entregue, e quem olha
   conclui que o documento veio quebrado.

   Medido em 26/09/2026: 951 criativos no banco, 951 sem cópia.

   SEM `server-only`, e isto é deliberado — mesma razão de
   `serie-do-grafico.ts` e `aviso-da-coleta.ts`. O backfill das 951
   linhas existentes é um script de linha de comando, e um módulo
   marcado como servidor não pode ser importado por ele; a alternativa
   seria copiar a lógica para o script, que é como duas versões da mesma
   coisa começam a divergir.

   Nada vaza: a única dependência de servidor é o TIPO do cliente admin,
   que o TypeScript apaga na compilação. A chave `service_role` mora em
   `supabase/admin`, e esta função não a alcança — ela recebe o cliente
   pronto de quem chama, e sem ele não faz nada.

   ⚠️ NUNCA LANÇA. Quem chama é `syncCreatives`, que roda dentro de um
   try/catch que engole erro de propósito — a galeria é complemento, e
   uma imagem que não baixou não pode fazer a sincronização de gasto e
   conversão contar como falha. Toda função aqui devolve `null` no
   tropeço, e o relatório cai de volta na URL da Meta, que ainda vale no
   dia em que foi sincronizada.
   ===================================================================== */

/**
 * ⚠️ `ad-thumbs`, E ELE JÁ EXISTIA — desde a primeira migration de
 * Storage, com o comentário "as URLs da Meta expiram em poucas horas;
 * copiamos para cá na sincronização". A intenção estava escrita desde o
 * começo; só a cópia nunca foi implementada, e o bucket estava vazio.
 *
 * A primeira versão deste arquivo criou um bucket novo por não ter
 * procurado o que já havia. Fica registrado porque o desenho antigo é
 * melhor: PRIVADO, com policy de leitura que reaproveita
 * `can_access_client` sobre a primeira pasta do caminho — o que dá
 * controle de acesso por cliente de graça, coisa que um bucket público
 * não teria.
 */
const BUCKET = "ad-thumbs";

/** Teto do bucket, conferido aqui para falhar antes de subir o corpo. */
const TAMANHO_MAXIMO = 10 * 1024 * 1024;

/** O que o bucket aceita. Sem GIF e sem SVG — é a lista dele. */
const TIPOS_ACEITOS = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Validade da URL assinada.
 *
 * Uma hora, igual a `report-pdfs`. Não precisa durar mais: no PDF a
 * imagem é RASTERIZADA dentro do arquivo na hora da geração, então o
 * documento que chega ao cliente não depende do link continuar de pé —
 * é justamente por isso que um bucket privado resolve sem recriar o
 * problema que esta cópia veio consertar.
 */
const VALIDADE_S = 60 * 60;

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Baixa a imagem da Meta e guarda no bucket. Devolve o CAMINHO.
 *
 * CAMINHO E NÃO URL: o bucket é privado, então não existe endereço
 * público para guardar. É a mesma convenção de `report_history.storage_path`,
 * que grava o caminho e assina na leitura — ver `assinarMiniaturas`.
 *
 * `null` em qualquer tropeço: rede, 403 de URL já vencida, tipo
 * inesperado, arquivo grande demais, bucket ausente.
 *
 * CAMINHO DETERMINÍSTICO — `<client_id>/<external_ad_id>`, sem extensão.
 * Duas consequências, as duas desejadas: rodar de novo SUBSTITUI em vez
 * de acumular cópia, e um anúncio que troca de imagem mantendo o id
 * atualiza no lugar. A extensão fica de fora porque ela mudaria com o
 * tipo devolvido pela Meta, e aí o mesmo anúncio teria dois arquivos
 * órfãos no bucket — o tipo viaja em `contentType`, que é o que o
 * Storage usa para servir.
 */
export async function guardarMiniatura(
  admin: Admin,
  clientId: string,
  externalAdId: string,
  urlDaMeta: string,
  timeoutMs = 8_000,
): Promise<string | null> {
  try {
    const resposta = await fetch(urlDaMeta, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });

    // 403 aqui é o caso comum e esperado: a URL já venceu.
    if (!resposta.ok) return null;

    const tipo = (resposta.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();

    /* Tipo fora da lista não vai para o bucket. O Storage recusaria
       sozinho, mas o erro dele chega como mensagem genérica e este
       caminho é silencioso — melhor parar onde a causa é legível. */
    if (!TIPOS_ACEITOS.has(tipo)) return null;

    const bytes = new Uint8Array(await resposta.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > TAMANHO_MAXIMO) return null;

    const caminho = `${clientId}/${externalAdId}`;

    const { error } = await admin.storage.from(BUCKET).upload(caminho, bytes, {
      contentType: tipo,
      // Substitui a cópia anterior — ver a nota sobre o caminho acima.
      upsert: true,
    });

    if (error) return null;

    return caminho;
  } catch {
    return null;
  }
}

/**
 * Resolve os caminhos guardados em URLs assinadas, por `external_ad_id`.
 *
 * ⚠️ SEM ISTO, POPULAR A COLUNA QUEBRA A GALERIA. `ad-gallery.tsx` e a
 * página do relatório usam `storage_path` direto como `src` da imagem —
 * o que funciona enquanto a coluna é nula em todas as linhas e os dois
 * caem em `thumbnail_url`. No instante em que a cópia começa a gravar um
 * CAMINHO ali, esse `src` vira um endereço relativo inválido e a imagem
 * some. A regressão apareceria justamente no trabalho feito para
 * consertar as imagens.
 *
 * Por isso quem CARREGA os criativos resolve o caminho antes de
 * entregá-los à tela: o banco guarda caminho, a view recebe URL. Os
 * componentes não mudam.
 *
 * Aceita qualquer cliente Supabase: no painel é o da sessão, e a policy
 * do bucket já limita por `can_access_client`; no relatório é o admin,
 * porque o Puppeteer não tem sessão.
 */
export async function assinarMiniaturas(
  cliente: { storage: Admin["storage"] },
  caminhos: string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const unicos = [...new Set(caminhos.filter(Boolean))];
  if (unicos.length === 0) return mapa;

  try {
    const { data, error } = await cliente.storage
      .from(BUCKET)
      .createSignedUrls(unicos, VALIDADE_S);

    if (error || !data) return mapa;

    for (const item of data) {
      /* `createSignedUrls` devolve uma entrada por caminho pedido, com
         `error` preenchido nas que falharam — um arquivo ausente não
         pode derrubar as outras. Quem ficar de fora do mapa cai em
         `thumbnail_url`, que é o comportamento de hoje. */
      if (item.signedUrl && !item.error) mapa.set(item.path ?? "", item.signedUrl);
    }
  } catch {
    // Mapa parcial ou vazio: a tela cai na URL da Meta.
  }

  return mapa;
}

/**
 * Guarda as miniaturas que ainda não têm cópia e grava o endereço.
 *
 * ⚠️ SÓ AS QUE FALTAM, e há um motivo além da economia: a URL da Meta
 * muda a cada sincronização mesmo quando a imagem é a mesma, porque a
 * assinatura é renovada. Não dá para comparar URLs e detectar troca de
 * imagem — a comparação diria "mudou" sempre, e a sincronização passaria
 * todas as noites rebaixando e resubindo a carteira inteira.
 *
 * O preço dessa escolha: um anúncio que troque de criativo MANTENDO o
 * mesmo id fica com a imagem antiga. É raro — na prática a Meta emite id
 * novo — e o conserto é apagar o `storage_path` daquela linha, que a
 * próxima rodada refaz.
 *
 * TETO POR RODADA porque isto acontece dentro do cron, que tem orçamento
 * para a fila inteira do dia. Uma conta com sessenta anúncios novos não
 * pode consumir a janela das outras; o que não couber hoje entra amanhã,
 * que é o mesmo desenho do resto da sincronização.
 *
 * Devolve quantas cópias foram feitas — só para o log da rodada.
 */
export async function guardarMiniaturasPendentes(
  admin: Admin,
  clientId: string,
  teto = 12,
): Promise<number> {
  try {
    const { data } = await admin
      .from("ad_creatives")
      .select("external_ad_id, thumbnail_url")
      .eq("client_id", clientId)
      .eq("platform", "meta_ads")
      .eq("is_active", true)
      .is("storage_path", null)
      .not("thumbnail_url", "is", null)
      /* Quem gastou mais primeiro: são os anúncios que aparecem na
         tabela do relatório, e o teto pode cortar antes do fim. */
      .order("spend_cents", { ascending: false })
      .limit(teto);

    const pendentes = (data ?? []) as {
      external_ad_id: string;
      thumbnail_url: string | null;
    }[];

    if (pendentes.length === 0) return 0;

    /* EM SÉRIE, não em paralelo. São downloads de imagem inteira dentro
       de uma função serverless com memória limitada, e doze buffers de
       até 5MB ao mesmo tempo é o caminho para o processo ser morto no
       meio da sincronização — levando junto o upsert de métricas que
       vem depois. Em série, o pior caso é o teto ser atingido pelo
       tempo, e aí o resto entra na rodada de amanhã. */
    let guardadas = 0;

    for (const ad of pendentes) {
      if (!ad.thumbnail_url) continue;

      const url = await guardarMiniatura(
        admin,
        clientId,
        ad.external_ad_id,
        ad.thumbnail_url,
      );

      if (!url) continue;

      const { error } = await admin
        .from("ad_creatives")
        .update({ storage_path: url })
        .eq("client_id", clientId)
        .eq("platform", "meta_ads")
        .eq("external_ad_id", ad.external_ad_id);

      if (!error) guardadas += 1;
    }

    return guardadas;
  } catch {
    return 0;
  }
}
