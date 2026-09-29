create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key,
  slug text not null unique,
  owner_id uuid not null references auth.users on delete cascade,
  owner_name text not null,
  name text not null,
  settings jsonb not null,
  password_hash text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index rooms_owner_idx on public.rooms (owner_id);

create table public.bans (
  room_id uuid not null references public.rooms on delete cascade,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, key)
);

create table public.reports (
  id bigserial primary key,
  room_id uuid references public.rooms on delete set null,
  reporter_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);

-- Only the server (service role) touches these tables; no policies means no client access.
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.bans enable row level security;
alter table public.reports enable row level security;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Host'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
