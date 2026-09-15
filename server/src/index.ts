import express from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { migrate } from './db.js';
import { requireAuth } from './auth.js';
import { errorMiddleware } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { patientsRouter } from './routes/patients.js';
import { callsRouter, casesRouter, workupRouter } from './routes/cases.js';
import { otEntriesRouter, otListsRouter } from './routes/otLists.js';
import { calendarDownloadRouter, calendarFeedRouter } from './routes/calendar.js';
import { settingsRouter } from './routes/settings.js';
import { dashboardRouter } from './routes/dashboard.js';

migrate();

const app = express();
app.disable('x-powered-by');
// Needed so req.protocol reflects X-Forwarded-Proto behind a reverse proxy.
app.set('trust proxy', true);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// The calendar feed is authenticated by the secret token in its own URL —
// calendar clients cannot present a session cookie.
app.use('/calendar', calendarFeedRouter);

app.use('/api/auth', authRouter);

// Everything past this point needs a signed-in consultant.
app.use('/api', requireAuth);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/cases', casesRouter);
app.use('/api/workup', workupRouter);
app.use('/api/calls', callsRouter);
app.use('/api/ot-lists', otListsRouter);
app.use('/api/ot-list-entries', otEntriesRouter);
app.use('/api/calendar', calendarDownloadRouter);
app.use('/api/settings', settingsRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'No such endpoint' });
});

// In production the built client is served from the same origin, which keeps
// the session cookie same-site. In dev, Vite serves it and proxies /api here.
if (existsSync(join(config.clientDist, 'index.html'))) {
  app.use(express.static(config.clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(join(config.clientDist, 'index.html'));
  });
} else if (config.isProduction) {
  console.warn(`[server] No client build at ${config.clientDist}. Run: npm run build`);
}

app.use(errorMiddleware);

app.listen(config.port, () => {
  console.log(`  OT Manager API listening on http://localhost:${config.port}`);
  if (!config.isProduction) {
    console.log('  Client dev server: http://localhost:5173');
  }
});
