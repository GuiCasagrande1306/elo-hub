import { Fragment, type ReactNode } from "react";

import { RichText } from "./rich-text";
import { briefFontVars } from "@/lib/content/fonts";
import { FAIXA_LABEL, type Bloco, type Carimbo } from "@/lib/content/blocks";

import "./brief-document.css";

/* =====================================================================
   O documento
   ---------------------------------------------------------------------
   Componente de servidor puro: recebe dados, devolve marcação. Nenhum
   estado, nenhum evento, nenhum `use client`.

   É deliberado — este mesmo componente renderiza em três lugares e um
   deles é o Puppeteer, que fotografa o HTML servido. Qualquer coisa que
   dependa de hidratação apareceria vazia no PDF, e o arquivo sairia sem
   erro nenhum para denunciar isso.

   AGRUPAMENTO
   ---------------------------------------------------------------------
   A lista de blocos é plana (ver `lib/content/blocks.ts`); o ritmo
   visual do documento vem daqui. Um bloco `secao` abre uma seção e
   tudo que vem depois pertence a ela até o próximo `secao` — é o que
   dá o respiro grande entre assuntos e o respiro pequeno entre um
   roteiro e o seguinte.
   ===================================================================== */

export interface BriefDocumentProps {
  titulo: string;
  /** Pedaço do título que sai na cor de destaque. */
  destaque?: string | null;
  resumo?: string | null;
  carimbos: Carimbo[];
  blocos: Bloco[];
  /**
   * Modo papel: claro sempre, para o PDF e para o Ctrl+P. Ver o
   * cabeçalho de `brief-document.css`.
   */
  papel?: boolean;
}

