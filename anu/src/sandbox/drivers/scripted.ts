import { writeFile } from "node:fs/promises";
import path from "node:path";

import { encodePng, saveFrame } from "../browser-frames.js";
import { DriverUnavailableError, sleep, type Driver, type DriverContext, type DriverOutcome, type SessionContext } from "./types.js";

/**
 * Deterministic fake harness for tests and demos. Goal markers change its path:
 * - `#approval` asks for an approval before writing the summary file.
 * - `#fail` ends the run as failed.
 * - `#nobrowser` skips the two fake browser steps (with generated PNG frames).
 * - `#slow` waits a long time before finishing (for stop and timeout tests).
 * With a bot, the plan step names it and the result and replies start with its name.
 */
export const scriptedDriver: Driver = {
  name: "scripted",
  async run(ctx: DriverContext): Promise<DriverOutcome> {
    const delay = ctx.settings.scriptedStepDelayMs;
    const wantsApproval = ctx.goal.includes("#approval");

    const plan = ["Inspect the workspace", wantsApproval ? "Ask before writing a file" : "Write a summary file", "Report the result"];
    ctx.step({ kind: "plan", title: "Plan", detail: { steps: plan, ...(ctx.bot ? { bot: ctx.bot.name } : {}) } });
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

    const as = ctx.bot ? `${ctx.bot.name}: ` : "";
    return {
      status: "succeeded",
      result: as + (wrote
        ? `Scripted run finished for: ${ctx.goal}`
        : `Scripted run finished without writing a file for: ${ctx.goal}`),
      confidence: wrote ? 0.9 : 0.6,
    };
  },

  /**
   * Chat mode. Replies are deterministic and show that context carries over:
   * `Reply N to "text" (I remember M earlier messages)`. Markers in a message:
   * `#browser` adds a browser step with a PNG frame, `#approval` asks first,
   * `#slow` waits (for stop tests), `#fail` fails the turn.
   */
  async session(ctx: SessionContext): Promise<void> {
    const delay = ctx.settings.scriptedStepDelayMs;
    const history = [...ctx.history];
    for await (const turn of ctx.turns) {
      const userTurns = history.filter((m) => m.role === "user").length;
      ctx.step({
        kind: "tool",
        title: "Read the conversation",
        detail: { earlierMessages: history.length, ...(ctx.bot ? { bot: ctx.bot.name } : {}) },
        status: "done",
      });
      await sleep(delay, ctx.signal);
      if (turn.text.includes("#browser")) {
        const png = encodePng(320, 200, (x, y) => (y < 24 ? [230, 230, 230] : x < 160 ? [120, 80, 200] : [250, 250, 250]));
        const url = `https://example.com/chat/${userTurns + 1}`;
        const frame = await saveFrame(ctx.workspaceDir, { data: png, url, action: "navigate" });
        ctx.step({ kind: "browser", title: `Browser navigate: ${url}`, detail: { url, action: "navigate", frameId: frame?.frameId ?? null } });
      }
      if (turn.text.includes("#slow")) {
        ctx.step({ kind: "message", title: "Working on a long step" });
        await sleep(10 * 60 * 1000, ctx.signal);
      }
      let reply = `${ctx.bot ? `${ctx.bot.name}: ` : ""}Reply ${userTurns + 1} to "${turn.text}" (I remember ${history.length} earlier messages)`;
      if (turn.text.includes("#approval")) {
        const decision = await ctx.requestApproval("Write notes.md to the session workspace?", { file: "notes.md" });
        if (decision === "approved") {
          await writeFile(path.join(ctx.workspaceDir, "notes.md"), `# Notes\n\n${turn.text}\n`);
          ctx.step({ kind: "tool", title: "Wrote notes.md", detail: { file: "notes.md" } });
        } else {
          reply += " (skipped writing notes.md)";
        }
      }
      history.push({ role: "user", text: turn.text });
      if (turn.text.includes("#fail")) {
        ctx.endTurn(turn.turnId, "failed", "The scripted driver was asked to fail.");
        continue;
      }
      history.push({ role: "assistant", text: reply });
      ctx.endTurn(turn.turnId, "succeeded", reply);
    }
  },

  /** No model to ask: the API answers with its deterministic template draft. */
  async draft(): Promise<string> {
    throw new DriverUnavailableError("the scripted driver has no model to draft a bot with");
  },
};
