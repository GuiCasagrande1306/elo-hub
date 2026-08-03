#!/bin/bash
# Gera os ícones do PWA a partir de SVG desenhado geometricamente.
#
# O "E" é feito de retângulos, não de texto: tipografia rasterizada
# depende da fonte instalada na máquina que gerou, e o ícone precisa
# sair idêntico em qualquer lugar.
set -e
cd "$(dirname "$0")"

INK="#0d1826"      # --background do tema escuro (navy da marca)
PAPER="#fbfdff"    # texto do site
SIGNAL="#71b0d9"   # azul do CTA do site

# $1 = arquivo, $2 = escala do conteúdo (1 = cheio, 0.62 = zona segura
# do maskable), $3 = raio do canto, $4 = cor de fundo
mark () {
  local file=$1 scale=$2 radius=$3 bg=$4
  local t=$(echo "256 - 256 * $scale" | bc -l)

  cat > "$file" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="$radius" ry="$radius" fill="$bg"/>
  <g transform="translate($t,$t) scale($scale)">
    <!-- E geométrico: haste + três barras -->
    <rect x="96"  y="128" width="44"  height="256" rx="10" fill="$PAPER"/>
    <rect x="96"  y="128" width="204" height="44"  rx="10" fill="$PAPER"/>
    <rect x="96"  y="234" width="172" height="44"  rx="10" fill="$PAPER"/>
    <rect x="96"  y="340" width="204" height="44"  rx="10" fill="$PAPER"/>
    <!-- ponto de sinal, separado da barra superior -->
    <circle cx="372" cy="150" r="44" fill="$SIGNAL"/>
  </g>
</svg>
SVG
}

# purpose: "any" — cantos arredondados, o sistema exibe como está
mark any.svg       1.00 112 "$INK"
# purpose: "maskable" — sangra até a borda, conteúdo na zona segura
mark maskable.svg  0.62 0   "$INK"
# iOS aplica a própria máscara: quadrado cheio, sem transparência
mark apple.svg     1.00 0   "$INK"

for f in any maskable apple; do
  rm -f "$f.svg.png"
  qlmanage -t -s 512 -o . "$f.svg" >/dev/null 2>&1
done

echo "SVGs rasterizados:"
ls -la *.svg.png
