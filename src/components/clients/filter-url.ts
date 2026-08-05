/* =====================================================================
   URL dos filtros da carteira
   ---------------------------------------------------------------------
   Mês e agência convivem na mesma URL. Cada seletor montando a própria
   querystring apagaria o outro — trocar o mês limparia a agência, e o
   usuário veria a carteira inteira sem entender por quê.

   Um construtor só, que sempre recebe o estado completo.
   ===================================================================== */

export function buildClientsUrl({
  month,
  agency,
  currentMonth,
}: {
  month: string;
  agency: string;
  /** Mês corrente: omitido da URL para o link limpo ser o padrão. */
  currentMonth: string;
}): string {
  const params = new URLSearchParams();

  if (month && month !== currentMonth) params.set("month", month);
  if (agency) params.set("agency", agency);

  const qs = params.toString();
  return qs ? `/clientes?${qs}` : "/clientes";
}
