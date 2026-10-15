import "server-only";

import { serverEnv } from "@/lib/env";
import {
  evolutionFetch,
  getWhatsAppProvider,
  isGroupJid,
  sendTextMessage,
} from "@/lib/whatsapp";

/* =====================================================================
   Disparo de WhatsApp quando um lead novo chega
   =====================================================================
   Responsabilidade única: formatar a mensagem e chamar o provedor.
   Quem decide SE notifica (verificando lead_notify_phone) é o chamador.

   FALHA SILENCIOSA. O WhatsApp é canal de aviso, não parte do
   fluxo principal: se o envio cair, o lead foi gravado corretamente e
   fica visível no painel. Um erro aqui não pode reverter a inserção.
   ===================================================================== */

export interface DadosDoLead {
  clientName: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  formName?: string | null;
  campaignName?: string | null;
  /** Campos extras do formulário (pares label→valor). */
  extras?: Record<string, string>;
}

export async function notificarNovoLead(
  phone: string,
  lead: DadosDoLead,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const linhas: string[] = [
      `🔔 *Novo lead — ${lead.clientName}*`,
      "",
    ];

    if (lead.contactName) linhas.push(`👤 *Nome:* ${lead.contactName}`);
    if (lead.contactPhone) linhas.push(`📱 *Telefone:* ${formatarTelefone(lead.contactPhone)}`);
    if (lead.contactEmail) linhas.push(`✉️ *E-mail:* ${lead.contactEmail}`);
    if (!lead.contactName && !lead.contactPhone && !lead.contactEmail) {
      linhas.push("⚠️ Não foi possível ler os dados no Meta — confira na Central de Leads.");
    }

    if (lead.formName) linhas.push(`📋 *Formulário:* ${lead.formName}`);
    if (lead.campaignName) linhas.push(`📣 *Campanha:* ${lead.campaignName}`);

    if (lead.extras && Object.keys(lead.extras).length > 0) {
      linhas.push("");
      for (const [label, valor] of Object.entries(lead.extras)) {
        if (valor) linhas.push(`• *${label}:* ${valor}`);
      }
    }

    linhas.push("", `_Via Elo Hub · ${agora()}_`);

    const texto = linhas.join("\n");

    if (serverEnv.whatsappProvider !== "evolution") {
      const resultado = await getWhatsAppProvider().sendText(phone, texto);
      return { ok: resultado.ok, error: resultado.error };
    }

    const instancia = await escolherInstancia(phone);
    if (!instancia) {
      const error = "Nenhum WhatsApp conectado participa deste destino.";
      console.error(`[lead-notify] ${error} (${phone})`);
      return { ok: false, error };
    }

    const envio = await sendTextMessage(phone, texto, instancia);
    if (!envio.success) {
      console.error(`[lead-notify] falha via ${instancia}:`, envio.error);
    }
    return { ok: envio.success, error: envio.error };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "erro desconhecido";
    console.error("[lead-notify] falha ao enviar WhatsApp:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * A agência não tem número próprio: o aviso sai pelo WhatsApp pessoal de
 * quem estiver conectado. Para grupo, só serve instância que participa
 * dele — senão a Evolution recusa com erro genérico.
 */
async function escolherInstancia(destino: string): Promise<string | null> {
  const lista = await evolutionFetch("GET", "instance/fetchInstances");
  if (!lista.success) return null;

  const nomes = (Array.isArray(lista.data) ? lista.data : [lista.data])
    .map((bruto) => {
      const item = (bruto ?? {}) as { name?: string; instanceName?: string; instance?: { name?: string; instanceName?: string } };
      const node = item.instance ?? item;
      return node.name ?? node.instanceName ?? "";
    })
    .filter((n) => n.startsWith("user-"))
    .sort();

  const agencia = serverEnv.whatsappEvolutionInstance;
  const candidatas = agencia ? [agencia, ...nomes.filter((n) => n !== agencia)] : nomes;
  const grupo = isGroupJid(destino);

  for (const nome of candidatas) {
    const estado = await evolutionFetch(
      "GET",
      `instance/connectionState/${encodeURIComponent(nome)}`,
      undefined,
      8_000,
    );
    const d = (estado.data ?? {}) as { state?: string; instance?: { state?: string } };
    if ((d.instance?.state ?? d.state) !== "open") continue;

    if (!grupo) return nome;

    const info = await evolutionFetch(
      "GET",
      `group/findGroupInfos/${encodeURIComponent(nome)}?groupJid=${encodeURIComponent(destino)}`,
      undefined,
      8_000,
    );
    if (info.success) return nome;
  }

  return null;
}

function formatarTelefone(numero: string): string {
  const d = numero.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return numero;
}

function agora(): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}
