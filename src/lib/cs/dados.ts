import "server-only";

import { isDemoMode } from "@/lib/env";
import { dataNoBrasil } from "@/lib/date-br";
import { getClientsWithGoals, type ClientWithGoal } from "@/lib/data";
import { saudeDaSequencia, type SaudeAtual } from "@/lib/clientes/saude";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { segundaDaSemana, somarDias } from "./semana";
import type { ColunaDaSemana } from "./rotina";
import type { SaudeDaConta } from "@/types/database";

/* =====================================================================
   Painel do CS — leitura
   ---------------------------------------------------------------------
   Tudo sob RLS: o painel mostra a carteira que a pessoa enxerga. A
   ficha de cada cliente (pendências, oportunidades, próxima reunião)
   vem junto do cadastro; o resto são três consultas para a carteira
   inteira, fora de qualquer laço.
   ===================================================================== */

export type MarcasDaSemana = Record<ColunaDaSemana, boolean>;

export interface LinhaDaCarteira extends ClientWithGoal {
  saude: SaudeAtual | null;
  semana: MarcasDaSemana;
  /** O relatório saiu pelo Hub nesta semana — marca o "relatório de segunda" sozinho. */
  relatorioPeloHub: boolean;
}

export interface PainelDoCs {
  hoje: string;
  segunda: string;
  usuario: string;
  carteira: LinhaDaCarteira[];
  /** Itens da rotina concluídos à mão por quem está logado. */
  rotinaFeita: string[];
}

const SEM_MARCA: MarcasDaSemana = {
  relatorio_seg: false,
  mensagem_qua: false,
  mensagem_sex: false,
  reuniao_preparada: false,
};

export async function getPainelDoCs(): Promise<PainelDoCs | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const hoje = dataNoBrasil(new Date());
  const segunda = segundaDaSemana(hoje);
  const domingo = somarDias(segunda, 6);

  const linhas = (await getClientsWithGoals()).filter(
    (r) => r.client.status === "active" || r.client.status === "onboarding",
  );
  const ids = linhas.map((r) => r.client.id);

  let otimizacoes: { client_id: string; dia: string; account_health: SaudeDaConta | null }[];
  let marcas: ({ client_id: string } & MarcasDaSemana)[];
  let relatorios: { client_id: string }[];
  let rotina: { item: string }[];

  if (isDemoMode) {
    const { demoOptimizations, demoCsSemana, demoCsRotina, demoReports } = await import("@/lib/mock/data");
    otimizacoes = demoOptimizations;
    marcas = demoCsSemana.filter((m) => m.semana === segunda);
    relatorios = demoReports.filter(
      (r) => r.delivered_at && r.delivered_at.slice(0, 10) >= segunda && r.delivered_at.slice(0, 10) <= domingo,
    );
    rotina = demoCsRotina.filter((r) => r.profile_id === user.id && r.semana === segunda);
  } else {
    const supabase = await createSupabaseServerClient();
    const [o, m, r, ro] = await Promise.all([
      supabase
        .from("optimization_history")
        .select("client_id, dia, account_health")
        .in("client_id", ids)
        .not("account_health", "is", null)
        /* shortcut: 60 dias (~1 otimização/semana × carteira cabe no teto
           de 1.000 linhas do Supabase); "verde há X dias" para em ~60.
           Paginar com `.range()` se a carteira passar de ~100 contas. */
        .gte("dia", somarDias(hoje, -60))
        .order("dia", { ascending: false })
        .range(0, 999),
      supabase.from("cs_semana").select("*").eq("semana", segunda).in("client_id", ids),
      supabase
        .from("report_history")
        .select("client_id")
        .in("client_id", ids)
        // Vira de dia no fuso de Brasília: -03:00 nas bordas da semana.
        .gte("delivered_at", `${segunda}T00:00:00-03:00`)
        .lt("delivered_at", `${somarDias(domingo, 1)}T00:00:00-03:00`),
      supabase.from("cs_rotina").select("item").eq("profile_id", user.id).eq("semana", segunda),
    ]);
    // Erro do banco não vira painel vazio calado.
    for (const x of [o, m, r, ro]) if (x.error) throw new Error(`Painel do CS: ${x.error.message}`);
    otimizacoes = o.data ?? [];
    marcas = (m.data ?? []) as ({ client_id: string } & MarcasDaSemana)[];
    relatorios = r.data ?? [];
    rotina = ro.data ?? [];
  }

  const porCliente = new Map<string, typeof otimizacoes>();
  for (const o of otimizacoes) {
    const l = porCliente.get(o.client_id) ?? [];
    l.push(o);
    porCliente.set(o.client_id, l);
  }
  const comRelatorio = new Set(relatorios.map((r) => r.client_id));
  const marcasPorCliente = new Map(marcas.map((m) => [m.client_id, m]));

  return {
    hoje,
    segunda,
    usuario: user.full_name ?? "",
    carteira: linhas.map((r) => {
      const m = marcasPorCliente.get(r.client.id);
      return {
        ...r,
        saude: saudeDaSequencia(
          (porCliente.get(r.client.id) ?? []).sort((a, b) => b.dia.localeCompare(a.dia)),
          hoje,
        ),
        semana: m
          ? {
              relatorio_seg: m.relatorio_seg,
              mensagem_qua: m.mensagem_qua,
              mensagem_sex: m.mensagem_sex,
              reuniao_preparada: m.reuniao_preparada,
            }
          : SEM_MARCA,
        relatorioPeloHub: comRelatorio.has(r.client.id),
      };
    }),
    rotinaFeita: rotina.map((r) => r.item),
  };
}
