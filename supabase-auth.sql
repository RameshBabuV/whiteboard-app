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
  select teacher_accounts.id, teacher_accounts.username, teacher_accounts.display_name
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
grant execute on function public.verify_teacher_login(text, text) to anon, authenticated, service_role;
revoke all on function public.verify_student_login(text, text, text) from public;
grant execute on function public.verify_student_login(text, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- Example teacher insert. Change the username, display name, and password before running.
-- insert into public.teacher_accounts (username, display_name, password_hash)
-- values ('RameshBabuV', 'Ramesh Babu', extensions.crypt('change-this-password', extensions.gen_salt('bf')));

-- Example enrolled student insert. Change the username, display name, password, and room as needed.
-- insert into public.student_accounts (username, display_name, password_hash)
-- values ('student1', 'Student One', extensions.crypt('change-this-password', extensions.gen_salt('bf')))
-- on conflict (username) do nothing;
--
-- insert into public.student_enrollments (student_id, room_slug, fees_amount, payment_status, allow_online_classes)
-- select id, 'python', 5000, 'paid', true
-- from public.student_accounts
-- where username = 'student1'
-- on conflict (student_id, room_slug) do nothing;
