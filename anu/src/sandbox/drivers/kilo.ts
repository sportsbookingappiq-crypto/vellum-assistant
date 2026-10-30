import { type Driver, type DriverContext, type DriverOutcome } from "./types.js";

/**
 * Stand-in agent loop until the harness runner is complete: two calls to the
 * Kilo Gateway (OpenAI Chat Completions). The first plans, the second works
 * through the plan by reasoning only (no tools) and reports a result with a
 * confidence. It never touches the network beyond the gateway.
 */

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chat(
  ctx: Pick<DriverContext, "settings" | "signal">,
  messages: ChatMessage[],
  maxTokens = 4000,
): Promise<{ content: string; model: string }> {
  const { kiloBaseUrl, kiloApiKey, kiloModel } = ctx.settings;
  const res = await fetch(`${kiloBaseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${kiloApiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: kiloModel, messages, max_tokens: maxTokens, temperature: 0.2 }),
    signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(180_000)]),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kilo Gateway returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as {
    model?: string;
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  };
  const content = body.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) {
    throw new Error(`Kilo Gateway returned no content (finish_reason ${body.choices?.[0]?.finish_reason ?? "unknown"})`);
  }
  return { content, model: body.model ?? kiloModel };
}

/** Pulls the first JSON object out of a model reply, tolerating code fences and prose. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

const SYSTEM =
  "You are ANU, an assistant that plans and completes a user's goal. You have no tools and no internet access in this mode. " +
  "Be honest about what you cannot verify. Reply with JSON only, no prose.";

export const kiloDriver: Driver = {
  name: "kilo",
  async run(ctx: DriverContext): Promise<DriverOutcome> {
    const planReply = await chat(ctx, [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          `Goal: ${ctx.goal}\n\nReturn {"steps": ["..."]} with 2 to 5 short, concrete steps to reach the goal.`,
      },
    ]);
    const planJson = extractJson(planReply.content) as { steps?: unknown } | null;
    const steps = Array.isArray(planJson?.steps)
      ? planJson!.steps.filter((s): s is string => typeof s === "string").slice(0, 5)
      : [];
    ctx.step({
      kind: "plan",
      title: "Plan",
      detail: { steps: steps.length ? steps : [planReply.content.slice(0, 1000)], model: planReply.model },
    });

    const workReply = await chat(ctx, [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          `Goal: ${ctx.goal}\nPlan:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n") || planReply.content}\n\n` +
          'Work through the plan. Return {"findings": [{"step": "...", "finding": "..."}], "result": "the answer for the user", "confidence": 0.0 to 1.0}.',
      },
    ]);
    const work = extractJson(workReply.content) as
      | { findings?: { step?: unknown; finding?: unknown }[]; result?: unknown; confidence?: unknown }
      | null;
    for (const item of Array.isArray(work?.findings) ? work!.findings.slice(0, 8) : []) {
      const title = typeof item?.step === "string" && item.step.trim() ? item.step : "Finding";
      ctx.step({ kind: "observation", title: title.slice(0, 200), detail: { finding: item?.finding ?? null } });
    }
    const result = typeof work?.result === "string" && work.result.trim() ? work.result : workReply.content;
    const confidence =
      typeof work?.confidence === "number" && work.confidence >= 0 && work.confidence <= 1 ? work.confidence : null;
    return { status: "succeeded", result, confidence };
  },
};
