import type { Client } from "@/types/database";

/** Um passo do onboarding. `done_by` é o NOME, para a lista não precisar de join. */
export interface ItemDoOnboarding {
  id: string;
  label: string;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
}

/* Ids fixos: são eles que ligam o clique ao item gravado. Mudar o
   texto aqui não mexe em cliente que já tem lista gravada. */
const PADRAO: Array<[string, string]> = [
  ["contrato", "Contrato assinado"],
  ["pagamento", "Primeiro pagamento confirmado"],
  ["grupo", "Grupo de WhatsApp criado"],
  ["kickoff", "Reunião de kickoff feita"],
  ["briefing", "Briefing preenchido"],
  ["meta", "Acesso ao Gerenciador de Anúncios (Meta)"],
  ["google", "Acesso ao Google Ads"],
  ["pixel", "Pixel/tag instalados"],
  ["metas", "Metas do mês definidas"],
  ["campanha", "Primeira campanha no ar"],
];

export function listaPadrao(): ItemDoOnboarding[] {
  return PADRAO.map(([id, label]) => ({
    id,
    label,
    done: false,
    done_at: null,
    done_by: null,
  }));
}

/** A lista gravada, ou a padrão enquanto ninguém mexeu. */
export function checklistDoCliente(
  client: Pick<Client, "onboarding_checklist">,
): ItemDoOnboarding[] {
  return client.onboarding_checklist ?? listaPadrao();
}

/** 0–100, inteiro. Lista vazia é 0: sem passo nenhum não há o que concluir. */
export function progresso(itens: ItemDoOnboarding[]): number {
  if (itens.length === 0) return 0;
  return Math.round((itens.filter((i) => i.done).length / itens.length) * 100);
}
