import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError, type ZodTypeAny } from 'zod';

/** Thrown by route code to produce a specific status without a stack trace. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

/** Wrap an async handler so a rejected promise reaches the error middleware. */
export function handler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function parseBody<T extends ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

function validationError(error: ZodError): HttpError {
  const detail = error.issues
    .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    .join('; ');
  return new HttpError(400, detail);
}

/** Route param that must be a positive integer id. */
export function idParam(req: Request, name = 'id'): number {
  const raw = req.params[name];
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `Invalid ${name}`);
  return id;
}

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD date');

export const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected a HH:MM time');

export const monthString = z.string().regex(/^\d{4}-\d{2}$/, 'expected a YYYY-MM month');

/** Empty strings from HTML form fields mean "not set", not "the empty string". */
export const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const boolish = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .transform((v) => (v ? 1 : 0));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    const wrapped = validationError(err);
    res.status(wrapped.status).json({ error: wrapped.message });
    return;
  }
  // SQLite constraint failures are usually the caller's fault, not ours.
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('SQLITE_CONSTRAINT')) {
    res.status(409).json({ error: message });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
}
