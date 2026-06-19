import {
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IExecuteFunctions,
	INodeProperties,
	NodeOperationError,
} from 'n8n-workflow';

import type { NodeConnectionType } from 'n8n-workflow';
import type { WdtRequestBody } from '@waywake/wdt-sdk';

import { WDT_ENDPOINT_CATEGORIES, WDT_ENDPOINT_OPTIONS } from './endpoints.generated';

const CUSTOM_RESOURCE = '__custom__';
const MAIN_CONNECTION: NodeConnectionType = 'main';

interface CategoryBinding {
	value: string;
	slug: string;
	hint: string;
}

const CATEGORY_BINDINGS: readonly CategoryBinding[] = [
	{ value: '订单类', slug: 'orders', hint: '订单' },
	{ value: '售后类', slug: 'aftersales', hint: '售后' },
	{ value: '货品类', slug: 'goods', hint: '货品' },
	{ value: '基础类', slug: 'settings', hint: '基础设置' },
	{ value: '库存类', slug: 'wms', hint: 'WMS / 库存' },
	{ value: '采购类', slug: 'purchase', hint: '采购' },
];

const BINDING_BY_VALUE: Record<string, CategoryBinding> = Object.fromEntries(
	CATEGORY_BINDINGS.map((binding) => [binding.value, binding]),
);

function countEndpointsByCategory(): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const opt of WDT_ENDPOINT_OPTIONS) {
		counts[opt.category] = (counts[opt.category] ?? 0) + 1;
	}
	return counts;
}

const ENDPOINT_COUNTS = countEndpointsByCategory();

const OPERATION_OPTIONS_BY_CATEGORY: Record<
	string,
	Array<{ name: string; value: string; description: string; action: string }>
> = {};
for (const binding of CATEGORY_BINDINGS) {
	OPERATION_OPTIONS_BY_CATEGORY[binding.value] = WDT_ENDPOINT_OPTIONS.filter(
		(opt) => opt.category === binding.value,
	).map((opt) => ({
		name: opt.name,
		value: opt.value,
		description:
			opt.description === opt.name
				? `[${opt.value}] ${opt.name}`
				: `${opt.description} [${opt.value}]`,
		action: opt.name,
	}));
}

