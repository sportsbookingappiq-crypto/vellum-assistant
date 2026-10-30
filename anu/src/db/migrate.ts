import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { ANU_DIR } from "../config.js";
import type { Sql } from "./client.js";

export const MIGRATIONS_DIR = path.join(ANU_DIR, "db", "migrations");

/** Applies pending SQL migrations in file-name order, then grants the app role. */
export async function migrate(
  sql: Sql,
  appRole: string,
  log: (line: string) => void = () => {},
): Promise<string[]> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(appRole)) throw new Error("invalid application role name");
  const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql")).sort();
  const applied: string[] = [];

  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(4242001)`;
    await tx`create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
    const done = new Set(
      (await tx<{ name: string }[]>`select name from schema_migrations`).map((row) => row.name),
    );
    for (const name of files) {
      if (done.has(name)) continue;
      const body = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${name})`;
      applied.push(name);
      log(`applied ${name}`);
    }

    await tx.unsafe(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = '${appRole}') then
          create role ${appRole} nologin;
        end if;
      end
      $$;
    `);
    const [{ me }] = await tx<{ me: string }[]>`select current_user as me`;
    if (me !== appRole) {
      await tx.unsafe(`grant ${appRole} to current_user`);
    }
    await tx.unsafe(`
      grant usage on schema public to ${appRole};
      grant select, insert, update, delete on all tables in schema public to ${appRole};
      revoke all on schema_migrations from ${appRole};
      grant usage, select on all sequences in schema public to ${appRole};
      grant execute on all functions in schema public to ${appRole};
    `);
  });
  return applied;
}

/** Test helper: removes every row. Runs as the login role, not the app role. */
export async function truncateAll(sql: Sql): Promise<void> {
  await sql`truncate audit_log, approvals, task_steps, tasks, sessions, login_codes, users restart identity cascade`;
}
