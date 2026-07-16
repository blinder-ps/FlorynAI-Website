# Floryn AI deployment

## Required environment variables

Copy `.env.example` into your hosting provider's environment-variable settings. Do not commit a real `.env` file.

Required for email delivery:

- `SMTP_HOST`: SMTP hostname supplied by the email provider
- `SMTP_PORT`: normally `587` for STARTTLS or `465` for implicit TLS
- `SMTP_SECURE`: `false` for port 587, `true` for port 465
- `SMTP_USER`: SMTP username
- `SMTP_PASS`: SMTP password or app password
- `MAIL_FROM`: a sender identity authorized by the SMTP provider
- `MAIL_TO`: `info@florynai.com`
- `ALLOWED_ORIGINS`: comma-separated production origins such as `https://florynai.com,https://www.florynai.com`
- `NODE_ENV`: `production`
- `TRUST_PROXY`: `1` when deployed behind one trusted reverse proxy

## Deploy

Use Node.js 20 or newer.

```sh
npm ci --omit=dev
npm start
```

The app listens on `PORT`, defaulting to `3000`. Terminate TLS at the hosting platform or reverse proxy and redirect HTTP to HTTPS.

## Email provider setup

Configure SPF and DKIM for the domain used in `MAIL_FROM`. Where supported, add DMARC after SPF and DKIM pass. The visitor's address is used only as `Reply-To`; it is never used as the sender, which helps prevent spoofing and delivery failures.

## Health check

Configure the platform health check to request:

```text
GET /api/health
```

A healthy instance responds with HTTP 200 and `{ "ok": true }`.

## Form endpoints

- `POST /api/applications` sends early-access applications to `MAIL_TO`.
- `POST /api/contact` sends contact and demo requests to `MAIL_TO`.

Both endpoints validate and limit input, reject unapproved browser origins, limit repeated submissions by IP, and return generic errors without exposing server details.

## Pre-deployment check

```sh
npm run check
npm audit --omit=dev
```

Never expose `.env`, SMTP credentials, server logs, or the `node_modules` directory through a public artifact upload.
