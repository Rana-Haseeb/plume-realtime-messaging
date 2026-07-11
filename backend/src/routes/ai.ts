import { Router, Response } from "express";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { aiChat, aiConfigured, parseStringList } from "../utils/ai";

const router = Router();

router.use(requireAuth);

const MAX_INPUT = 4000;

/** Reject early (503) when the server has no API key configured. */
function ensureConfigured(res: Response): boolean {
  if (!aiConfigured()) {
    res.status(503).json({ error: "AI features are not configured on the server." });
    return false;
  }
  return true;
}

function readText(value: unknown): string {
  return String(value ?? "").slice(0, MAX_INPUT).trim();
}

/** Rewrite the user's own draft in a chosen tone, keeping its language. */
router.post("/rewrite", async (req: AuthRequest, res: Response) => {
  if (!ensureConfigured(res)) return;
  const text = readText(req.body?.text);
  const tone = String(req.body?.tone ?? "clear and polished").slice(0, 40);
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  try {
    const result = await aiChat(
      [
        {
          role: "system",
          content:
            `You rewrite a chat message so it sounds ${tone}, keeping the original ` +
            `meaning. ALWAYS improve it — fix spelling, grammar, punctuation and ` +
            `capitalization, remove typos and repeated/elongated letters ` +
            `(e.g. "hoooo" -> "ho", "plzzz" -> "please"), and make it read ` +
            `smoothly. Never return the message unchanged. ` +
            `Reply in the SAME language AND the SAME script as the input: ` +
            `if it is written in Latin/Roman letters (e.g. Roman Urdu, Hinglish), ` +
            `keep it in Latin letters — never convert it to Urdu, Hindi, Arabic or ` +
            `any other script, and do not translate. ` +
            `Return ONLY the final rewritten message — no thinking, quotes, ` +
            `labels, notes, or alternative versions.`,
        },
        { role: "user", content: text },
      ],
      { temperature: 0.7 }
    );
    res.json({ result });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/** Translate any text into a target language (default English). */
router.post("/translate", async (req: AuthRequest, res: Response) => {
  if (!ensureConfigured(res)) return;
  const text = readText(req.body?.text);
  const target = String(req.body?.target ?? "English").slice(0, 40);
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  try {
    const result = await aiChat(
      [
        {
          role: "system",
          content:
            `Translate the user's message into ${target}. Auto-detect the source ` +
            `language (it may be Roman Urdu / Hinglish written in Latin letters). ` +
            `Do NOT think out loud or explain. Return ONLY the ${target} translation ` +
            `— a single line, no notes. If it is already in ${target}, return it unchanged.`,
        },
        { role: "user", content: text },
      ],
      { temperature: 0.2 }
    );
    res.json({ result });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/** Suggest three distinct replies to a received message, in its language. */
router.post("/suggest-replies", async (req: AuthRequest, res: Response) => {
  if (!ensureConfigured(res)) return;
  const text = readText(req.body?.text);
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  try {
    const raw = await aiChat(
      [
        {
          role: "system",
          content:
            "You help a user reply in a chat. Given a message they RECEIVED, " +
            "propose 3 short, natural, and clearly distinct replies (e.g. one " +
            "agreeing, one asking a follow-up, one neutral). Write the replies in " +
            "the SAME language AND SAME script as the received message (if it is " +
            "Roman Urdu / Hinglish in Latin letters, reply in Latin letters). " +
            "Do NOT think out loud. Output EXACTLY ONE JSON array of 3 strings and " +
            'nothing else — no second version, no separators. Example: ["...","...","..."].',
        },
        { role: "user", content: text },
      ],
      { temperature: 0.5 }
    );
    const replies = parseStringList(raw, 3);
    if (replies.length === 0) {
      res.status(502).json({ error: "Could not generate replies" });
      return;
    }
    res.json({ replies });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

export default router;
