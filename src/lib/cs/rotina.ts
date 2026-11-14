/* Rotina da semana do CS.
   shortcut: lista fixa no código, tirada do protótipo de 13/11/2026;
   se cada pessoa precisar da própria, mover para uma tabela.

   `auto`: o item se marca sozinho quando TODOS os clientes da carteira
   estão marcados na coluna correspondente da tabela da semana. */
export type ColunaDaSemana = "relatorio_seg" | "mensagem_qua" | "mensagem_sex" | "reuniao_preparada";

export interface ItemDaRotina {
  id: string;
  dia: "Segunda" | "Terça" | "Quarta" | "Quinta" | "Sexta";
  titulo: string;
  detalhe?: string;
  auto?: ColunaDaSemana;
}

export const ROTINA: ItemDaRotina[] = [
  { id: "seg-relatorios", dia: "Segunda", titulo: "Relatório semanal de cada cliente", detalhe: "enviar até as 11h", auto: "relatorio_seg" },
  { id: "seg-performance", dia: "Segunda", titulo: "Reunião de performance", detalhe: "rever contas amarelas e vermelhas" },
  { id: "ter-pendencias", dia: "Terça", titulo: "Bloco de CS: cobrar pendências", detalhe: "por WhatsApp, uma a uma" },
  { id: "qua-mensagem", dia: "Quarta", titulo: "Mensagem da semana", auto: "mensagem_qua" },
  { id: "qui-reunioes", dia: "Quinta", titulo: "Preparar as reuniões da próxima semana", auto: "reuniao_preparada" },
  { id: "sex-mensagem", dia: "Sexta", titulo: "Mensagem de fechamento da semana", auto: "mensagem_sex" },
  { id: "sex-saude", dia: "Sexta", titulo: "Atualizar a saúde da carteira", detalhe: "marcar verde/amarelo/vermelho na esteira" },
];
