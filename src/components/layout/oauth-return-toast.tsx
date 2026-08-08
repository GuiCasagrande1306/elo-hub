"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

/* =====================================================================
   O aviso da volta do consentimento
   ---------------------------------------------------------------------
   Os callbacks de OAuth sempre devolveram o resultado na URL — `?meta=
   conectado`, `?instagram_erro=<motivo>` — e NADA lia isso. A pessoa
   autorizava no Facebook ou no Instagram, voltava para a tela do cliente
   e não via sinal nenhum. Quando falhava, o motivo ficava escrito na
   barra de endereço, onde ninguém olha.

   Num piloto isso é o pior defeito possível: o teste "não funcionou" sem
   nenhuma pista de por quê, e o diagnóstico está a um scroll horizontal
   de distância.

   MORA NO LAYOUT, não na página do cliente: o `returnTo` do consentimento
   pode apontar para qualquer tela, e o callback de erro cai em
   `/clientes`. Uma cópia por página deixaria justamente o caminho de
   falha sem aviso.
   ===================================================================== */

/** Chave na URL → como anunciar. `null` = usa o valor como mensagem. */
const SUCESSOS: Record<string, string> = {
  meta: "Meta Ads conectado.",
  instagram: "Instagram conectado.",
};

const ERROS = ["meta_erro", "instagram_erro", "oauth_erro"];

export function OAuthReturnToast() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  /* O efeito roda duas vezes no StrictMode em desenvolvimento, e a
     limpeza da URL só chega no ciclo seguinte — sem esta trava o aviso
     aparece em dobro. `ref` e não estado: nada aqui precisa
     rerrenderizar. */
  const jaAvisou = useRef(false);

  useEffect(() => {
    if (jaAvisou.current) return;

    const erroChave = ERROS.find((k) => params.get(k));
    const sucessoChave = Object.keys(SUCESSOS).find((k) => params.get(k));

    if (!erroChave && !sucessoChave) return;

    jaAvisou.current = true;

    if (erroChave) {
      toast.error("A conexão não foi concluída.", {
        description: params.get(erroChave) ?? undefined,
        /* Sem fechar sozinho: é a única cópia do motivo que existe, e um
           erro de OAuth costuma precisar ser lido com calma — ou copiado
           para alguém. */
        duration: Infinity,
        closeButton: true,
      });
    } else if (sucessoChave) {
      const valor = params.get(sucessoChave) ?? "";
      /* O callback do Instagram devolve `conectado:<usuario>` quando
         conseguiu ler o perfil. Mostrar o @ é o que prova que conectou a
         conta CERTA — num piloto com várias contas, é a diferença entre
         "funcionou" e "funcionou no perfil que eu queria". */
      const usuario = valor.startsWith("conectado:") ? valor.slice(10) : null;

      toast.success(SUCESSOS[sucessoChave], {
        description: usuario ? `Perfil @${usuario}` : undefined,
      });
    }

    /* Limpa os parâmetros: recarregar a página não pode repetir o aviso,
       e um link copiado daqui não deve carregar "conectado" junto. */
    const limpo = new URLSearchParams(params.toString());
    for (const k of [...ERROS, ...Object.keys(SUCESSOS)]) limpo.delete(k);
    const query = limpo.toString();

    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [params, pathname, router]);

  return null;
}
