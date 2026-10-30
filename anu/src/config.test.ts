import { describe, expect, test } from "bun:test";

import { corsOriginMatcher, DEFAULT_CORS_ORIGINS, loadApiConfig, loadConfig, loadSandboxConfig } from "./config.js";

describe("loadConfig", () => {
  test("accepts the test environment with the dev OTP sender", () => {
    const config = loadConfig({ ANU_ENV: "test", OTP_SENDER: "dev" });
    expect(config.ANU_ENV).toBe("test");
    expect(config.OTP_SENDER).toBe("dev");
  });

  test("requires ANU_ENV", () => {
    expect(() => loadConfig({ OTP_SENDER: "dev" })).toThrow("ANU_ENV");
  });

  test("requires OTP_SENDER to be set explicitly", () => {
    expect(() => loadConfig({ ANU_ENV: "dev" })).toThrow("OTP_SENDER");
  });

  test("refuses the dev OTP sender in staging and production", () => {
    for (const env of ["staging", "production"]) {
      expect(() => loadConfig({ ANU_ENV: env, OTP_SENDER: "dev" })).toThrow(
        "OTP_SENDER=dev is allowed only when ANU_ENV is dev or test",
      );
    }
  });

  test("rejects an unknown environment name", () => {
    expect(() => loadConfig({ ANU_ENV: "local", OTP_SENDER: "dev" })).toThrow("ANU_ENV");
  });

  test("validates KILO_BASE_URL as an absolute URL when it is set", () => {
    expect(() =>
      loadConfig({ ANU_ENV: "test", OTP_SENDER: "dev", KILO_BASE_URL: "not a url" }),
    ).toThrow("KILO_BASE_URL");
  });

  test("treats an empty KILO_API_KEY as invalid rather than as set", () => {
    expect(() =>
      loadConfig({ ANU_ENV: "test", OTP_SENDER: "dev", KILO_API_KEY: "" }),
    ).toThrow("KILO_API_KEY");
  });
});

describe("service configuration", () => {
  const secrets = {
    ANU_OTP_SECRET: "a".repeat(64),
    ANU_INTERNAL_TOKEN: "b".repeat(64),
  };

  test("the API needs a database URL and long secrets, and has safe defaults", () => {
    expect(() => loadApiConfig({ ANU_ENV: "test", OTP_SENDER: "dev", ...secrets })).toThrow("DATABASE_URL");
    expect(() =>
      loadApiConfig({ ANU_ENV: "test", OTP_SENDER: "dev", DATABASE_URL: "postgres://x/y", ANU_OTP_SECRET: "short", ANU_INTERNAL_TOKEN: secrets.ANU_INTERNAL_TOKEN }),
    ).toThrow("ANU_OTP_SECRET");
    const config = loadApiConfig({ ANU_ENV: "test", OTP_SENDER: "dev", DATABASE_URL: "postgres://x/y", ...secrets });
    expect(config.ANU_API_PORT).toBe(8787);
    expect(config.ANU_API_HOST).toBe("127.0.0.1");
    expect(config.ANU_DB_APP_ROLE).toBe("anu_platform_app");
    expect(config.ANU_TRUST_PROXY).toBe(false);
  });

  test("the sandbox has its own defaults and validates the driver", () => {
    const config = loadSandboxConfig({ ANU_ENV: "dev", OTP_SENDER: "dev", ANU_INTERNAL_TOKEN: secrets.ANU_INTERNAL_TOKEN });
    expect(config.ANU_SANDBOX_PORT).toBe(8788);
    expect(config.ANU_SANDBOX_DRIVER).toBe("scripted");
    expect(config.KILO_MODEL).toBe("kilo-auto/free");
    expect(() =>
      loadSandboxConfig({ ANU_ENV: "dev", OTP_SENDER: "dev", ANU_INTERNAL_TOKEN: secrets.ANU_INTERNAL_TOKEN, ANU_SANDBOX_DRIVER: "docker" }),
    ).toThrow("ANU_SANDBOX_DRIVER");
  });

  test("the role name cannot carry SQL", () => {
    expect(() =>
      loadApiConfig({ ANU_ENV: "test", OTP_SENDER: "dev", DATABASE_URL: "postgres://x/y", ...secrets, ANU_DB_APP_ROLE: "x; drop table users" }),
    ).toThrow("ANU_DB_APP_ROLE");
  });

  test("CORS origins match exactly or by any port", () => {
    const allowed = corsOriginMatcher(DEFAULT_CORS_ORIGINS);
    expect(allowed("capacitor://localhost")).toBe(true);
    expect(allowed("https://localhost")).toBe(true);
    expect(allowed("http://localhost:5173")).toBe(true);
    expect(allowed("http://localhost")).toBe(false);
    expect(allowed("http://localhost:5173.evil.example")).toBe(false);
    expect(allowed("http://localhost.evil.example:80")).toBe(false);
    expect(allowed("https://evil.example")).toBe(false);
  });
});
