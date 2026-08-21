import assert from "node:assert/strict";
import test from "node:test";
import { createSession, validSameOrigin, verifySession } from "../lib/auth.ts";

test("sessions are signed and expire", () => {
  process.env.SESSION_SECRET = "test-session-secret-that-is-longer-than-32-characters";
  const now = Date.now(), token = createSession(now);
  assert.equal(verifySession(token, now), true);
  assert.equal(verifySession(`${token}x`, now), false);
  assert.equal(verifySession(token, now + 13 * 60 * 60 * 1000), false);
});


test("same-origin validation requires a matching Origin on mutations", () => {
  const url = "http://127.0.0.1:3219/api/settings/legacy/import-runs/run/advance";
  assert.equal(validSameOrigin(new Request(url, { method: "POST", headers: { host: "127.0.0.1:3219" } })), false);
  assert.equal(validSameOrigin(new Request(url, { method: "POST", headers: { host: "127.0.0.1:3219", origin: "http://127.0.0.1:3219" } })), true);
  assert.equal(validSameOrigin(new Request(url, { method: "POST", headers: { host: "127.0.0.1:3219", origin: "https://foreign.example" } })), false);
});
