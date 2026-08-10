import { NextResponse, type NextRequest } from "next/server";

import {
  desconectarInstancia,
  instanceNameForClient,
  parearInstancia,
  statusDaInstancia,
} from "@/lib/whatsapp/session";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Número de atendimento de um CLIENTE da carteira — o EloZap.
 *
 *   GET     ?cliente=<id>   estado da conexão
 *   POST    { clientId }    cria a instância (se preciso) e devolve o QR
 *   DELETE  ?cliente=<id>   desconecta o aparelho
 *
 * ⚠️ POR QUE ESTA ROTA ACEITA UM IDENTIFICADOR, E A DE /api/whatsapp NÃO.
 *
 * Naquela, o alvo é a instância PESSOAL de quem está logado, então o
 * nome sai da sessão e não existe parâmetro para adulterar — é o que
 * impede alguém de ler o QR do celular de um colega.
 *
 * Aqui o alvo é o número de uma CONTA, que várias pessoas atendem. O id
 * precisa vir na requisição, e por isso a autorização passa a ser
 * explícita: a consulta abaixo usa a chave ANON com o JWT de quem
 * chamou, então quem decide se aquela conta é visível é a policy do
 * Postgres. Conta fora da carteira devolve zero linhas e a rota
 * responde 404 — nunca 403, que confirmaria a existência do id.
 *
 * Parear e desconectar exigem ADMIN. Ligar o WhatsApp de um cliente é
 * ato administrativo, como vincular conta de anúncios: errar aqui
 * direciona a conversa de um cliente para o número de outro.
 *
 * MODO DEMO NÃO PAREIA. A carteira de demonstração é fictícia, mas a
 * Evolution do outro lado é a de produção — sem esta trava, um clique na
 * demo criaria a instância `cliente-verdi` de verdade no contêiner do
 * Railway, com nome de um cliente que não existe. Ler o estado continua
 * liberado; criar e destruir, não.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Autorizado =
  | { ok: true; nome: string; admin: boolean }
  | { ok: false; resposta: NextResponse };

async function autorizar(clientId: string | null): Promise<Autorizado> {
  if (!clientId) {
    return {
      ok: false,
      resposta: NextResponse.json({ error: "Informe o cliente." }, { status: 400 }),
    };
  }

  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      resposta: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
    };
  }

  const admin = user.role === "admin";

  if (!isDemoMode) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .maybeSingle();

    if (!data) {
      return {
        ok: false,
        resposta: NextResponse.json(
          { error: "Cliente não encontrado ou sem permissão." },
          { status: 404 },
        ),
      };
    }
  }

  return { ok: true, nome: instanceNameForClient(clientId), admin };
}

/**
 * FUNÇÕES, não constantes.
 *
 * Um `NextResponse` guardado no módulo tem o corpo consumido na PRIMEIRA
 * resposta: a segunda chamada devolve 403 com corpo vazio, e a tela
 * mostra o erro genérico em vez do motivo. Medido — o DELETE em modo
 * demo voltava `""` logo depois do POST. Uma resposta nova por chamada.
 */
const SOMENTE_ADMIN = () =>
  NextResponse.json(
    { error: "Só administrador conecta ou desconecta o número de um cliente." },
    { status: 403 },
  );

/** Ver a nota do topo: a carteira é fictícia, a Evolution não é. */
const DEMO_NAO_PAREIA = () =>
  NextResponse.json(
    { error: "Modo demo: conectar e desconectar números está desativado." },
    { status: 403 },
  );

export async function GET(request: NextRequest) {
  const clientId = new URL(request.url).searchParams.get("cliente");
  const auth = await autorizar(clientId);
  if (!auth.ok) return auth.resposta;

  /* EM DEMONSTRAÇÃO, a mesma fixture que a página usou para desenhar.
     Consultar a Evolution aqui devolveria "sem número" para uma conta
     que a tela acabou de mostrar como conectada — um clique em Atualizar
     desmontava a demonstração. E, num demo publicado (o
     `NEXT_PUBLIC_DEMO_MODE=1` que `env.ts` prevê), pouparia o contêiner
     do Railway de responder a visitante anônimo. */
  if (isDemoMode) {
    const { demoConnections } = await import("@/lib/mock/data");
    // `Object.hasOwn` e não indexação direta: `?cliente=constructor`
    // alcançaria o protótipo e devolveria uma função para serializar.
    const id = clientId as string;
    return NextResponse.json(
      Object.hasOwn(demoConnections, id)
        ? demoConnections[id]
        : { state: "absent" },
    );
  }

  return NextResponse.json(await statusDaInstancia(auth.nome));
}

export async function POST(request: NextRequest) {
  const corpo = (await request.json().catch(() => ({}))) as {
    clientId?: string;
  };

  const auth = await autorizar(corpo.clientId ?? null);
  if (!auth.ok) return auth.resposta;
  if (!auth.admin) return SOMENTE_ADMIN();
  if (isDemoMode) return DEMO_NAO_PAREIA();

  const resultado = await parearInstancia(auth.nome);

  return NextResponse.json(resultado, { status: resultado.success ? 200 : 502 });
}

export async function DELETE(request: NextRequest) {
  const auth = await autorizar(
    new URL(request.url).searchParams.get("cliente"),
  );
  if (!auth.ok) return auth.resposta;
  if (!auth.admin) return SOMENTE_ADMIN();
  if (isDemoMode) return DEMO_NAO_PAREIA();

  const resultado = await desconectarInstancia(auth.nome);

  return NextResponse.json(resultado, { status: resultado.success ? 200 : 502 });
}
