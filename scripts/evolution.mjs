#!/usr/bin/env node
/**
 * Ferramenta de linha de comando para a Evolution API.
 *
 * Existe porque configurar a Evolution na mão é uma sequência de curls
 * com a chave no header, e errar um deles produz mensagem de erro que
 * não diz o que fazer. Aqui cada comando responde em português e sugere
 * o passo seguinte.
 *
 * Lê as credenciais de .env.local. Nunca imprime a chave.
 *
 *   node scripts/evolution.mjs status     estado da instância
 *   node scripts/evolution.mjs criar      cria a instância
 *   node scripts/evolution.mjs qr         salva o QR Code em PNG
 *   node scripts/evolution.mjs grupos     lista grupos e seus JIDs
 *   node scripts/evolution.mjs enviar <destino> <texto>
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(raiz, ".env.local");

function lerEnv() {
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

const env = lerEnv();
const BASE = (env.EVOLUTION_API_URL ?? "").replace(/\/$/, "");
const KEY = env.EVOLUTION_API_KEY ?? "";
const INSTANCIA = env.EVOLUTION_INSTANCE_NAME ?? "";

function exigirConfig({ precisaInstancia = true } = {}) {
  const faltando = [];
  if (!BASE) faltando.push("EVOLUTION_API_URL");
  if (!KEY) faltando.push("EVOLUTION_API_KEY");
  if (precisaInstancia && !INSTANCIA) faltando.push("EVOLUTION_INSTANCE_NAME");

  if (faltando.length > 0) {
    console.error(`\n✗ Faltando em .env.local: ${faltando.join(", ")}\n`);
    console.error("  A Evolution precisa estar rodando numa URL pública ou");
    console.error("  local. Sem servidor, não há o que configurar.\n");
    process.exit(1);
  }
}

async function api(metodo, caminho, corpo) {
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", apikey: KEY },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const dado = await resposta.json().catch(() => ({}));
  return { ok: resposta.ok, status: resposta.status, dado };
}

/** Traduz falhas comuns em algo acionável. */
function explicar(status, dado) {
  const bruto = dado?.response?.message ?? dado?.message ?? dado?.error ?? "";
  const texto = Array.isArray(bruto) ? bruto.join("; ") : String(bruto);

  if (status === 401 || status === 403) {
    return "Chave recusada. Confira EVOLUTION_API_KEY (é a AUTHENTICATION_API_KEY do servidor).";
  }
  if (status === 404) {
    return `Instância "${INSTANCIA}" não existe. Rode: node scripts/evolution.mjs criar`;
  }
  return texto || `Servidor respondeu ${status}.`;
}

