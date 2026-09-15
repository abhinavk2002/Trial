import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

const SCRYPT_KEYLEN = 64;
export const SESSION_COOKIE = 'ot_session';

/** scrypt so we avoid a native bcrypt dependency. Format: scrypt$salt$hash */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Stateless session cookie: "<userId>.<expiresAt>.<hmac>". Signed with
 * SESSION_SECRET, so rotating the secret invalidates every session.
 */
export function createSessionToken(userId: number): string {
  const expiresAt = Date.now() + config.sessionMaxAgeMs;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawId, rawExpiry, signature] = parts as [string, string, string];

  const expected = sign(`${rawId}.${rawExpiry}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const expiresAt = Number(rawExpiry);
  const userId = Number(rawId);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(userId)) return null;
  if (Date.now() > expiresAt) return null;
  return userId;
}

function sign(payload: string): string {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
}

export function setSessionCookie(res: Response, userId: number): void {
  res.cookie(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: config.sessionMaxAgeMs,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = readSessionToken(req.cookies?.[SESSION_COOKIE]);
  if (userId === null) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }
  req.userId = userId;
  next();
}
