"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* =====================================================================
   O seletor de período do link público
   ---------------------------------------------------------------------
   A única parte interativa de um documento que, no resto, é estático.

   CORES FIXAS, como o resto da folha: esta página é aberta por um
   cliente, fora do Elo Hub, e não deve herdar tema nenhum. Ver a nota
   em `folha-de-rolagem.tsx`.

   ⚠️ O ESTADO MORA NA URL, não aqui dentro. O componente escreve
   `?inicio=&fim=` e deixa o servidor recarregar — o que é mais lento
   que filtrar no cliente, e é o desenho certo assim mesmo:

     • o número tem de vir do servidor de qualquer jeito, porque a
       apuração do período (inclusive as chamadas à Graph API) acontece
       lá;
     • o endereço passa a carregar o período, então o cliente consegue
       salvar ou reenviar exatamente a tela que está vendo;
     • e as travas de data ficam num lugar só, no servidor, em vez de
       duplicadas aqui — duplicadas, a do cliente cederia primeiro.
   ===================================================================== */

export function SeletorDePeriodo({
  inicio,
  fim,
  /** Ontem, no fuso do Brasil. O dia corrente está pela metade. */
  maximo,
}: {
  inicio: string;
  fim: string;
  maximo: string;
}) {
  const router = useRouter();
  const [de, setDe] = useState(inicio);
  const [ate, setAte] = useState(fim);
  const [carregando, setCarregando] = useState(false);

  const invalido = de > ate;

  function aplicar() {
    if (invalido) return;
    setCarregando(true);
    /* `refresh` junto com `push` porque o Next serve a mesma rota de
       cache quando só a query muda, e a página voltaria com os números
       antigos sob as datas novas — o pior desfecho possível aqui. */
    router.push(`?inicio=${de}&fim=${ate}`);
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-[1080px] flex-wrap items-end gap-3 px-16 py-5 print:hidden">
      <div>
        <label
          htmlFor="periodo-de"
          className="block text-[11px] font-medium text-[#64707d]"
        >
          De
        </label>
        <input
          id="periodo-de"
          type="date"
          value={de}
          max={maximo}
          onChange={(e) => setDe(e.target.value)}
          className="mt-1 rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[13px] text-[#111827]"
        />
      </div>

      <div>
        <label
          htmlFor="periodo-ate"
          className="block text-[11px] font-medium text-[#64707d]"
        >
          Até
        </label>
        <input
          id="periodo-ate"
          type="date"
          value={ate}
          max={maximo}
          onChange={(e) => setAte(e.target.value)}
          className="mt-1 rounded-lg border border-[#d8dde3] bg-white px-3 py-2 text-[13px] text-[#111827]"
        />
      </div>

      <button
        type="button"
        onClick={aplicar}
        disabled={invalido || carregando}
        className="rounded-lg bg-[#111827] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40"
      >
        {carregando ? "Carregando…" : "Ver período"}
      </button>

      {invalido && (
        <p className="text-[12px] text-[#b03a2e]">
          A data inicial precisa vir antes da final.
        </p>
      )}
    </div>
  );
}
