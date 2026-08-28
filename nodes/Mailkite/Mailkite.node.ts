import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { buildSendBody } from './GenericFunctions';

/**
 * MailKite n8n node.
 *
 * Sends email through the MailKite API (`POST /v1/send`) from a verified domain.
 * The request body mirrors `sdks/spec/schemas/send-request.json` exactly: `from`
 * and `to` are required, everything else is optional and is only sent when the
 * user has set it (omitted fields mean "use the domain default", most sharply for
 * the tracking flags).
 */
export class Mailkite implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MailKite',
		name: 'mailkite',
		icon: { light: 'file:../../icons/mailkite.svg', dark: 'file:../../icons/mailkite.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Send email via the MailKite API from a verified domain',
		defaults: {
			name: 'MailKite',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
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
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Send Email',
						value: 'send',
						action: 'Send an email',
						description: 'Send an email from a verified MailKite domain',
					},
				],
				default: 'send',
			},

			// -- Send Email fields (mirror send-request.json) -------------------

			{
				displayName: 'From',
				name: 'from',
				type: 'string',
				default: '',
				required: true,
				description: 'Sender address on a verified domain, e.g. <code>support@yourdomain.com</code>',
			},
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				typeOptions: {
					multipleValues: true,
				},
				default: '',
				required: true,
				description: 'One or more recipient addresses',
			},
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				default: '',
				description: 'Email subject. Required unless you send a template.',
			},
			{
				displayName: 'HTML Body',
				name: 'html',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				description: 'HTML content. Provide HTML, text, or a template.',
			},
			{
				displayName: 'Text Body',
				name: 'text',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				description: 'Plain-text content',
			},
			{
				displayName: 'CC',
				name: 'cc',
				type: 'string',
				typeOptions: {
					multipleValues: true,
				},
				default: '',
				description: 'Additional recipients in the CC field',
			},
			{
				displayName: 'BCC',
				name: 'bcc',
				type: 'string',
				typeOptions: {
					multipleValues: true,
				},
				default: '',
				description: 'Additional recipients in the BCC field',
			},
			{
				displayName: 'Reply-To',
				name: 'replyTo',
				type: 'string',
				default: '',
				description: 'Address replies should go to',
			},
			{
				displayName: 'In-Reply-To',
				name: 'inReplyTo',
				type: 'string',
				default: '',
				description: 'The <code>Message-ID</code> of the message this one replies to, so mail clients thread the reply',
			},
			{
				displayName: 'Template ID',
				name: 'templateId',
				type: 'string',
				default: '',
				description:
					'A saved (<code>tpl_…</code>) or base (<code>base_…</code>) template. When set, subject/body become optional.',
			},
			{
				displayName: 'Template Data',
				name: 'templateData',
				type: 'json',
				default: '{}',
				description: 'Key/value pairs substituted into the template\'s merge tags',
			},
			{
				displayName: 'Extra Headers',
				name: 'headers',
				type: 'json',
				default: '{}',
				description:
					'Extra raw MIME headers (name → value), applied after threading headers. Use for what the structured fields can\u0027t express — e.g. <code>List-Unsubscribe</code>, a dedup key, or a tag header.',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'json',
				default: '{}',
				description:
					'Structured metadata kept server-side for this send (stored on the message, never emitted as a MIME header). Scalar values only.',
			},
			{
				displayName: 'Sequence',
				name: 'sequence',
				type: 'string',
				default: '',
				description:
					'Name or ID of an active sequence to enrol the recipient in when the send succeeds',
			},
			{
				displayName: 'Sequence Input',
				name: 'sequenceInput',
				type: 'json',
				default: '{}',
				description: 'Explicit input for the sequence named in Sequence',
			},
			{
				displayName: 'Attachments',
				name: 'attachments',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
					multipleValueButtonText: 'Add Attachment',
				},
				default: {},
				options: [
					{
						name: 'attachment',
						displayName: 'Attachment',
						values: [
							{
								displayName: 'Filename',
								name: 'filename',
								type: 'string',
								default: '',
								description: 'File name, e.g. <code>invoice.pdf</code>',
							},
							{
								displayName: 'URL',
								name: 'url',
								type: 'string',
								default: '',
								description: 'Fetch the file from this URL at send time (preferred for large files)',
							},
							{
								displayName: 'Content (Base64)',
								name: 'content',
								type: 'string',
								default: '',
								description: 'Inline file bytes as base64',
							},
							{
								displayName: 'Content Type',
								name: 'contentType',
								type: 'string',
								default: '',
								description: 'MIME type; defaults to <code>application/octet-stream</code>',
							},
						],
					},
				],
				description: 'Files to attach. Each entry needs a filename and either a URL or base64 content.',
			},
			{
				displayName: 'Schedule Send',
				name: 'scheduledAt',
				type: 'string',
				default: '',
				description:
					'Send later instead of now. Accepts ISO 8601, simple relative language (<code>in 2 hours</code>), or a ms-epoch.',
			},
			{
				displayName: 'Track Opens',
				name: 'trackOpens',
				type: 'options',
				default: 'default',
				options: [
					{
						name: 'Use Domain Default',
						value: 'default',
					},
					{
						name: 'On',
						value: 'on',
					},
					{
						name: 'Off',
						value: 'off',
					},
				],
				description:
					'Open-tracking override for this send. "Use Domain Default" omits the field (HTML sends only).',
			},
			{
				displayName: 'Track Clicks',
				name: 'trackClicks',
				type: 'options',
				default: 'default',
				options: [
					{
						name: 'Use Domain Default',
						value: 'default',
					},
					{
						name: 'On',
						value: 'on',
					},
					{
						name: 'Off',
						value: 'off',
					},
				],
				description:
					'Click-tracking override for this send. "Use Domain Default" omits the field (HTML sends only).',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const body = buildSendBody.call(this, itemIndex);

			try {
				const response = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'mailkiteApi',
					{
						method: 'POST',
						url: '/v1/send',
						body,
						json: true,
					},
				)) as { id?: string; status?: string; scheduledAt?: number };

				returnData.push({
					json: response,
					pairedItem: { item: itemIndex },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
				} else {
					throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
				}
			}
		}

		return [returnData];
	}
}
