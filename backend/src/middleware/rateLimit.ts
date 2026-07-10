import { Request, Response, NextFunction } from "express";

/**
 * Lightweight in-memory rate limiting (no external dependency).
 *
 * Fixed-window counter keyed by client IP. Good enough for a single-node
 * deployment; for multi-node you'd swap the Map for a shared store (Redis).
 */

interface Bucket {
  count: number;
  resetAt: number;
}

interface Options {
  windowMs: number;
  max: number;
  message?: string;
  keyPrefix?: string;
}

export function rateLimit({
  windowMs,
  max,
  message = "Too many requests, please try again later.",
  keyPrefix = "",
}: Options) {
  const hits = new Map<string, Bucket>();

  // Periodically drop expired buckets so the Map doesn't grow unbounded
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of hits) if (b.resetAt <= now) hits.delete(k);
  }, windowMs);
  if (typeof timer.unref === "function") timer.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyPrefix + (req.ip || req.socket.remoteAddress || "unknown");
    const now = Date.now();

    let bucket = hits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      hits.set(key, bucket);
    }
    bucket.count++;

    const remaining = Math.max(0, max - bucket.count);
    const resetSec = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSec));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(resetSec));
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}

/**
 * A per-key action limiter for non-HTTP contexts (e.g. Socket.io events).
 * Returns a function that reports whether an action for `key` is allowed.
 */
export function createActionLimiter({
  windowMs,
  max,
}: {
  windowMs: number;
  max: number;
}) {
  const hits = new Map<string, Bucket>();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of hits) if (b.resetAt <= now) hits.delete(k);
  }, windowMs);
  if (typeof timer.unref === "function") timer.unref();

  return function allow(key: string): boolean {
    const now = Date.now();
    let bucket = hits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      hits.set(key, bucket);
    }
    bucket.count++;
    return bucket.count <= max;
  };
}
