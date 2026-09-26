import type { AdPlatform } from "@/types/database";

/* =====================================================================
   O aviso de coleta parada
   ---------------------------------------------------------------------
   PURO DE PROPÓSITO: sem `server-only`, e pelo mesmo motivo de
   `reports/serie-do-grafico.ts`. Quem mede a coleta precisa do banco com
   service_role; quem decide o TEXTO não precisa de nada, e um módulo
   marcado como servidor não pode ser importado por um teste de mesa.

   E este texto precisa de teste. Ele resume — e resumir é escolher o que
   a equipe NÃO vai ler. Errar o corte é mandar cinquenta linhas quase
   idênticas para um grupo de WhatsApp, o que enterra as três linhas de
   saldo que vêm depois e treina todo mundo a rolar a tela sem ler.
   ===================================================================== */

export type CausaDaParada =
  /** Token expirado ou revogado. Só reautorizar resolve. */
  | "reautorizar"
  /** A plataforma recusou por outro motivo. Precisa de investigação. */
  | "erro"
  /** Sem erro registrado e sem dado novo — a rodada não chegou aqui. */
  | "sem_dado";

export interface IntegracaoParada {
  clientId: string;
  clientName: string;
  platform: AdPlatform;
  causa: CausaDaParada;
  /** A mensagem da plataforma, sem o código entre colchetes. */
  detalhe: string | null;
  /** Dias desde a última vez que dado entrou. `null` = nunca entrou. */
  diasSemDado: number | null;
  /** Quem autorizou, quando se sabe. Ver a nota no uso. */
  autorizadoPor: string | null;
}

/**
 * A seção da coleta parada.
 *
 * ⚠️ RESUME EM VEZ DE LISTAR TUDO, e isto não é preguiça — é a diferença
 * entre um aviso lido e um aviso silenciado. Quando a causa é comum (um
 * token que autorizava a carteira inteira), a lista completa tem o
 * tamanho da carteira: medido em 26/09/2026, 49 integrações de uma vez.
 * Cinquenta linhas quase idênticas num grupo de WhatsApp enterram as
 * três linhas de saldo que vêm depois e treinam a equipe a rolar a tela
 * sem ler.
 *
 * O QUE SOBREVIVE AO CORTE é o que muda a ação: quantas contas, de
 * quantos clientes, há quanto tempo, e — quando se sabe — de quem era o
 * acesso que caiu. Com um nome só na lista de autorizadores, esse nome é
 * a causa, e dizê-lo resolve o problema em um passo em vez de trinta.
 */
export function secaoDaColeta(parada: IntegracaoParada[]): string[] {
  const linhas: string[] = [];
  const clientes = new Set(parada.map((p) => p.clientId)).size;

  linhas.push(
    parada.length === 1
      ? "*A coleta de 1 conta parou.* Os números abaixo podem estar velhos."
      : `*A coleta de ${parada.length} contas parou* (${clientes} ${clientes === 1 ? "cliente" : "clientes"}). Os números abaixo podem estar velhos.`,
  );

  const porCausa = {
    reautorizar: parada.filter((p) => p.causa === "reautorizar"),
    erro: parada.filter((p) => p.causa === "erro"),
    sem_dado: parada.filter((p) => p.causa === "sem_dado"),
  };

  /* A AÇÃO NO RÓTULO, não a causa técnica. "auth_expired" não diz a
     ninguém o que fazer; "reautorizar" diz, e é um botão que existe. */
  const RÓTULO: Record<IntegracaoParada["causa"], string> = {
    reautorizar: "precisam de reautorização",
    erro: "com erro da plataforma",
    sem_dado: "sem dado novo, sem erro registrado",
  };

  for (const causa of ["reautorizar", "erro", "sem_dado"] as const) {
    const grupo = porCausa[causa];
    if (grupo.length === 0) continue;

    linhas.push("", `*${grupo.length} ${RÓTULO[causa]}:*`);

    /* ⚠️ ORDENA AQUI TAMBÉM, e não confia em quem chama.
       `coletaParada` já devolve ordenado, e a primeira versão deste
       código dizia justamente isso num comentário — "já foram ordenadas,
       então as três primeiras são as piores". Era uma invariante afirmada
       e não garantida: o teste de mesa passou com entrada ordenada e o
       exemplo impresso ao lado mostrou "há 1 dia, há 2 dias, há 3 dias"
       sob um teto que existe para mostrar as mais antigas.

       Um corte que descarta 46 linhas precisa estar certo sobre as três
       que sobram, e ordenar de novo custa nada.

       `null` = nunca coletou, e vem na frente de tudo. */
    const piores = [...grupo].sort(
      (a, b) => (b.diasSemDado ?? 9999) - (a.diasSemDado ?? 9999),
    );

    for (const p of piores.slice(0, 3)) {
      const tempo =
        p.diasSemDado === null
          ? "nunca coletou"
          : p.diasSemDado === 0
            ? "parou hoje"
            : `há ${p.diasSemDado} ${p.diasSemDado === 1 ? "dia" : "dias"}`;

      linhas.push(
        `• ${p.clientName} (${p.platform === "meta_ads" ? "Meta" : "Google"}) — ${tempo}`,
      );
    }

    if (grupo.length > 3) {
      linhas.push(`• e outras ${grupo.length - 3}`);
    }

    /* ⚠️ O DONO DO ACESSO É A LINHA QUE RESOLVE. Quando todas as contas
       que pedem reautorização vêm do MESMO autorizador, não são trinta
       problemas: é um, com trinta sintomas. Foi exatamente o 18/09, e
       levar esse nome para o grupo troca uma investigação por um pedido
       direto a uma pessoa. Só aparece quando o nome é único — dois ou
       mais e a afirmação deixaria de ser verdade. */
    if (causa === "reautorizar") {
      const donos = new Set(
        grupo.map((p) => p.autorizadoPor).filter((n): n is string => Boolean(n)),
      );
      if (donos.size === 1 && grupo.length > 1) {
        linhas.push(
          `Todas autorizadas por ${[...donos][0]} — é um acesso só que caiu.`,
        );
      }
    }
  }

  return linhas;
}
