import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/* =====================================================================
   Rosto de quem trabalha
   ---------------------------------------------------------------------
   O par de `ClientAvatar`, para pessoas em vez de contas. Existe pelo
   mesmo motivo: a foto aparecia só na barra lateral, montada à mão, e
   todo o resto do sistema mostrava monograma — inclusive a coluna de
   responsável das tarefas, que é onde mais importa distinguir quem é
   quem de relance.

   DIFERENÇAS EM RELAÇÃO AO `ClientAvatar`, e o porquê de cada uma:

   1. `object-cover`, não `object-contain` sobre branco. Aqui é foto de
      rosto: cortar as bordas centraliza o que interessa. Logo de cliente
      precisa do inverso, e por isso são dois componentes.

   2. Redondo, não arredondado. Convenção de interface que separa pessoa
      de organização sem precisar de rótulo.

   3. O fallback é CINZA e continua sendo o monograma. Tingi-lo com uma
      cor derivada do nome seria bonito e enganoso: sugeriria uma
      identidade que a pessoa não escolheu, e brigaria com a foto de quem
      já tem uma — metade da lista colorida, metade não.

   `AvatarImage` do Base UI só monta depois que a imagem CARREGA. Então
   perfil sem foto, URL quebrada ou arquivo apagado do Storage caem todos
   no monograma sozinhos, sem `onError` à mão.
   ===================================================================== */

export function PersonAvatar({
  name,
  avatarUrl,
  className,
  fallbackClassName,
}: {
  name: string;
  avatarUrl?: string | null;
  /** Tamanho e anel ficam com quem chama — cada lista tem a sua métrica. */
  className?: string;
  fallbackClassName?: string;
}) {
  return (
    <Avatar
      title={name}
      className={cn(
        /* `after:` some: aquele contorno serve ao avatar solto de 32px e
           vira sujeira em cima do `ring` das listas sobrepostas. */
        "size-6 after:hidden",
        className,
      )}
    >
      <AvatarImage src={avatarUrl ?? undefined} alt={name} />
      <AvatarFallback
        className={cn(
          "bg-surface-2 text-[9px] font-semibold text-foreground",
          fallbackClassName,
        )}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
