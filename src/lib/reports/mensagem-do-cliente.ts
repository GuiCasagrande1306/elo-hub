/* =====================================================================
   A mensagem que acompanha o relatório
   ---------------------------------------------------------------------
   UM TEXTO SÓ, E ELE É ESTE. Até 23/08/2026 existiam dois: o que a
   estação de comando mostrava em "Texto para o cliente" e o que o
   WhatsApp de fato despachava junto do PDF. A tela mostrava

       Olá! Segue o resumo da campanha.
       • Período: 20 - 21 de agosto de 2026
       • Investimento: R$ 189,83
       • Pedidos: 21
       • Custo por pedido: R$ 8,92

   e o cliente recebia

       Fala equipe! 🚀 Segue o relatório de performance fechado.
       Investimos *R$ 189,83* e geramos *21 resultados* a um custo de
       *R$ 8,92* cada.

   Mesmos números, outra voz — e "21 resultados" onde a conta chama de
   pedidos. Quem operava conferia uma coisa e enviava outra, sem meio de
   perceber: a tela não mostra o que sai.

   O TEXTO É MONTADO AQUI, e os dois caminhos passam por esta função. A
   diferença entre eles é só de onde vêm os números — da tela, já
   somados para a janela escolhida; ou do payload, no envio agendado e
   no reenvio da fila.

   PURO DE PROPÓSITO: sem `server-only`, sem banco. Roda no navegador
   para a prévia e no servidor no envio, e é a mesma função nos dois.

   SEM EMOJI E SEM `*negrito*`. O asterisco do WhatsApp não aparece na
   prévia, então o que a equipe confere não é o que o cliente lê. E
   emoji em relatório de resultado é uma escolha de tom que nunca foi
   pedida — a mensagem some no meio do grupo do cliente com a mesma
   cara de disparo automático.
   ===================================================================== */

export interface ResumoParaCliente {
  /** "20 – 21 de agosto de 2026", já formatado por `formatPeriod`. */
  periodoLabel: string;
  /** "R$ 189,83". */
  investimento: string;
  /** Como ESTA conta chama o resultado: "Pedidos", "Leads", "Vendas". */
  resultadoLabel: string;
  /** "21" ou "R$ 12.345,67", conforme a unidade da meta. */
  resultado: string;
  /**
   * "Custo por pedido". `null` em meta de faturamento — "custo por
   * faturamento" não é uma grandeza, e ali quem responde é o retorno.
   */
  custoLabel: string | null;
  /** "R$ 8,92". `null` quando não houve resultado para dividir. */
  custo: string | null;
  /** "3,2x". Só em meta de faturamento, e só com investimento > 0. */
  retorno: string | null;
}

export function mensagemDoCliente(r: ResumoParaCliente): string {
  return [
    "Olá! Segue o resumo da campanha.",
    "",
    /* O período entra como CAMPO, na mesma lista dos números — não
       embutido na saudação. Colado neles, não há como ler um sem o
       outro; era exatamente essa separação que deixava a frase dizer
       "7 dias" sobre o gasto de um mês. */
    `• Período: ${r.periodoLabel}`,
    `• Investimento: ${r.investimento}`,
    `• ${r.resultadoLabel}: ${r.resultado}`,
    r.custoLabel && r.custo ? `• ${r.custoLabel}: ${r.custo}` : null,
    r.retorno ? `• Retorno: ${r.retorno} sobre o investido` : null,
    "",
    "Qualquer dúvida, é só chamar por aqui.",
  ]
    .filter((l) => l !== null)
    .join("\n");
}
