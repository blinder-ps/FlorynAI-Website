# Floryn backend foundation

## Supabase

1. Create a Supabase project and enable email confirmations.
2. Configure the Site URL as `APP_URL` and add `/auth/callback` plus `/reset-password` as redirect URLs.
3. Apply migrations in filename order with the Supabase CLI: `supabase db reset` locally, then `supabase db push` after review.
4. Seed only local development with `supabase/seed.sql`. Auth users must be created through invitations before their profile and membership rows are added.
5. Store `SUPABASE_SECRET_KEY` and `N8N_WEBHOOK_SECRET` as sensitive, production-only Vercel variables.

## n8n signature

Send the exact raw JSON produced by the workflow. Define `timestamp` as an ISO-8601 UTC value. Generate a lowercase hexadecimal signature from:

```text
HMAC-SHA256(N8N_WEBHOOK_SECRET, timestamp + "." + rawJsonBody)
```

Send `X-Floryn-Timestamp`, `X-Floryn-Signature`, `X-Floryn-Workflow`, and `X-Floryn-Idempotency-Key`. The idempotency key must equal the payload `sync_id`. n8n receives no Supabase database or secret key.

## Authentication

The MVP has no public registration. Invite users from a protected administrative workflow, create a `profiles` row, then add either a `model_members` or `agency_members` row. Disabled profiles are rejected even if their Supabase session remains valid.

## n8n HTTP Request node

The production endpoint is:

```text
POST https://www.florynai.com/api/internal/n8n/earnings-sync
```

Use a Code node immediately before the HTTP Request node. It must generate the exact JSON string that will be sent, because changing whitespace after signing invalidates the signature.

```js
const crypto = require('crypto');
const body = JSON.stringify($json.payload ?? $json);
const timestamp = new Date().toISOString();
const signature = crypto
  .createHmac('sha256', $env.N8N_WEBHOOK_SECRET)
  .update(`${timestamp}.${body}`)
  .digest('hex');

return [{ json: {
  rawBody: body,
  timestamp,
  signature,
  workflow: JSON.parse(body).workflow_name,
  idempotencyKey: JSON.parse(body).sync_id
} }];
```

Configure the HTTP Request node with `Send Body` enabled, body content type `Raw`, content type `application/json`, and body `={{ $json.rawBody }}`. Add these headers:

```text
X-Floryn-Timestamp: {{ $json.timestamp }}
X-Floryn-Signature: {{ $json.signature }}
X-Floryn-Workflow: {{ $json.workflow }}
X-Floryn-Idempotency-Key: {{ $json.idempotencyKey }}
```

Store `N8N_WEBHOOK_SECRET` as an n8n environment variable or encrypted credential. Never place a Supabase secret key in n8n.

## Dashboard data

Authenticated dashboard requests send the Supabase access token to Express. The server calls authorization-aware PostgreSQL functions for summaries, history, model totals, and synchronization health. Transactions use cursor pagination and RLS. Apply `0007_dashboard_functions.sql` before deploying these routes.
