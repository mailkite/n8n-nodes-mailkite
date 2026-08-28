import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * Turn an n8n multipleValues string into what `/v1/send` accepts for `to`/`cc`/`bcc`:
 * a single string when there is one recipient, an array when there are several.
 * Returns undefined for an empty/whitespace-only value.
 */
export function toRecipients(value: string): string | string[] | undefined {
	const list = String(value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s !== '');
	if (list.length === 0) return undefined;
	return list.length === 1 ? list[0] : list;
}

/**
 * Normalize the Attachments fixedCollection into the
 * `[{ filename, url | content, contentType? }]` array `/v1/send` accepts.
 * An entry is skipped when it has no filename, or neither url nor content.
 */
export function buildAttachments(
	this: IExecuteFunctions,
	itemIndex: number,
): Array<Record<string, unknown>> {
	const collection = this.getNodeParameter('attachments', itemIndex, {}) as {
		attachment?: Array<{
			filename?: string;
			url?: string;
			content?: string;
			contentType?: string;
		}>;
	};
	const list = collection?.attachment ?? [];
	const out: Array<Record<string, unknown>> = [];
	for (const entry of list) {
		const filename = (entry.filename ?? '').trim();
		const url = (entry.url ?? '').trim();
		const content = (entry.content ?? '').trim();
		const contentType = (entry.contentType ?? '').trim();
		if (filename === '' || (url === '' && content === '')) {
			continue;
		}
		const a: Record<string, unknown> = { filename };
		if (url !== '') a.url = url;
		if (content !== '') a.content = content;
		if (contentType !== '') a.contentType = contentType;
		out.push(a);
	}
	return out;
}

/**
 * Build the `POST /v1/send` body for one input item. Only fields the user
 * actually set are included — omitting a field is meaningfully different from
 * sending it (tracking flags: omitted = domain default, explicit off = off).
 */
export function buildSendBody(this: IExecuteFunctions, itemIndex: number): Record<string, unknown> {
	const body: Record<string, unknown> = {
		from: this.getNodeParameter('from', itemIndex) as string,
		to: toRecipients(this.getNodeParameter('to', itemIndex) as string),
	};

	const setString = (key: string): void => {
		const value = (this.getNodeParameter(key, itemIndex, '') as string).trim();
		if (value !== '') {
			body[key] = value;
		}
	};
	const setJsonObject = (key: string): void => {
		const value = this.getNodeParameter(key, itemIndex, '{}') as string;
		let parsed: unknown;
		try {
			parsed = typeof value === 'string' ? JSON.parse(value) : value;
		} catch {
			throw new NodeOperationError(
				this.getNode(),
				`${key} must be valid JSON — could not parse: ${value}`,
				{ itemIndex },
			);
		}
		if (parsed && typeof parsed === 'object' && Object.keys(parsed as object).length > 0) {
			body[key] = parsed;
		}
	};

	for (const key of [
		'subject',
		'html',
		'text',
		'cc',
		'bcc',
		'replyTo',
		'inReplyTo',
		'templateId',
		'sequence',
		'scheduledAt',
	]) {
		setString(key);
	}

	// The recipient-list fields need the same comma-splitting as `to`.
	for (const key of ['cc', 'bcc']) {
		if (typeof body[key] === 'string') {
			const value = toRecipients(body[key] as string);
			if (value === undefined) {
				delete body[key];
			} else {
				body[key] = value;
			}
		}
	}

	for (const key of ['templateData', 'headers', 'metadata', 'sequenceInput']) {
		setJsonObject(key);
	}

	const trackOpens = this.getNodeParameter('trackOpens', itemIndex, 'default') as string;
	if (trackOpens === 'on') body.trackOpens = true;
	else if (trackOpens === 'off') body.trackOpens = false;

	const trackClicks = this.getNodeParameter('trackClicks', itemIndex, 'default') as string;
	if (trackClicks === 'on') body.trackClicks = true;
	else if (trackClicks === 'off') body.trackClicks = false;

	const attachments = buildAttachments.call(this, itemIndex);
	if (attachments.length > 0) {
		body.attachments = attachments;
	}

	return body;
}
