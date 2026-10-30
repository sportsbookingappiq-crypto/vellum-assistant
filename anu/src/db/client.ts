import postgres from "postgres";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

/**
 * Opens a connection pool. A `host` query parameter that is an absolute path
 * selects a Unix socket directory, as libpq does, for example
 * postgres://ai@localhost/anu_platform?host=/var/run/postgresql
 */
export function connect(databaseUrl: string, options: { max?: number } = {}): Sql {
  const url = new URL(databaseUrl);
  const socketDir = url.searchParams.get("host");
  const common = {
    max: options.max ?? 10,
    onnotice: () => {},
    idle_timeout: 30,
    connection: { application_name: "anu" },
  };
  if (socketDir && socketDir.startsWith("/")) {
    url.searchParams.delete("host");
    const portNumber = url.port || "5432";
    return postgres(url.toString(), { ...common, path: `${socketDir}/.s.PGSQL.${portNumber}` });
  }
  return postgres(databaseUrl, common);
}

/**
 * All application queries go through Db so that row-level security is always
 * in force: each transaction switches to the application role and sets either
 * a user scope or the system scope. A query issued outside these wrappers would
 * run as the login role, so the API never uses `sql` directly.
 */
export class Db {
  constructor(
    readonly sql: Sql,
    private readonly appRole: string,
  ) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(appRole)) {
      throw new Error("invalid application role name");
    }
  }

  /** Runs fn with visibility limited to rows owned by userId. */
  asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${this.appRole}`);
      await tx`select set_config('anu.user_id', ${userId}, true), set_config('anu.scope', 'user', true)`;
      return fn(tx);
    }) as Promise<T>;
  }

  /**
   * Runs fn in the system scope. Used for login, session lookup, and the
   * internal sandbox endpoints, which act before or outside a user session.
   * Every system-scope query still names its owner explicitly.
   */
  asSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${this.appRole}`);
      await tx`select set_config('anu.scope', 'system', true), set_config('anu.user_id', '', true)`;
      return fn(tx);
    }) as Promise<T>;
  }

  close(): Promise<void> {
    return this.sql.end({ timeout: 5 });
  }
}
