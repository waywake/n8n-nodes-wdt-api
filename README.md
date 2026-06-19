# n8n-nodes-wdt-api

n8n community nodes for the [旺店通旗舰版 OpenAPI](https://open.wangdian.cn/qjb/open/apidoc). All 184 endpoints exposed by [`@waywake/wdt-sdk`](https://www.npmjs.com/package/@waywake/wdt-sdk) are mapped to a single n8n node with a categorized `资源 → 操作` picker, so you can call any WangDian API without leaving the canvas.

## Highlights

- **Full API coverage.** 184 endpoints across 6 categories (订单 / 售后 / 货品 / 基础 / 库存 / 采购) are auto-generated from the SDK's `WDT_ENDPOINTS` metadata. Run `bun run generate:endpoints` to refresh when the SDK ships new endpoints.
- **Typed signing + transport.** Delegates to `@waywake/wdt-sdk`'s `WdtClient` — request body camelCase→snake_case conversion, MD5 signing, pager params, and error handling all match the official spec.
- **Resource → Operation UX.** Pick a category and the matching operation dropdown appears. Each option surfaces the official doc description plus the SDK method identifier.
- **Custom method escape hatch.** Need an endpoint the SDK doesn't know yet? Switch resource to `自定义` and type the method name directly.
- **Optional pager.** Toggle on for query endpoints to send `page_no` / `page_size` / `calc_total`.
- **Graceful error mode.** `遇到业务错误时抛出` defaults to on (throws on non-zero `status`). Turn it off to surface the raw API response as JSON for in-flow error handling.

## Installation

In n8n, go to **Settings → Community nodes → Install**, then enter:

```
@waywake/n8n-nodes-wdt-api
```

Or install manually inside your n8n data directory:

```bash
npm install @waywake/n8n-nodes-wdt-api
```

## Configuration

Create a **WangDian API** credential with:

| Field | Description |
| --- | --- |
| 卖家账号 (`sid`) | WangDian seller account ID |
| 接口 Key (`appKey`) | API key from WangDian open platform |
| 接口 Secret (`appSecret`) | API secret in the form `<secret>:<salt>` |
| 接口地址 (`serverUrl`) | Defaults to `https://wdt.wangdian.cn/openapi` |

## Usage

1. Drop a **WangDian API** node into your workflow.
2. Pick a **资源** (category). The matching **操作** dropdown appears.
3. Choose the endpoint. The method name shows in the node subtitle.
4. Set **请求参数** as a JSON object — use camelCase keys, the SDK converts to snake_case automatically.
5. For paginated endpoints, toggle **启用分页** and configure page/count.

### Examples

Query the first page of sales trades:

```jsonc
// 资源: 订单类 → 操作: 订单查询 (sales.TradeQuery.queryWithDetail)
// 启用分页: on, 页码: 1, 每页数量: 40, 是否计算总数: on
// 请求参数:
{
  "startTime": "2026-06-01 00:00:00",
  "endTime": "2026-06-19 23:59:59",
  "statusType": 0
}
```

Push a raw trade:

```jsonc
// 资源: 订单类 → 操作: 原始单推送 (sales.RawTrade.pushSelf)
// 请求参数:
{
  "shopNo": "MY-SHOP",
  "rawTradeList": [{ "tid": "T123", "tradeStatus": 10 }],
  "rawTradeOrderList": [{ "oid": "O1", "num": 1 }]
}
```

## Development

```bash
bun install
bun run generate:endpoints   # regenerate endpoints.generated.ts from the SDK
bun run build                # codegen + tsc + copy icons
bun run lint
```

`endpoints.generated.ts` is checked in and refreshed on every build. The generator pulls `WDT_ENDPOINTS` straight from `@waywake/wdt-sdk`, so adding new endpoints to the SDK is picked up automatically.

## How it works

The SDK ships as ESM-only; n8n community nodes are CommonJS. The node therefore:

1. **Static metadata** — `endpoints.generated.ts` (codegen output) holds the 184 endpoint option arrays used to build the node description, so n8n can render the dropdowns at load time without any async work.
2. **Runtime calls** — `execute()` uses a `Function()`-wrapped `import('@waywake/wdt-sdk')` to dynamically load the SDK at call time. This bypasses TypeScript's commonjs `import()` lowering, which would otherwise emit `require()` and fail on the ESM-only package.

## License

MIT
