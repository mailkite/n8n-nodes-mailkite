# n8n-nodes-mailkite

[n8n](https://n8n.io) community node for [MailKite](https://mailkite.dev) — send email
from a verified domain with one API call.

## Features

- **Send Email** — `POST /v1/send` with the full MailKite request surface: `from`, `to`,
  `cc`, `bcc`, `replyTo`, `inReplyTo`, `subject`, `html`, `text`, `templateId`/`templateData`,
  `attachments`, `headers`, `metadata`, `sequence`/`sequenceInput`, `scheduledAt`,
  `trackOpens` and `trackClicks`. Omitted fields stay omitted, so domain-level defaults
  (tracking) apply exactly as they would over the raw API.

## Credentials

1. In the MailKite dashboard, create an API key under **Settings → API Keys** (it starts
   with `mk_live_`).
2. In n8n, create a new **MailKite API** credential and paste the key.

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
