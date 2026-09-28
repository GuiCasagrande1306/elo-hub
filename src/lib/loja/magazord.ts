import "server-only";

import { pedidoEstaPago } from "./status-pago";

/* =====================================================================
   Cliente da API da Magazord (BW Commerce)
   ---------------------------------------------------------------------
   Documentação: https://docs.bwcommerce.com.br/v2.html

   QUATRO ARMADILHAS, e todas custaram tentativa antes de virarem linha
   de código. Estão aqui porque nenhuma delas está na documentação, e
   duas produziriam número errado em silêncio.

   1. ⚠️ ERRO VEM COM HTTP 200. A resposta é sempre 200; a falha aparece
      como `erros: [...]` preenchido no corpo. O padrão que este projeto
      usa com a Meta — `if (!response.ok) return null` — trataria TODA
      falha como sucesso e gravaria faturamento zero no relatório do
      cliente. Aqui se olha `erros`, nunca o status.

   2. ⚠️ O CAMINHO É RASO. É `/pedidos`, sem `/api`, sem versão e sem
      `/site`. Vinte e quatro combinações com prefixo devolveram
      "Nome da classe não informado" — a "classe" é o PRIMEIRO segmento
      da URL, e qualquer prefixo antes dela some com a classe.

   3. ⚠️ `data_inicial` NÃO É A DATA DO PEDIDO. Medido: uma janela de
      20 a 26/09 com `data_inicial` devolveu pedido de 16 de agosto. O
      filtro certo é `data_criacao_inicial`/`data_criacao_final`.
      Confiar no nome do parâmetro produziria faturamento de outra
      janela, com a data certa impressa na capa.

   4. ⚠️ `status` É OBJETO, não número: `{id, descricao, cor_html}`.
      Comparar `status !== 4` passa todo cancelado como pago.

   AUTENTICAÇÃO: cabeçalho `Token`, seco. `Authorization: Token` e
   `Authorization: Bearer` devolvem "Falha na autenticação".
   ===================================================================== */

/** Rede contra laço infinito se `totalPaginas` vier estranho. */
const MAX_PAGINAS = 40;

export interface DiaDaLoja {
  /** YYYY-MM-DD, no fuso em que a loja registra (Brasília). */
  data: string;
  pedidosPagos: number;
  receitaCents: number;
  /** Cancelados e em análise — fora do faturamento, mas visíveis. */
  pedidosDescartados: number;
}

interface PedidoBruto {
  id?: number;
  data?: string;
  vlr_total_pedido?: string | number | null;
  status?: { id?: number; descricao?: string; cor_html?: string } | null;
}

interface Envelope {
  registros?: PedidoBruto[];
  erros?: string[];
  totalPaginas?: number;
  totalRegistros?: number;
}

/** "2026-09-20" → "20-09-2026", que é o formato dos exemplos da doc. */
function paraDDMMAAAA(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}-${m}-${a}`;
}

/**
 * Reais em decimal → centavos, sem passar por float.
 *
 * `vlr_total_pedido` chega como string ("545.84") ou número. Somar
 * floats de reais acumula erro de arredondamento e, com 187 pedidos, a
 * diferença aparece nos centavos do total — que é justamente o que foi
 * conferido contra o painel da loja.
 */
function paraCentavos(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const texto = String(v).trim().replace(",", ".");
  const n = Number(texto);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export interface ResultadoDaLoja {
  dias: DiaDaLoja[];
  totalDePedidos: number;
}

/**
 * Os pedidos da janela, já somados por dia.
 *
 * `null` em qualquer tropeço — rede, token recusado, envelope
 * inesperado. NUNCA um resultado vazio como se significasse "não
 * vendeu nada": é a mesma distinção de `creative-insights.ts`, e aqui
 * ela vale dinheiro impresso no relatório.
 */
export async function pedidosDaJanela(
  baseUrl: string,
  token: string,
  inicio: string,
  fim: string,
  timeoutMs = 30_000,
): Promise<ResultadoDaLoja | null> {
  const base = baseUrl.replace(/\/+$/, "");
  const porDia = new Map<string, DiaDaLoja>();
  let total = 0;

  try {
    let pagina = 1;
    let totalPaginas = 1;

    do {
      const url = new URL(`${base}/pedidos`);
      url.searchParams.set("data_criacao_inicial", paraDDMMAAAA(inicio));
      url.searchParams.set("data_criacao_final", paraDDMMAAAA(fim));
      url.searchParams.set("pagina", String(pagina));

      const resposta = await fetch(url.toString(), {
        headers: { Token: token },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });

      /* O status ainda é conferido — um 500 ou um 404 de infraestrutura
         não devolve envelope nenhum. Mas ele NÃO basta: ver a
         armadilha 1 no cabeçalho. */
      if (!resposta.ok) return null;

      const corpo = (await resposta.json().catch(() => null)) as Envelope | null;
      if (!corpo) return null;

      // ⚠️ A checagem que importa. Erro chega aqui, não no status.
      if (Array.isArray(corpo.erros) && corpo.erros.length > 0) return null;

      const registros = corpo.registros;
      if (!Array.isArray(registros)) return null;

      for (const p of registros) {
        total += 1;

        /* "2026-09-20 14:57:50" → "2026-09-20". Corta a hora sem
           construir `Date`: passar pelo objeto converteria para UTC e,
           num pedido das 21h, jogaria a venda para o dia seguinte. */
        const dia = (p.data ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;

        const atual = porDia.get(dia) ?? {
          data: dia,
          pedidosPagos: 0,
          receitaCents: 0,
          pedidosDescartados: 0,
        };

        if (pedidoEstaPago(p.status)) {
          atual.pedidosPagos += 1;
          atual.receitaCents += paraCentavos(p.vlr_total_pedido);
        } else {
          atual.pedidosDescartados += 1;
        }

        porDia.set(dia, atual);
      }

      totalPaginas = corpo.totalPaginas ?? 1;
      pagina += 1;

      /* Respiro entre páginas. Um mês grande são duas ou três; a pausa
         custa pouco e evita disparar limite de requisição numa API de
         terceiro sobre a qual não temos cota documentada. */
      if (pagina <= totalPaginas) await new Promise((r) => setTimeout(r, 250));
    } while (pagina <= totalPaginas && pagina <= MAX_PAGINAS);

    return {
      dias: [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data)),
      totalDePedidos: total,
    };
  } catch {
    return null;
  }
}
