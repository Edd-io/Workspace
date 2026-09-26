import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Database } from '../db/database.ts';
import type { OfficeStore } from '../store/officeStore.ts';

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const PASSWORD_SETTING = 'auth.passwordHash';

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: 256 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  private readonly db: Database;
  private readonly store: OfficeStore;
  private readonly attempts = new Map<string, number[]>();

  constructor(db: Database, store: OfficeStore) {
    this.db = db;
    this.store = store;
  }

  isPasswordSet(): boolean {
    return this.store.getSetting(PASSWORD_SETTING) !== null;
  }

  async setPassword(password: string): Promise<void> {
    this.store.setSetting(PASSWORD_SETTING, await hashPassword(password));
    // Changing the password logs every device out.
    this.db.prepare('DELETE FROM auth_sessions').run();
  }

  /** Returns false when the client exceeded the allowed number of attempts. */
  private allowAttempt(clientKey: string): boolean {
    const now = Date.now();
    const recent = (this.attempts.get(clientKey) ?? []).filter((ts) => now - ts < LOGIN_WINDOW_MS);
    recent.push(now);
    this.attempts.set(clientKey, recent);
    return recent.length <= LOGIN_MAX_ATTEMPTS;
  }

  async login(
    password: string,
    clientKey: string,
  ): Promise<{ token: string } | { error: 'rate_limited' | 'invalid' | 'no_password' }> {
    if (!this.allowAttempt(clientKey)) return { error: 'rate_limited' };
    const stored = this.store.getSetting(PASSWORD_SETTING);
    if (!stored) return { error: 'no_password' };
    if (!(await verifyPassword(password, stored))) return { error: 'invalid' };
    this.attempts.delete(clientKey);

    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO auth_sessions (token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?)',
      )
      .run(hashToken(token), now, now + SESSION_TTL_MS, now);
    return { token };
  }

  /** Validates a session token and slides its expiry. */
  validate(token: string | undefined): boolean {
    if (!token) return false;
    const tokenHash = hashToken(token);
    const row = this.db
      .prepare('SELECT expires_at FROM auth_sessions WHERE token_hash = ?')
      .get(tokenHash) as { expires_at: number } | undefined;
    const now = Date.now();
    if (!row || row.expires_at < now) return false;
    this.db
      .prepare('UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .run(now, now + SESSION_TTL_MS, tokenHash);
    return true;
  }

  logout(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token));
  }

  purgeExpired(): void {
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(Date.now());
  }
}

export const SESSION_COOKIE = 'workspace_session';
export const SESSION_COOKIE_MAX_AGE_S = SESSION_TTL_MS / 1000;
