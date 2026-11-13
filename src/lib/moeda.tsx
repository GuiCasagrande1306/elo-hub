"use client";

import { createContext, useContext } from "react";

/* Moeda das contas de anúncio do cliente em tela (ISO 4217).
   Contexto e não prop: a página do cliente formata dinheiro em uma dúzia
   de componentes aninhados (gráfico, metas, tabela de anúncios), e todos
   descendem de `ClientDashboard`. Fora de um provider vale "BRL", o que
   mantém intactas as telas da agência inteira. */
const MoedaContext = createContext("BRL");

export const MoedaProvider = MoedaContext.Provider;

export function useMoeda(): string {
  return useContext(MoedaContext);
}
