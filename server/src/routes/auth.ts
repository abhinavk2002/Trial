import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db.js';
import {
  clearSessionCookie,
  hashPassword,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from '../auth.js';
import { handler, HttpError, parseBody } from '../lib/http.js';

export const authRouter = Router();

interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  calendar_token: string;
}

function findByEmail(email: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | UserRow
    | undefined;
}

function findById(id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    calendar_token: user.calendar_token,
  };
}

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required'),
});

authRouter.post(
  '/login',
  handler((req, res) => {
    const { email, password } = parseBody(loginSchema, req.body);
    const user = findByEmail(email);

    // Same message either way so the form cannot be used to probe for accounts.
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Incorrect email or password');
    }

    setSessionCookie(res, user.id);
    res.json({ user: publicUser(user) });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  requireAuth,
  handler((req, res) => {
    const user = findById(req.userId!);
    if (!user) {
      clearSessionCookie(res);
      throw new HttpError(401, 'Not signed in');
    }
    res.json({ user: publicUser(user) });
  }),
);

const profileSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
});

authRouter.patch(
  '/me',
  requireAuth,
  handler((req, res) => {
    const patch = parseBody(profileSchema, req.body);
    const user = findById(req.userId!);
    if (!user) throw new HttpError(401, 'Not signed in');

    db.prepare(
      `UPDATE users SET name = ?, email = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(patch.name ?? user.name, (patch.email ?? user.email).toLowerCase(), user.id);

    res.json({ user: publicUser(findById(user.id)!) });
  }),
);

const passwordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(8, 'New password must be at least 8 characters'),
});

authRouter.post(
  '/change-password',
  requireAuth,
  handler((req, res) => {
    const { current_password, new_password } = parseBody(passwordSchema, req.body);
    const user = findById(req.userId!);
    if (!user) throw new HttpError(401, 'Not signed in');
    if (!verifyPassword(current_password, user.password_hash)) {
      throw new HttpError(400, 'Current password is incorrect');
    }

    db.prepare(
      `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(hashPassword(new_password), user.id);

    // Re-issue so the caller's own session stays valid.
    setSessionCookie(res, user.id);
    res.json({ ok: true });
  }),
);

/** Rotating the token instantly kills any calendar subscription using the old URL. */
authRouter.post(
  '/rotate-calendar-token',
  requireAuth,
  handler((req, res) => {
    const token = randomBytes(24).toString('hex');
    db.prepare(
      `UPDATE users SET calendar_token = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(token, req.userId!);
    res.json({ calendar_token: token });
  }),
);
