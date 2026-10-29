import { describe, expect, test } from "bun:test";

import { loadConfig } from "./config.js";

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
