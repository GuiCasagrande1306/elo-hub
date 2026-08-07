import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/* =====================================================================
   Marca do cliente
   ---------------------------------------------------------------------
   Um componente para as duas telas — sidebar e performance — em vez do
   `<Avatar>` montado à mão em cada uma. Não é economia de linhas: são
   dois detalhes que o avatar padrão erra com logo de cliente, e
   duplicá-los é duplicar a chance de esquecer um.

   1. `object-contain` SOBRE BRANCO, não `object-cover`. Avatar é feito
      para foto de rosto, onde cortar as bordas é inofensivo. Logo vem
      com margem própria e fundo transparente: `cover` decepa o símbolo,
      e sem o branco uma logo preta some no tema escuro. A maioria é
      desenhada para papel.

   2. O FALLBACK MANTÉM A COR DA MARCA. Trocar a bolinha colorida por um
      monograma cinza perderia o que a bolinha fazia bem — distinguir
      contas de relance numa lista. `brand_primary` é derivada do nome e
      já existe para toda conta; o monograma entra sobre ela.
   ===================================================================== */

export function ClientAvatar({
  name,
  logoUrl,
  brandPrimary,
  className,
}: {
  name: string;
  logoUrl: string | null;
  brandPrimary: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-5 shrink-0 rounded-md", className)}>
      {/* `AvatarImage` só monta quando a URL carrega; se o arquivo sumiu
          do Storage, o fallback assume sozinho. */}
      <AvatarImage
        src={logoUrl ?? undefined}
        alt={name}
        className="bg-white object-contain p-px"
      />
      <AvatarFallback
        className="rounded-md text-[9px] font-semibold text-white ring-1 ring-inset ring-black/10 dark:ring-white/10"
        style={{ backgroundColor: brandPrimary ?? "#8a8a8a" }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
