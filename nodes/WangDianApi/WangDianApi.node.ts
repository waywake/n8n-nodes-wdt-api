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

import {
	WDT_ENDPOINT_CATEGORIES,
	WDT_ENDPOINT_FIELDS,
	WDT_ENDPOINT_OPTIONS,
	type WdtEndpointOption,
	type WdtFieldDef,
} from './endpoints.generated';

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

const PARAM_FIELD_NAME_PREFIX = 'params_';
const BODY_FIELD_NAME_PREFIX = 'body_';
const AGGREGATE_LIST_FIELD_NAME_PREFIX = 'aggregateListField_';
const PAGINATION_MODE_SINGLE = 'singlePage';
const PAGINATION_MODE_ALL = 'allPages';

function methodToSuffix(method: string): string {
	return method.replace(/\./g, '_');
}

function paramsFieldName(method: string): string {
	return `${PARAM_FIELD_NAME_PREFIX}${methodToSuffix(method)}`;
}

function bodyFieldName(method: string): string {
	return `${BODY_FIELD_NAME_PREFIX}${methodToSuffix(method)}`;
}

function aggregateListFieldName(method: string): string {
	return `${AGGREGATE_LIST_FIELD_NAME_PREFIX}${methodToSuffix(method)}`;
}

function defaultValueForField(field: WdtFieldDef): string | number | boolean {
	switch (field.type) {
		case 'string':
			return '';
		case 'number':
			return 0;
		case 'boolean':
			return false;
		case 'json':
			if (/\[\]$|^Array</.test(field.tsType)) {
				return '[]';
			}
			return '{}';
	}
}

function buildParamField(opt: WdtEndpointOption): INodeProperties {
	// BINDING_BY_VALUE always contains every category emitted by the SDK codegen.
	const binding = BINDING_BY_VALUE[opt.category];
	const operationField = `${binding!.slug}_op`;
	const meta = WDT_ENDPOINT_FIELDS[opt.value];

	if (!meta || meta.fallbackToJson || meta.fields.length === 0) {
		return {
			displayName: '请求参数 (JSON)',
			name: bodyFieldName(opt.value),
			type: 'json',
			typeOptions: {
				alwaysOpenEditWindow: true,
			},
			default: '{}',
			displayOptions: {
				show: {
					[operationField]: [opt.value],
				},
			},
			description: `此接口未内置结构化字段，请直接编辑 JSON 对象。字段名使用 camelCase (SDK 会自动转为 snake_case)。 [${opt.value}]`,
		};
	}

	const values: INodeProperties[] = meta.fields.map((field) => {
		const tsHint =
			field.type === 'json' && field.tsType !== 'json' ? ` (TS 类型: ${field.tsType})` : '';
		const requiredHint = field.optional ? '' : ' [必填]';
		const property: INodeProperties = {
			displayName: field.optional ? field.displayName : `${field.displayName} *`,
			name: field.name,
			type: field.type,
			default: defaultValueForField(field),
			description: `${field.description || field.displayName}${requiredHint}${tsHint}`,
		};
		if (field.type === 'json') {
			property.typeOptions = { alwaysOpenEditWindow: true };
		}
		return property;
	});

	return {
		displayName: '请求参数',
		name: paramsFieldName(opt.value),
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: false,
		},
		displayOptions: {
			show: {
				resource: [opt.category],
				[operationField]: [opt.value],
			},
		},
		default: {},
		placeholder: '',
		description: `${opt.description} [${opt.value}]`,
		options: [
			{
				displayName: '字段',
				name: 'values',
				values,
			},
		],
	};
}

function buildAggregateListField(opt: WdtEndpointOption): INodeProperties {
	// BINDING_BY_VALUE always contains every category emitted by the SDK codegen.
	const binding = BINDING_BY_VALUE[opt.category];
	const operationField = `${binding!.slug}_op`;
	const defaultAggregateListField = WDT_ENDPOINT_FIELDS[opt.value]?.defaultAggregateListField ?? '';

	return {
		displayName: '聚合列表字段',
		name: aggregateListFieldName(opt.value),
		type: 'string',
		displayOptions: {
			show: {
				resource: [opt.category],
				[operationField]: [opt.value],
				pagerEnabled: [true],
				paginationMode: [PAGINATION_MODE_ALL],
			},
		},
		default: defaultAggregateListField,
		placeholder: defaultAggregateListField || 'order',
		description:
			'自动分页时要从每页响应中抽取并合并的数组字段，支持点路径，例如 order、details 或 result.detailList。留空则按页输出完整 data 对象。',
	};
}

