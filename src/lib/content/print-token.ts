import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/lib/env";

/* =====================================================================
   Token da página que vira PDF
   ---------------------------------------------------------------------
   Mesma mecânica de `lib/reports/print-token.ts`, e a duplicação é
   deliberada: aquele token carrega cliente e período, este carrega o id
   do brief. Generalizar os dois num token de payload livre trocaria
   duas funções pequenas e legíveis por uma genérica que aceita
   qualquer coisa — e um token que aceita qualquer payload é um token
   que autoriza qualquer coisa se alguém errar o chamador.

   Por que existe: o Puppeteer abre uma URL do próprio sistema para
   fotografar o documento, e chega SEM cookie de sessão. Sem o token, o
   proxy responde 307 para /login e o PDF sai com a tela de login
   dentro — falha silenciosa, porque o arquivo é gerado com tamanho
   normal.
   ===================================================================== */

/** Gerar o PDF leva poucos segundos. 5 min é folga, não janela. */
const TTL_SECONDS = 300;

interface Payload {
  briefId: string;
  /** Epoch em segundos. */
  exp: number;
}

function secret(): string {
  // Mesmo segredo do token de impressão do relatório: é a mesma classe
  // de uso (servidor falando com o próprio servidor) e evita mais uma
  // variável de ambiente para alguém esquecer de setar na Vercel.
  const value = serverEnv.cronSecret;
  if (!value) {
    throw new Error(
      "CRON_SECRET é obrigatório para assinar o token de impressão do brief.",
    );
  }
  return value;
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function criarTokenDeImpressao(briefId: string): string {
  const payload: Payload = {
    briefId,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };

  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/**
 * Devolve o id do brief autorizado, ou `null`.
 *
 * O chamador compara esse id com o da rota. Devolver o id em vez de um
 * booleano é o que impede um token válido de um documento abrir outro.
 */
export function verificarTokenDeImpressao(token: string | null): string | null {
  if (!token) return null;

  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const a = Buffer.from(signature);
  const b = Buffer.from(sign(body));

  // Comparação em tempo constante: `===` entre strings vaza, pelo tempo
  // de execução, quantos caracteres iniciais bateram.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload.briefId ?? null;
}
