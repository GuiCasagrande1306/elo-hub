import type { ClientSegment, ReportTemplate } from "@/types/database";

/* =====================================================================
   Qual template esta conta usa
   ---------------------------------------------------------------------
   UMA função, porque a regra estava escrita em dois lugares e é o tipo
   de duplicata que diverge sem ninguém perceber: o compositor resolvia
   o template para gerar o PDF, e a tela de Relatórios ia passar a
   resolver de novo só para EXIBIR qual seria. Se as duas discordassem, a
   tela anunciaria um template e o PDF sairia com outro — e o defeito só
   apareceria no arquivo enviado ao cliente.

   O fallback para o template sem segmento é o que garante que toda
   conta tenha um: nicho novo entra no sistema antes de alguém desenhar
   o template dele.
   ===================================================================== */

export function resolverTemplate(
  templates: ReportTemplate[],
  segment: ClientSegment | null | undefined,
): ReportTemplate | undefined {
  return (
    templates.find((t) => t.segment === segment && t.is_default) ??
    templates.find((t) => t.segment === null && t.is_default)
  );
}
