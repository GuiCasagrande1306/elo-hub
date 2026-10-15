import "server-only";

import { asaasGet, type AsaasPage } from "./client";

/* =====================================================================
   Extrato da conta Asaas
   ---------------------------------------------------------------------
   Endpoint: GET /financialTransactions
   Devolve movimentações da conta (créditos e débitos), com saldo
   acumulado. Inclui recebimentos de cobranças, tarifas, saques, etc.
   ===================================================================== */

export interface AsaasMovimentacao {
  id: string;
  value: number;           // positivo = crédito, negativo = débito
  balance: number;         // saldo após a movimentação
  type: string;            // PAYMENT_RECEIVED, TRANSFER, FEE, etc.
  description: string;
  date: string;            // "YYYY-MM-DD"
  payment?: {
    id: string;
    customerName: string;
    description: string;
  } | null;
}

export async function extratoAsaas(
  inicio: string, // "YYYY-MM-DD"
  fim: string,    // "YYYY-MM-DD"
): Promise<AsaasMovimentacao[]> {
  const todas: AsaasMovimentacao[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const page = await asaasGet<AsaasPage<AsaasMovimentacao>>(
      "/financialTransactions",
      {
        startDate: inicio,
        finishDate: fim,
        limit: String(limit),
        offset: String(offset),
      },
    );

    todas.push(...page.data);

    if (!page.hasMore) break;
    offset += limit;
  }

  return todas;
}

/* Rótulo legível para os tipos do Asaas */
export const TIPO_ASAAS: Record<string, string> = {
  PAYMENT_RECEIVED:        "Recebimento",
  PAYMENT_RECEIVED_IN_CASH_AND_CREDIT_CARD: "Recebimento (cartão)",
  TRANSFER:                "Transferência",
  CREDIT:                  "Crédito",
  DEBIT:                   "Débito",
  FEE:                     "Tarifa",
  INTERNAL_TRANSFER_DEBIT: "Transferência interna",
  INTERNAL_TRANSFER_CREDIT:"Transferência interna",
  REFUND:                  "Estorno",
  CHARGEBACK:              "Chargeback",
  ANTICIPATED_PAYMENT:     "Antecipação",
  PIX_CREDIT:              "PIX recebido",
  PIX_DEBIT:               "PIX enviado",
  BANK_SLIP_FEE:           "Tarifa de boleto",
  PIX_TRANSACTION_FEE:     "Tarifa PIX",
  CREDIT_CARD_TRANSACTION_FEE: "Tarifa cartão",
};
