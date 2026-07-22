import { describe, expect, it } from 'bun:test'
import {
  authConfigFromEnv,
  verifyCredentials,
  signSession,
  verifySession,
  parseCookies,
  sessionSetCookie,
  sessionClearCookie,
  SESSION_COOKIE,
} from './auth.js'

const cfg = { username: 'admin', password: 'test-fixture-pw', secret: 'test-secret', ttlSec: 3600 }

describe('authConfigFromEnv', () => {
  it('defaults username to admin and generates a random password when env is empty', () => {
    const a = authConfigFromEnv({})
    const b = authConfigFromEnv({})
    expect(a.username).toBe('admin')
    // No hardcoded password: the fallback is random per call, so two empty-env
    // configs must not share a password.
    expect(a.password.length).toBeGreaterThan(0)
    expect(a.password).not.toBe(b.password)
    expect(a.secret.length).toBeGreaterThan(0)
    expect(a.ttlSec).toBeGreaterThan(0)
  })

  it('reads overrides from env', () => {
    const c = authConfigFromEnv({ AUTH_USERNAME: 'bob', AUTH_PASSWORD: 'pw', SESSION_SECRET: 's', SESSION_TTL_SEC: '60' })
    expect(c.username).toBe('bob')
    expect(c.password).toBe('pw')
    expect(c.secret).toBe('s')
    expect(c.ttlSec).toBe(60)
  })
})

describe('verifyCredentials', () => {
  it('accepts the exact username and password', () => {
    expect(verifyCredentials(cfg, 'admin', 'test-fixture-pw')).toBe(true)
  })
  it('rejects a wrong password', () => {
    expect(verifyCredentials(cfg, 'admin', 'nope')).toBe(false)
  })
  it('rejects a wrong username', () => {
    expect(verifyCredentials(cfg, 'root', 'test-fixture-pw')).toBe(false)
  })
  it('rejects empty credentials', () => {
    expect(verifyCredentials(cfg, '', '')).toBe(false)
  })
})

describe('signSession / verifySession', () => {
  it('round-trips a freshly signed session', () => {
    const now = 1_000_000
    const token = signSession(cfg, now)
    expect(verifySession(cfg, token, now)).toBe(true)
  })

  it('rejects an expired session', () => {
    const now = 1_000_000
    const token = signSession(cfg, now)
    expect(verifySession(cfg, token, now + cfg.ttlSec + 1)).toBe(false)
  })

  it('rejects a tampered payload', () => {
    const now = 1_000_000
    const token = signSession(cfg, now)
    const tampered = 'x' + token.slice(1)
    expect(verifySession(cfg, tampered, now)).toBe(false)
  })

  it('rejects a token signed with a different secret', () => {
    const now = 1_000_000
    const token = signSession({ ...cfg, secret: 'other' }, now)
    expect(verifySession(cfg, token, now)).toBe(false)
  })

  it('rejects garbage', () => {
    expect(verifySession(cfg, 'not-a-token', 1_000_000)).toBe(false)
    expect(verifySession(cfg, '', 1_000_000)).toBe(false)
  })
})

describe('parseCookies', () => {
  it('parses a cookie header into a map', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' })
  })
  it('returns an empty map for missing/blank headers', () => {
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('')).toEqual({})
  })
  it('handles values that contain =', () => {
    expect(parseCookies(`${SESSION_COOKIE}=abc.def==`)[SESSION_COOKIE]).toBe('abc.def==')
  })
})

describe('cookie headers', () => {
  it('sessionSetCookie is HttpOnly and scoped to /', () => {
    const header = sessionSetCookie('value123', 3600)
    expect(header).toContain(`${SESSION_COOKIE}=value123`)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Path=/')
    expect(header).toContain('Max-Age=3600')
    expect(header).toContain('SameSite=Lax')
  })
  it('sessionClearCookie expires the cookie', () => {
    const header = sessionClearCookie()
    expect(header).toContain(`${SESSION_COOKIE}=`)
    expect(header).toContain('Max-Age=0')
  })
})
