import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, createActionLimiter } from "./rateLimit";

/** Minimal Express req/res stubs for exercising the middleware. */
function mockReqRes(ip: string) {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let jsonBody: unknown = null;
  const req = { ip, socket: { remoteAddress: ip } } as never;
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      jsonBody = body;
      return this;
    },
  } as never;
  return {
    req,
    res,
    get status() {
      return statusCode;
    },
    get body() {
      return jsonBody;
    },
    headers,
  };
}

test("rateLimit allows requests up to the max, then blocks with 429", () => {
  const mw = rateLimit({ windowMs: 60_000, max: 3 });
  let nextCalls = 0;
  const next = () => {
    nextCalls++;
  };

  for (let i = 0; i < 3; i++) {
    const ctx = mockReqRes("1.1.1.1");
    mw(ctx.req, ctx.res, next);
    assert.equal(ctx.status, 200, `request ${i + 1} should pass`);
  }
  assert.equal(nextCalls, 3);

  // 4th request over the limit → blocked
  const blocked = mockReqRes("1.1.1.1");
  mw(blocked.req, blocked.res, next);
  assert.equal(blocked.status, 429);
  assert.deepEqual(Object.keys(blocked.body as object), ["error"]);
  assert.ok(blocked.headers["Retry-After"]);
  assert.equal(nextCalls, 3, "next() should not be called when blocked");
});

test("rateLimit tracks limits per IP independently", () => {
  const mw = rateLimit({ windowMs: 60_000, max: 1 });
  const next = () => {};

  const a1 = mockReqRes("2.2.2.2");
  mw(a1.req, a1.res, next);
  assert.equal(a1.status, 200);

  const a2 = mockReqRes("2.2.2.2");
  mw(a2.req, a2.res, next);
  assert.equal(a2.status, 429, "second hit from same IP is blocked");

  const b1 = mockReqRes("3.3.3.3");
  mw(b1.req, b1.res, next);
  assert.equal(b1.status, 200, "a different IP is unaffected");
});

test("rateLimit window resets after windowMs", async () => {
  const mw = rateLimit({ windowMs: 40, max: 1 });
  const next = () => {};

  const first = mockReqRes("4.4.4.4");
  mw(first.req, first.res, next);
  assert.equal(first.status, 200);

  const blocked = mockReqRes("4.4.4.4");
  mw(blocked.req, blocked.res, next);
  assert.equal(blocked.status, 429);

  await new Promise((r) => setTimeout(r, 55));

  const afterReset = mockReqRes("4.4.4.4");
  mw(afterReset.req, afterReset.res, next);
  assert.equal(afterReset.status, 200, "window should have reset");
});

test("createActionLimiter returns false once the cap is exceeded", () => {
  const allow = createActionLimiter({ windowMs: 60_000, max: 2 });
  assert.equal(allow("user-a"), true);
  assert.equal(allow("user-a"), true);
  assert.equal(allow("user-a"), false, "third action for same key is denied");
  assert.equal(allow("user-b"), true, "a different key is independent");
});
