import type { MetadataRoute } from "next";

/**
 * Web App Manifest.
 *
 * Rota de metadados nativa do Next (`app/manifest.ts`) em vez de um
 * `public/manifest.json` estático: assim o arquivo é tipado, o
 * `<link rel="manifest">` entra no <head> sozinho e não há um segundo
 * lugar para o nome do app divergir.
 *
 * `theme_color` é o mesmo `--background` do tema escuro (#0d1826). Ele
 * pinta a barra de status no Android e a barra de título quando o app
 * roda instalado — usar a cor de destaque aqui criaria uma faixa verde
 * que não existe em lugar nenhum da interface.
 *
 * Os ícones vêm da marca oficial (traçada do site, mesmas cores). O
 * `maskable` é um arquivo À PARTE, com a marca a 72%: o Android recorta
 * um círculo de ~80% do quadrado, e reaproveitar o ícone normal cortaria
 * as pontas das formas.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Elo Hub — Gestão da agência",
    short_name: "Elo Hub",
    description:
      "Performance de mídia paga, operação de tarefas e relatórios da Elo Marketing.",

    start_url: "/",
    // `standalone` remove a barra de endereço: instalado, parece app.
    display: "standalone",
    orientation: "portrait-primary",

    background_color: "#0d1826",
    theme_color: "#0d1826",

    lang: "pt-BR",
    dir: "ltr",
    categories: ["business", "productivity"],

    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // O Android recorta o ícone no formato do launcher. Sem uma
        // versão `maskable`, o sistema aplica o recorte no ícone `any`
        // e come as bordas do desenho.
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],

    // Atalhos de toque longo no ícone (Android e iOS 16.4+).
    shortcuts: [
      {
        name: "Tarefas",
        short_name: "Tarefas",
        url: "/tarefas",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Clientes",
        short_name: "Clientes",
        url: "/clientes",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
