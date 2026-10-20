import { dataNoBrasil } from "@/lib/date-br";

/* =====================================================================
   NPS trimestral — regras compartilhadas pelo formulário e pelo painel
   ===================================================================== */

export type Continuidade = "sim" | "talvez" | "nao";

export const DIMENSOES = [
  { chave: "nota_resultados", rotulo: "Resultados das campanhas" },
  { chave: "nota_comunicacao", rotulo: "Comunicação e agilidade no atendimento" },
  { chave: "nota_conteudo", rotulo: "Qualidade do conteúdo e dos criativos" },
  { chave: "nota_relatorios", rotulo: "Relatórios e clareza dos números" },
  { chave: "nota_estrategia", rotulo: "Estratégia e proatividade (trazer ideias)" },
] as const;

export type ChaveDimensao = (typeof DIMENSOES)[number]["chave"];

export const CONTINUIDADE: { valor: Continuidade; rotulo: string }[] = [
  { valor: "sim", rotulo: "Sim" },
  { valor: "talvez", rotulo: "Talvez" },
  { valor: "nao", rotulo: "Não" },
];

export interface RespostaNps extends Record<ChaveDimensao, number | null> {
  id: string;
  client_id: string;
  trimestre: string;
  score: number;
  motivo: string | null;
  continuidade: Continuidade | null;
  melhoria: string | null;
  respondente: string | null;
  submitted_at: string;
}

/** "2026-T4", pela data de São Paulo — o servidor roda em UTC. */
export function trimestreDe(quando: Date | string = new Date()): string {
  const iso = dataNoBrasil(quando);
  const mes = Number(iso.slice(5, 7));
  return `${iso.slice(0, 4)}-T${Math.ceil(mes / 3)}`;
}

export function rotuloDoTrimestre(t: string): string {
  const [ano, tri] = t.split("-T");
  return `${tri}º trimestre de ${ano}`;
}

export type Categoria = "promotor" | "neutro" | "detrator";

export function categoria(score: number): Categoria {
  if (score >= 9) return "promotor";
  if (score >= 7) return "neutro";
  return "detrator";
}

/**
 * NPS = % promotores − % detratores, de −100 a 100. `null` sem resposta:
 * zero é uma nota (tantos promotores quanto detratores), não ausência.
 */
export function calcularNps(scores: number[]) {
  const total = scores.length;
  const promotores = scores.filter((s) => s >= 9).length;
  const detratores = scores.filter((s) => s <= 6).length;
  const neutros = total - promotores - detratores;
  return {
    total,
    promotores,
    neutros,
    detratores,
    nps: total === 0 ? null : Math.round(((promotores - detratores) / total) * 100),
  };
}

/** Média de 1 a 5 ignorando "não se aplica". `null` se ninguém avaliou. */
export function mediaDaDimensao(respostas: RespostaNps[], chave: ChaveDimensao): number | null {
  const notas = respostas.map((r) => r[chave]).filter((n): n is number => n !== null);
  if (notas.length === 0) return null;
  return notas.reduce((a, b) => a + b, 0) / notas.length;
}
