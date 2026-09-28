/* =====================================================================
   Backfill do histórico de métricas
   ---------------------------------------------------------------------
   Rode com o servidor de pé (`elo-hub-dev`) e:

     npx tsx scripts/backfill-historico.mts
     npx tsx scripts/backfill-historico.mts --cliente=maya-sushi
     npx tsx scripts/backfill-historico.mts --desde=2026-01 --dry

   POR QUE PRECISA EXISTIR. A rodada diária só alcança o mês corrente, e
   `?since=&until=` resolve um mês de um cliente por chamada. Medido em
   28/09/2026: 28 das 60 contas ativas têm dado a partir de 06/2026 —
   quando o sistema passou a coletar, não quando a relação começou. Há
   contas cadastradas em agosto com dado só a partir de meados de
   setembro. Fazer isso à mão são centenas de chamadas.

   ⚠️ A ORDEM É DO MAIS ANTIGO PARA O MAIS NOVO, E TERMINA NO MÊS
   CORRENTE. Não é estética: a sincronização reescreve `ad_creatives`
   com os números DA JANELA PEDIDA. Se o último bloco a rodar for junho
   de 2025, a galeria do painel passa a exibir os números de junho de
   2025 com cara de atuais — o relatório não se engana, porque reapura
   na hora, mas a tela sim. Fechar no mês corrente devolve o retrato ao
   lugar certo.

   ⚠️ PULA TOKEN MORTO, e isso economiza a rodada inteira. Em 28/09/2026
   só 7 das 60 contas tinham token vivo; sem esta checagem seriam
   centenas de chamadas para colher `auth_expired`. O script confere uma
   vez por conta, antes de começar.

   IDEMPOTENTE. A chave do upsert é (cliente, plataforma, dia, campanha):
   rodar de novo atualiza, não duplica. Falhou um mês? Rode outra vez.

   A META GUARDA 37 MESES. Pedir mais que isso não traz nada, e o script
   nem tenta.
   ===================================================================== */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

/* --- ambiente ------------------------------------------------------- */

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const V = env.META_API_VERSION || "v21.0";

/* --- argumentos ----------------------------------------------------- */

const arg = (nome: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1];

const temFlag = (nome: string) => process.argv.includes(`--${nome}`);

/** Só simula: lista o que faria, sem chamar a sincronização. */
const DRY = temFlag("dry");
/** Limita a um cliente, por slug ou uuid. */
const ALVO = arg("cliente");
/** Começa deste mês (YYYY-MM) em vez da data de cadastro. */
const DESDE = arg("desde");
/** Onde o servidor está ouvindo. O `npm run dev` fixa a 5210. */
const BASE = arg("base") ?? "http://localhost:5210";

/**
 * De quantos meses atrás começar, no máximo.
 *
 * ⚠️ 36 E NÃO 37, e a diferença é um mês inteiro de chamada perdida.
 * A Meta guarda 37 meses e recusa a janela com
 * `(#3018) The start date of the time range cannot be beyond 37 months`.
 * Contando 37 a partir de HOJE, o piso cai no meio de um mês — e o
 * script pede aquele mês desde o DIA 1, que já está fora. Medido em
 * 27/09/2026: o piso deu 2023-08 e as duas contas antigas da carteira
 * falharam exatamente no primeiro mês da varredura, as duas com o 3018.
 *
 * Com 36, o dia 1 do mês do piso está sempre dentro da janela. Perde-se
 * até um mês de histórico no pior caso, contra uma chamada que falha
 * garantidamente em toda rodada.
 */
const MESES_DE_RETENCAO = 36;

/* --- utilitários de mês --------------------------------------------- */

/** "2026-09" → { since: "2026-09-01", until: "2026-09-30" } */
function limitesDoMes(mes: string, hoje: string) {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const since = `${mes}-01`;
  const until = `${mes}-${String(ultimo).padStart(2, "0")}`;
  /* O mês corrente termina HOJE, não no dia 31: pedir dias que ainda
     não aconteceram faz a Graph API devolver a janela inteira vazia em
     algumas contas, em vez de só ignorar o excedente. */
  return { since, until: until > hoje ? hoje : until };
}

function mesSeguinte(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return m === 12
    ? `${a + 1}-01`
    : `${a}-${String(m + 1).padStart(2, "0")}`;
}

function mesesEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  let m = de;
  /* Teto de 60 iterações: rede de segurança contra um `de` malformado
     que produziria um laço infinito. A retenção da Meta já limita a 37
     meses, então o teto nunca morde num caso real. */
  while (m <= ate && out.length < 60) {
    out.push(m);
    m = mesSeguinte(m);
  }
  return out;
}

const hojeBR = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/* --- 1. quem entra na rodada ---------------------------------------- */

const { data: integracoes, error } = await admin
  .from("client_integrations")
  .select(
    "client_id, external_account_id, clients!inner(name, slug, status, created_at), integration_secrets(access_token)",
  )
  .eq("platform", "meta_ads")
  .eq("is_active", true);

if (error) {
  console.error("Consulta recusada pelo banco:", error.message);
  process.exit(1);
}

type Linha = {
  client_id: string;
  external_account_id: string | null;
  clients?: { name?: string; slug?: string; status?: string; created_at?: string } | null;
  integration_secrets?: { access_token?: string | null } | null;
};

const candidatos = (integracoes ?? []) as unknown as Linha[];

const hoje = hojeBR();
const mesAtual = hoje.slice(0, 7);

/* O piso da retenção, em mês. Pedir antes disso é chamada desperdiçada. */
const pisoData = new Date();
pisoData.setUTCMonth(pisoData.getUTCMonth() - MESES_DE_RETENCAO);
const mesPiso = pisoData.toISOString().slice(0, 7);

console.log(`servidor: ${BASE}`);
console.log(`hoje: ${hoje} · piso da retenção: ${mesPiso}${DRY ? " · MODO SIMULAÇÃO" : ""}\n`);

const fila: { nome: string; clientId: string; meses: string[] }[] = [];
let semToken = 0;
let mortos = 0;
let foraDoAlvo = 0;

for (const i of candidatos) {
  const c = i.clients;
  if (!["active", "onboarding"].includes(c?.status ?? "")) continue;

  if (ALVO && c?.slug !== ALVO && i.client_id !== ALVO) {
    foraDoAlvo++;
    continue;
  }

  const token = i.integration_secrets?.access_token;
  const conta = i.external_account_id;
  if (!token || !conta || conta.startsWith("pending:")) {
    semToken++;
    continue;
  }

  /* ⚠️ UMA CHAMADA QUE FAZ DUAS COISAS, e as duas importam.
     -----------------------------------------------------------------
     1. CONFERE O TOKEN antes de começar. Sem isto, uma conta com token
        morto geraria uma chamada por mês do histórico inteiro, todas
        devolvendo `auth_expired`. Perguntar pela CONTA, e não por
        `/me`, ainda é mais preciso: prova que aquele token alcança
        aquela conta, não só que ele existe.

     2. DESCOBRE QUANDO A CONTA NASCEU, que é de onde o histórico deve
        partir.

     ⚠️ E NÃO da data de cadastro do cliente no Elo Hub, que foi a
     primeira versão deste script. Medido em 28/09/2026, a diferença é
     grande demais para arredondar:

        R&D Assessoria   conta de 2021-03   cadastro 2026-08
        LEOTEX Química   conta de 2023-03   cadastro 2026-08
        Station63        conta de 2025-01   cadastro 2026-08

     Partir do cadastro teria varrido dois meses e declarado o
     histórico completo, deixando anos de dado para trás sem nada na
     tela dizendo. É exatamente o caso que `SyncOptions.range` existe
     para resolver: conta vinculada no meio da relação. */
  const conta_meta = await fetch(
    `https://graph.facebook.com/${V}/${conta}?fields=created_time`,
    { headers: { Authorization: `Bearer ${token}` } },
  ).then((r) => r.json());

  if (conta_meta.error) {
    mortos++;
    continue;
  }

  /* Mês em que a conta de anúncio foi criada, nunca antes do piso da
     retenção. `--desde` manda quando informado — serve para repetir um
     trecho sem varrer tudo de novo. */
  const nascimento =
    String(conta_meta.created_time ?? "").slice(0, 7) || mesAtual;
  let inicio = DESDE ?? nascimento;
  if (inicio < mesPiso) inicio = mesPiso;

  fila.push({
    nome: c?.name ?? i.client_id,
    clientId: i.client_id,
    meses: mesesEntre(inicio, mesAtual),
  });
}

