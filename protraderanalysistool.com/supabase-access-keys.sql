-- Matchestool.pro individual access keys
-- Run once in the Supabase SQL Editor for the project configured in Vercel.
create extension if not exists pgcrypto;

create table if not exists public.access_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  expires_at timestamptz,
  created_by text
);

create table if not exists public.access_sessions (
  id uuid primary key default gen_random_uuid(),
  key_id uuid not null references public.access_keys(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists access_keys_active_hash_idx
  on public.access_keys (key_hash) where revoked_at is null;
create index if not exists access_sessions_token_hash_idx
  on public.access_sessions (token_hash) where revoked_at is null;

alter table public.access_keys enable row level security;
alter table public.access_sessions enable row level security;

-- No anon/authenticated policies: only the server's service-role key may access these tables.
