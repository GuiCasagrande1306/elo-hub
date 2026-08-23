# Briefs de conteúdo

Documentos de linha editorial no formato que o módulo `/conteudo` renderiza.
Cada arquivo `.json` é um documento inteiro — cabeçalho e corpo.

## Como importar

1. Abrir **Conteúdo → Novo documento** no Elo Hub.
2. Escolher o cliente.
3. Colar o arquivo **inteiro** no campo *Corpo do documento*.

Colar o objeto completo preenche título, destaque, resumo e carimbos junto —
ver `documentoInteiro` em `src/components/content/brief-editor.tsx`. Colar só o
array de blocos também funciona; nesse caso o cabeçalho fica por conta de quem
está editando.

## O formato

O contrato está em `src/lib/content/blocks.ts`, com um comentário por tipo de
bloco. O esqueleto que aparece num documento novo está em
`src/lib/content/modelo.ts`.

Marcação dentro de qualquer texto:

| Marca | Vira | Serve para |
|---|---|---|
| `**negrito**` | ênfase | argumento |
| `_itálico_` | itálico | indicação de cena |
| `[colchete]` | destaque amarelo | dado a confirmar com o cliente antes de gravar |

O colchete não é enfeite: a listagem e a barra do documento contam quantos
ainda faltam, e enquanto não for zero a equipe não grava sem inventar dado.

## Arquivos

- `brazzo-bastidores.json` — Brazzo Pizza Delivery. É o documento que deu
  origem ao formato: diagnóstico do perfil por visualização, os três
  arquétipos, a série "A Denúncia", o filtro anti-dono-de-pizzaria, dez
  roteiros, banco de ganchos e checklist.
