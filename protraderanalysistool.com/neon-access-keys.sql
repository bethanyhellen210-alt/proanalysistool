-- Run this once in the Neon SQL Editor for the database connected to Vercel.
CREATE TABLE IF NOT EXISTS public.access_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  expires_at timestamptz,
  created_by text
);

CREATE TABLE IF NOT EXISTS public.access_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES public.access_keys(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS access_keys_active_hash_idx
  ON public.access_keys (key_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS access_sessions_token_hash_idx
  ON public.access_sessions (token_hash) WHERE revoked_at IS NULL;
