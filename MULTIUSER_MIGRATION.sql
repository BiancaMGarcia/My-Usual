
-- ============================================================
-- MY USUAL V4 - MULTI-USER MIGRATION
-- Run this in Supabase SQL Editor.
-- ============================================================

-- 1) USER PROFILES
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
on public.profiles for select
to authenticated
using (user_id = auth.uid());

create policy "Users can insert own profile"
on public.profiles for insert
to authenticated
with check (user_id = auth.uid());

create policy "Users can update own profile"
on public.profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- 2) REPLACE GLOBAL TASTE PROFILE WITH PER-USER PROFILE
alter table public.taste_profile
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Remove old public/global policies if they exist.
drop policy if exists "Taste profile is publicly viewable" on public.taste_profile;
drop policy if exists "Admins can add taste profile" on public.taste_profile;
drop policy if exists "Admins can update taste profile" on public.taste_profile;

-- Existing rows are global/legacy. Leave them unassigned; new app ignores rows with null user_id.
create unique index if not exists taste_profile_one_per_user
on public.taste_profile(user_id)
where user_id is not null;

create policy "Users can view own taste profile"
on public.taste_profile for select
to authenticated
using (user_id = auth.uid());

create policy "Users can insert own taste profile"
on public.taste_profile for insert
to authenticated
with check (user_id = auth.uid());

create policy "Users can update own taste profile"
on public.taste_profile for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users can delete own taste profile"
on public.taste_profile for delete
to authenticated
using (user_id = auth.uid());

-- 3) MAKE RESTAURANTS USER-SPECIFIC
alter table public.restaurants
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Remove old public/admin policies.
drop policy if exists "Restaurants are publicly viewable" on public.restaurants;
drop policy if exists "Admins can add restaurants" on public.restaurants;
drop policy if exists "Admins can update restaurants" on public.restaurants;
drop policy if exists "Admins can delete restaurants" on public.restaurants;

create policy "Users can view own restaurants"
on public.restaurants for select
to authenticated
using (user_id = auth.uid());

create policy "Users can insert own restaurants"
on public.restaurants for insert
to authenticated
with check (user_id = auth.uid());

create policy "Users can update own restaurants"
on public.restaurants for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Users can delete own restaurants"
on public.restaurants for delete
to authenticated
using (user_id = auth.uid());

-- 4) ORDERS INHERIT OWNERSHIP THROUGH THEIR RESTAURANT
drop policy if exists "Orders are publicly viewable" on public.orders;
drop policy if exists "Admins can add orders" on public.orders;
drop policy if exists "Admins can update orders" on public.orders;
drop policy if exists "Admins can delete orders" on public.orders;

create policy "Users can view own orders"
on public.orders for select
to authenticated
using (
  exists (
    select 1 from public.restaurants r
    where r.id = orders.restaurant_id
      and r.user_id = auth.uid()
  )
);

create policy "Users can insert own orders"
on public.orders for insert
to authenticated
with check (
  exists (
    select 1 from public.restaurants r
    where r.id = orders.restaurant_id
      and r.user_id = auth.uid()
  )
);

create policy "Users can update own orders"
on public.orders for update
to authenticated
using (
  exists (
    select 1 from public.restaurants r
    where r.id = orders.restaurant_id
      and r.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.restaurants r
    where r.id = orders.restaurant_id
      and r.user_id = auth.uid()
  )
);

create policy "Users can delete own orders"
on public.orders for delete
to authenticated
using (
  exists (
    select 1 from public.restaurants r
    where r.id = orders.restaurant_id
      and r.user_id = auth.uid()
  )
);

-- 5) UPDATED_AT TRIGGERS
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- 6) OPTIONAL: AUTO-CREATE PROFILE ROW WHEN A NEW AUTH USER IS CREATED
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- 7) IMPORTANT:
-- Existing restaurant rows from the old single-user version have user_id = null.
-- After you sign into V4, you can either recreate them or assign them manually
-- to your own auth user id with:
-- update public.restaurants set user_id = '<YOUR-USER-UUID>' where user_id is null;
