-- Custom bots: a user's named assistants. A bot's profile is applied to the
-- harness runtime of each session or task that uses it (IDENTITY.md, SOUL.md,
-- avatar, inference profile, skills). Default bots are per-user rows, created
-- lazily by the API, so every bot follows the same RLS rule and is editable.

create table bots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  default_key text check (default_key in ('anu', 'researcher', 'shopper')),
  name text not null check (char_length(name) between 1 and 40),
  role text not null default '' check (char_length(role) <= 120),
  personality text not null default '' check (char_length(personality) <= 200),
  greeting text not null default '' check (char_length(greeting) <= 280),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  starters jsonb not null default '[]'::jsonb
    check (jsonb_typeof(starters) = 'array' and jsonb_array_length(starters) <= 3),
  body_shape text not null,
  eye_style text not null,
  color text not null,
  model_profile text,
  skills text[] not null default '{}' check (cardinality(skills) <= 20),
  locale text not null default 'en' check (locale in ('ar', 'en')),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, default_key)
);
create index bots_user on bots (user_id, last_used_at desc nulls last);

alter table bots enable row level security;
alter table bots force row level security;
create policy bots_scope on bots
  using (anu_is_system() or user_id = anu_current_user_id())
  with check (anu_is_system() or user_id = anu_current_user_id());

alter table chat_sessions add column bot_id uuid references bots (id) on delete set null;
alter table chat_sessions add column bot_version text;
create index chat_sessions_bot on chat_sessions (bot_id);
alter table tasks add column bot_id uuid references bots (id) on delete set null;
create index tasks_bot on tasks (bot_id);
alter table agents add column bot_id uuid references bots (id) on delete set null;
alter table users add column default_bot_id uuid references bots (id) on delete set null;
-- Set once the default bots were created, so a deleted default is not recreated.
alter table users add column default_bots_seeded_at timestamptz;
