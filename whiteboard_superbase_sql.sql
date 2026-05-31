-- RS Academy Whiteboard Supabase SQL
-- Run this file in the Supabase SQL Editor.
-- It creates the course rooms, teacher accounts, student accounts,
-- course enrollments, fee/payment access fields, and login RPC functions.

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
on conflict (slug) do update
set
  name = excluded.name,
  is_active = true;

create table if not exists public.teacher_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.student_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_accounts(id) on delete cascade,
  room_slug text not null references public.rooms(slug) on delete cascade,
  fees_amount numeric(10, 2) not null default 0,
  payment_status text not null default 'pending',
  allow_online_classes boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_enrollments_payment_status_check
    check (payment_status in ('pending', 'partial', 'paid', 'waived')),
  unique (student_id, room_slug)
);

-- Existing database upgrade support.
alter table public.student_enrollments
  add column if not exists fees_amount numeric(10, 2) not null default 0;

alter table public.student_enrollments
  add column if not exists payment_status text not null default 'pending';

alter table public.student_enrollments
  add column if not exists allow_online_classes boolean not null default false;

alter table public.student_enrollments
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'student_enrollments_payment_status_check'
      and conrelid = 'public.student_enrollments'::regclass
  ) then
    alter table public.student_enrollments
      add constraint student_enrollments_payment_status_check
      check (payment_status in ('pending', 'partial', 'paid', 'waived')) not valid;
  end if;
end $$;

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
  select teacher_accounts.id,
         teacher_accounts.username,
         teacher_accounts.display_name
  from public.teacher_accounts
  where teacher_accounts.username = p_username
    and teacher_accounts.password_hash = extensions.crypt(p_password, teacher_accounts.password_hash)
    and teacher_accounts.is_active = true
  limit 1;
$$;

create or replace function public.verify_student_login(
  p_username text,
  p_password text,
  p_room text
)
returns table (
  id uuid,
  username text,
  display_name text,
  room_slug text,
  fees_amount numeric,
  payment_status text,
  allow_online_classes boolean
)
language sql
security definer
set search_path = public, extensions
as $$
  select student_accounts.id,
         student_accounts.username,
         student_accounts.display_name,
         student_enrollments.room_slug,
         student_enrollments.fees_amount,
         student_enrollments.payment_status,
         student_enrollments.allow_online_classes
  from public.student_accounts
  join public.student_enrollments
    on student_enrollments.student_id = student_accounts.id
  join public.rooms
    on rooms.slug = student_enrollments.room_slug
  where student_accounts.username = p_username
    and student_accounts.password_hash = extensions.crypt(p_password, student_accounts.password_hash)
    and student_accounts.is_active = true
    and student_enrollments.is_active = true
    and student_enrollments.allow_online_classes = true
    and rooms.is_active = true
    and student_enrollments.room_slug = p_room
  limit 1;
$$;

revoke all on function public.verify_teacher_login(text, text) from public;
grant execute on function public.verify_teacher_login(text, text)
to anon, authenticated, service_role;

revoke all on function public.verify_student_login(text, text, text) from public;
grant execute on function public.verify_student_login(text, text, text)
to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- Optional sample teacher.
-- Change username, display name, and password before running.
-- insert into public.teacher_accounts (username, display_name, password_hash)
-- values (
--   'RameshBabuV',
--   'Ramesh Babu',
--   extensions.crypt('change-this-password', extensions.gen_salt('bf'))
-- )
-- on conflict (username) do update
-- set
--   display_name = excluded.display_name,
--   password_hash = excluded.password_hash,
--   is_active = true,
--   updated_at = now();

-- Optional sample student account.
-- Change username, display name, and password before running.
-- insert into public.student_accounts (username, display_name, password_hash)
-- values (
--   'student1',
--   'Student One',
--   extensions.crypt('student-password', extensions.gen_salt('bf'))
-- )
-- on conflict (username) do update
-- set
--   display_name = excluded.display_name,
--   password_hash = excluded.password_hash,
--   is_active = true,
--   updated_at = now();

-- Optional sample student enrollment for Python.
-- Student can join only when allow_online_classes is true.
-- insert into public.student_enrollments (
--   student_id,
--   room_slug,
--   fees_amount,
--   payment_status,
--   allow_online_classes,
--   is_active
-- )
-- select
--   id,
--   'python',
--   5000,
--   'paid',
--   true,
--   true
-- from public.student_accounts
-- where username = 'student1'
-- on conflict (student_id, room_slug) do update
-- set
--   fees_amount = excluded.fees_amount,
--   payment_status = excluded.payment_status,
--   allow_online_classes = excluded.allow_online_classes,
--   is_active = excluded.is_active,
--   updated_at = now();

-- Optional test queries.
-- select * from public.verify_teacher_login('RameshBabuV', 'change-this-password');
-- select * from public.verify_student_login('student1', 'student-password', 'python');
