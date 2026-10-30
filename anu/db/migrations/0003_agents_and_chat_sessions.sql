-- Chat sessions (a conversation with an agent, separate from tasks) and agents
-- (the named, avatared worker behind each task or chat session).
-- `sessions` is already the login-session table, so chats are `chat_sessions`.

create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  status text not null default 'idle'
    check (status in ('idle', 'working', 'waiting_for_you', 'failed')),
  driver text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chat_sessions_user_updated on chat_sessions (user_id, updated_at desc);

create table session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  seq integer not null check (seq > 0),
  kind text not null check (kind in (
    'user_message', 'assistant_message', 'plan', 'tool', 'observation', 'message',
    'browser', 'approval_request', 'turn_complete')),
  title text not null check (char_length(title) between 1 and 500),
  text text check (char_length(text) <= 100000),
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'done' check (status in ('pending', 'running', 'done', 'failed')),
  turn_id uuid,
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

create table agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  body_shape text not null,
  eye_style text not null,
  color text not null,
  task_id uuid unique references tasks (id) on delete cascade,
  session_id uuid unique references chat_sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(task_id, session_id) = 1)
);
create index agents_user on agents (user_id, created_at desc);

-- Approvals belong to a task or to a chat session.
alter table approvals alter column task_id drop not null;
alter table approvals add column session_id uuid references chat_sessions (id) on delete cascade;
alter table approvals add constraint approvals_owner_check check (num_nonnulls(task_id, session_id) = 1);
create index approvals_session on approvals (session_id);

alter table chat_sessions enable row level security;
alter table chat_sessions force row level security;
create policy chat_sessions_scope on chat_sessions
  using (anu_is_system() or user_id = anu_current_user_id())
  with check (anu_is_system() or user_id = anu_current_user_id());

alter table session_items enable row level security;
alter table session_items force row level security;
create policy session_items_scope on session_items
  using (anu_is_system() or user_id = anu_current_user_id())
  with check (anu_is_system() or user_id = anu_current_user_id());

alter table agents enable row level security;
alter table agents force row level security;
create policy agents_scope on agents
  using (anu_is_system() or user_id = anu_current_user_id())
  with check (anu_is_system() or user_id = anu_current_user_id());

-- Agents for tasks created before this migration. New rows get theirs from the
-- application (src/api/agents.ts); these ids are the avatar catalog's at the time.
insert into agents (user_id, name, body_shape, eye_style, color, task_id, created_at)
select t.user_id,
  (array['Nova','Orion','Lyra','Vega','Atlas','Juno','Echo','Iris','Rune','Sol','Wren','Zephyr'])[1 + abs(hashtext(t.id::text)) % 12],
  (array['blob','cloud','sprout','star','ghost','urchin','stack','flower','burst','ninja','stellar','dendrite'])[1 + abs(hashtext(t.id::text || 'b')) % 12],
  (array['grumpy','angry','curious','goofy','surprised','bashful','gentle','quirky','dazed'])[1 + abs(hashtext(t.id::text || 'e')) % 9],
  (array['teal','purple','pink','orange','yellow','green'])[1 + abs(hashtext(t.id::text || 'c')) % 6],
  t.id, t.created_at
from tasks t
where not exists (select 1 from agents a where a.task_id = t.id);
