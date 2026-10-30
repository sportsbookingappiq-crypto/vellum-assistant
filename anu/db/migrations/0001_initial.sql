-- ANU platform schema, version 1.
-- Applied by scripts/db-migrate.ts as the database owner. The API connects
-- with the owner's login but switches to the application role in every
-- transaction (SET LOCAL ROLE), so the row-level security policies below
-- apply to every query the API makes.

-- Scope helpers. The API sets these with set_config(..., true), which lasts
-- for the current transaction only.
create function anu_current_user_id() returns uuid
  language sql stable
  as $$ select nullif(current_setting('anu.user_id', true), '')::uuid $$;

create function anu_is_system() returns boolean
  language sql stable
  as $$ select coalesce(current_setting('anu.scope', true), '') = 'system' $$;

create table users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  created_at timestamptz not null default now()
);

create table login_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  client_hash text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  consumed_at timestamptz,
  locked_at timestamptz
);
create index login_codes_phone_created on login_codes (phone, created_at desc);
create index login_codes_client_created on login_codes (client_hash, created_at desc);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user on sessions (user_id);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  goal text not null check (char_length(goal) between 1 and 4000),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'stopped')),
  driver text,
  result text,
  confidence real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index tasks_user_created on tasks (user_id, created_at desc);

create table task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  seq integer not null check (seq > 0),
  kind text not null
    check (kind in ('plan', 'tool', 'observation', 'message', 'approval_request', 'result')),
  title text not null check (char_length(title) between 1 and 500),
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'done' check (status in ('pending', 'running', 'done', 'failed')),
  created_at timestamptz not null default now(),
  unique (task_id, seq)
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  step_id uuid references task_steps (id) on delete set null,
  prompt text not null check (char_length(prompt) between 1 and 2000),
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index approvals_task on approvals (task_id);

create table audit_log (
  id bigserial primary key,
  user_id uuid references users (id) on delete cascade,
  action text not null,
  target text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_user on audit_log (user_id, created_at desc);

-- Row-level security. FORCE makes the policies apply to the table owner too.
-- Superusers still bypass them, which is why the API always switches role.
alter table users enable row level security;
alter table users force row level security;
create policy users_scope on users
  using (anu_is_system() or id = anu_current_user_id())
  with check (anu_is_system() or id = anu_current_user_id());

alter table login_codes enable row level security;
alter table login_codes force row level security;
create policy login_codes_system on login_codes using (anu_is_system()) with check (anu_is_system());

alter table sessions enable row level security;
alter table sessions force row level security;
create policy sessions_scope on sessions
  using (anu_is_system() or user_id = anu_current_user_id())
  with check (anu_is_system() or user_id = anu_current_user_id());

alter table tasks enable row level security;
alter table tasks force row level security;
create policy tasks_scope on tasks
  using (anu_is_system() or user_id = anu_current_user_id())
  with check (anu_is_system() or user_id = anu_current_user_id());

alter table task_steps enable row level security;
alter table task_steps force row level security;
create policy task_steps_scope on task_steps
  using (anu_is_system() or user_id = anu_current_user_id())
  with check (anu_is_system() or user_id = anu_current_user_id());

alter table approvals enable row level security;
alter table approvals force row level security;
create policy approvals_scope on approvals
  using (anu_is_system() or user_id = anu_current_user_id())
  with check (anu_is_system() or user_id = anu_current_user_id());

alter table audit_log enable row level security;
alter table audit_log force row level security;
create policy audit_log_scope on audit_log
  using (anu_is_system() or user_id = anu_current_user_id())
  with check (anu_is_system() or user_id = anu_current_user_id());
