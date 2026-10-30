import { AuthService } from "../auth/service.js";
import { createOtpSender } from "../auth/otp.js";
import { loadApiConfig, type ApiConfig } from "../config.js";
import { connect, Db } from "../db/client.js";
import { createLogger, type Logger } from "../lib/log.js";
import { createApp } from "./app.js";
import { HttpSandboxClient, type SandboxClient } from "./sandbox-client.js";
import { TaskEvents, TaskService } from "./tasks.js";

export interface ApiServerOptions {
  config: ApiConfig;
  now?: () => Date;
  sandbox?: SandboxClient;
  log?: Logger;
}

export function buildApi(options: ApiServerOptions) {
  const { config } = options;
  const log = options.log ?? createLogger("api");
  const now = options.now ?? (() => new Date());
  const sender = createOtpSender(config);
  const db = new Db(connect(config.DATABASE_URL), config.ANU_DB_APP_ROLE);
  const auth = new AuthService(
    db,
    sender,
    {
      otpSecret: config.ANU_OTP_SECRET,
      sessionTtlSeconds: config.ANU_SESSION_TTL_SECONDS,
      rateWindowSeconds: config.ANU_RATE_WINDOW_SECONDS,
      ratePhoneMax: config.ANU_RATE_PHONE_MAX,
      rateClientMax: config.ANU_RATE_CLIENT_MAX,
    },
    now,
    log,
  );
  const sandbox = options.sandbox ?? new HttpSandboxClient(config.ANU_SANDBOX_URL, config.ANU_INTERNAL_TOKEN);
  const tasks = new TaskService(db, sandbox, new TaskEvents(), now, log);
  const handler = createApp({
    auth,
    tasks,
    internalToken: config.ANU_INTERNAL_TOKEN,
    corsOrigins: config.ANU_CORS_ORIGINS,
    log,
  });
  return { db, auth, tasks, handler, log };
}

export function clientAddressOf(req: Request, socketAddress: string | undefined, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return socketAddress ?? "unknown";
}

if (import.meta.main) {
  const config = loadApiConfig(process.env);
  const api = buildApi({ config });
  const server = Bun.serve({
    hostname: config.ANU_API_HOST,
    port: config.ANU_API_PORT,
    idleTimeout: 120,
    fetch: (req, srv) => api.handler(req, clientAddressOf(req, srv.requestIP(req)?.address, config.ANU_TRUST_PROXY)),
  });
  api.log.info("api.listening", { url: server.url.toString(), env: config.ANU_ENV, otpSender: config.OTP_SENDER });
  const shutdown = async () => {
    server.stop(true);
    await api.db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
