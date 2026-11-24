/**
 * The path to send someone to after signing in: where they were headed when
 * the guard intercepted them, if that is a path inside this app.
 *
 * The value comes from the address, which a crafted link controls, so
 * anything that could leave the site (`//evil.example`, `https://…`,
 * `/\evil.example`) or loop back to sign-in falls back to `fallback`.
 */
export function safeReturnPath(candidate: unknown, fallback: string, signInPath: string): string {
  if (typeof candidate !== 'string') return fallback;
  if (!candidate.startsWith('/')) return fallback;
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback;
  // Control characters have no place in a path and are a header-splitting vector.
  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate.charCodeAt(index) < 0x20) return fallback;
  }
  // The URL parser normalizes dot segments and backslashes before routing.
  const base = 'https://clims.invalid';
  let parsed: URL;
  try {
    parsed = new URL(candidate, base);
  } catch {
    return fallback;
  }
  if (parsed.origin !== base) return fallback;
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  if (path === signInPath) return fallback;
  return candidate;
}
