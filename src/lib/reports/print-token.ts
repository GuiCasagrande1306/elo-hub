import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/lib/env";

/* =====================================================================
   Token de acesso à página de impressão
   ---------------------------------------------------------------------
   O Puppeteer navega até uma URL DO NOSSO PRÓPRIO SISTEMA para
   fotografar o relatório. Só que ele chega como um visitante anônimo:
   não tem cookie de sessão. Sem tratamento, o proxy responde 307 para
   /login e o PDF sai com a TELA DE LOGIN dentro — falha silenciosa,
   porque o arquivo é gerado, tem o tamanho certo e some no Storage.

   Duas saídas ruins e uma boa:

     ✗ deixar /reports/render público — expõe faturamento e métricas de
       qualquer cliente a quem descobrir o UUID;
     ✗ repassar o cookie de sessão para o Puppeteer — funciona, mas
       amarra a geração a um usuário logado e quebra no cron, que não
       tem sessão nenhuma;
     ✓ token HMAC de vida curta, embutido na URL.

   O token carrega clientId, período e expiração, tudo assinado. Não é
   adivinhável, não serve para outro cliente, e vence em minutos — então
   uma URL vazada num log não vira acesso permanente.
   ===================================================================== */

/** Janela de validade. Geração de PDF leva segundos; 5 min é folga. */
const TTL_SECONDS = 300;

export interface PrintTokenPayload {
  clientId: string;
  periodStart: string;
  periodEnd: string;
  /** Epoch em segundos. */
  exp: number;
}

function secret(): string {
  // Reaproveita o CRON_SECRET: mesma classe de segredo (servidor-para-
  // servidor) e evita mais uma variável para alguém esquecer de setar.
  const value = serverEnv.cronSecret;
  if (!value) {
    throw new Error(
      "CRON_SECRET é obrigatório para assinar o token de impressão do PDF.",
    );
  }
  return value;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createPrintToken(payload: Omit<PrintTokenPayload, "exp">): string {
  const full: PrintTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };

  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export type VerifyResult =
  | { valid: true; payload: PrintTokenPayload }
  | { valid: false; reason: string };

export function verifyPrintToken(token: string | null): VerifyResult {
  if (!token) return { valid: false, reason: "Token ausente." };

  const [body, signature] = token.split(".");
  if (!body || !signature) return { valid: false, reason: "Token malformado." };

  const expected = sign(body);

  // Comparação em tempo constante: `===` em string vaza, pelo tempo de
  // execução, quantos caracteres iniciais bateram — o suficiente para
  // reconstruir a assinatura byte a byte.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, reason: "Assinatura inválida." };
  }

  let payload: PrintTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "Conteúdo ilegível." };
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, reason: "Token expirado." };
  }

  return { valid: true, payload };
}
