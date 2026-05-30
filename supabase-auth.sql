create extension if not exists pgcrypto with schema extensions;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.rooms (slug, name)
values
  ('python', 'Python'),
  ('java', 'Java'),
  ('cpp', 'C & C++'),
  ('hadoop', 'Hadoop')
on conflict (slug) do nothing;

create table if not exists public.teacher_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.verify_teacher_login(
  p_username text,
  p_password text
)
returns table (
  id uuid,
  username text,
  display_name text
)
language sql
security definer
set search_path = public, extensions
as $$
  select teacher_accounts.id, teacher_accounts.username, teacher_accounts.display_name
  from public.teacher_accounts
  where teacher_accounts.username = p_username
    and teacher_accounts.password_hash = extensions.crypt(p_password, teacher_accounts.password_hash)
    and teacher_accounts.is_active = true
  limit 1;
$$;

revoke all on function public.verify_teacher_login(text, text) from public;
grant execute on function public.verify_teacher_login(text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- Example teacher insert. Change the username, display name, and password before running.
-- insert into public.teacher_accounts (username, display_name, password_hash)
-- values ('RameshBabuV', 'Ramesh Babu', extensions.crypt('change-this-password', extensions.gen_salt('bf')));