console.log(
  `contas na fila: ${fila.length} · token morto: ${mortos} · sem conta vinculada: ${semToken}` +
    (ALVO ? ` · fora do alvo: ${foraDoAlvo}` : ""),
);

if (fila.length === 0) {
  console.log("\nNada a fazer. Reautorize as contas e rode de novo.");
  process.exit(0);
}

const totalChamadas = fila.reduce((a, f) => a + f.meses.length, 0);
console.log(`meses a processar: ${totalChamadas}\n`);

if (DRY) {
  for (const f of fila) {
    console.log(`  ${f.nome.padEnd(28)} ${f.meses[0]} → ${f.meses[f.meses.length - 1]} (${f.meses.length} meses)`);
  }
  console.log("\nSimulação: nada foi chamado. Tire o --dry para valer.");
  process.exit(0);
}

/* --- 2. a varredura -------------------------------------------------- */

const SEGREDO = env.CRON_SECRET;
if (!SEGREDO) {
  console.error("CRON_SECRET ausente no .env.local — a rota recusaria tudo.");
  process.exit(1);
}

let linhasTotais = 0;
let falhas = 0;

for (const f of fila) {
  console.log(`\n${f.nome}`);

  for (const mes of f.meses) {
    const { since, until } = limitesDoMes(mes, hoje);
    const url =
      `${BASE}/api/cron/sync-ads?clientId=${encodeURIComponent(f.clientId)}` +
      `&since=${since}&until=${until}`;

    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${SEGREDO}` },
        // Generoso: um mês de conta grande é lento, e abortar no meio
        // deixaria o upsert pela metade sem nada dizer.
        signal: AbortSignal.timeout(120_000),
      });

      if (!r.ok) {
        falhas++;
        console.log(`  ${mes}  ✗ HTTP ${r.status}`);
        continue;
      }

      const j = (await r.json()) as {
        totalRowsUpserted?: number;
        failed?: number;
        results?: { ok?: boolean; message?: string }[];
      };

      const linhas = j.totalRowsUpserted ?? 0;
      linhasTotais += linhas;

      const problema = j.results?.find((x) => x.ok === false);
      console.log(
        `  ${mes}  ${problema ? "✗" : "✓"} ${String(linhas).padStart(4)} linhas` +
          (problema ? ` — ${(problema.message ?? "").slice(0, 60)}` : ""),
      );
      if (problema) falhas++;
    } catch (e) {
      falhas++;
      console.log(`  ${mes}  ✗ ${e instanceof Error ? e.message : "falhou"}`);
    }

    /* Respiro entre chamadas. A Graph API limita por app, e uma
       varredura de centenas de meses em sequência é exatamente o
       padrão que dispara o limite — que chega como erro obscuro e
       contamina os meses seguintes. */
    await new Promise((r) => setTimeout(r, 400));
  }
}

/* --- 3. fechar no mês corrente --------------------------------------- */
/* ⚠️ O PASSO QUE NÃO PODE FALTAR. Ver a nota do cabeçalho: sem ele, o
   retrato em `ad_creatives` fica com os números do último mês varrido,
   e a galeria do painel passa a mentir com cara de atual. */

console.log("\n--- devolvendo o retrato dos criativos ao mês corrente ---");

for (const f of fila) {
  const { since, until } = limitesDoMes(mesAtual, hoje);
  try {
    const r = await fetch(
      `${BASE}/api/cron/sync-ads?clientId=${encodeURIComponent(f.clientId)}&since=${since}&until=${until}`,
      {
        headers: { Authorization: `Bearer ${SEGREDO}` },
        signal: AbortSignal.timeout(120_000),
      },
    );
    console.log(`  ${f.nome.padEnd(28)} ${r.ok ? "✓" : `✗ HTTP ${r.status}`}`);
  } catch {
    console.log(`  ${f.nome.padEnd(28)} ✗ falhou — rode de novo`);
  }
  await new Promise((r) => setTimeout(r, 400));
}

console.log(
  `\nlinhas gravadas: ${linhasTotais} · meses com falha: ${falhas} de ${totalChamadas}`,
);
console.log(
  falhas > 0
    ? "Falha de mês é recuperável: o script é idempotente, rode de novo."
    : "",
);
