-- Lot Locator database setup
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- Safe to run again: it only creates what's missing.

create extension if not exists pgcrypto;

-- People who can sign in. role: pending (waiting for approval), staff, manager.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text default '',
  role text not null default 'pending' check (role in ('pending','staff','manager')),
  created_at timestamptz not null default now()
);

-- One row per car. area is null until someone saves where it's parked.
create table if not exists public.cars (
  id uuid primary key default gen_random_uuid(),
  stock text not null unique,
  vin text default '',
  year int,
  model text default '',
  trim_level text default '',
  color text default '',
  type text default 'New',
  area text,
  spot text default '',
  keys text default '',
  note text default '',
  updated_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null
);

-- Every saved location, newest first per car.
create table if not exists public.moves (
  id bigint generated always as identity primary key,
  car_id uuid not null references public.cars(id) on delete cascade,
  area text,
  spot text,
  keys text,
  note text,
  moved_by uuid references public.profiles(id) on delete set null,
  moved_at timestamptz not null default now()
);
create index if not exists moves_car_idx on public.moves (car_id, moved_at desc);

-- The signed-in person's role.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- New sign-up gets a profile. The very first account becomes a manager; everyone after waits for approval.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''),
          case when exists (select 1 from public.profiles) then 'pending' else 'manager' end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Record a move whenever a car's location is saved.
create or replace function public.log_move() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.area is not null and (tg_op = 'INSERT' or new.updated_at is distinct from old.updated_at) then
    insert into public.moves (car_id, area, spot, keys, note, moved_by, moved_at)
    values (new.id, new.area, new.spot, new.keys, new.note, new.updated_by, coalesce(new.updated_at, now()));
  end if;
  return new;
end $$;
drop trigger if exists cars_log_move on public.cars;
create trigger cars_log_move after insert or update on public.cars
  for each row execute function public.log_move();

-- Access rules
alter table public.profiles enable row level security;
alter table public.cars enable row level security;
alter table public.moves enable row level security;

drop policy if exists "see self or team" on public.profiles;
create policy "see self or team" on public.profiles for select
  using (id = auth.uid() or public.my_role() in ('staff','manager'));
drop policy if exists "managers set roles" on public.profiles;
create policy "managers set roles" on public.profiles for update
  using (public.my_role() = 'manager');

drop policy if exists "team reads cars" on public.cars;
create policy "team reads cars" on public.cars for select using (public.my_role() in ('staff','manager'));
drop policy if exists "team adds cars" on public.cars;
create policy "team adds cars" on public.cars for insert with check (public.my_role() in ('staff','manager'));
drop policy if exists "team updates cars" on public.cars;
create policy "team updates cars" on public.cars for update using (public.my_role() in ('staff','manager'));
drop policy if exists "managers remove cars" on public.cars;
create policy "managers remove cars" on public.cars for delete using (public.my_role() = 'manager');

drop policy if exists "team reads moves" on public.moves;
create policy "team reads moves" on public.moves for select using (public.my_role() in ('staff','manager'));

-- Live updates for everyone's screens
do $$ begin
  alter publication supabase_realtime add table public.cars;
exception when duplicate_object then null;
end $$;

-- Car photos: one current photo per car, stored privately and visible only to approved staff.
alter table public.cars add column if not exists photo_path text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('car-photos', 'car-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "team reads car photos" on storage.objects;
create policy "team reads car photos" on storage.objects for select
  using (bucket_id = 'car-photos' and public.my_role() in ('staff','manager'));
drop policy if exists "team adds car photos" on storage.objects;
create policy "team adds car photos" on storage.objects for insert
  with check (bucket_id = 'car-photos' and public.my_role() in ('staff','manager'));
drop policy if exists "team removes car photos" on storage.objects;
create policy "team removes car photos" on storage.objects for delete
  using (bucket_id = 'car-photos' and public.my_role() in ('staff','manager'));
