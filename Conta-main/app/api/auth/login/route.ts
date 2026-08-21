import { createSession, SESSION_COOKIE, sessionCookieOptions, validSameOrigin, verifyPassword } from "../../../../lib/auth";

export async function POST(request: Request) {
  if (!validSameOrigin(request)) return Response.json({ error: "طلب غير صالح" }, { status: 403 });
  const data = await request.formData();
  const password = data.get("password");
  if (typeof password !== "string" || !verifyPassword(password)) return Response.redirect(new URL("/login?error=1", request.url), 303);
  return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": `${SESSION_COOKIE}=${createSession()}; ${sessionCookieOptions}` } });
}
