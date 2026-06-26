# n8n-nodes-wdt-api

n8n community nodes for the [旺店通旗舰版 OpenAPI](https://open.wangdian.cn/qjb/open/apidoc). All 184 endpoints exposed by [`@waywake/wdt-sdk`](https://www.npmjs.com/package/@waywake/wdt-sdk) are mapped to a single n8n node with a categorized `资源 → 操作` picker, so you can call any WangDian API without leaving the canvas.

## Highlights

- **Full API coverage.** 184 endpoints across 6 categories (订单 / 售后 / 货品 / 基础 / 库存 / 采购) are auto-generated from the SDK's `WDT_ENDPOINTS` metadata. Run `bun run generate:endpoints` to refresh when the SDK ships new endpoints.
- **Typed signing + transport.** Delegates to `@waywake/wdt-sdk`'s `WdtClient` — request body camelCase→snake_case conversion, MD5 signing, pager params, and error handling all match the official spec.
- **Resource → Operation UX.** Pick a category and the matching operation dropdown appears. Each option surfaces the official doc description plus the SDK method identifier.
- **Structured request fields.** Every endpoint with a typed `Request` interface (182 of 184) gets a `请求参数` form auto-generated from the SDK's `endpoint-types.d.ts` — 875 named fields in total, each carrying its JSDoc description, required flag, and coarse type (string / number / boolean / JSON). Required fields are marked with `*` and `[必填]` in the description.
- **Custom method escape hatch.** Need an endpoint the SDK doesn't know yet? Switch resource to `自定义` and type the method name + raw JSON body directly.
- **Optional pager.** Toggle on for query endpoints to send `page_no` / `page_size` / `calc_total`, with single-page or auto-pagination modes.
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

| Field                     | Description                                   |
| ------------------------- | --------------------------------------------- |
| 卖家账号 (`sid`)          | WangDian seller account ID                    |
| 接口 Key (`appKey`)       | API key from WangDian open platform           |
| 接口 Secret (`appSecret`) | API secret in the form `<secret>:<salt>`      |
| 接口地址 (`serverUrl`)    | Defaults to `https://wdt.wangdian.cn/openapi` |

## Usage

1. Drop a **WangDian API** node into your workflow.
2. Pick a **资源** (category). The matching **操作** dropdown appears.
3. Choose the endpoint. The method name shows in the node subtitle and a typed **请求参数** form renders below.
4. Fill the named fields. Required fields are marked with `*` and `[必填]`; descriptions come from the SDK's JSDoc.
5. For paginated endpoints, toggle **启用分页** and configure page/count. Use **分页模式 → 所有页** to automatically request subsequent pages.

For endpoints the SDK ships as a generic `WdtRequestBody` (no typed interface), the node falls back to a JSON editor for that operation. The `自定义` resource always uses a JSON editor since the method is user-supplied.

### Examples

Query the first page of sales trades:

```
资源:        订单类
操作:        订单查询 (sales.TradeQuery.queryWithDetail)
启用分页:    on
分页模式:    单页
  页码:       1
  每页数量:   40
  是否计算总数: on

请求参数:
  Start Time *  2026-06-01 00:00:00
  End Time   *  2026-06-19 23:59:59
  Warehouse No  (leave blank for all warehouses)
  Status        55,95
```

Query all pages from a paginated endpoint:

```
启用分页:    on
分页模式:    所有页
页码:        0
每页数量:    100
最大页数:    100
聚合列表字段: order
```

Automatic pagination stops when the returned page has fewer records than `每页数量`, when `totalCount` has been reached, or when `最大页数` is hit. If `聚合列表字段` is set, the node extracts that array field from every page and emits the merged list as n8n items. For built-in typed endpoints, this field defaults to the first array field declared on the endpoint response `Data` interface, such as `order` or `details`. Leave it blank to output each page's full `data` object.

Push a raw trade (uses JSON sub-editors for array fields):

```
资源:    订单类
操作:    原始单推送 (sales.RawTrade.pushSelf)

请求参数:
  Shop No *        MY-SHOP
  Raw Trade List   [{ "tid": "T123", "tradeStatus": 10 }]
  Raw Trade Order List  [{ "oid": "O1", "num": 1 }]
```

## Development

```bash
bun install
bun run generate:endpoints   # regenerate endpoints.generated.ts from the SDK
bun run build                # codegen + tsc + copy icons
bun run lint
```

`endpoints.generated.ts` is checked in and refreshed on every build. The generator pulls `WDT_ENDPOINTS` straight from `@waywake/wdt-sdk` and walks `endpoint-types.d.ts` with the TypeScript Compiler API to extract every field on each `Request` interface — names, types, optionality, and JSDoc descriptions all flow into the generated `WDT_ENDPOINT_FIELDS` map. Adding new endpoints to the SDK is picked up automatically.

## How it works

The SDK ships as ESM-only; n8n community nodes are CommonJS. The node therefore:

1. **Static metadata** — `endpoints.generated.ts` (codegen output) holds the 184 endpoint option arrays used to build the node description, so n8n can render the dropdowns at load time without any async work.
2. **Runtime calls** — `execute()` uses a `Function()`-wrapped `import('@waywake/wdt-sdk')` to dynamically load the SDK at call time. This bypasses TypeScript's commonjs `import()` lowering, which would otherwise emit `require()` and fail on the ESM-only package.

## License

MIT
