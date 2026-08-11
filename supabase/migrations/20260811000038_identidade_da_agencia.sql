/* =====================================================================
   Identidade visual por agência
   ---------------------------------------------------------------------
   O relatório que vai ao cliente final era assinado "Elo Marketing" em
   texto fixo no código, com o verde da Elo na barra de acento. Parte da
   carteira, porém, é operada por agências PARCEIRAS — e o relatório
   delas saía com a marca de outra empresa.

   A CORREÇÃO É TIRAR A MARCA DO CÓDIGO, não trocá-la por outra. Cada
   agência passa a ter nome, cor e logo em DADO, e o relatório carrega a
   identidade de quem atende aquele cliente (`clients.agency_partner`).
   A Elo vira uma linha como as outras: nada de "Elo Marketing" escrito
   em arquivo nenhum do entregável.

   POR QUE AQUI, e não numa tabela nova: `agency_contracts` já é a
   tabela por agência, com `agency` como chave primária, e já é onde o
   honorário da parceira vive. Uma segunda tabela com a mesma chave
   obrigaria a manter duas listas em sincronia — e a lista de agências
   já é frágil, porque também existe como `const` no código
   (`AGENCY_PARTNERS`), com o comentário de lá avisando que renomear
   exige UPDATE nas duas tabelas.

   ⚠️ LOGO PRECISA SER RASTER (PNG/JPG), NÃO SVG. O motor padrão de PDF
   é o react-pdf, que só rasteriza imagem — e uma imagem inválida ABORTA
   a geração inteira, derrubando o relatório do cliente por causa de um
   logo. O documento já trata isso nas miniaturas de anúncio, com
   `imageIsRaster` e um bloco de cor no lugar; o logo segue a mesma
   regra. O `check` abaixo recusa SVG na entrada, que é onde o erro é
   barato de corrigir.

   Sem logo ou sem cor, o relatório continua saindo: cai no nome em
   texto e num acento neutro. Identidade é enfeite do documento, não
   requisito para emitir.
   ===================================================================== */

alter table public.agency_contracts
  add column if not exists brand_primary text,
  add column if not exists logo_url      text;

comment on column public.agency_contracts.brand_primary is
  'Cor da marca da agência, em #rrggbb. Pinta o acento do relatório dos clientes dela. Null = acento neutro.';
comment on column public.agency_contracts.logo_url is
  'Logo RASTER (png/jpg) no bucket `brand`. SVG não serve: o react-pdf não rasteriza e a geração aborta.';

/* ------------------------------------------------------------------ */
/* Guardas de formato                                                  */
/* ------------------------------------------------------------------ */

do $$
begin
  alter table public.agency_contracts
    add constraint agency_contracts_brand_primary_hex
    check (brand_primary is null or brand_primary ~ '^#[0-9a-fA-F]{6}$');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  /* Extensão no fim da URL, ignorando query string. `~*` para não
     recusar ".PNG". SVG fica de fora de propósito — ver a nota do topo. */
  alter table public.agency_contracts
    add constraint agency_contracts_logo_raster
    check (
      logo_url is null
      or split_part(logo_url, '?', 1) ~* '\.(png|jpe?g|webp)$'
    );
exception
  when duplicate_object then null;
end $$;

/* ------------------------------------------------------------------ */
/* A Elo entra como dado                                               */
/* ------------------------------------------------------------------ */

/* A linha precisa existir para os clientes da casa terem identidade —
   sem ela, o relatório de conta própria sairia sem assinatura nenhuma.
   `monthly_fee_cents` fica zero: a Elo não cobra de si mesma, e o job de
   recorrência já pula quem tem zero.

   A cor é o azul institucional que o painel já usa. Não é "voltar a
   escrever a marca no sistema": é preencher, em DADO, a linha de uma
   agência que também emite relatório. Trocar é um UPDATE. */
insert into public.agency_contracts (agency, monthly_fee_cents, notes)
values (
  'Elo Marketing',
  0,
  'Conta própria. Linha criada para o relatório ter identidade; o honorário não se aplica.'
)
on conflict (agency) do nothing;

update public.agency_contracts
   set brand_primary = '#16466E'
 where agency = 'Elo Marketing'
   and brand_primary is null;

/* ------------------------------------------------------------------ */
/* O verde da Elo sai dos templates                                    */
/* ------------------------------------------------------------------ */

/* `theme.accent` foi semeado com o verde #7BF178 na migration 09 e
   repetido nas seguintes. Enquanto ele estiver GRAVADO nas linhas, tirar
   o padrão do código não muda nada: o template continua mandando a cor
   da Elo para o relatório de toda agência.

   Removida a chave em vez de trocada por outra cor: o acento agora vem
   da agência que assina, e um valor no template venceria essa
   resolução. Template que quiser fixar cor própria pode voltar a
   definir `accent` — a precedência está documentada em `payload.ts`. */
update public.report_templates
   set theme = theme - 'accent'
 where theme ? 'accent'
   and lower(theme->>'accent') = '#7bf178';
