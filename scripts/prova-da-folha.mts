/* Gera a folha com um payload sintético e MEDE o resultado.
   A pergunta é uma só: a altura da página bate com o plano, e sobra
   branco no fim? */
import { writeFileSync } from "node:fs";

/* Import dinâmico nos dois, na MESMA ordem de `pdf/render.ts`. Com um
   estático e um dinâmico, o tsx resolve `@react-pdf/renderer` em duas
   instâncias e o `Font.register` da folha não é visto por quem
   renderiza — o erro que sai é "Font family not registered: Geist",
   que manda procurar a fonte em vez do carregamento. */
const [{ renderToBuffer }, { FolhaDoRelatorio }, { createElement }, { planoDoRelatorio }] =
  await Promise.all([
    import("@react-pdf/renderer"),
    import("../src/lib/reports/pdf/folha"),
    import("react"),
    import("../src/lib/reports/pdf/plano"),
  ]);

const kpi = (key: string, label: string, formatted: string, prev: string | null, delta: number | null, sentiment = "positive") =>
  ({ key, label, formatted, previousFormatted: prev, deltaPercent: delta, sentiment, indefinido: false }) as never;

const payload = {
  meta: { generatedAt: "2026-10-02", periodStart: "2026-09-01", periodEnd: "2026-09-30", days: 30, templateName: "Leads", accent: "#1877F2" },
  agency: { name: "Elo Marketing", brandPrimary: "#1877F2", logoUrl: null },
  client: { id: "c1", name: "Flora Natural", segment: "food", brandPrimary: "#8DC63F", logoUrl: null, website: null },
  creativesDoPeriodo: true,
  kpis: [],
  highlight: null,
  trend: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, spend: 60 + Math.round(Math.sin(i / 3) * 30 + i) })),
  platforms: [],
  platformDetail: [
    {
      platform: "meta_ads", label: "Meta Ads", spendShare: 0.65,
      kpis: [
        kpi("spend", "Valor investido", "R$2.618,05", "R$1.885,45", 38.86),
        kpi("reach", "Alcance Total", "182.428", "195.935", -6.89, "negative"),
        kpi("impressions", "Impressões Totais", "448.724", "404.100", 11.04),
        kpi("linkClicks", "Cliques no link", "4.174", "3.999", 4.38),
        kpi("clicks", "Total de Cliques", "6.011", "5.688", 5.68),
        kpi("results", "Conversas iniciadas", "22", "18", 22.2),
      ],
      campaigns: [
        { name: "02 | RECONHECIMENTO | 20.04", spendCents: 104692, results: 109873, cpaCents: 953 },
        { name: "01 | ENGAJAMENTO INSTAGRAM | 20.04 com nome bem longo para testar o truncamento", spendCents: 157113, results: 39497, cpaCents: 4 },
      ],
    },
    {
      platform: "google_ads", label: "Google Ads", spendShare: 0.35,
      kpis: [
        kpi("spend", "Custo", "R$1.394,83", "R$2.658,15", -47.53, "negative"),
        kpi("impressions", "Impressões", "40.880", "68.963", -40.72, "negative"),
        kpi("clicks", "Cliques", "383", "1.536", -75.07, "negative"),
        kpi("ctr", "CTR", "0,94%", "2,23%", -57.94, "negative"),
        kpi("results", "Conversões", "136", "781", -82.59, "negative"),
      ],
      campaigns: [{ name: "Campanha 01 - Pmax visita no restaurante", spendCents: 139483, results: 136, cpaCents: 1026 }],
    },
  ],
  creatives: [
    { id: "a1", platform: "meta_ads", platformLabel: "Meta", campaignName: "02", adName: "02 | INFLUENCER", headline: null, primaryText: "Conheça o nosso almoço executivo", imageUrl: null, imageIsRaster: false, spendCents: 27890, results: 97235, cpaCents: 287, ctr: 0, clicks: 799 },
    { id: "a2", platform: "meta_ads", platformLabel: "Meta", campaignName: "03", adName: "03 | 23.06", headline: null, primaryText: "Café colonial aos domingos", imageUrl: null, imageIsRaster: false, spendCents: 1152, results: 6477, cpaCents: 178, ctr: 0, clicks: 27 },
  ],
  sections: [], insights: "", nextSteps: [],
} as never;

/* O arnês registra a fonte na SUA instância do react-pdf. Sob o tsx a
   resolução do pacote difere da do Next, e sem isto o render falha com
   "Font family not registered" — artefato do script, não do produto. */
const { Font } = await import("@react-pdf/renderer");
const { join } = await import("node:path");
const dir = join(process.cwd(), "src/assets/fonts");
Font.register({
  family: "Geist",
  fonts: [
    { src: join(dir, "Geist-Regular.ttf"), fontWeight: 400 },
    { src: join(dir, "Geist-Bold.ttf"), fontWeight: 700 },
  ],
});

const plano = planoDoRelatorio(payload);
const buf = await renderToBuffer(createElement(FolhaDoRelatorio, { payload }) as never);
writeFileSync("/tmp/folha.pdf", buf);

const txt = Buffer.from(buf).toString("latin1");
const boxes = [...txt.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
  .map((m) => ({ w: Math.round(+m[3]), h: Math.round(+m[4]) }));

console.log("plano calculou altura:", plano.altura);
console.log("blocos:", plano.blocos.map((b) => `${b.tipo}:${b.altura}`).join(" · "));
console.log("PDF saiu com:", JSON.stringify(boxes));
console.log("páginas:", boxes.length);
console.log(boxes.length === 1 && boxes[0].h === plano.altura
  ? "✓ UMA página, altura exatamente igual ao plano"
  : "✗ DIVERGIU");