const PARAM_FIELDS: INodeProperties[] = WDT_ENDPOINT_OPTIONS.map(buildParamField);
const AGGREGATE_LIST_FIELDS: INodeProperties[] = WDT_ENDPOINT_OPTIONS.map(buildAggregateListField);

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
			...PARAM_FIELDS,
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
				displayName: '请求参数 (JSON)',
				name: 'body',
				type: 'json',
				typeOptions: {
					alwaysOpenEditWindow: true,
				},
				default: '{}',
				displayOptions: {
					show: {
						resource: [CUSTOM_RESOURCE],
					},
				},
				description: '请求体 JSON 对象，字段名使用 camelCase (SDK 会自动转换为 snake_case)。',
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
					minValue: 0,
				},
				displayOptions: {
					show: {
						pagerEnabled: [true],
					},
				},
				default: 0,
				description: '起始页码，从 0 开始。',
			},
			{
				displayName: '分页模式',
				name: 'paginationMode',
				type: 'options',
				displayOptions: {
					show: {
						pagerEnabled: [true],
					},
				},
				options: [
					{
						name: '单页',
						value: PAGINATION_MODE_SINGLE,
						description: '只请求指定页码的一页数据。',
					},
					{
						name: '所有页',
						value: PAGINATION_MODE_ALL,
						description: '从起始页码开始自动请求后续页面，直到没有更多数据或达到最大页数。',
					},
				],
				default: PAGINATION_MODE_SINGLE,
				description: '选择只查询一页，或自动遍历所有分页结果。',
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
				displayName: '最大页数',
				name: 'maxPages',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				displayOptions: {
					show: {
						pagerEnabled: [true],
						paginationMode: [PAGINATION_MODE_ALL],
					},
				},
				default: 100,
				description: '自动分页时最多请求多少页，用于避免异常接口导致无限循环。',
			},
			...AGGREGATE_LIST_FIELDS,
			{
				displayName: '聚合列表字段',
				name: 'aggregateListField',
				type: 'string',
				displayOptions: {
					show: {
						resource: [CUSTOM_RESOURCE],
						pagerEnabled: [true],
						paginationMode: [PAGINATION_MODE_ALL],
					},
				},
				default: '',
				placeholder: 'order',
				description:
					'自动分页时要从每页响应中抽取并合并的数组字段，支持点路径，例如 order、details 或 result.detailList。留空则按页输出完整 data 对象。',
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
			const request = resolveRequestBody(this, resource, method, itemIndex);
			const throwOnApiError = this.getNodeParameter('throwOnApiError', itemIndex, true) as boolean;
			const pagerEnabled = this.getNodeParameter('pagerEnabled', itemIndex, false) as boolean;
			const paginationMode = pagerEnabled
				? (this.getNodeParameter('paginationMode', itemIndex, PAGINATION_MODE_SINGLE) as string)
				: PAGINATION_MODE_SINGLE;

			const options: {
				throwOnApiError: boolean;
				pager?: { pageNo: number; pageSize: number; calcTotal: boolean };
			} = {
				throwOnApiError,
			};
			if (pagerEnabled) {
				options.pager = {
					pageNo: this.getNodeParameter('pageNo', itemIndex, 0) as number,
					pageSize: this.getNodeParameter('pageSize', itemIndex, 40) as number,
					calcTotal: this.getNodeParameter('calcTotal', itemIndex, false) as boolean,
				};
			}

			const client = createWdtClient({ sid, appKey, appSecret, baseUrl });

			if (!pagerEnabled || paginationMode === PAGINATION_MODE_SINGLE) {
				const response = await callWdtApi(client, method, request, options, this, itemIndex, {
					WdtApiError,
					WdtHttpError,
					WdtResponseParseError,
				});
				pushPayload(returnData, payloadFromResponse(response, throwOnApiError));
				continue;
			}

			const pageSize = options.pager?.pageSize ?? 40;
			const startPageNo = options.pager?.pageNo ?? 0;
			const maxPages = this.getNodeParameter('maxPages', itemIndex, 100) as number;
			const aggregateListField = resolveAggregateListField(this, resource, method, itemIndex);
			let fetchedCount = 0;

			for (let pageOffset = 0; pageOffset < maxPages; pageOffset++) {
				const pageNo = startPageNo + pageOffset;
				const response = await callWdtApi(
					client,
					method,
					request,
					{
						...options,
						pager: {
							pageNo,
							pageSize,
							calcTotal: options.pager?.calcTotal ?? false,
						},
					},
					this,
					itemIndex,
					{
						WdtApiError,
						WdtHttpError,
						WdtResponseParseError,
					},
				);
				const payload = payloadFromResponse(response, throwOnApiError);
				const pageItems = aggregateListField
					? extractAggregateListField(response, payload, aggregateListField, this, itemIndex)
					: undefined;

				if (pageItems) {
					pushPayload(returnData, pageItems, { _pageNo: pageNo });
				} else {
					pushPayload(returnData, payload, { _pageNo: pageNo });
				}

				const pageInfo = extractPageInfo(response, payload, pageItems);
				fetchedCount += pageInfo.itemCount;

				if (pageInfo.totalCount !== undefined && fetchedCount >= pageInfo.totalCount) {
					break;
				}
				if (pageInfo.itemCount < pageSize) {
					break;
				}
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

function resolveAggregateListField(
	ctx: IExecuteFunctions,
	resource: string,
	method: string,
	itemIndex: number,
): string {
	const fallback = WDT_ENDPOINT_FIELDS[method]?.defaultAggregateListField ?? '';
	const fieldName =
		resource === CUSTOM_RESOURCE ? 'aggregateListField' : aggregateListFieldName(method);
	return (ctx.getNodeParameter(fieldName, itemIndex, fallback) as string).trim();
}

function resolveRequestBody(
	ctx: IExecuteFunctions,
	resource: string,
	method: string,
	itemIndex: number,
): unknown {
	// Custom method → free-form JSON body
	if (resource === CUSTOM_RESOURCE) {
		return parseJsonBody(ctx, 'body', itemIndex);
	}

	const meta = WDT_ENDPOINT_FIELDS[method];
	if (!meta || meta.fallbackToJson || meta.fields.length === 0) {
		// Unstructured endpoint → per-method JSON body field
		return parseJsonBody(ctx, bodyFieldName(method), itemIndex);
	}

	// Structured endpoint → fixedCollection of typed fields
	const raw = ctx.getNodeParameter(paramsFieldName(method), itemIndex, {}) as
		| { values?: IDataObject }
		| IDataObject;
	const values = (
		raw && typeof raw === 'object' && 'values' in raw ? raw.values : {}
	) as IDataObject;

	if (meta.requestShape === 'tuple') {
		return meta.fields.map((field) => {
			const value = cleanStructuredValue(ctx, field, values[field.name], itemIndex);
			if (isEmptyValue(value) && !field.optional) {
				throw new NodeOperationError(ctx.getNode(), `请求参数 ${field.displayName} 不能为空。`, {
					itemIndex,
				});
			}
			return value;
		});
	}

	// Strip empty-string defaults so we don't send noise to the API.
	const cleaned: Record<string, unknown> = {};
	for (const field of meta.fields) {
		const value = cleanStructuredValue(ctx, field, values[field.name], itemIndex);
		if (isEmptyValue(value)) continue;
		cleaned[field.name] = value;
	}
	return cleaned;
}

function cleanStructuredValue(
	ctx: IExecuteFunctions,
	field: WdtFieldDef,
	value: unknown,
	itemIndex: number,
): unknown {
	if (field.type !== 'json' || typeof value !== 'string') {
		return value;
	}
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch (error) {
		throw new NodeOperationError(
			ctx.getNode(),
			`请求参数 ${field.displayName} 不是合法 JSON：${(error as Error).message}`,
			{
				itemIndex,
			},
		);
	}
}

function isEmptyValue(value: unknown): boolean {
	return value === '' || value === null || value === undefined;
}

function parseJsonBody(ctx: IExecuteFunctions, fieldName: string, itemIndex: number): unknown {
	const raw = ctx.getNodeParameter(fieldName, itemIndex, '{}') as string | object;
	if (typeof raw !== 'string') {
		return raw || undefined;
	}
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch (error) {
		throw new NodeOperationError(
			ctx.getNode(),
			`请求参数不是合法 JSON：${(error as Error).message}`,
			{
				itemIndex,
			},
		);
	}
}

async function callWdtApi(
	client: {
		call: (
			method: string,
			request?: WdtRequestBody,
			options?: WdtCallOptionsLike,
		) => Promise<unknown>;
	},
	method: string,
	request: unknown,
	options: WdtCallOptionsLike,
	ctx: IExecuteFunctions,
	itemIndex: number,
	errors: {
		WdtApiError: new (...args: never[]) => Error & { status?: number };
		WdtHttpError: new (...args: never[]) => Error;
		WdtResponseParseError: new (...args: never[]) => Error;
	},
): Promise<unknown> {
	try {
		return await client.call(method, request as WdtRequestBody, options);
	} catch (error) {
		if (
			error instanceof errors.WdtApiError ||
			error instanceof errors.WdtHttpError ||
			error instanceof errors.WdtResponseParseError
		) {
			throw new NodeOperationError(ctx.getNode(), error.message, {
				itemIndex,
				description:
					error instanceof errors.WdtApiError
						? `旺店通返回业务错误（status=${error.status}）。`
						: '与旺店通 OpenAPI 通信失败。',
			});
		}
		throw error;
	}
}

interface WdtCallOptionsLike {
	throwOnApiError: boolean;
	pager?: { pageNo: number; pageSize: number; calcTotal: boolean };
}

function payloadFromResponse(response: unknown, throwOnApiError: boolean): unknown {
	return throwOnApiError && response && typeof response === 'object' && 'data' in response
		? (response as { data?: unknown }).data
		: response;
}

function pushPayload(
	returnData: INodeExecutionData[],
	payload: unknown,
	metadata?: IDataObject,
): void {
	if (Array.isArray(payload)) {
		for (const item of payload) {
			returnData.push({ json: attachMetadata(item, metadata) });
		}
	} else if (payload && typeof payload === 'object') {
		returnData.push({ json: attachMetadata(payload, metadata) });
	} else {
		returnData.push({
			json: {
				value: payload as string | number | boolean | null,
				...(metadata ?? {}),
			},
		});
	}
}

function attachMetadata(value: unknown, metadata?: IDataObject): IDataObject {
	if (!metadata) return value as IDataObject;
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return { ...(value as IDataObject), ...metadata };
	}
	return { value: value as string | number | boolean | null, ...metadata };
}

function extractPageInfo(
	response: unknown,
	payload: unknown,
	pageItems?: unknown[],
): { itemCount: number; totalCount?: number } {
	const data =
		response && typeof response === 'object' && 'data' in response
			? (response as { data?: unknown }).data
			: payload;
	const totalCount = findTotalCount(data);
	return {
		itemCount: pageItems ? pageItems.length : countPageItems(data),
		totalCount,
	};
}

function findTotalCount(value: unknown): number | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const totalCount = (value as Record<string, unknown>).totalCount;
	return typeof totalCount === 'number' ? totalCount : undefined;
}

