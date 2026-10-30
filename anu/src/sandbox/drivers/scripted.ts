import { writeFile } from "node:fs/promises";
import path from "node:path";

import { encodePng, saveFrame } from "../browser-frames.js";
import { sleep, type Driver, type DriverContext, type DriverOutcome } from "./types.js";

/**
 * Deterministic fake harness for tests and demos. Goal markers change its path:
 * - `#approval` asks for an approval before writing the summary file.
 * - `#fail` ends the run as failed.
 * - `#nobrowser` skips the two fake browser steps (with generated PNG frames).
 * - `#slow` waits a long time before finishing (for stop and timeout tests).
 */
export const scriptedDriver: Driver = {
  name: "scripted",
  async run(ctx: DriverContext): Promise<DriverOutcome> {
    const delay = ctx.settings.scriptedStepDelayMs;
    const wantsApproval = ctx.goal.includes("#approval");

    const plan = ["Inspect the workspace", wantsApproval ? "Ask before writing a file" : "Write a summary file", "Report the result"];
    ctx.step({ kind: "plan", title: "Plan", detail: { steps: plan } });
    await sleep(delay, ctx.signal);

    ctx.step({ kind: "tool", title: "Run env in the workspace", detail: { command: "env" }, status: "done" });
    const proc = Bun.spawn(["env"], { cwd: ctx.workspaceDir, env: ctx.env, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const envNames = output
      .split("\n")
      .map((line) => line.split("=")[0]!)
      .filter(Boolean)
      .sort();
    ctx.step({
      kind: "observation",
      title: `Workspace has ${envNames.length} environment variables`,
      detail: { cwd: ctx.workspaceDir, envNames },
    });
    await sleep(delay, ctx.signal);

    if (!ctx.goal.includes("#nobrowser")) {
      const pages = [
        { url: "https://example.com/", action: "navigate", color: [40, 90, 200] as const },
        { url: "https://example.com/results", action: "click", color: [30, 160, 90] as const },
      ];
      for (const [index, page] of pages.entries()) {
        const png = encodePng(320, 200, (x, y) =>
          y < 24 ? [230, 230, 230] : x < 40 + index * 60 ? [page.color[0], page.color[1], page.color[2]] : [250, 250, 250],
        );
        const frame = await saveFrame(ctx.workspaceDir, { data: png, url: page.url, action: page.action });
        ctx.step({
          kind: "browser",
          title: `Browser ${page.action}: ${page.url}`,
          detail: { url: page.url, action: page.action, frameId: frame?.frameId ?? null },
        });
        await sleep(delay, ctx.signal);
      }
    }

    if (ctx.goal.includes("#slow")) {
      ctx.step({ kind: "message", title: "Working on a long step" });
      await sleep(10 * 60 * 1000, ctx.signal);
    }

    if (ctx.goal.includes("#fail")) {
      return { status: "failed", result: "The scripted driver was asked to fail.", confidence: null };
    }

    let wrote = true;
    if (wantsApproval) {
      const decision = await ctx.requestApproval("Write summary.md to the task workspace?", {
        file: "summary.md",
      });
      wrote = decision === "approved";
      if (!wrote) ctx.step({ kind: "message", title: "Skipped writing summary.md" });
    }
    if (wrote) {
      await writeFile(path.join(ctx.workspaceDir, "summary.md"), `# Summary\n\nGoal: ${ctx.goal}\n`);
      ctx.step({ kind: "tool", title: "Wrote summary.md", detail: { file: "summary.md" } });
    }
    await sleep(delay, ctx.signal);

    return {
      status: "succeeded",
      result: wrote
        ? `Scripted run finished for: ${ctx.goal}`
        : `Scripted run finished without writing a file for: ${ctx.goal}`,
      confidence: wrote ? 0.9 : 0.6,
    };
  },
};
