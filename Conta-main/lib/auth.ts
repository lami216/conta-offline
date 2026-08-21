import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "conta_session";
const MAX_AGE = 60 * 60 * 12;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return value;
}

function digest(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createSession(now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + MAX_AGE })).toString("base64url");
  return `${payload}.${digest(payload)}`;
}

export function verifySession(token?: string | null, now = Date.now()) {
  if (!token) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = digest(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: number };
    return typeof value.exp === "number" && value.exp > Math.floor(now / 1000);
  } catch { return false; }
}

export function sessionFromRequest(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie.split(";").map(v => v.trim()).find(v => v.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return verifySession(token);
}

/** Password hashes use memory-hard scrypt and a random salt. */
export function verifyPassword(password: string) {
  const configured = process.env.OWNER_PASSWORD_HASH ?? "";
  const [salt, hash, extra] = configured.split(":");
  if (!salt || !hash || extra) return false;
  const actual = scryptSync(password, salt, 64).toString("hex");
  return actual.length === hash.length && timingSafeEqual(Buffer.from(actual), Buffer.from(hash));
}

export function validSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  try { return new URL(origin).origin === `${proto}://${host}`; } catch { return false; }
}

export type OwnerCapability = "settings.backup.manage" | "settings.legacy.import";

/** Central authorization seam for future RBAC. The only current principal is the owner. */
export function requireCapability(request: Request, capability: OwnerCapability) {
  void capability; // Deliberate RBAC seam; every current capability belongs to the sole owner.
  if (!sessionFromRequest(request)) return Response.json({ error: "غير مصرح" }, { status: 401 });
  return null;
}

export const sessionCookieOptions = `Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