export function BriefDocument({
  titulo,
  destaque,
  resumo,
  carimbos,
  blocos,
  papel = false,
}: BriefDocumentProps) {
  const { secoes, rodape } = agrupar(blocos);

  return (
    <div
      className={`brief-doc ${papel ? "brief-doc--papel" : ""} ${briefFontVars}`}
    >
      <div className="brief-page">
        <header className="brief-masthead">
          <h1>{comDestaque(titulo, destaque)}</h1>
          {resumo ? (
            <p className="brief-standfirst">
              <RichText>{resumo}</RichText>
            </p>
          ) : null}
          {carimbos.length > 0 ? (
            <p className="brief-stamp">
              {carimbos.map((c) => (
                <span key={`${c.rotulo}-${c.valor}`}>
                  {c.rotulo} <b>{c.valor}</b>
                </span>
              ))}
            </p>
          ) : null}
        </header>

        {secoes.map((secao, i) => (
          <Secao key={i} secao={secao} />
        ))}

        {rodape ? (
          <footer className="brief-end">
            {rodape.itens.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agrupamento                                                         */
/* ------------------------------------------------------------------ */

type BlocoSecao = Extract<Bloco, { tipo: "secao" }>;
type BlocoRodape = Extract<Bloco, { tipo: "rodape" }>;
type BlocoCorpo = Exclude<Bloco, { tipo: "secao" } | { tipo: "rodape" }>;

interface Secao {
  cabecalho: BlocoSecao | null;
  corpo: BlocoCorpo[];
}

function agrupar(blocos: Bloco[]): {
  secoes: Secao[];
  rodape: BlocoRodape | null;
} {
  const secoes: Secao[] = [];
  let rodape: BlocoRodape | null = null;
  /* Seção implícita: um documento pode abrir direto num callout, sem
     cabeçalho. Sem ela, esses blocos não teriam onde entrar e sumiriam
     em silêncio. */
  let atual: Secao = { cabecalho: null, corpo: [] };

  for (const bloco of blocos) {
    if (bloco.tipo === "secao") {
      if (atual.cabecalho || atual.corpo.length > 0) secoes.push(atual);
      atual = { cabecalho: bloco, corpo: [] };
      continue;
    }

    /* O rodapé fecha a página, não uma seção. O último vence: dois
       rodapés num documento é erro de edição, e escolher um evita
       renderizar duas réguas grossas seguidas. */
    if (bloco.tipo === "rodape") {
      rodape = bloco;
      continue;
    }

    atual.corpo.push(bloco);
  }

  if (atual.cabecalho || atual.corpo.length > 0) secoes.push(atual);

  return { secoes, rodape };
}

/** Envolve a primeira ocorrência de `destaque` no título em `<em>`. */
function comDestaque(titulo: string, destaque?: string | null): ReactNode {
  if (!destaque) return titulo;

  const corte = titulo.indexOf(destaque);
  if (corte < 0) return titulo;

  return (
    <>
      {titulo.slice(0, corte)}
      <em>{destaque}</em>
      {titulo.slice(corte + destaque.length)}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Seção                                                               */
/* ------------------------------------------------------------------ */

function Secao({ secao }: { secao: Secao }) {
  const { cabecalho, corpo } = secao;

  return (
    <section className="brief-section">
      {cabecalho ? (
        <>
          <p className="brief-eyebrow">{cabecalho.eyebrow}</p>
          <h2>{cabecalho.titulo}</h2>
          {cabecalho.lede ? (
            <p className="brief-lede">
              <RichText>{cabecalho.lede}</RichText>
            </p>
          ) : null}
          {cabecalho.prosa.length > 0 ? (
            <div className="brief-prose">
              {cabecalho.prosa.map((p, i) => (
                <p key={i}>
                  <RichText>{p}</RichText>
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {agruparRoteiros(corpo).map((grupo, i) =>
        Array.isArray(grupo) ? (
          /* Roteiros seguidos entram num contêiner próprio: entre eles o
             respiro é menor que entre blocos de tipos diferentes, senão
             dez cards soltos parecem dez seções. */
          <div className="brief-roteiros" key={i}>
            {grupo.map((r, j) => (
              <Roteiro bloco={r} key={j} />
            ))}
          </div>
        ) : (
          <Fragment key={i}>
            <BlocoCorpoView bloco={grupo} />
          </Fragment>
        ),
      )}
    </section>
  );
}

type BlocoRoteiro = Extract<Bloco, { tipo: "roteiro" }>;

function agruparRoteiros(
  corpo: BlocoCorpo[],
): Array<BlocoCorpo | BlocoRoteiro[]> {
  const saida: Array<BlocoCorpo | BlocoRoteiro[]> = [];

  for (const bloco of corpo) {
    if (bloco.tipo !== "roteiro") {
      saida.push(bloco);
      continue;
    }

    const ultimo = saida[saida.length - 1];
    if (Array.isArray(ultimo)) ultimo.push(bloco);
    else saida.push([bloco]);
  }

  return saida;
}

/* ------------------------------------------------------------------ */
/* Blocos                                                              */
/* ------------------------------------------------------------------ */

function BlocoCorpoView({ bloco }: { bloco: BlocoCorpo }) {
  switch (bloco.tipo) {
    case "tabela":
      return (
        <div className="brief-scroller">
          <table>
            <thead>
              <tr>
                {bloco.colunas.map((c) => (
                  <th key={c.rotulo} className={c.numerica ? "brief-n" : ""}>
                    {c.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bloco.linhas.map((linha, i) => (
                <tr key={i} className={linha.destaque ? "brief-hit" : ""}>
                  {bloco.colunas.map((coluna, j) => (
                    <td key={j} className={coluna.numerica ? "brief-n" : ""}>
                      {linha.celulas[j] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "colunas":
      return (
        <div className="brief-grid">
          {bloco.colunas.map((coluna, i) => (
            <div key={i} className={`brief-col brief-col--${coluna.tom}`}>
              <h3>{coluna.titulo}</h3>
              <ul>
                {coluna.itens.map((item, j) => (
                  <li key={j}>
                    <RichText>{item}</RichText>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );

    case "callout":
      return (
        <div
          className={`brief-callout ${
            bloco.tom === "alerta" ? "brief-callout--alerta" : ""
          }`}
        >
          <h3>{bloco.titulo}</h3>
          {bloco.paragrafos.map((p, i) => (
            <p key={i}>
              <RichText>{p}</RichText>
            </p>
          ))}
        </div>
      );

    case "formula":
      return (
        <div className="brief-formula">
          {bloco.partes.map((parte, i) => (
            <Fragment key={i}>
              {i > 0 ? <span className="brief-plus">→</span> : null}
              <div className="brief-part">
                <span>{parte.etapa}</span>
                <b>
                  <RichText>{parte.texto}</RichText>
                </b>
              </div>
            </Fragment>
          ))}
        </div>
      );

    case "banco":
      return (
        <ul className="brief-bank">
          {bloco.itens.map((item, i) => (
            <li key={i}>
              <span className="brief-i">{item.numero}</span>
              <span className="brief-h">
                <RichText>{item.gancho}</RichText>
                {item.nota ? <em>{item.nota}</em> : null}
              </span>
            </li>
          ))}
        </ul>
      );

    case "checklist":
      return (
        <ul className="brief-check">
          {bloco.itens.map((item, i) => (
            <li key={i}>
              <RichText>{item}</RichText>
            </li>
          ))}
        </ul>
      );

    case "roteiro":
      return <Roteiro bloco={bloco} />;
  }
}

function Roteiro({ bloco }: { bloco: BlocoRoteiro }) {
  return (
    <article className="brief-roteiro">
      <div className="brief-rail">
        <span className="brief-num">{bloco.numero}</span>
        <span className={`brief-tag brief-tag--${bloco.faixa}`}>
          {FAIXA_LABEL[bloco.faixa]}
        </span>
        {bloco.formato.length > 0 ? (
          <span className="brief-fmt">
            {bloco.formato.map((linha, i) => (
              <Fragment key={i}>
                {i > 0 ? <br /> : null}
                {linha}
              </Fragment>
            ))}
          </span>
        ) : null}
      </div>

      <div className="brief-rbody">
        <h3>{bloco.titulo}</h3>

        <div className="brief-blk">
          <span className="brief-lbl">Gancho</span>
          <p className="brief-hook">
            <RichText>{bloco.gancho}</RichText>
          </p>
        </div>

        <div className="brief-blk">
          <span className="brief-lbl">Desenvolvimento</span>
          {bloco.desenvolvimento.map((p, i) => (
            <p key={i}>
              <RichText>{p}</RichText>
            </p>
          ))}
        </div>

        <div className="brief-blk">
          <span className="brief-lbl">CTA</span>
          <p>
            <RichText>{bloco.cta}</RichText>
          </p>
        </div>

        {bloco.legenda.length > 0 ? (
          <div className="brief-blk brief-blk--legenda">
            <span className="brief-lbl">Legenda</span>
            {bloco.legenda.map((linha, i) => (
              <p key={i}>
                <RichText>{linha}</RichText>
              </p>
            ))}
          </div>
        ) : null}

        {bloco.direcao ? (
          <div className="brief-blk brief-blk--dir">
            <span className="brief-lbl">Direção</span>
            <p>
              <RichText>{bloco.direcao}</RichText>
            </p>
          </div>
        ) : null}
      </div>
    </article>
  );
}
