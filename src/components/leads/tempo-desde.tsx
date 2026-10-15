"use client";

import { useCallback, useSyncExternalStore } from "react";

import { dataNoBrasil } from "@/lib/date-br";

/* =====================================================================
   Há quanto tempo esse lead está esperando
   ---------------------------------------------------------------------
   O NÚMERO MAIS IMPORTANTE DA TELA para um lead que acabou de chegar.
   Quem responde em minutos fala com a pessoa; quem responde no dia
   seguinte fala com quem já foi atendido pelo concorrente. Um funil que
   não mostra a espera esconde justamente o defeito que ele existiria
   para expor.

   ⚠️ POR QUE DOIS FORMATOS, e não um só. "há 40 min" muda a cada
   minuto, então servidor e cliente renderizariam textos diferentes e o
   React acusaria divergência de hidratação em toda carga. A saída aqui
   é conhecida e barata:

     • o primeiro render — o do servidor e o da hidratação — usa a
       granularidade de DIA, ancorada ao meio-dia de Brasília. É
       determinística: dois processos calculam o mesmo texto.
     • depois de montar, o componente troca pela versão precisa, em
       minutos e horas, e passa a atualizar sozinho.

   O primeiro quadro bate exatamente, então não há aviso nem piscada de
   conteúdo — só um refinamento imperceptível.

   ⚠️ QUEM FAZ ISSO É `useSyncExternalStore`, e não um `useEffect` com
   `setState`. O relógio é um sistema externo, que é exatamente o caso
   para o qual este hook existe: `getServerSnapshot` devolve a versão em
   dias para o HTML e para a hidratação, `getSnapshot` devolve a precisa
   depois, e `subscribe` cuida do intervalo. Escrito com effect, o mesmo
   comportamento dispara `react-hooks/set-state-in-effect` — e a regra
   está certa: seria uma renderização em cascata por cartão, e um quadro
   tem centenas deles.
   ===================================================================== */

/* ⚠️ O COMPONENTE DEVOLVE SÓ A DURAÇÃO — "9h", "3 dias", "40 min" — e
   nunca a preposição. Quem chama escreve o "há".

   Não é preciosismo: a primeira versão devolvia frases prontas ("ontem",
   "há 9h") e o cartão as concatenava com um prefixo fixo. O resultado
   passava por "esperando desde ontem" e batia em "esperando desde há
   9h". Com a duração pura, toda combinação fecha em português —
   "esperando há 9h", "criado há 3 dias", "chegou há 40 min" — e um
   chamador novo não precisa saber quais frases o componente pode
   produzir. */

/** Granularidade de dia. Determinística: serve para o render do servidor. */
function emDias(iso: string): string {
  const hoje = dataNoBrasil();
  const quando = dataNoBrasil(iso);

  const dias = Math.round(
    (Date.parse(`${hoje}T12:00:00-03:00`) -
      Date.parse(`${quando}T12:00:00-03:00`)) /
      86_400_000,
  );

  /* "menos de 1 dia" e não "hoje": o servidor não sabe se foram vinte
     minutos ou vinte horas, e o cliente refina em seguida. "hoje" seria
     lido como precisão que não existe — e depois de "há" nem frase é. */
  if (dias <= 0) return "menos de 1 dia";
  if (dias === 1) return "1 dia";
  if (dias < 7) return `${dias} dias`;
  if (dias < 30) return `${Math.floor(dias / 7)} sem`;

  const meses = Math.floor(dias / 30);
  return meses === 1 ? "1 mês" : `${meses} meses`;
}

/** Granularidade fina. Só depois de montar — depende do relógio local. */
function preciso(iso: string): string {
  const minutos = Math.floor((Date.now() - Date.parse(iso)) / 60_000);

  if (minutos < 1) return "instantes";
  if (minutos < 60) return `${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas}h`;

  return emDias(iso);
}

/**
 * Quão urgente é essa espera.
 *
 * Os cortes não são redondos por acaso: uma hora é o limite clássico em
 * que a chance de contato ainda é alta, e um dia é onde ela desaba. Só
 * vale para lead que ainda não foi trabalhado — por isso `ativo`.
 */
export function tomDaEspera(iso: string, ativo: boolean): "quente" | "morno" | "frio" | "neutro" {
  if (!ativo) return "neutro";

  const horas = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (horas < 1) return "quente";
  if (horas < 24) return "morno";
  return "frio";
}

export function TempoDesde({ iso, className }: { iso: string; className?: string }) {
  /* Um minuto. Mais frequente não muda o texto; menos deixaria "há 3
     min" parado na tela enquanto alguém decide se liga agora. */
  const subscribe = useCallback((aoMudar: () => void) => {
    const id = setInterval(aoMudar, 60_000);
    return () => clearInterval(id);
  }, []);

  /* `getSnapshot` DEVOLVE STRING, e isso é o que torna o hook seguro
     aqui: o React compara os retornos com `Object.is` e uma string igual
     é igual. Se devolvesse um objeto novo a cada chamada, o React
     entraria em laço acusando "getSnapshot should be cached". */
  const texto = useSyncExternalStore(
    subscribe,
    () => preciso(iso),
    () => emDias(iso),
  );

  return (
    <time dateTime={iso} className={className}>
      {texto}
    </time>
  );
}
