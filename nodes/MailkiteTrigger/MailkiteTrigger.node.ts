import type {
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	deleteWebhook,
	getDomain,
	getWebhookSecret,
	setWebhook,
	verifySignature,
} from './GenericFunctions';

/**
 * MailKite n8n trigger node.
 *
 * Starts the workflow when an email arrives at a verified MailKite domain. The
 * node registers the domain's single catch-all webhook on activate (stashing any
 * incumbent route so it can be restored on deactivate), verifies each delivery's
 * `x-mailkite-signature` HMAC over the raw body, and emits the `email.received`
 * payload (the exact shape in `sdks/spec/schemas/email-received-event.json`).
 */
export class MailkiteTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MailKite Trigger',
		name: 'mailkiteTrigger',
		icon: { light: 'file:../../icons/mailkite.svg', dark: 'file:../../icons/mailkite.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '=New Inbound Email',
		description: 'Starts the workflow when an email arrives at a verified MailKite domain',
		defaults: {
			name: 'MailKite Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'mailkiteApi',
				required: true,
			},
		],
		requestDefaults: {
			baseURL: 'https://api.mailkite.dev',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Domain Name or ID',
				name: 'domainId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getDomains',
				},
				default: '',
				required: true,
				description:
					'The MX-verified MailKite domain to receive email for. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Acknowledgement Mode',
				name: 'ackMode',
				type: 'options',
				options: [
					{
						name: 'Lenient',
						value: 'lenient',
						description: 'Any 2xx response acknowledges delivery (default)',
					},
					{
						name: 'Ack',
						value: 'ack',
						description:
							'MailKite requires an explicit <code>{"status":"ok"}</code> acknowledgement and retries until it gets one',
					},
				],
				default: 'lenient',
				description: 'How strictly MailKite treats this node\u2019s response',
			},
			{
				displayName: 'Webhook Signing Secret Override',
				name: 'webhookSecret',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description:
					'Signature verification (HMAC-SHA256) is on by default using the secret MailKite issues when this node registers its webhook — no setup needed. Set this only to override that secret (e.g. it was rotated in the MailKite dashboard).',
			},
		],
	};

	methods = {
		loadOptions: {
			async getDomains(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'mailkiteApi',
					{
						method: 'GET',
						url: '/api/domains',
					},
				)) as Array<{ id: string; domain: string; mx_verified?: boolean }>;
				return (response ?? [])
					.filter((d) => d.mx_verified)
					.map((d) => ({ name: d.domain, value: d.id }));
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const domainId = this.getNodeParameter('domainId') as string;
				const webhookUrl = this.getNodeWebhookUrl('default');

				const domain = await getDomain.call(this, domainId);
				if (domain?.webhookUrl === webhookUrl) {
					// Already ours. Re-persist the signing secret so verification keeps
					// working after an n8n restart even if static data was lost.
					const secret = await getWebhookSecret.call(this, domainId);
					if (secret) {
						this.getWorkflowStaticData('node').signingSecret = secret;
					}
					return true;
				}
				return false;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const domainId = this.getNodeParameter('domainId') as string;
				const ackMode = this.getNodeParameter('ackMode', 'lenient') as string;
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!webhookUrl) {
					throw new NodeOperationError(this.getNode(), 'Could not determine the webhook URL');
				}

				// A domain has one catch-all webhook route. Stash whatever is there
				// before we replace it, so delete() can put it back instead of
				// destroying the user's existing wiring.
				const staticData = this.getWorkflowStaticData('node');
				const incumbent = await getDomain.call(this, domainId);
				staticData.incumbentWebhook = incumbent?.webhookUrl
					? { url: incumbent.webhookUrl, ackMode: incumbent.webhookAckMode ?? 'lenient' }
					: null;

				const signingSecret = await setWebhook.call(this, domainId, {
					url: webhookUrl,
					ackMode,
				});
				if (!signingSecret) {
					throw new NodeOperationError(
						this.getNode(),
						'MailKite did not return a signing secret when registering the webhook',
					);
				}
				staticData.signingSecret = signingSecret;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const domainId = this.getNodeParameter('domainId') as string;
				const staticData = this.getWorkflowStaticData('node');
				const incumbent = staticData.incumbentWebhook as
					| { url: string; ackMode: string }
					| null
					| undefined;

				if (incumbent?.url) {
					await setWebhook.call(this, domainId, {
						url: incumbent.url,
						ackMode: incumbent.ackMode,
					});
				} else {
					await deleteWebhook.call(this, domainId);
				}

				delete staticData.incumbentWebhook;
				delete staticData.signingSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const res = this.getResponseObject();
		const ackMode = this.getNodeParameter('ackMode', 'lenient') as string;

		// Acknowledge first so MailKite does not retry, then verify. In `ack` mode
		// the 2xx must carry an explicit acknowledgement body, otherwise the
		// delivery reads as failed and MailKite retries it.
		if (ackMode === 'ack') {
			res.status(200).json({ status: 'ok' });
		} else {
			res.status(200).send('ok');
		}

		const body = this.getBodyData();
		const rawBody = this.getRequestObject().rawBody;
		const signatureHeader = this.getHeaderData()['x-mailkite-signature'] as string | undefined;

		// Verification runs over the raw body only — re-serializing the parsed body
		// cannot reproduce the exact bytes MailKite signed. The secret persisted at
		// create() makes this always-on; `webhookSecret` only overrides it.
		const secret = ((this.getNodeParameter('webhookSecret', '') as string).trim() ||
			this.getWorkflowStaticData('node').signingSecret) as string | undefined;
		if (secret) {
			if (!rawBody) {
				this.logger.warn(
					'Rejected event: no raw body available, so the x-mailkite-signature cannot be verified — dropped rather than emitted unverified',
				);
				return { noWebhookResponse: true };
			}
			if (!verifySignature(secret, signatureHeader, rawBody)) {
				this.logger.warn('Rejected event: invalid or stale x-mailkite-signature');
				return { noWebhookResponse: true };
			}
		}

		// Only emit inbound mail.
		if (body?.type !== 'email.received') {
			return { noWebhookResponse: true };
		}

		return {
			noWebhookResponse: true,
			workflowData: [[{ json: body }]],
		};
	}
}