function countPageItems(value: unknown): number {
	if (Array.isArray(value)) return value.length;
	if (!value || typeof value !== 'object') return 0;

	const arrayLengths = Object.values(value as Record<string, unknown>)
		.filter((entry): entry is unknown[] => Array.isArray(entry))
		.map((entry) => entry.length);

	return arrayLengths.length > 0 ? Math.max(...arrayLengths) : 0;
}

function extractAggregateListField(
	response: unknown,
	payload: unknown,
	fieldPath: string,
	ctx: IExecuteFunctions,
	itemIndex: number,
): unknown[] {
	const payloadValue = getValueAtPath(payload, fieldPath);
	const value =
		payloadValue !== undefined
			? payloadValue
			: getValueAtPath(
					response && typeof response === 'object' && 'data' in response
						? (response as { data?: unknown }).data
						: undefined,
					fieldPath,
				);

	if (!Array.isArray(value)) {
		throw new NodeOperationError(ctx.getNode(), `聚合列表字段不是数组：${fieldPath}`, {
			itemIndex,
			description: '请确认该字段存在于响应 data 中，并且字段值是数组。',
		});
	}

	return value;
}

function getValueAtPath(value: unknown, fieldPath: string): unknown {
	if (!fieldPath) return undefined;
	const segments = fieldPath
		.split('.')
		.map((segment) => segment.trim())
		.filter(Boolean);
	let current = value;
	for (const segment of segments) {
		if (!current || typeof current !== 'object' || Array.isArray(current)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}
