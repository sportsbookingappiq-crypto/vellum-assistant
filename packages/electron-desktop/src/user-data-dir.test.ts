import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { pinPackagedUserDataDir } from "./user-data-dir";

function fakeApp(name: string) {
  const paths: Record<string, string> = { appData: "/data" };
  return {
    getName: () => name,
    getPath: (key: string) => paths[key] ?? "",
    setPath: (key: string, value: string) => {
      paths[key] = value;
    },
    paths,
  };
}

describe("pinPackagedUserDataDir", () => {
  test("production keeps the legacy directory name", () => {
    const app = fakeApp("ANU");
    pinPackagedUserDataDir(app as never, "production");
    expect(app.paths.userData).toBe(join("/data", "Vellum"));
  });

  test("non-production channels keep the legacy name and add a suffix", () => {
    const app = fakeApp("ANU Staging");
    pinPackagedUserDataDir(app as never, "staging");
    expect(app.paths.userData).toBe(
      join("/data", "Vellum Staging") + "-staging",
    );
  });

  test("a name without the ANU prefix is used as is", () => {
    const app = fakeApp("Example");
    pinPackagedUserDataDir(app as never, "production");
    expect(app.paths.userData).toBe(join("/data", "Example"));
  });
});
