import { cn } from "@/lib/utils";

/**
 * Cabeçalho padrão das páginas internas.
 *
 * Existe para que título, subtítulo e ações tenham SEMPRE o mesmo ritmo
 * vertical. Espaçamento inconsistente entre telas é o que mais denuncia
 * interface montada às pressas.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/** Container de página com largura máxima e respiro consistentes. */
export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8",
        className,
      )}
    >
      {children}
    </div>
  );
}
