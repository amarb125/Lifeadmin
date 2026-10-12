import { authenticate, json } from "@/lib/server/auth";
import { ParseRequestSchema } from "@/lib/schemas";
import { parseHeuristic } from "@/lib/parser";
import { parseWithLLM } from "@/lib/server/llm";
import { DEFAULT_PREFS } from "@/lib/types";
import { isValidTimezone } from "@/lib/time";
import type { ParseResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;

  const parsed = ParseRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Send some text to turn into tasks." }, 400);
  const { text, timezone, defaultOffsetsMinutes } = parsed.data;
  if (!isValidTimezone(timezone)) return json({ error: "Unknown timezone." }, 400);

  const prefs = {
    ...DEFAULT_PREFS,
    timezone,
    ...(defaultOffsetsMinutes?.length ? { defaultOffsetsMinutes } : {}),
  };
  const now = new Date();

  let result: ParseResult;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      result = await parseWithLLM(text, now, timezone, prefs);
    } catch (e) {
      // Fall back so capture never dead-ends, and say so plainly.
      result = parseHeuristic(text, now, timezone, prefs);
      result.notice = `The AI service was unavailable (${(e as Error).message}). I used the basic parser instead; please check each task carefully.`;
    }
  } else {
    result = parseHeuristic(text, now, timezone, prefs);
  }

  if (!result.tasks.length) return json({ error: "I couldn't find a task in that. Try describing what you need to do." }, 422);
  return json(result);
}
