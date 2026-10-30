// @ts-check

const env = process.env.VELLUM_ENVIRONMENT || "local";
const bucketEnv = env === "production" ? "prod" : env;
const targetArch =
  process.env.ELECTRON_TARGET_ARCH ||
  (process.arch === "arm64" ? "arm64" : "x64");

const productName =
  env === "production"
    ? "ANU"
    : `ANU ${env.charAt(0).toUpperCase() + env.slice(1)}`;

const appId =
  env === "production"
    ? "ai.anu.assistant-electron"
    : `ai.anu.assistant-electron-${env}`;

const schemes =
  env === "production"
    ? ["vellum", "vellum-assistant"]
    : [`vellum-assistant-${env}`];

/** @type {import("electron-builder").Configuration} */
module.exports = {
  appId,
  productName,
  publish: {
    provider: "generic",
    url: `https://storage.googleapis.com/vellum-ai-${bucketEnv}-releases/linux-electron/${targetArch}/`,
  },
  directories: {
    output: "dist",
  },
  extraResources: [
    { from: "resources/bun", to: "bun" },
    { from: "resources/web-dist", to: "web-dist" },
    { from: "resources/cli-lockfile", to: "cli-lockfile" },
    { from: "build/icon.png", to: "icon.png" },
  ],
  afterPack: "./scripts/afterPack.cjs",
  linux: {
    icon: "build/icon.png",
    category: "Utility",
    target: [
      {
        target: "AppImage",
        arch: [targetArch],
      },
    ],
    maintainer: "ANU",
    vendor: "ANU",
    executableName: "vellum-linux",
  },
  protocols: [
    {
      name: "ANU Deep Links",
      schemes,
    },
  ],
  fileAssociations: [
    {
      ext: "vellum",
      name: "ANU Bundle",
    },
  ],
};