export class WangDianApi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WangDian API',
		name: 'wangDianApi',
		icon: 'file:wdt.svg',
		group: ['transform'],
		version: 1,
		subtitle:
			'={{$parameter["resource"] === "订单类" ? $parameter["orders_op"] : $parameter["resource"] === "售后类" ? $parameter["aftersales_op"] : $parameter["resource"] === "货品类" ? $parameter["goods_op"] : $parameter["resource"] === "基础类" ? $parameter["settings_op"] : $parameter["resource"] === "库存类" ? $parameter["wms_op"] : $parameter["resource"] === "采购类" ? $parameter["purchase_op"] : $parameter["method"]}}',
		description: '旺店通旗舰版 OpenAPI（基于 @waywake/wdt-sdk）。',
		defaults: {
			name: 'WangDian API',
		},
		inputs: [MAIN_CONNECTION],
		outputs: [MAIN_CONNECTION],
		credentials: [
			{
				name: 'wangDianApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: '资源',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				description: '选择接口分类，n8n 会自动展开分类下的所有可用接口。',
				options: [
					{
						name: '订单类',
						value: '订单类',
						description: `订单相关接口，共 ${ENDPOINT_COUNTS['订单类'] ?? 0} 个。`,
					},
					{
						name: '售后类',
						value: '售后类',
						description: `售后相关接口，共 ${ENDPOINT_COUNTS['售后类'] ?? 0} 个。`,
					},
					{
						name: '货品类',
						value: '货品类',
						description: `货品相关接口，共 ${ENDPOINT_COUNTS['货品类'] ?? 0} 个。`,
					},
					{
						name: '基础类',
						value: '基础类',
						description: `基础设置相关接口，共 ${ENDPOINT_COUNTS['基础类'] ?? 0} 个。`,
					},
					{
						name: '库存类',
						value: '库存类',
						description: `WMS / 库存相关接口，共 ${ENDPOINT_COUNTS['库存类'] ?? 0} 个。`,
					},
					{
						name: '采购类',
						value: '采购类',
						description: `采购相关接口，共 ${ENDPOINT_COUNTS['采购类'] ?? 0} 个。`,
					},
					{
						name: '自定义',
						value: CUSTOM_RESOURCE,
						description: '直接传入 method 名调用任意接口，适用于 SDK 未内置元数据的场景。',
					},
				],
				required: true,
				default: '订单类',
			},
			...buildOperationFields(),
			{
				displayName: '方法名称',
				name: 'method',
				type: 'string',
				displayOptions: {
					show: {
						resource: [CUSTOM_RESOURCE],
					},
				},
				description:
					'旺店通 method 标识符，例如 sales.TradeQuery.queryWithDetail，可在 https://open.wangdian.cn/qjb/open/apidoc 查阅。',
				required: true,
				default: '',
				placeholder: 'sales.TradeQuery.queryWithDetail',
			},
			{
				displayName: '请求参数',
				name: 'body',
				type: 'json',
				typeOptions: {
					alwaysOpenEditWindow: true,
				},
				default: '{}',
				description: '请求体 JSON 对象，字段名使用 camelCase（SDK 会自动转换为 snake_case）。',
			},
			{
				displayName: '启用分页',
				name: 'pagerEnabled',
				type: 'boolean',
				default: false,
				description:
					'Whether to attach page_no / page_size / calc_total to the query string. 仅在调用支持分页的查询接口时勾选.',
			},
			{
				displayName: '页码',
				name: 'pageNo',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						pagerEnabled: [true],
					},
				},
				default: 1,
				description: '页码，从 1 开始。',
			},
			{
				displayName: '每页数量',
				name: 'pageSize',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						pagerEnabled: [true],
					},
				},
				default: 40,
				description: '每页返回的条数。',
			},
			{
				displayName: '是否计算总数',
				name: 'calcTotal',
				type: 'boolean',
				displayOptions: {
					show: {
						pagerEnabled: [true],
					},
				},
				default: false,
				description: 'Whether to return the total record count for the query',
			},
			{
				displayName: '遇到业务错误时抛出',
				name: 'throwOnApiError',
				type: 'boolean',
				default: true,
				description:
					'Whether to throw when status is non-zero. 关闭后将以普通 JSON 形式返回响应，便于在流程中自行处理错误.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('wangDianApi');

		const sid = credentials.sid as string;
		const appKey = credentials.appKey as string;
		const appSecret = credentials.appSecret as string;
		const baseUrl = (credentials.serverUrl as string) || undefined;

		// tsc with module:commonjs lowers `await import('...')` to `require()`, which fails on
		// the ESM-only wdt-sdk. Wrap the import in a Function() so TypeScript leaves it as a
		// native dynamic import at runtime.
		const dynamicImport = new Function('specifier', 'return import(specifier)') as (
			specifier: string,
		) => Promise<typeof import('@waywake/wdt-sdk')>;
		const sdk = await dynamicImport('@waywake/wdt-sdk');
		const { createWdtClient, WdtApiError, WdtHttpError, WdtResponseParseError } = sdk;

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const resource = this.getNodeParameter('resource', itemIndex) as string;
			const method = resolveMethod(this, resource, itemIndex);
			const bodyRaw = this.getNodeParameter('body', itemIndex, '{}') as string | object;
			const throwOnApiError = this.getNodeParameter('throwOnApiError', itemIndex, true) as boolean;
			const pagerEnabled = this.getNodeParameter('pagerEnabled', itemIndex, false) as boolean;

			let request: unknown;
			try {
				request =
					typeof bodyRaw === 'string' && bodyRaw.trim()
						? JSON.parse(bodyRaw)
						: bodyRaw || undefined;
			} catch (error) {
				throw new NodeOperationError(
					this.getNode(),
					`请求参数不是合法 JSON：${(error as Error).message}`,
					{ itemIndex },
				);
			}

			const options: {
				throwOnApiError: boolean;
				pager?: { pageNo: number; pageSize: number; calcTotal: boolean };
			} = {
				throwOnApiError,
			};
			if (pagerEnabled) {
				options.pager = {
					pageNo: this.getNodeParameter('pageNo', itemIndex, 1) as number,
					pageSize: this.getNodeParameter('pageSize', itemIndex, 40) as number,
					calcTotal: this.getNodeParameter('calcTotal', itemIndex, false) as boolean,
				};
			}

			const client = createWdtClient({ sid, appKey, appSecret, baseUrl });

			let response;
			try {
				response = await client.call(method, request as WdtRequestBody, options);
			} catch (error) {
				if (
					error instanceof WdtApiError ||
					error instanceof WdtHttpError ||
					error instanceof WdtResponseParseError
				) {
					throw new NodeOperationError(this.getNode(), error.message, {
						itemIndex,
						description:
							error instanceof WdtApiError
								? `旺店通返回业务错误（status=${error.status}）。`
								: '与旺店通 OpenAPI 通信失败。',
					});
				}
				throw error;
			}

			const payload =
				throwOnApiError && response && typeof response === 'object' && 'data' in response
					? (response as { data?: unknown }).data
					: response;

			if (Array.isArray(payload)) {
				for (const item of payload) {
					returnData.push({ json: item as IDataObject });
				}
			} else if (payload && typeof payload === 'object') {
				returnData.push({ json: payload as IDataObject });
			} else {
				returnData.push({ json: { value: payload as string | number | boolean | null } });
			}
		}

		return [returnData];
	}
}

function buildOperationFields(): INodeProperties[] {
	return CATEGORY_BINDINGS.map((binding) => {
		const categoryMeta = WDT_ENDPOINT_CATEGORIES.find((c) => c.value === binding.value);
		return {
			displayName: `操作 [${binding.hint}]`,
			name: `${binding.slug}_op`,
			type: 'options' as const,
			noDataExpression: true,
			displayOptions: {
				show: {
					resource: [binding.value],
				},
			},
			options: OPERATION_OPTIONS_BY_CATEGORY[binding.value],
			required: true,
			default: categoryMeta?.defaultMethod ?? '',
			description: `${binding.hint} 下的可用接口。`,
		};
	});
}

function resolveMethod(ctx: IExecuteFunctions, resource: string, itemIndex: number): string {
	if (resource === CUSTOM_RESOURCE) {
		const method = (ctx.getNodeParameter('method', itemIndex, '') as string).trim();
		if (!method) {
			throw new NodeOperationError(ctx.getNode(), '方法名称不能为空。', { itemIndex });
		}
		return method;
	}
	const binding = BINDING_BY_VALUE[resource];
	if (!binding) {
		throw new NodeOperationError(ctx.getNode(), `未知资源：${resource}`, { itemIndex });
	}
	const method = ctx.getNodeParameter(`${binding.slug}_op`, itemIndex, '') as string;
	if (!method) {
		throw new NodeOperationError(ctx.getNode(), '请选择一个接口操作。', { itemIndex });
	}
	return method;
}
