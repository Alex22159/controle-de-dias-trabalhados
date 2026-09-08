-- Execute este arquivo no SQL Editor do Supabase.
-- Esta versão compartilha um único conjunto de dados entre os seus aparelhos.
create table if not exists public.controle_trabalho_estado (
  id bigint primary key check (id = 1),
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);

alter table public.controle_trabalho_estado enable row level security;

drop policy if exists "controle publico leitura" on public.controle_trabalho_estado;
drop policy if exists "controle publico gravacao" on public.controle_trabalho_estado;

create policy "controle publico leitura"
  on public.controle_trabalho_estado for select
  to anon, authenticated
  using (true);

create policy "controle publico gravacao"
  on public.controle_trabalho_estado for insert
  to anon, authenticated
  with check (id = 1);

create policy "controle publico atualizacao"
  on public.controle_trabalho_estado for update
  to anon, authenticated
  using (id = 1)
  with check (id = 1);
