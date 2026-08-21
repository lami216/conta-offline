export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="login"><form action="/api/auth/login" method="post"><h1>Conta POS</h1><label>كلمة المرور<input name="password" type="password" required autoComplete="current-password" /></label><button type="submit">دخول</button>{error && <p role="alert">كلمة المرور غير صحيحة</p>}</form></main>;
}
