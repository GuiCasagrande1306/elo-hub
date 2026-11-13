/* Checklist de onboarding por cliente.

   jsonb no próprio `clients`, e não tabela nova, porque herda as
   policies de leitura e update que já valem para a conta: quem enxerga
   o cliente marca o checklist dele, sem grant nem policy nova.

   Formato: [{ id, label, done, done_at, done_by }].
   Null = ninguém mexeu ainda; a tela mostra a lista padrão do código
   (`src/lib/onboarding/checklist.ts`) e grava a lista inteira no
   primeiro clique. */
alter table public.clients
  add column if not exists onboarding_checklist jsonb;

comment on column public.clients.onboarding_checklist is
  'Checklist de onboarding: [{id, label, done, done_at, done_by}]. Null = lista padrão, nada marcado.';
