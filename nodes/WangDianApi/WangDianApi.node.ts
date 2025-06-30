import {
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IExecuteFunctions,
	NodeOperationError,
	NodeConnectionType,
	IRequestOptions,
} from 'n8n-workflow';

import md5 from 'md5';

export class WangDianApi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WangDian API',
		name: 'wangDianApi',
		icon: 'file:wdt.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] }}',
		description: '旺店通旗舰版 API',
		defaults: {
			name: 'WangDian API',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		credentials: [
			{
				name: 'wangDianApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: '操作',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				description: '要执行的操作',
				options: [
					{
						name: 'Query',
						value: 'query',
						description: '查询数据',
						action: 'Query data',
					},
					{
						name: 'Call',
						value: 'call',
						description: '调用接口',
						action: 'Call API',
					},
				],
				required: true,
				default: 'query',
			},
			{
				displayName: '方法名称',
				name: 'method',
				type: 'string',
				default: '',
				required: true,
			},
			{
				displayName: '请求参数',
				name: 'body',
				type: 'json',
				typeOptions: {
					alwaysOpenEditWindow: true,
				},
				default: '[]',
			},
			{
				displayName: '分页索引',
				name: 'pageIndex',
				type: 'number',
				default: 0,
				displayOptions: {
					show: {
						operation: ['query'],
					},
				},
			},
			{
				displayName: '分页大小',
				name: 'pageSize',
				type: 'number',
				default: 10,
				displayOptions: {
					show: {
						operation: ['query'],
					},
				},
			},
			{
				displayName: '是否计算总数',
				name: 'calcTotal',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						operation: ['query'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const credentials = await this.getCredentials('wangDianApi');

		const sid = credentials.sid.toString();
		const appKey = credentials.appKey.toString();
		const appSecret = credentials.appSecret.toString();
		const serverUrl = credentials.serverUrl.toString();

		// 验证API URL格式
		if (!serverUrl || !serverUrl.startsWith('http')) {
			throw new NodeOperationError(this.getNode(), `API URL格式无效: ${serverUrl}`);
		}

		const operation = this.getNodeParameter('operation', 0) as string;
		const method = this.getNodeParameter('method', 0) as string;

		if (!method || method.trim() === '') {
			throw new NodeOperationError(this.getNode(), '方法名称不能为空');
		}

		if (!appSecret.includes(':')) {
			throw new NodeOperationError(this.getNode(), '接口Secret格式错误，应该是"secret:salt"格式');
		}

		const pageIndex = (this.getNodeParameter('pageIndex', 0) || 0) as number;
		const pageSize = (this.getNodeParameter('pageSize', 0) || 10) as number;
		const calcTotal = (this.getNodeParameter('calcTotal', 0) || true) as boolean;
		const bodyStr = this.getNodeParameter('body', 0) as string;

		const [secret, salt] = appSecret.split(':');
		const data: Record<string, any> = {};
		data['sid'] = sid;
		data['key'] = appKey;
		data['salt'] = salt;
		data['method'] = method;
		data['timestamp'] = Math.floor(new Date().getTime() / 1000 - 1325347200).toString();
		data['v'] = '1.0';

		if (operation === 'query') {
			data['page_no'] = pageIndex.toString();
			data['page_size'] = pageSize.toString();
			data['calc_total'] = calcTotal ? 1 : 0;
		}

		const body = JSON.stringify(JSON.parse(bodyStr));
		data['body'] = body;
		data['sign'] = makeSign(data, secret);
		delete data['body'];

		const options: IRequestOptions = {
			url: serverUrl,
			method: 'POST',
			json: true,
			headers: {
				'Content-Type': 'application/json',
			},
			qs: data,
			body,
		};

		const result: any = await this.helpers.request(options);
		if (!result) {
			throw new NodeOperationError(this.getNode(), 'invalid response');
		}

		if (result.status > 0) {
			throw new NodeOperationError(
				this.getNode(),
				`code: ${result.status}, message: ${result.message}`,
			);
		}

		const resultData = [this.helpers.returnJsonArray(result.data)];
		return resultData;
	}
}

function makeSign(params: Record<string, any>, appSecret: string): string {
	const str = Object.keys(params)
		.filter((key) => key !== 'sign')
		.sort()
		.map((key) => `${key}${params[key]}`)
		.join('');

	return md5(appSecret + str + appSecret);
}
