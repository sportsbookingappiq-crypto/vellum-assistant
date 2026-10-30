/** Runs the API and the sandbox server together. Ctrl-C stops both. */
const children = [
  Bun.spawn([process.execPath, "src/api/server.ts"], { stdout: "inherit", stderr: "inherit", env: process.env }),
  Bun.spawn([process.execPath, "src/sandbox/server.ts"], { stdout: "inherit", stderr: "inherit", env: process.env }),
];
const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const code = await Promise.race(children.map((child) => child.exited));
stop();
await Promise.all(children.map((child) => child.exited));
process.exit(code);
