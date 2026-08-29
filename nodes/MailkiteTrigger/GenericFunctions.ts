import { createHmac, timingSafeEqual } from 'crypto';
import type { IHookFunctions } from 'n8n-workflow';

/**
 * How far (in either direction) a delivery's signature timestamp may drift from
 * the current clock before it is rejected as stale. The same window the MailKite
 * SDKs enforce (`DEFAULT_TOLERANCE_MS` in the Node SDK), so a delivery captured
 * off the wire stops verifying once it is old, and a timestamp far in the future
 * is equally suspect.
 */
export const FRESHNESS_MS = 5 * 60 * 1000;

/**
 * A MailKite domain row as returned by `GET /api/domains/:id`. Only the fields
 * the trigger reads are declared; the API returns more.
 */
export interface MailkiteDomain {
	id: string;
	domain: string;
	mx_verified?: boolean;
	webhookUrl?: string | null;
	webhookAckMode?: string | null;
}

/**
 * Verify an `x-mailkite-signature: t=<ms>,v1=<hex>` header over the exact bytes
 * MailKite signed. Mirrors the canonical verifier — `MailKite.verifyWebhook` in
 * the MailKite Node SDK — so there is one algorithm to reason about: `v1` is
 * `HMAC-SHA256(secret, "<t>.<rawBody>")` as lowercase hex, and `t` is
 * milliseconds since the epoch. The comparison is over decoded bytes and
 * constant-time.
 *
 * @param secret - The webhook signing secret (`whsec_…`).
 * @param signatureHeader - Raw `x-mailkite-signature` header value.
 * @param rawBody - The unparsed request body, byte-for-byte as delivered.
 * @param toleranceMs - Replay window in ms; `0` disables the freshness check.
 * @returns `true` only if the header is well-formed, fresh, and authentic.
 */
export function verifySignature(
	secret: string,
	signatureHeader: string | undefined,
	rawBody: Buffer,
	toleranceMs: number = FRESHNESS_MS,
): boolean {
	if (typeof signatureHeader !== 'string' || !signatureHeader) {
		return false;
	}

	const parts: Record<string, string> = {};
	for (const segment of signatureHeader.split(',')) {
		const i = segment.indexOf('=');
		if (i !== -1) {
			parts[segment.slice(0, i).trim()] = segment.slice(i + 1).trim();
		}
	}

	const t = Number(parts.t);
	if (!parts.t || !parts.v1 || !Number.isFinite(t)) {
		return false;
	}

	// Freshness: a delivery captured off the wire stops verifying once it is
	// stale, and a timestamp far in the future is equally suspect.
	if (toleranceMs > 0 && Math.abs(Date.now() - t) > toleranceMs) {
		return false;
	}

	const expected = createHmac('sha256', secret).update(`${parts.t}.`).update(rawBody).digest('hex');

	// Compare decoded bytes, as the SDK does — invalid hex decodes short and
	// fails on length.
	const a = Buffer.from(expected, 'hex');
	const b = Buffer.from(parts.v1, 'hex');
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Fetch one domain — `GET /api/domains/:id`. The response is `{ domain, dns }`;
 * only the domain is returned. Its `webhookUrl` / `webhookAckMode` describe the
 * domain's current catch-all webhook route, which the trigger stashes before
 * taking it over.
 */
export async function getDomain(
	this: IHookFunctions,
	domainId: string,
): Promise<MailkiteDomain | null> {
	const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'mailkiteApi', {
		method: 'GET',
		url: `/api/domains/${domainId}`,
	})) as { domain?: MailkiteDomain };
	return response?.domain ?? null;
}

/**
 * Read the domain's catch-all webhook signing secret —
 * `GET /api/domains/:id/webhook/secret`. Returns null when the domain has no
 * webhook set (404 `no_webhook`).
 */
export async function getWebhookSecret(
	this: IHookFunctions,
	domainId: string,
): Promise<string | null> {
	const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'mailkiteApi', {
		method: 'GET',
		url: `/api/domains/${domainId}/webhook/secret`,
	})) as { secret?: string };
	return response?.secret ?? null;
}

/**
 * Register (or replace) the domain's catch-all inbound webhook —
 * `PUT /api/domains/:id/webhook`. A domain has exactly one, so this overwrites
 * any incumbent route. Returns the route's `signingSecret`, which is the HMAC
 * key for `x-mailkite-signature` and is returned here only.
 */
export async function setWebhook(
	this: IHookFunctions,
	domainId: string,
	data: { url: string; ackMode: string },
): Promise<string | null> {
	const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'mailkiteApi', {
		method: 'PUT',
		url: `/api/domains/${domainId}/webhook`,
		body: data,
		json: true,
	})) as { signingSecret?: string };
	return response?.signingSecret ?? null;
}

/**
 * Remove the domain's catch-all inbound webhook — `DELETE /api/domains/:id/webhook`.
 * Inbound mail stops being POSTed anywhere, so only call this when the domain
 * had no webhook before the trigger took it over.
 */
export async function deleteWebhook(this: IHookFunctions, domainId: string): Promise<void> {
	await this.helpers.httpRequestWithAuthentication.call(this, 'mailkiteApi', {
		method: 'DELETE',
		url: `/api/domains/${domainId}/webhook`,
	});
}
