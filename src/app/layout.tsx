import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Elo Hub",
    template: "%s · Elo Hub",
  },
  description:
    "Sistema de gestão da agência: performance de mídia paga, operação e relatórios.",
  applicationName: "Elo Hub",

  /**
   * Tags de PWA para iOS.
   *
   * O Safari ignora boa parte do manifest e usa estas meta tags no
   * lugar. `capable: true` gera `apple-mobile-web-app-capable=yes`, que
   * é o que remove a barra do Safari quando o app é adicionado à tela
   * de início. Sem isso, no iPhone o "app instalado" abre como uma aba
   * comum e a Bottom Navigation briga com a barra do navegador.
   *
   * `statusBarStyle: "default"` mantém o texto da barra de status legível
   * sobre o fundo escuro do app.
   *
   * O `<link rel="apple-touch-icon">` não é escrito à mão: o arquivo
   * `src/app/apple-icon.png` é uma convenção de metadados do Next e a
   * tag entra no <head> automaticamente, no tamanho certo.
   */
  appleWebApp: {
    capable: true,
    title: "Elo Hub",
    statusBarStyle: "default",
  },

  // Painel interno: fora do índice de busca.
  robots: { index: false, follow: false },

  formatDetection: {
    // Impede o iOS de transformar CNPJ e valores em links de telefone.
    telephone: false,
  },

  other: {
    /**
     * `appleWebApp.capable` acima faz o Next emitir
     * `<meta name="mobile-web-app-capable">` — o nome PADRONIZADO, que
     * substituiu o prefixado da Apple e é o que iOS 16.4+ lê.
     *
     * Mantemos também a forma legada para cobrir iPhones em iOS 15 ou
     * anterior, onde só ela existe. O custo é um aviso de depreciação no
     * console do Chrome; o benefício é o app instalar em tela cheia num
     * aparelho antigo em vez de abrir como aba comum do Safari.
     * Quando não houver mais iOS 15 na equipe, esta linha pode sair.
     */
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a18" },
  ],
  // `viewport-fit=cover` é pré-requisito para `env(safe-area-inset-*)`
  // funcionar. Sem ele, a Bottom Navigation fica embaixo do indicador
  // de home do iPhone e os toques não chegam.
  viewportFit: "cover",
  // Zoom liberado de propósito: bloquear pinch-to-zoom é uma barreira
  // de acessibilidade, e o layout já é legível sem ele.
  initialScale: 1,
  width: "device-width",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <ServiceWorkerRegistrar />
          <Toaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
