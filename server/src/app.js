import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';
import { db } from './db.js';
import crypto from 'node:crypto';
import { loadSession, csrfProtect, requireAuth, requirePasswordChanged, purgeExpiredSessions } from './auth/session.js';
import { HttpError } from './lib/errors.js';
import { log } from './lib/util.js';
import { RESOURCES } from './resources.js';
import { crudRouter } from './routes/crud.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import businessRoutes from './routes/business.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    strictTransportSecurity: config.cookieSecure ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'same-origin' },
  }));
  // The app never needs the camera, microphone, location, payments or USB; deny them outright.
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });
  app.use(compression());

  // Structured access log (no query strings or bodies, so no personal data in logs)
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (!req.path.startsWith('/api')) return;
      log.info('request', {
        method: req.method, path: req.path, status: res.statusCode,
        ms: Number((process.hrtime.bigint() - start) / 1_000_000n), user: req.user?.id,
      });
    });
    next();
  });

  app.get('/api/health', async (req, res) => {
    try {
      await db.raw('select 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'db_unavailable' });
    }
  });

  // Daily maintenance called by Vercel Cron (it sends "Authorization: Bearer $CRON_SECRET"). Docker uses timers instead.
  app.get('/api/cron/daily', async (req, res) => {
    const auth = String(req.get('authorization') || '');
    const expected = `Bearer ${config.cronSecret}`;
    if (!config.cronSecret || auth.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
      return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    const purged = await purgeExpiredSessions();
    log.info('daily maintenance', { purgedSessions: purged });
    res.json({ ok: true, purgedSessions: purged });
  });

  app.use('/api', rateLimit({
    windowMs: 60_000,
    limit: config.apiRateLimitPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.', code: 'RATE_LIMIT' },
  }));
  app.use('/api/settings', express.json({ limit: '500kb' })); // logo upload
  app.use('/api/admin/restore', express.json({ limit: '60mb' })); // backup file
  app.use('/api', express.json({ limit: '100kb' }));
  app.use('/api', cookieParser());
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', loadSession);
  app.use('/api', csrfProtect);
  app.use('/api', requirePasswordChanged);

  app.use('/api/auth', authRoutes);
  app.use('/api/users', requireAuth, userRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', businessRoutes);
  for (const [name, cfg] of Object.entries(RESOURCES)) {
    app.use(`/api/${name}`, requireAuth, crudRouter(name, cfg));
  }
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

  // Central error handler: consistent JSON, no stack traces or SQL leaked to clients
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.name === 'ZodError') {
      const fields = {};
      for (const i of err.issues) {
        const k = i.path.join('.') || '_';
        if (!fields[k]) fields[k] = i.message;
      }
      return res.status(400).json({ error: 'Please correct the highlighted fields', code: 'VALIDATION', fields });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code, fields: err.fields, details: err.details });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON', code: 'BAD_JSON' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large', code: 'TOO_LARGE' });
    const msg = String(err?.message || '');
    let code = String(err?.code || '');
    if (/UNIQUE constraint failed/.test(msg)) code = 'SQLITE_CONSTRAINT_UNIQUE';
    if (/FOREIGN KEY constraint failed/.test(msg)) code = 'SQLITE_CONSTRAINT_FOREIGNKEY';
    if (code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return res.status(409).json({ error: 'A record with the same name or number already exists.', code: 'DUPLICATE' });
    }
    if (code === '23503' || code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return res.status(409).json({ error: 'This record is used by other entries, so it cannot be removed. Edit it instead.', code: 'IN_USE' });
    }
    log.error('unhandled error', { path: req.path, method: req.method, err: err?.message, stack: config.isProd ? undefined : err?.stack });
    res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'SERVER_ERROR' });
  });

  return app;
}
