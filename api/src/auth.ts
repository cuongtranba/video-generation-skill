import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** The signed, HttpOnly session cookie name. */
export const SESSION_COOKIE = 'vg_session'

/** Single-user auth configuration, resolved from the environment at boot. */
export interface AuthConfig {
  username: string
  password: string
  /** HMAC key for signing session cookies. */
  secret: string
  /** Session lifetime in seconds. */
  ttlSec: number
}

interface SessionPayload {
  u: string
  exp: number
}

const DEFAULT_USERNAME = 'admin'
const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60 // 7 days

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

/** Resolve auth config from env. The password is NEVER hardcoded — it comes from
 * AUTH_PASSWORD (set in .env locally, in the deploy environment / dokploy in
 * production). If it is unset the api falls back to a random per-boot password
 * (logged) so an unconfigured deploy fails closed instead of shipping a known
 * credential. SESSION_SECRET likewise falls back to a per-process random key —
 * set a stable value in production or a restart invalidates sessions. */
export function authConfigFromEnv(env: Record<string, string | undefined>): AuthConfig {
  const ttlRaw = env.SESSION_TTL_SEC ? Number(env.SESSION_TTL_SEC) : DEFAULT_TTL_SEC
  let password = env.AUTH_PASSWORD
  if (!present(password)) {
    password = randomBytes(24).toString('base64url')
    console.warn('AUTH_PASSWORD is not set — generated a random per-boot password; set AUTH_PASSWORD to enable login.')
  }
  return {
    username: present(env.AUTH_USERNAME) ? env.AUTH_USERNAME : DEFAULT_USERNAME,
    password,
    secret: present(env.SESSION_SECRET) ? env.SESSION_SECRET : randomBytes(32).toString('hex'),
    ttlSec: Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : DEFAULT_TTL_SEC,
  }
}

/** Length-independent, constant-time string comparison: both sides are hashed
 * to a fixed 32 bytes first so timingSafeEqual never sees mismatched lengths
 * (which would throw) and the comparison leaks neither length nor content. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest()
  const hb = createHmac('sha256', 'cmp').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function verifyCredentials(config: AuthConfig, username: string, password: string): boolean {
  // Evaluate both comparisons regardless of the first result to avoid an
  // early-exit timing side channel on the username.
  const okUser = safeEqual(username, config.username)
  const okPass = safeEqual(password, config.password)
  return okUser && okPass
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url')
}

/** Produce a stateless signed session token: base64url(payload).signature. */
export function signSession(config: AuthConfig, nowSec: number): string {
  const payload: SessionPayload = { u: config.username, exp: nowSec + config.ttlSec }
  const payloadB64 = b64url(JSON.stringify(payload))
  return `${payloadB64}.${sign(payloadB64, config.secret)}`
}

/** Verify a session token's signature and expiry against the given clock. */
export function verifySession(config: AuthConfig, token: string, nowSec: number): boolean {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(payloadB64, config.secret)
  if (!safeEqual(sig, expected)) return false
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) return false
    const { u, exp } = parsed as Record<string, unknown>
    if (typeof u !== 'string' || typeof exp !== 'number') return false
    return exp > nowSec
  } catch {
    return false
  }
}

/** Parse a Cookie request header into a name→value map. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (name) out[name] = value
  }
  return out
}

/** Set-Cookie header for a signed session. HttpOnly keeps it out of JS; the
 * SPA tracks only the boolean auth status from GET /api/session. */
export function sessionSetCookie(value: string, ttlSec: number): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${ttlSec}`
}

/** Set-Cookie header that immediately expires the session cookie (logout). */
export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
}
