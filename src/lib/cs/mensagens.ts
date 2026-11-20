/* Mensagens padrão do CS (migration 109). O texto de fábrica aparece
   enquanto ninguém salvou a do dia — a tela nunca começa vazia. */
export type DiaDaMensagem = "seg" | "qua" | "sex";

export const MENSAGENS_DE_FABRICA: { dia: DiaDaMensagem; titulo: string; dica: string; texto: string }[] = [
  {
    dia: "seg",
    titulo: "Segunda · relatório",
    dica: "Vai junto com o relatório semanal.",
    texto:
      "Bom dia! Segue o relatório da semana passada com os principais números das campanhas. Qualquer dúvida, estamos por aqui. Boa semana!",
  },
  {
    dia: "qua",
    titulo: "Quarta · ideia de criativo / leads",
    dica: "Proposta de criativo e como estão chegando os leads.",
    texto:
      "Oi! Passando para saber como estão os contatos que chegaram pelos anúncios esta semana. Também tivemos uma ideia de criativo novo e queremos a opinião de vocês. Podemos mostrar?",
  },
  {
    dia: "sex",
    titulo: "Sexta · leads ou acompanhamento",
    dica: "Retorno dos leads ou o que foi feito e os próximos passos.",
    texto:
      "Oi! Fechando a semana: como foi o retorno dos leads? Do nosso lado, fizemos ajustes nas campanhas e o próximo passo é acompanhar o resultado na semana que vem. Bom fim de semana!",
  },
];
