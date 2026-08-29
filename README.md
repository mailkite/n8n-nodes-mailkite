# n8n-nodes-mailkite

[n8n](https://n8n.io) community node for [MailKite](https://mailkite.dev) — send email
from a verified domain with one API call, and trigger workflows when email arrives.

## Features

- **Send Email** — `POST /v1/send` with the full MailKite request surface: `from`, `to`,
  `cc`, `bcc`, `replyTo`, `inReplyTo`, `subject`, `html`, `text`, `templateId`/`templateData`,
  `attachments`, `headers`, `metadata`, `sequence`/`sequenceInput`, `scheduledAt`,
  `trackOpens` and `trackClicks`. Omitted fields stay omitted, so domain-level defaults
  (tracking) apply exactly as they would over the raw API.
- **MailKite Trigger** — start a workflow when an email arrives at a verified MailKite domain.
  On activation the node registers the domain's catch-all webhook (restoring whatever the
  domain pointed at before on deactivation), verifies every delivery's `x-mailkite-signature`
  HMAC over the raw body, and emits the full `email.received` payload.

## Credentials

1. In the MailKite dashboard, create an API key under **Settings → API Keys** (it starts
   with `mk_live_`).
2. In n8n, create a new **MailKite API** credential and paste the key.

The same credential drives both nodes. For the trigger, the API key must be able to read and
manage the chosen domain's webhook (`GET/PUT/DELETE /api/domains/:id/webhook`) — a
`mk_live_` account key or a domain-scoped key for that domain both work.

## Trigger setup

1. Add a **MailKite Trigger** node and choose an MX-verified domain.
2. Activate the workflow — the node registers the domain's catch-all webhook pointing at the
   n8n URL, and MailKite stores a signing secret that verification uses automatically (no
   setup needed). Set **Webhook Signing Secret Override** only if the secret was rotated in
   the MailKite dashboard.
3. Email sent to `anything@yourdomain.com` now starts the workflow with the `email.received`
   payload (`from`, `to`, `subject`, `text`, `html`, `attachments`, `auth` verdicts, …).

## Install

### Community node (recommended)

Follow n8n's
[community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
and register `n8n-nodes-mailkite`.

### Local development

```sh
npm install
npm run build
npm run lint
```

## License

MIT — see [LICENSE.md](LICENSE.md).
