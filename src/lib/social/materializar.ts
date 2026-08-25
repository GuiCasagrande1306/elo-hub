import "server-only";

import { dataNoBrasil } from "@/lib/date-br";
import { montarAgendamento } from "@/lib/social/agenda";
import {
  SEMANAS_A_FRENTE,
  diasDaRecorrencia,
  domingoDe,
} from "@/lib/social/programacao";

/* =====================================================================
   Materializar a grade semanal no calendário
   ---------------------------------------------------------------------
   O núcleo, separado da action porque tem DOIS chamadores com clientes
   de banco diferentes:

     o botão "Preencher agora"  → cliente de sessão, passa pela policy
     o cron diário              → cliente de serviço, sem sessão nenhuma

   Duplicar a lógica para atender os dois foi a primeira ideia, e ela
   erra devagar: as duas cópias divergem no primeiro ajuste e ninguém
   percebe, porque o resultado continua plausível — algumas peças a mais
   ou a menos num mês que ninguém confere linha a linha.

   IDEMPOTENTE. Antes de criar, pergunta quais dias JÁ têm peça daquela
   linha da grade. É o que permite o cron chamar isto todo dia.
   ===================================================================== */

/** O mínimo do cliente Supabase que esta função usa. */
interface ClienteDeBanco {
  from: (tabela: string) => {
    select: (colunas: string) => never;
    insert: (linhas: unknown) => never;
  };
}

export interface ResultadoDaMaterializacao {
  criadas: number;
  linhas: number;
  erro?: string;
}

export async function materializarProgramacao(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  opcoes?: {
    semanas?: number;
    clientId?: string;
    /**
     * Quem assina as peças criadas.
     *
     * OBRIGATÓRIO NO CAMINHO DE SESSÃO, e descobri isso do jeito ruim: a
     * policy de insert de `social_posts` exige
     * `created_by = (select auth.uid())`, então sem este campo o Postgres
     * devolve 42501 e a materialização inteira cria zero — com a tela
     * dizendo apenas "não deu", porque o erro chega como texto de
     * violação de policy e não como "faltou o autor".
     *
     * `null` é o valor do CRON, e é correto lá: ninguém clicou, e o
     * cliente de serviço não passa por policy nenhuma. Peça sem autor
     * quer dizer "o sistema criou", que é a verdade.
     */
    createdBy?: string | null;
  },
): Promise<ResultadoDaMaterializacao> {
  const semanas = Math.min(Math.max(opcoes?.semanas ?? SEMANAS_A_FRENTE, 1), 26);

  let query = supabase
    .from("social_recurrences")
    .select("id, client_id, weekday, hora, format, title, networks")
    .eq("is_active", true);

  if (opcoes?.clientId) query = query.eq("client_id", opcoes.clientId);

  const { data: grade, error: eGrade } = await query;
  if (eGrade) return { criadas: 0, linhas: 0, erro: eGrade.message };
  if (!grade?.length) return { criadas: 0, linhas: 0 };

  type Linha = {
    id: string;
    client_id: string;
    weekday: number;
    hora: string;
    format: string;
    title: string;
    networks: string[] | null;
  };
  const linhas = grade as Linha[];

  const hoje = dataNoBrasil();

  /* O que já existe, numa consulta só. Uma por linha da grade seriam 22
     idas ao banco para responder a mesma pergunta. */
  const { data: existentes, error: eExist } = await supabase
    .from("social_posts")
    .select("recurrence_id, scheduled_at")
    .in(
      "recurrence_id",
      linhas.map((g) => g.id),
    )
    .gte("scheduled_at", `${hoje}T00:00:00-03:00`);

  if (eExist) return { criadas: 0, linhas: linhas.length, erro: eExist.message };

  /* A CHAVE É A SEMANA, NÃO O DIA, e a primeira versão errou isso —
     medido na tela. Uma linha da grade vale UMA peça por semana; a data
     dentro da semana é onde ela caiu, não a identidade dela.

     Com a chave por dia, toda peça que não está exatamente no dia da
     grade fazia o gerador criar uma segunda na mesma semana. Dois
     caminhos comuns levam lá:

       - trocar o dia da grade, quando a peça daquela semana não moveu
         por já ter arte (protegida de propósito)
       - arrastar a peça no calendário, que é o gesto natural da grade

     Medido: depois de trocar Capelari de quarta para sexta com três
     peças protegidas, o "Preencher agora" criou 3 peças a mais — a
     semana do cliente dobrava sem ninguém pedir. */
  const jaTem = new Set(
    ((existentes ?? []) as { recurrence_id: string | null; scheduled_at: string | null }[])
      .filter((p) => p.recurrence_id && p.scheduled_at)
      .map((p) => `${p.recurrence_id}|${domingoDe(dataNoBrasil(p.scheduled_at!))}`),
  );

  const novas: Record<string, unknown>[] = [];
  for (const linha of linhas) {
    for (const dia of diasDaRecorrencia(linha.weekday, hoje, semanas)) {
      if (jaTem.has(`${linha.id}|${domingoDe(dia)}`)) continue;
      novas.push({
        client_id: linha.client_id,
        /* Sem nome na grade a peça nasce com um rótulo genérico, não
           vazia: `salvarPost` exige título, e mais importante, uma
           célula em branco no calendário é indistinguível de dia sem
           pauta — que é o oposto do que a grade promete. */
        title: linha.title || "Peça da semana",
        caption: "",
        format: linha.format,
        media_urls: [],
        scheduled_at: montarAgendamento(dia, linha.hora),
        status: "rascunho",
        recurrence_id: linha.id,
        created_by: opcoes?.createdBy ?? null,
      });
    }
  }

  if (novas.length === 0) return { criadas: 0, linhas: linhas.length };

  const { data: criadas, error } = await supabase
    .from("social_posts")
    .insert(novas)
    .select("id, recurrence_id");

  if (error) return { criadas: 0, linhas: linhas.length, erro: error.message };

  /* Os destinos, em lote. Peça sem destino nenhum é invisível para
     `situacaoDoPost`, que mede publicação contando linhas de
     `social_post_targets` — ela ficaria eternamente em "rascunho" mesmo
     depois de ir ao ar. */
  const redePorLinha = new Map<string, string[]>(
    linhas.map((g) => [g.id, g.networks ?? ["instagram"]]),
  );

  const destinos = ((criadas ?? []) as { id: string; recurrence_id: string | null }[])
    .flatMap((p) =>
      (redePorLinha.get(p.recurrence_id ?? "") ?? ["instagram"]).map(
        (network) => ({ post_id: p.id, network }),
      ),
    );

  if (destinos.length > 0) {
    /* O erro dos destinos NÃO é engolido. Uma peça sem destino nenhum é
       invisível para `situacaoDoPost` e fica presa em "rascunho" para
       sempre; falhar em silêncio aqui produziria um calendário cheio de
       peças que nenhuma tela sabe cobrar. */
    const { error: eDestinos } = await supabase
      .from("social_post_targets")
      .insert(destinos);

    if (eDestinos) {
      return {
        criadas: (criadas ?? []).length,
        linhas: linhas.length,
        erro: `Peças criadas, mas sem destino: ${eDestinos.message}`,
      };
    }
  }

  return { criadas: (criadas ?? []).length, linhas: linhas.length };
}

export type { ClienteDeBanco };
