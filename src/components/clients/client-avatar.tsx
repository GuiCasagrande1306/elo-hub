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

   1. `object-contain`, e SEM a chapa branca que havia aqui.

      O comentário anterior justificava o `bg-white` dizendo que "logo
      vem com fundo transparente" e que "a maioria é desenhada para
      papel". MEDIDO nos 42 logos cadastrados em 19/08/2026: nenhum tem
      canal alfa e todos são quadrados — 150×150 na maioria, alguns
      maiores. São FOTOS DE PERFIL de rede social, não logotipos
      vetoriais.

      Com imagem opaca, a chapa branca nunca aparece por baixo — ela só
      aparecia por FORA, como uma borda clara em volta de um logo
      redondo, sobre a barra escura. Era isso que se via.

      `contain` continua, e não `cover`: para os 42 quadrados os dois são
      idênticos (a imagem preenche exato), e se um dia entrar um logo
      deitado, `contain` o mostra inteiro enquanto `cover` o decepa no
      meio.

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
    /* `after:rounded-[inherit]` acerta o ANEL, e o `inherit` é o ponto.

       O primitivo desenha um `::after` com `rounded-full` — ele nasceu
       para avatar redondo de pessoa. Sobre um tile quadrado, isso vira
       um arco claro cortando os quatro cantos: era o anel branco em
       volta do logo.

       Um valor FIXO aqui não resolve: a barra lateral chama com
       `rounded-[5px]` e outras telas com outros raios, então
       `after:rounded-md` deixaria o anel em 10px dentro de um tile de
       5px — medido, e ainda parecia círculo. Com `inherit`, anel e
       imagem seguem o raio de quem chama, qualquer que seja.

       `overflow-hidden` porque a imagem precisa ser recortada pelo mesmo
       raio do tile. */
    <Avatar
      className={cn(
        "size-5 shrink-0 overflow-hidden rounded-md after:rounded-[inherit]",
        className,
      )}
    >
      {/* `AvatarImage` só monta quando a URL carrega; se o arquivo sumiu
          do Storage, o fallback assume sozinho.

          `rounded-[inherit]` no lugar do `rounded-full` que o primitivo
          aplica: sem isto a imagem é recortada em círculo dentro de um
          tile quadrado, e sobra a cor do tile nos cantos. */}
      <AvatarImage
        src={logoUrl ?? undefined}
        alt={name}
        className="rounded-[inherit] object-contain"
      />
      <AvatarFallback
        className="rounded-[inherit] text-[9px] font-semibold text-white ring-1 ring-inset ring-black/10 dark:ring-white/10"
        style={{ backgroundColor: brandPrimary ?? "#8a8a8a" }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
