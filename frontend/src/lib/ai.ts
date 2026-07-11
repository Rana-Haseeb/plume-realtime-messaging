import { api } from "./api";

/** Rewrite the user's own draft to read better, keeping its language. */
export async function aiRewrite(text: string, tone?: string): Promise<string> {
  const { result } = await api<{ result: string }>("/api/ai/rewrite", {
    method: "POST",
    body: JSON.stringify({ text, tone }),
  });
  return result;
}

/** Translate any text into a target language (default English). */
export async function aiTranslate(text: string, target = "English"): Promise<string> {
  const { result } = await api<{ result: string }>("/api/ai/translate", {
    method: "POST",
    body: JSON.stringify({ text, target }),
  });
  return result;
}

/** Get three suggested replies to a received message, in its language. */
export async function aiSuggestReplies(text: string): Promise<string[]> {
  const { replies } = await api<{ replies: string[] }>("/api/ai/suggest-replies", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  return replies;
}
