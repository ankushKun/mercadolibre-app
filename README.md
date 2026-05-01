[![Construct App](https://img.shields.io/badge/Construct-App-6366f1)](https://construct.computer)

# Construct App: Mercado Libre URL Resolver

A token-free [Construct](https://construct.computer) app that resolves Mercado Libre / Mercado Livre product IDs into canonical product page URLs and SEO slugs.

The app intentionally returns only browser-ready URL metadata. For rich product details such as title, price, seller, condition, or shipping information, the Construct agent should open the resolved product URL with its browser tool and extract what is visible on the page.

## Tools

| Tool | Description |
|---|---|
| `mercadolibre_resolve_product_url` | Resolve one product ID or `/p/{id}` URL into a browser-ready URL row with `status`, `product_id`, `url`, `slug`, `site_id`, and `country`. |
| `mercadolibre_resolve_product_urls` | Resolve up to 25 product IDs in one call and return JSON rows or minimal resolver CSV. Batch rows can be `ok`, `blocked`, `partial`, or `error`. |

Supported prefixes: `MLA` Argentina, `MLB` Brazil, `MLM` Mexico, `MLC` Chile, `MLU` Uruguay, `MLV` Venezuela, `MCO` Colombia, `MPE` Peru, `MEC` Ecuador.

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

## Intended Agent Workflow

1. Use this app to resolve Mercado Libre IDs into canonical URLs.
2. Open the resolved URLs with the browser tool when the user needs page details. If a row is `blocked` or `partial`, still open the returned `url`; it is the best browser-ready fallback.
3. Extract visible product data from the real page.
4. Produce the user's final table, CSV, or report from the browser-extracted details.

This keeps the app usable without OAuth tokens or account access.

## Limitations

- This is not an orders, listings, shipments, seller, or questions API integration.
- It does not use Mercado Libre OAuth or access tokens.
- It depends on Mercado Libre's `/p/{id}` redirect behavior for app-style clients.
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
│   └── icon.svg
├── package.json
└── README.md
```

## Links

- [Construct App Registry](https://registry.construct.computer)
- [Construct app publishing guide](https://registry.construct.computer/publish)
- [@construct-computer/app-sdk](https://www.npmjs.com/package/@construct-computer/app-sdk)
