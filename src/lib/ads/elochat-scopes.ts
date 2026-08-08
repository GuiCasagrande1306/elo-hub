/* =====================================================================
   Permissões do EloChat — a parte que os dois lados podem ler
   ---------------------------------------------------------------------
   SEM `server-only`, e é por isso que este arquivo existe separado do
   verificador. O painel do cliente é Client Component e precisa do tipo
   do resultado e dos rótulos das permissões; importá-los de
   `meta-permissions.ts` arrastava o módulo inteiro — com o cliente
   admin do Supabase e a `service_role` junto — para o bundle do
   navegador. O `tsc` não acusa isso; o build do Next acusa.

   Aqui só entra DADO. Nada que toque em rede, token ou banco.
   ===================================================================== */

/**
 * O que o EloChat precisa, em ordem de dependência.
 *
 * As duas primeiras são pré-requisito estrutural: sem `pages_show_list`
 * o app não enxerga a página, e sem ela não chega ao Instagram
 * profissional que está vinculado. As duas últimas são as que fazem o
 * robô ler e responder.
 */
export const ESCOPOS_ELOCHAT = [
  "pages_show_list",
  "instagram_basic",
  "pages_messaging",
  "instagram_manage_messages",
] as const;

/**
 * Sem estas duas não existe automação — só elas leem e respondem direct.
 *
 * `instagram_basic` e `pages_show_list` aparecem como pendência na tela,
 * mas não derrubam sozinhas o `isReadyForEloChat`: na prática a Meta não
 * concede as de mensagem sem as de leitura, então cobrar as quatro no
 * mesmo nível transformaria um problema em quatro.
 */
export const ESCOPOS_CRITICOS = [
  "pages_messaging",
  "instagram_manage_messages",
] as const;

export interface PermissoesMeta {
  /** As duas permissões críticas estão concedidas. */
  isReadyForEloChat: boolean;
  /** Das quatro do EloChat, o que não está concedido. */
  missingPermissions: string[];
  /**
   * Permissões que a pessoa RECUSOU no diálogo, não apenas que faltam.
   *
   * A distinção decide o que o botão precisa fazer: depois de uma recusa
   * a Meta não pergunta de novo num consentimento comum — só com
   * `auth_type=rerequest`. Sem isso o usuário passa pelo fluxo inteiro,
   * volta e nada muda.
   */
  declinedPermissions: string[];
  /** Tudo que o token tem hoje, para diagnóstico. */
  granted: string[];
  /**
   * Falha de rede, token expirado ou conta sem integração.
   *
   * SEPARADO de `missingPermissions` de propósito: "não consegui
   * verificar" e "verifiquei e falta permissão" pedem ações opostas, e
   * juntá-los faria a tela mandar reautorizar por causa de um timeout.
   */
  error: string | null;
  checkedAt: string;
}

/** Nome legível de cada permissão, para a tela não cuspir snake_case. */
export const RÓTULOS_ESCOPO: Record<string, string> = {
  pages_show_list: "Listar as páginas do Facebook",
  instagram_basic: "Ler o perfil do Instagram",
  pages_messaging: "Enviar mensagem pela página",
  instagram_manage_messages: "Responder no direct do Instagram",
};
