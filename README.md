[![Construct App](https://img.shields.io/badge/Construct-App-6366f1)](https://construct.computer)

# Construct App: Mercado Libre URL Resolver

A token-free [Construct](https://construct.computer) app that resolves Mercado Libre / Mercado Livre product IDs into canonical product page URLs, SEO slugs, and large-batch CSV scaffolds for product-detail extraction.

The app intentionally returns only browser-ready URL metadata. For rich product details such as title, price, seller, condition, or shipping information, the Construct agent should open the resolved product URL with its browser tool and extract what is visible on the page.

## Agent Guidance

Use this app before terminal scripts, curl, Python `requests`, raw Mercado Libre API probing, vendor CLIs, search-engine scraping, or generic web search when the input is a Mercado Libre product ID or `/p/{id}` URL.

Preferred sequence:

1. Call `mercadolibre_prepare_product_batch` for large CSV/detail jobs, `mercadolibre_resolve_product_url` for one ID, or `mercadolibre_resolve_product_urls` for small URL batches.
2. For detail jobs, use the returned CSV scaffold/artifact with columns such as Product ID, Title, Brand, Model, Price, Original Price, and Power.
3. Read `open_in_browser_url` from each non-error result row.
4. Open `open_in_browser_url` with the browser tool only for requested visible fields.
5. Fill the CSV scaffold from browser-extracted details and mark `browser_status`.

## Tools

| Tool | Description |
|---|---|
| `mercadolibre_resolve_product_url` | Resolve one product ID or `/p/{id}` URL into a browser-ready URL row with `status`, `product_id`, `url`, `open_in_browser_url`, `recommended_next_action`, `slug`, `site_id`, and `country`. |
| `mercadolibre_resolve_product_urls` | Resolve up to 25 product IDs in one call and return JSON rows or minimal resolver CSV. Batch rows can be `ok`, `blocked`, `partial`, or `error`; non-error rows include `open_in_browser_url` for browser follow-up. |
| `mercadolibre_prepare_product_batch` | Prepare up to 250 product IDs for large CSV/detail workflows. Deduplicates inputs, chunks internally, resolves browser-ready URLs, and returns a CSV scaffold artifact with product-detail columns ready for browser fill. |

Supported prefixes: `MLA` Argentina, `MLB` Brazil, `MLM` Mexico, `MLC` Chile, `MLU` Uruguay, `MLV` Venezuela, `MCO` Colombia, `MPE` Peru, `MEC` Ecuador, `MPA` Panama, `MPY` Paraguay, `MRD` Dominican Republic, `MBO` Bolivia, `MNI` Nicaragua, `MCR` Costa Rica, `MSV` El Salvador, `MHN` Honduras, `MGT` Guatemala.

## Getting Started

```bash
pnpm install
pnpm dev
```

The local Worker usually runs at `http://localhost:8787`.

## MCP Examples

List tools:

```bash
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Resolve one product URL:

```bash
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mercadolibre_resolve_product_url","arguments":{"product_id":"MLA19791378"}}}'
```

Resolve a batch as JSON:

```bash
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"mercadolibre_resolve_product_urls","arguments":{"product_ids":["MLA19791378","MLA50469491","MLA54262263"]}}}'
```

Resolve a batch as minimal CSV:

```bash
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"mercadolibre_resolve_product_urls","arguments":{"product_ids":["MLA19791378","MLA50469491","MLA54262263"],"output_format":"csv"}}}'
```

Prepare a large product-detail CSV scaffold:

```bash
curl -X POST http://localhost:8787/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"mercadolibre_prepare_product_batch","arguments":{"product_ids":["MLA19791378","MLA50469491","MLA54262263"]}}}'
```

## Intended Agent Workflow

1. Use `mercadolibre_prepare_product_batch` for large detail/CSV requests, especially 25+ IDs.
2. Use the generated CSV scaffold as the source table for Product ID, Title, Brand, Model, Price, Original Price, Power, and related fields.
3. Open each row's `open_in_browser_url` with the browser tool when the user needs page details. If a row is `blocked` or `partial`, still open `open_in_browser_url`; it is the best browser-ready fallback.
4. Extract visible product data from the real page.
5. Produce the user's final table, CSV, or report from the browser-extracted details.

This keeps the app usable without OAuth tokens or account access.

## Limitations

- This is not an orders, listings, shipments, seller, or questions API integration.
- It does not use Mercado Libre OAuth or access tokens.
- It depends on Mercado Libre's `/p/{id}` redirect behavior for app-style clients.
- The large-batch CSV scaffold intentionally leaves title, brand, model, price, original price, power, seller, condition, and shipping blank until the agent fills them from browser-visible product pages.
- If Mercado Libre redirects the resolver to account verification, captcha, or another non-product page, the tool returns a `blocked` or `partial` row with a fallback `/p/{id}` URL instead of failing the whole call.
- If a country prefix is unsupported or an ID is invalid, the single tool throws and the batch tool returns an `error` row for that input.

## Testing in Construct

1. Run `pnpm dev`.
2. Open Construct → Settings → Developer.
3. Enable Developer Mode.
4. Connect the dev server URL, usually `http://localhost:8787`.

Construct probes `/health` and `/mcp`, registers the tools, and opens the UI in a sandboxed window.

## Project Structure

```text
mercadolibre-app/
├── manifest.json
├── server.ts
├── wrangler.toml
├── ui/
│   ├── index.html
│   ├── app.js
│   ├── construct.d.ts
│   ├── jsconfig.json
│   └── icon.png
├── package.json
└── README.md
```

## Links

- [Construct App Registry](https://registry.construct.computer)
- [Construct app publishing guide](https://registry.construct.computer/publish)
- [@construct-computer/app-sdk](https://www.npmjs.com/package/@construct-computer/app-sdk)
