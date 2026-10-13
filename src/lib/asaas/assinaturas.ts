import "server-only";

import { asaasGet, type AsaasPage } from "./client";

/* =====================================================================
   Assinaturas ativas do Asaas
   ---------------------------------------------------------------------
   Uma assinatura = um cliente com cobrança recorrente mensal. O Asaas
   gera automaticamente cada boleto/PIX antes do vencimento.

   Precisamos do nome do cliente, que fica em /v3/customers — não vem
   embutido em /v3/subscriptions. Buscamos os dois em paralelo e
   cruzamos pelo customer id.

   PAGINAÇÃO: limit máximo do Asaas é 100. Com 26 assinaturas ativas,
   uma só página chega. Se isso mudar, ampliar com hasMore.
   ===================================================================== */

interface AsaasSubscription {
  id: string;
  customer: string;
  value: number;
  nextDueDate: string;
  cycle: string;
  status: string;
  description: string;
  billingType: string;
}

interface AsaasCustomer {
  id: string;
  name: string;
}

export interface AssinaturaResolvida {
  id: string;
  customerId: string;
  customerName: string;
  valueCents: number;
  nextDueDate: string;
  billingType: string;
  status: string;
}

export async function assinaturasAtivas(): Promise<AssinaturaResolvida[]> {
  const page = await asaasGet<AsaasPage<AsaasSubscription>>(
    "/subscriptions",
    { status: "ACTIVE", limit: "100" },
  );

  if (page.data.length === 0) return [];

  /* Buscar clientes únicos em paralelo. */
  const customerIds = [...new Set(page.data.map((s) => s.customer))];
  const customerMap = new Map<string, string>();

  await Promise.all(
    customerIds.map(async (id) => {
      try {
        const c = await asaasGet<AsaasCustomer>(`/customers/${id}`);
        customerMap.set(id, c.name);
      } catch {
        customerMap.set(id, id);
      }
    }),
  );

  return page.data
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))
    .map((s) => ({
      id: s.id,
      customerId: s.customer,
      customerName: customerMap.get(s.customer) ?? s.customer,
      valueCents: Math.round(s.value * 100),
      nextDueDate: s.nextDueDate,
      billingType: s.billingType,
      status: s.status,
    }));
}

/* Soma em centavos de todas as assinaturas ativas — MRR. */
export function mrrCents(assinaturas: AssinaturaResolvida[]): number {
  return assinaturas.reduce((a, s) => a + s.valueCents, 0);
}
