"use client";

import { ChevronLeft, Heart, ImageIcon, Mic, Phone, Video } from "lucide-react";

import type { DadosDoNo } from "./blocks";

/* =====================================================================
   Prévia do Instagram Direct
   ---------------------------------------------------------------------
   ESCURO SEMPRE, inclusive quando o Elo Hub está no tema claro — e isso
   é regra, não descuido. O quadro não é interface deste sistema: é a
   captura de OUTRO aplicativo. Fazê-lo acompanhar o tema do painel
   entregaria uma prévia que não se parece com o que o contato vai ver,
   que é a única coisa que a prévia precisa acertar. Por isso as cores
   aqui são valores fixos e não tokens.

   O que ela mostra e o que NÃO mostra: o balão do robô, os botões
   colados nele e os cartões do carrossel. Não simula digitação, entrega,
   visualização nem a resposta do contato — inventar esses estados daria
   confiança falsa numa tela que ainda não manda mensagem nenhuma.
   ===================================================================== */

const FUNDO = "#000000";
const BALAO_ROBO = "#262626";
const BORDA = "#262626";
const TEXTO = "#f5f5f5";
const TEXTO_FRACO = "#a8a8a8";

export function InstagramPreview({
  dados,
  perfil = "sua_conta",
}: {
  dados: DadosDoNo;
  perfil?: string;
}) {
  const temBotoes = dados.botoes.length > 0;
  const temCartoes = dados.cartoes.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs text-muted-foreground">
        Como o contato vê no direct
      </p>

      <div
        className="overflow-hidden rounded-[22px] p-1.5 ring-1 ring-hairline"
        style={{ backgroundColor: "#101010" }}
      >
        <div
          className="flex h-[330px] flex-col overflow-hidden rounded-[17px]"
          style={{ backgroundColor: FUNDO, color: TEXTO }}
        >
          {/* --------------------- Barra do topo -------------------- */}
          <div
            className="flex shrink-0 items-center gap-2 border-b px-2.5 py-2"
            style={{ borderColor: BORDA }}
          >
            <ChevronLeft className="size-4 shrink-0" strokeWidth={2.2} />

            {/* Anel do story: o gradiente é a assinatura visual do
                Instagram e é o que faz o quadro ser reconhecido de
                relance como direct, e não como um chat qualquer. */}
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-full p-[1.5px]"
              style={{
                background:
                  "linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)",
              }}
            >
              <span
                className="flex size-full items-center justify-center rounded-full text-[9px] font-semibold"
                style={{ backgroundColor: "#3a3a3a" }}
              >
                {perfil.slice(0, 2).toUpperCase()}
              </span>
            </span>

            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[11px] font-semibold">{perfil}</p>
              <p className="text-[9px]" style={{ color: TEXTO_FRACO }}>
                Instagram
              </p>
            </div>

            <Phone className="size-3.5 shrink-0" style={{ color: TEXTO_FRACO }} />
            <Video className="size-3.5 shrink-0" style={{ color: TEXTO_FRACO }} />
          </div>

          {/* ---------------------- Conversa ------------------------ */}
          <div className="flex flex-1 flex-col justify-end gap-1.5 overflow-y-auto p-2.5">
            {dados.texto.trim() === "" && !temCartoes ? (
              <p
                className="self-center text-center text-[10px] leading-relaxed"
                style={{ color: TEXTO_FRACO }}
              >
                Escreva a mensagem ao lado
                <br />
                para ver a prévia aqui.
              </p>
            ) : (
              <>
                {dados.texto.trim() !== "" && (
                  <div
                    className="max-w-[82%] self-start rounded-[16px] px-3 py-2 text-[11px] leading-snug"
                    style={{ backgroundColor: BALAO_ROBO }}
                  >
                    {/* `whitespace-pre-wrap` porque quebra de linha é
                        significativa numa mensagem — o contato vê os
                        parágrafos como foram escritos. */}
                    <span className="whitespace-pre-wrap break-words">
                      {dados.texto}
                    </span>
                  </div>
                )}

                {/* Botões COLADOS no balão, empilhados e largura cheia:
                    é assim que o template de botões aparece no direct.
                    Desenhá-los como pastilhas soltas seria pintar quick
                    reply, que é outro recurso e some depois do toque. */}
                {temBotoes && (
                  <div className="flex max-w-[82%] flex-col gap-px self-start overflow-hidden rounded-[14px]">
                    {dados.botoes.map((botao) => (
                      <div
                        key={botao.id}
                        className="px-3 py-2 text-center text-[11px] font-medium"
                        style={{ backgroundColor: BALAO_ROBO, color: "#3797f0" }}
                      >
                        {botao.label || "Botão"}
                      </div>
                    ))}
                  </div>
                )}

                {temCartoes && (
                  <div className="-mx-0.5 flex gap-1.5 overflow-x-auto pb-1">
                    {dados.cartoes.map((cartao) => (
                      <div
                        key={cartao.id}
                        className="w-[112px] shrink-0 overflow-hidden rounded-[12px]"
                        style={{ backgroundColor: BALAO_ROBO }}
                      >
                        <div
                          className="flex h-14 items-center justify-center"
                          style={{ backgroundColor: "#3a3a3a" }}
                        >
                          <ImageIcon
                            className="size-4"
                            style={{ color: TEXTO_FRACO }}
                          />
                        </div>
                        <div className="p-1.5">
                          <p className="truncate text-[10px] font-semibold">
                            {cartao.titulo || "Título"}
                          </p>
                          {cartao.subtitulo && (
                            <p
                              className="truncate text-[9px]"
                              style={{ color: TEXTO_FRACO }}
                            >
                              {cartao.subtitulo}
                            </p>
                          )}
                          <p
                            className="mt-1 truncate text-center text-[10px] font-medium"
                            style={{ color: "#3797f0" }}
                          >
                            {cartao.botao || "Ver"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ---------------------- Composer ------------------------ */}
          <div className="shrink-0 px-2.5 pb-2.5">
            <div
              className="flex items-center gap-2 rounded-full px-3 py-1.5"
              style={{ backgroundColor: "#1c1c1c" }}
            >
              <span className="flex-1 text-[10px]" style={{ color: TEXTO_FRACO }}>
                Mensagem…
              </span>
              <Mic className="size-3.5" style={{ color: TEXTO_FRACO }} />
              <ImageIcon className="size-3.5" style={{ color: TEXTO_FRACO }} />
              <Heart className="size-3.5" style={{ color: TEXTO_FRACO }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
