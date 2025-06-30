import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class WangDianApi implements ICredentialType {
	name = 'wangDianApi';

	displayName = 'WangDian API';

	documentationUrl = 'https://example.com/docs/auth';

	properties: INodeProperties[] = [
		{
			displayName: '卖家账号',
			name: 'sid',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: '接口Key',
			name: 'appKey',
			type: 'string',
			default: '',
			required: true,
			typeOptions: {
				password: true,
			},
		},
		{
			displayName: '接口Secret',
			name: 'appSecret',
			type: 'string',
			default: '',
			required: true,
			typeOptions: {
				password: true,
			},
		},
		{
			displayName: '接口地址',
			name: 'serverUrl',
			type: 'string',
			default: 'https://wdt.wangdian.cn/openapi',
			required: true,
		},
	];
}
