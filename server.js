'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { z } = require('zod');

const app = express();
const port = Number(process.env.PORT) || 3000;
const root = __dirname;
const publicDir = path.join(root, 'public');
const isProduction = process.env.NODE_ENV === 'production';
const mailTo = process.env.MAIL_TO || 'info@florynai.com';
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean));

if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(compression());
app.use(express.json({ limit: '20kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const sameOrigin = origin === `${req.protocol}://${req.get('host')}`;
  if (sameOrigin || allowedOrigins.has(origin)) return next();
  return res.status(403).json({ ok: false, message: 'Origin not allowed.' });
});

const submissionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, message: 'Too many requests. Please try again later.' }
});

const clean = z.string().trim().min(1).max(200).transform(value => value.replace(/[<>]/g, ''));
const email = z.string().trim().email().max(254);
const webAddress = z.string().trim().min(3, 'Enter a social profile or website.').max(500)
  .transform(value => /^https?:\/\//i.test(value) ? value : `https://${value}`)
  .pipe(z.string().url('Enter a valid social profile or website.'));
const applicationSchema = z.object({
  name: clean,
  email,
  category: z.enum(['Independent Model', 'Model Agency']),
  audience: clean,
  social: webAddress,
  usecase: z.string().trim().min(10, 'Tell us a little more about your use case (at least 10 characters).').max(3000).transform(value => value.replace(/[<>]/g, '')),
  company: z.string().max(0).optional().default('')
}).strict();
const contactSchema = z.object({
  name: clean,
  email,
  subject: clean,
  message: z.string().trim().min(10).max(3000).transform(value => value.replace(/[<>]/g, '')),
  company: z.string().max(0).optional().default('')
}).strict();

let transporter;
function getTransporter() {
  if (transporter) return transporter;
  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Mail service is not configured: ${missing.join(', ')}`);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
  });
  return transporter;
}

function textRows(data) {
  return Object.entries(data).filter(([key]) => key !== 'company').map(([key, value]) => `${key.toUpperCase()}: ${value}`).join('\n\n');
}
async function sendSubmission(type, data) {
  const subject = type === 'application' ? `New early access application — ${data.name}` : `Website contact — ${data.subject}`;
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM,
    to: mailTo,
    replyTo: data.email,
    subject,
    text: `New ${type} received from the Floryn AI website.\n\n${textRows(data)}`
  });
}

function endpoint(schema, type) {
  return async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        message: 'Please check the highlighted fields and try again.',
        fields: parsed.error.flatten().fieldErrors
      });
    }
    if (parsed.data.company) return res.status(200).json({ ok: true });
    try {
      await sendSubmission(type, parsed.data);
      return res.status(200).json({ ok: true, message: 'Request sent successfully.' });
    } catch (error) {
      console.error('Submission delivery failed:', error.message);
      return res.status(503).json({ ok: false, message: 'We could not send your request right now. Please try again shortly.' });
    }
  };
}

app.post('/api/applications', submissionLimiter, endpoint(applicationSchema, 'application'));
app.post('/api/contact', submissionLimiter, endpoint(contactSchema, 'contact'));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(publicDir, { dotfiles: 'deny', etag: true, maxAge: isProduction ? '1h' : 0, index: 'index.html' }));
app.use('/api', (_req, res) => res.status(404).json({ ok: false, message: 'Not found.' }));
app.use((_req, res) => res.status(404).sendFile(path.join(publicDir, 'index.html')));
app.use((error, _req, res, _next) => {
  console.error('Unhandled request error:', error.message);
  res.status(500).json({ ok: false, message: 'Unexpected server error.' });
});

if (require.main === module) {
  app.listen(port, '0.0.0.0', () => console.log(`Floryn AI listening on port ${port}`));
}

module.exports = app;
