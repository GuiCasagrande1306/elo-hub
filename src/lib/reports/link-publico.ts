import "server-only";

import { randomBytes } from "node:crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataNoBrasil, somarDiasBR } from "@/lib/date-br";
import { isDemoMode } from "@/lib/env";

/* =====================================================================
   O link público do relatório
   ---------------------------------------------------------------------
   Uma alternativa ao PDF: em vez de um arquivo fechado num período
   fixo, um endereço onde o cliente escolhe as datas. Mesmo documento,
   mesma apuração — muda o invólucro.

   ⚠️ O TOKEN É A ÚNICA FECHADURA. Quem tem o endereço vê o desempenho
   de mídia daquela conta, sem login. Três consequências que o código
   precisa respeitar:

     • 32 bytes aleatórios, não um id sequencial nem o UUID do cliente.
       Um link adivinhável seria o mesmo que não ter fechadura.
     • REVOGÁVEL, e é por isso que existe tabela em vez de um HMAC
       assinado como o do Puppeteer: blob assinado só se cancela
       trocando o segredo, o que derrubaria o link de todos os outros
       clientes junto.
     • `noindex` na página. Um link que vaze para um buscador deixa de
       ser secreto para sempre.
   ===================================================================== */

/**
 * O maior intervalo que o link aceita.
 *
 * As datas são livres por decisão do produto — mas livre não é
 * ilimitado: sem teto, um intervalo de dez anos varre `daily_metrics`
 * inteira numa rota pública que qualquer um com o endereço pode
 * recarregar. Um ano cobre qualquer conversa real com cliente.
 */
const JANELA_MAXIMA_DIAS = 366;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve o período pedido na URL, com as travas mecânicas.
 *
 * ⚠️ O FIM NÃO PASSA DE ONTEM, e isto não é limitar a escolha: o dia
 * corrente está pela metade na plataforma, então incluí-lo mostra uma
 * queda que não existe justamente no último ponto do gráfico — que é
 * onde o olho vai primeiro. O relatório interno já usa a mesma régua.
 *
 * Entrada inválida cai nos últimos 30 dias em vez de derrubar a página:
 * quem abriu veio ver um relatório, e uma tela em branco não diz o que
 * aconteceu. O período escolhido aparece escrito no documento, então um
 * padrão diferente do pedido é visível, não silencioso.
 */
export function periodoDoLink(
  inicio?: string,
  fim?: string,
): { periodStart: string; periodEnd: string } {
  const ontem = somarDiasBR(dataNoBrasil(), -1);
  const padrao = {
    periodStart: somarDiasBR(ontem, -29),
    periodEnd: ontem,
  };

  if (!inicio || !fim || !DATA.test(inicio) || !DATA.test(fim)) return padrao;
  if (inicio > fim) return padrao;

  // Nunca além de ontem — ver a nota acima.
  const periodEnd = fim > ontem ? ontem : fim;

  // Teto de janela: corta pelo começo, preservando o fim que foi pedido.
  const maisAntigo = somarDiasBR(periodEnd, -(JANELA_MAXIMA_DIAS - 1));
  const periodStart = inicio < maisAntigo ? maisAntigo : inicio;

  if (periodStart > periodEnd) return padrao;

  return { periodStart, periodEnd };
}

/**
 * O cliente dono do link, contabilizando a visita na mesma ida.
 *
 * `null` = token inexistente ou revogado. Quem chama devolve 404, nunca
 * 403: um 403 confirmaria que aquele token já existiu.
 *
 * SERVICE_ROLE porque o visitante não tem sessão — e é justamente por
 * isso que a tabela não tem policy nenhuma para `anon`. O visitante
 * nunca fala com o Postgres; manda um token e recebe HTML.
 */
export async function clienteDoLink(token: string): Promise<string | null> {
  if (isDemoMode) return null;
  if (!token || token.length < 20) return null;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("registrar_visita_do_link", {
      p_token: token,
    });

    if (error) return null;
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

export interface LinkDoRelatorio {
  token: string;
  createdAt: string;
  viewCount: number;
  lastViewedAt: string | null;
}

/**
 * O link ativo de um cliente, criando um se ainda não houver.
 *
 * REAPROVEITA em vez de criar a cada clique: dois links ativos para o
 * mesmo cliente significam dois endereços circulando, e revogar um
 * deixaria o outro de pé sem ninguém perceber.
 *
 * Roda sob a sessão de quem pediu — a policy de INSERT exige
 * `can_write_client`, então quem não administra a conta não consegue
 * abrir uma porta para ela.
 */
export async function linkAtivoDoCliente(
  supabase: {
    from: ReturnType<typeof createSupabaseAdminClient>["from"];
  },
  clientId: string,
  profileId: string | null,
): Promise<LinkDoRelatorio | null> {
  const { data: existente } = await supabase
    .from("report_share_links")
    .select("token, created_at, view_count, last_viewed_at")
    .eq("client_id", clientId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existente) {
    const e = existente as unknown as {
      token: string;
      created_at: string;
      view_count: number;
      last_viewed_at: string | null;
    };
    return {
      token: e.token,
      createdAt: e.created_at,
      viewCount: e.view_count,
      lastViewedAt: e.last_viewed_at,
    };
  }

  /* 32 bytes = 256 bits de entropia, em base64url para caber numa URL
     sem escapar nada. É o único segredo que protege o conteúdo. */
  const token = randomBytes(32).toString("base64url");

  const { data: criado, error } = await supabase
    .from("report_share_links")
    .insert({ client_id: clientId, token, created_by: profileId })
    .select("token, created_at, view_count, last_viewed_at")
    .single();

  if (error || !criado) return null;

  const c = criado as unknown as {
    token: string;
    created_at: string;
    view_count: number;
    last_viewed_at: string | null;
  };

  return {
    token: c.token,
    createdAt: c.created_at,
    viewCount: c.view_count,
    lastViewedAt: c.last_viewed_at,
  };
}
