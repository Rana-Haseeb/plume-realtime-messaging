/**
 * Thin OpenRouter client with automatic model fallback.
 *
 * The API key lives only on the server (OPENROUTER_API_KEY) so it is never
 * exposed to the browser. If one model is down / rate-limited / not found,
 * we transparently retry the next model in the list.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Ordered fallback chain. Override with AI_MODELS="a,b,c" in the environment.
// Gemma (non-reasoning) is preferred for clean answers. The two free Gemma
// models share one upstream rate limit, so a couple of other-provider models
// are appended as last resorts to keep AI working when both Gemmas are 429.
const DEFAULT_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "openai/gpt-oss-120b:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
];

export function aiModels(): string[] {
  const raw = process.env.AI_MODELS?.trim();
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return DEFAULT_MODELS;
}

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * Send a chat completion, trying each model until one succeeds.
 * Throws if every model fails (so callers can return a 502).
 */
export async function aiChat(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("AI is not configured");

  let lastError = "unknown error";

  for (const model of aiModels()) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          // OpenRouter uses these for attribution / rankings (optional).
          "HTTP-Referer": process.env.CLIENT_URL || "http://localhost:3000",
          "X-Title": "Plume Chat",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? 800,
          // Several of the free models are "reasoning" models. Left on, they
          // burn the whole token budget thinking out loud and leak that trace
          // (or run out of tokens before answering). Turn it off for these
          // short, deterministic tasks.
          reasoning: { enabled: false },
        }),
      });

      if (!res.ok) {
        // 404 (unknown model), 429 (rate limit), 5xx → fall through to next model.
        const body = await res.text().catch(() => "");
        lastError = `${model} → ${res.status} ${body}`.slice(0, 300);
        continue;
      }

      const data = (await res.json()) as CompletionResponse;
      const content = stripReasoning(data.choices?.[0]?.message?.content ?? "");
      if (content) return content;
      // 200 but no usable answer (e.g. a thinking-only, truncated reply) →
      // fall through to the next, hopefully non-reasoning, model.
      lastError = `${model} → empty/thinking-only response`;
    } catch (err) {
      lastError = `${model} → ${(err as Error).message}`;
    }
  }

  throw new Error(`All AI models failed (${lastError})`);
}

/**
 * Strip leaked chain-of-thought from a model reply. Reasoning models wrap
 * their thinking in <think>…</think> (sometimes left unclosed when truncated).
 * If nothing but thinking remains, returns "" so the caller can fall back.
 */
export function stripReasoning(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "") // closed think block
    .replace(/<think>[\s\S]*$/i, "") // unclosed (truncated) think block
    .replace(/^<\/think>/i, "")
    .trim();
}

/**
 * Parse a model reply that should be a JSON array of strings.
 * Tolerates ```json fences and falls back to splitting lines.
 */
export function parseStringList(raw: string, limit: number): string[] {
  const cleaned = stripReasoning(raw).replace(/```(?:json)?/gi, "").trim();

  // Weak models sometimes emit two arrays or trailing junk. Try the first
  // JSON array we can find, then the whole string, before giving up to lines.
  const firstArray = cleaned.match(/\[[\s\S]*?\]/)?.[0];
  for (const candidate of [firstArray, cleaned]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        const out = parsed
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          .map((x) => x.trim())
          .slice(0, limit);
        if (out.length) return out;
      }
    } catch {
      /* try next candidate */
    }
  }

  // Line fallback: strip bullets/quotes and drop separator lines like "*****".
  return cleaned
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").replace(/^["']|["']$/g, "").trim())
    .filter((line) => line.length > 0 && !/^[*_=-]{2,}$/.test(line))
    .slice(0, limit);
}
