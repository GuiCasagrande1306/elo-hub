/* =====================================================================
   Permissões do EloChat — a parte que os dois lados podem ler
   ---------------------------------------------------------------------
   SEM `server-only`, e é por isso que este arquivo existe separado do
   verificador. O painel do cliente é Client Component e precisa do tipo
   do resultado e dos rótulos das permissões; importá-los do módulo do
   servidor arrastava o cliente admin do Supabase — com a `service_role`
   junto — para o bundle do navegador. O `tsc` não acusa isso; o build
   do Next acusa.

   ⚠️ ESTES NOMES SÃO OS DO **INSTAGRAM LOGIN**, e não os do Facebook
   Login. A Meta tem dois caminhos para automação de direct, com nomes
   de permissão parecidos e incompatíveis:

     Instagram Login   instagram_business_basic
     (este)            instagram_business_manage_messages
                       instagram_business_manage_comments
                       login em instagram.com · API em graph.instagram.com

     Facebook Login    instagram_basic · instagram_manage_messages
                       pages_show_list · pages_messaging
                       login em facebook.com · API em graph.facebook.com

   Verificar um caminho com os nomes do outro devolve "faltam
   permissões" para sempre, mesmo com tudo configurado certo — e o erro
   não aparece em lugar nenhum, porque a lista simplesmente não casa.
   ===================================================================== */

/**
 * O que o EloChat pede no consentimento.
 *
 * `basic` é pré-requisito estrutural — sem ele não se lê nem o @ do
 * perfil. `manage_messages` responde no direct. `manage_comments` lê o
 * comentário que dispara o fluxo, e sem ela o gatilho "comentou no Reel"
 * não existe.
 */
export const ESCOPOS_ELOCHAT = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
] as const;

/**
 * Sem esta não existe automação — é ela que responde no direct.
 *
 * `manage_comments` fica de fora do corte crítico porque um fluxo com
 * gatilho de palavra-chave no direct funciona sem ela; só os gatilhos de
 * comentário param. Cobrar as três no mesmo nível transformaria um
 * problema em três.
 */
export const ESCOPOS_CRITICOS = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
] as const;

export interface PermissoesInstagram {
  /** Existe conexão gravada para este cliente. */
  conectado: boolean;
  /** As permissões críticas estão concedidas E o token responde. */
  isReadyForEloChat: boolean;
  /** Das três do EloChat, o que a Meta não concedeu. */
  missingPermissions: string[];
  /** Tudo que a Meta concedeu, como ela mesma devolveu. */
  granted: string[];
  /** @ do perfil conectado, quando há. */
  username: string | null;
  /** Vencimento do token longo — ~60 dias, renovável. */
  expiresAt: string | null;
  /**
   * Falha de rede, token revogado ou conta sem conexão.
   *
   * SEPARADO de `missingPermissions` de propósito: "não consegui
   * verificar" e "verifiquei e falta permissão" pedem ações opostas, e
   * juntá-los faria a tela mandar reconectar por causa de um timeout.
   */
  error: string | null;
  checkedAt: string;
}

/** Nome legível de cada permissão, para a tela não cuspir snake_case. */
export const RÓTULOS_ESCOPO: Record<string, string> = {
  instagram_business_basic: "Ler o perfil do Instagram",
  instagram_business_manage_messages: "Responder no direct",
  instagram_business_manage_comments: "Ler e responder comentários",
};
