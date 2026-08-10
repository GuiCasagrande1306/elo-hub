"use client";

import { Printer, X } from "lucide-react";

/* =====================================================================
   Barra de ações da página de impressão
   ---------------------------------------------------------------------
   `print:hidden` é o ponto inteiro: ela existe na tela para quem está
   revisando e SOME do papel. Sem isso, dois botões apareceriam
   impressos na capa do relatório que vai para o cliente.

   Fica fora da folha A4 (posicionada em `fixed`), então não empurra o
   conteúdo nem desloca a paginação — a folha continua com exatamente
   210×297mm e o Chrome não insere uma página extra.

   Componente de cliente porque `window.print()` é do navegador. É a
   única ilha interativa desta rota; o resto é renderizado no servidor.
   ===================================================================== */

export function PrintToolbar() {
  return (
    <div className="fixed right-4 top-4 z-50 flex items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={() => window.close()}
        className="flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-2 text-xs font-medium text-slate-700 shadow-lg ring-1 ring-slate-900/10 backdrop-blur transition-colors hover:bg-white"
      >
        <X className="size-3.5" />
        Fechar
      </button>

      <button
        type="button"
        onClick={() => window.print()}
        className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-lg transition-colors hover:bg-slate-800"
      >
        <Printer className="size-3.5" />
        Salvar PDF
      </button>
    </div>
  );
}
