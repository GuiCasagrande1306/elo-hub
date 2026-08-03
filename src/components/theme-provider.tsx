"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * next-themes injeta um script inline antes da hidratação que aplica a
 * classe `dark` no <html>. É isso que evita o flash branco ao carregar
 * no escuro — daí o `suppressHydrationWarning` no layout raiz.
 */
export function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
