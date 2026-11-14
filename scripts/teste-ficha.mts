// Validação da ficha do cliente. Rodar: npx tsx scripts/teste-ficha.mts
import assert from "node:assert/strict";
import { SECOES_DE_LISTA, ehSecaoDeCampos, ehSecaoDeLista, limparValores } from "../src/lib/clientes/ficha";

const regra = limparValores(SECOES_DE_LISTA.regras, {
  texto: "  Não mostrar preço  ",
  categoria: "nao_pode",
  senha: "123", // chave fora da definição: some
  motivo: 42, // não-texto: some
});
assert.deepEqual(regra, { texto: "Não mostrar preço", categoria: "nao_pode" });

// Opção fora da lista não entra.
assert.deepEqual(limparValores(SECOES_DE_LISTA.regras, { texto: "x", categoria: "talvez" }), { texto: "x" });

// Texto longo é cortado no limite.
assert.equal(limparValores(SECOES_DE_LISTA.pendencias, { texto: "a".repeat(5000) }).texto.length, 3000);

assert.ok(ehSecaoDeCampos("mapa") && !ehSecaoDeCampos("regras") && !ehSecaoDeCampos("__proto__"));
assert.ok(ehSecaoDeLista("acessos") && !ehSecaoDeLista("mapa") && !ehSecaoDeLista("constructor"));

console.log("ok: ficha");