const comandos = {
  async status() {
    exigirConfig({ precisaInstancia: false });

    const { ok, status, dado } = await api("GET", "/instance/fetchInstances");
    if (!ok) {
      console.error(`\n✗ ${explicar(status, dado)}\n`);
      process.exit(1);
    }

    const lista = Array.isArray(dado) ? dado : [dado];
    if (lista.length === 0) {
      console.log("\nNenhuma instância no servidor. Rode: node scripts/evolution.mjs criar\n");
      return;
    }

    console.log("\nInstâncias no servidor:\n");
    for (const item of lista) {
      const i = item.instance ?? item;
      const nome = i.instanceName ?? i.name ?? "?";
      const estado = i.connectionStatus ?? i.status ?? i.state ?? "?";
      const marca = nome === INSTANCIA ? " ← a do .env.local" : "";
      const pronto = /open|connected/i.test(estado) ? "✓" : "○";
      console.log(`  ${pronto} ${nome} — ${estado}${marca}`);
    }

    console.log(
      "\n  ✓ = pareada e pronta.  ○ = precisa ler o QR (comando: qr)\n",
    );
  },

  async criar() {
    exigirConfig();

    const { ok, status, dado } = await api("POST", "/instance/create", {
      instanceName: INSTANCIA,
      qrcode: true,
      // v2 exige o tipo de integração; é o Baileys (WhatsApp Web).
      integration: "WHATSAPP-BAILEYS",
    });

    if (!ok) {
      console.error(`\n✗ ${explicar(status, dado)}\n`);
      process.exit(1);
    }

    console.log(`\n✓ Instância "${INSTANCIA}" criada.`);
    console.log("  Agora rode: node scripts/evolution.mjs qr\n");
  },

  async qr() {
    exigirConfig();

    const { ok, status, dado } = await api(
      "GET",
      `/instance/connect/${encodeURIComponent(INSTANCIA)}`,
    );

    if (!ok) {
      console.error(`\n✗ ${explicar(status, dado)}\n`);
      process.exit(1);
    }

    if (dado.pairingCode) {
      console.log(`\n  Código de pareamento: ${dado.pairingCode}`);
      console.log("  WhatsApp → Aparelhos conectados → Conectar com número\n");
    }

    const base64 = (dado.base64 ?? dado.qrcode?.base64 ?? "").replace(
      /^data:image\/\w+;base64,/,
      "",
    );

    if (!base64) {
      console.log(
        "\n  Sem QR na resposta — normalmente significa que já está conectada.",
      );
      console.log("  Confirme com: node scripts/evolution.mjs status\n");
      return;
    }

    const destino = join(raiz, "evolution-qr.png");
    writeFileSync(destino, Buffer.from(base64, "base64"));

    console.log(`\n✓ QR salvo em ${destino}`);
    console.log("  Abra o arquivo e leia no WhatsApp:");
    console.log("  Configurações → Aparelhos conectados → Conectar aparelho");
    console.log("\n  O QR expira em ~40s. Se falhar, rode o comando de novo.\n");
  },

  async grupos() {
    exigirConfig();

    const { ok, status, dado } = await api(
      "GET",
      `/group/fetchAllGroups/${encodeURIComponent(INSTANCIA)}?getParticipants=false`,
    );

    if (!ok) {
      console.error(`\n✗ ${explicar(status, dado)}\n`);
      process.exit(1);
    }

    const lista = Array.isArray(dado) ? dado : (dado.groups ?? []);
    if (lista.length === 0) {
      console.log(
        "\nNenhum grupo. A instância precisa PARTICIPAR do grupo para enviar nele.\n",
      );
      return;
    }

    console.log(`\n${lista.length} grupo(s):\n`);
    for (const g of lista) {
      console.log(`  ${g.subject ?? "(sem nome)"}`);
      console.log(`    ${g.id}`);
    }
    console.log(
      "\n  Use o id (terminado em @g.us) em clients.whatsapp_phone.\n",
    );
  },

  async enviar(destino, ...resto) {
    exigirConfig();

    const texto = resto.join(" ");
    if (!destino || !texto) {
      console.error('\n✗ Uso: node scripts/evolution.mjs enviar <destino> "<texto>"\n');
      process.exit(1);
    }

    const { ok, status, dado } = await api(
      "POST",
      `/message/sendText/${encodeURIComponent(INSTANCIA)}`,
      { number: destino, text: texto, delay: 1200 },
    );

    if (!ok) {
      console.error(`\n✗ ${explicar(status, dado)}\n`);
      process.exit(1);
    }

    console.log(`\n✓ Enviado para ${destino} (id ${dado?.key?.id ?? "?"})\n`);
  },
  /**
   * Espelha os grupos de um usuário na tabela `whatsapp_groups`.
   *
   * POR QUE ISTO NÃO É UMA ROTA. `fetchAllGroups` pede metadados grupo a
   * grupo à Meta: medimos 110 segundos para 231 grupos. A função da
   * Vercel morre em 60s, então a varredura não cabe em requisição
   * nenhuma — nem a do formulário, nem um cron. Aqui não há teto, e o
   * seletor passa a ler a tabela e responder na hora.
   *
   * Rode de novo quando entrar cliente novo. É trabalho de onboarding,
   * não de tempo real.
   */
  async sincronizar(instancia) {
    exigirConfig({ precisaInstancia: false });

    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const servico = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !servico) {
      console.error(
        "\n✗ Faltando em .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY\n",
      );
      process.exit(1);
    }

    if (!instancia) {
      const { dado } = await api("GET", "/instance/fetchInstances");
      const lista = Array.isArray(dado) ? dado : (dado?.instances ?? []);
      const pessoais = lista
        .map((i) => i?.name ?? i?.instance?.instanceName ?? "")
        .filter((n) => n.startsWith("user-"));

      console.log("\nInforme a instância. Pareadas hoje:\n");
      for (const n of pessoais) console.log(`  ${n}`);
      console.log("\n  node scripts/evolution.mjs sincronizar <instancia>\n");
      process.exit(1);
    }

    /* O nome carrega o id do usuário — é assim que `instanceNameFor`
       monta, e é a única ligação entre a instância e a linha da tabela. */
    const userId = instancia.replace(/^user-/, "");
    if (userId === instancia) {
      console.error(
        `\n✗ "${instancia}" não é instância de usuário (esperado user-<uuid>).\n`,
      );
      process.exit(1);
    }

    console.log(
      `\nVarrendo ${instancia}… leva ~2 minutos, é a chamada mais lenta da Evolution.`,
    );

    const resposta = await fetch(
      `${BASE}/group/fetchAllGroups/${encodeURIComponent(instancia)}?getParticipants=false`,
      // 4 minutos: o teto aqui existe só para não pendurar o terminal
      // para sempre. É o dobro do pior tempo medido.
      { headers: { apikey: KEY }, signal: AbortSignal.timeout(240_000) },
    );

    const dado = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      console.error(`\n✗ ${explicar(resposta.status, dado)}\n`);
      process.exit(1);
    }

    const grupos = (Array.isArray(dado) ? dado : (dado.groups ?? []))
      .map((g) => ({
        user_id: userId,
        jid: String(g.id ?? ""),
        name: String(g.subject ?? "").trim() || "(sem nome)",
        updated_at: new Date().toISOString(),
      }))
      .filter((g) => g.jid.endsWith("@g.us"));

    if (grupos.length === 0) {
      console.log("\nNenhum grupo. A instância precisa PARTICIPAR do grupo.\n");
      return;
    }

    /* `resolution=merge-duplicates` faz UPSERT pela chave (user_id, jid):
       grupo renomeado atualiza, grupo novo entra. Não apagamos os que
       sumiram — sair de um grupo não pode zerar o destino já gravado no
       cadastro de um cliente. */
    const gravacao = await fetch(`${url}/rest/v1/whatsapp_groups`, {
      method: "POST",
      headers: {
        apikey: servico,
        Authorization: `Bearer ${servico}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(grupos),
    });

    if (!gravacao.ok) {
      console.error(`\n✗ Supabase recusou: ${await gravacao.text()}\n`);
      process.exit(1);
    }

    console.log(`\n✓ ${grupos.length} grupo(s) no banco. O seletor já lista.\n`);
  },
};

const [comando, ...args] = process.argv.slice(2);
const executar = comandos[comando];

if (!executar) {
  console.log("\nComandos: status | criar | qr | grupos | sincronizar | enviar\n");
  console.log("  node scripts/evolution.mjs status");
  console.log("  node scripts/evolution.mjs criar");
  console.log("  node scripts/evolution.mjs qr");
  console.log("  node scripts/evolution.mjs grupos");
  console.log("  node scripts/evolution.mjs sincronizar <instancia>");
  console.log('  node scripts/evolution.mjs enviar 5548999110022 "Teste"\n');
  process.exit(comando ? 1 : 0);
}

await executar(...args);
