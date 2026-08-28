import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class MailKiteApi implements ICredentialType {
	name = 'mailkiteApi';

	displayName = 'MailKite API';

	icon: Icon = { light: 'file:../icons/mailkite.svg', dark: 'file:../icons/mailkite.dark.svg' };

	documentationUrl = 'https://mailkite.dev/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'MailKite API key (starts with <code>mk_live_</code>). Create one in the MailKite dashboard under Settings → API Keys.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.mailkite.dev',
			url: '/api/domains',
			method: 'GET',
		},
	};
}
