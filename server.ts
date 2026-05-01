import { ConstructApp } from '@construct-computer/app-sdk';

const app = new ConstructApp({ name: 'mercadolibre', version: '0.1.0' });

/**
 * Mercado Libre site id → site metadata.
 * The ID prefix (MLA/MLB/MLM/...) tells us which country site to query.
 */
const SITES = {
  MLA: { origin: 'https://www.mercadolibre.com.ar', country: 'Argentina' },
  MLB: { origin: 'https://www.mercadolivre.com.br', country: 'Brazil' },
  MLM: { origin: 'https://www.mercadolibre.com.mx', country: 'Mexico' },
  MLC: { origin: 'https://www.mercadolibre.cl', country: 'Chile' },
  MLU: { origin: 'https://www.mercadolibre.com.uy', country: 'Uruguay' },
  MLV: { origin: 'https://www.mercadolibre.com.ve', country: 'Venezuela' },
  MCO: { origin: 'https://www.mercadolibre.com.co', country: 'Colombia' },
  MPE: { origin: 'https://www.mercadolibre.com.pe', country: 'Peru' },
  MEC: { origin: 'https://www.mercadolibre.com.ec', country: 'Ecuador' },
} as const;

type SiteId = keyof typeof SITES;
type OutputFormat = 'json' | 'csv';
type ResolveStatus = 'ok' | 'blocked' | 'partial' | 'error';

const SITE_IDS = Object.keys(SITES) as SiteId[];
const MAX_BATCH_SIZE = 25;
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Mercado Libre redirects /p/{id} → /{slug}/p/{id} only for app-style clients.
 * A generic browser User-Agent receives a 200 HTML "bot wall" with no Location header.
 */
const ML_APP_UA =
  'MercadoLibre/10.3.0 CFNetwork Darwin/23.0.0 AppleWebKit/605.1.15';

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('request_timeout'), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCanonicalProductUrl(shortUrl: string): Promise<Response> {
  const headers = {
    'User-Agent': ML_APP_UA,
    Accept: '*/*',
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      let res = await fetchWithTimeout(shortUrl, { method: 'HEAD', redirect: 'follow', headers });
      if (res.status === 405 || res.status === 501) {
        res = await fetchWithTimeout(shortUrl, { method: 'GET', redirect: 'follow', headers });
      }
      if (res.status < 500 || attempt === 1) return res;
    } catch (err) {
      lastError = err;
      if (attempt === 1) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Mercado Libre product IDs are strictly `{2-4 uppercase letters}{digits}`
 * (e.g. `MLA19791378`). No separators, no lowercase, no whitespace. Reject
 * anything else so callers don't paste garbage IDs that "almost work".
 */
const PRODUCT_ID_RE = /^[A-Z]{2,4}\d+$/;

/** Extract catalog slug from canonical URL path `/{slug}/p/{id}`. */
function slugFromProductUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const parts = pathname.split('/').filter(Boolean);
  const pIdx = parts.indexOf('p');
  if (pIdx < 1 || pIdx !== parts.length - 2) return null;
  const slug = parts[pIdx - 1];
  const id = parts[pIdx + 1];
  if (!slug || !id || !PRODUCT_ID_RE.test(id)) return null;
  return slug;
}

function parseProductId(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) {
    throw new Error('product_id is required (e.g. MLA19791378).');
  }
  const urlMatch = s.match(/\/p\/([^/?#]+)/);
  const candidate = urlMatch ? urlMatch[1] : s;
  if (!PRODUCT_ID_RE.test(candidate)) {
    throw new Error(
      `Invalid product_id "${candidate}". Expected the canonical Mercado Libre format: 2–4 uppercase letters followed by digits, with no separators (e.g. MLA19791378).`,
    );
  }
  return candidate;
}

function siteIdForProductId(productId: string): SiteId {
  const siteId = [...SITE_IDS]
    .sort((a, b) => b.length - a.length)
    .find((id) => productId.startsWith(id));
  if (!siteId) {
    throw new Error(`Unsupported Mercado Libre product prefix in "${productId}". Supported prefixes: ${SITE_IDS.join(', ')}.`);
  }
  return siteId;
}

function siteFromArg(site: unknown, productId: string): { site_id: SiteId; origin: string; country: string } {
  const raw = String(site ?? '').trim().replace(/\/+$/, '');
  if (!raw) {
    const siteId = siteIdForProductId(productId);
    return { site_id: siteId, ...SITES[siteId] };
  }

  const upper = raw.toUpperCase();
  if (SITE_IDS.includes(upper as SiteId)) {
    const siteId = upper as SiteId;
    return { site_id: siteId, ...SITES[siteId] };
  }

  const byOrigin = SITE_IDS.find((id) => SITES[id].origin === raw);
  if (byOrigin) return { site_id: byOrigin, ...SITES[byOrigin] };

  throw new Error(`Invalid site "${raw}". Use one of: ${SITE_IDS.join(', ')}.`);
}

function sourceUrlFromInput(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : undefined;
}

function fallbackProductUrl(productId: string, origin: string): string {
  return new URL(`/p/${encodeURIComponent(productId)}`, origin).href;
}

function extractGoUrl(finalUrl: string): string | undefined {
  try {
    const url = new URL(finalUrl);
    const go = url.searchParams.get('go');
    if (!go) return undefined;
    const decoded = decodeURIComponent(go);
    return /^https:\/\/www\.mercadolib(?:re|ivre)\./i.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function isBlockedFinalUrl(finalUrl: string): boolean {
  try {
    const path = new URL(finalUrl).pathname.toLowerCase();
    return path.includes('/gz/account-verification')
      || path.includes('captcha')
      || path.includes('challenge')
      || path.includes('verification')
      || path.includes('blocked');
  } catch {
    return false;
  }
}

interface ResolvedProductUrl {
  status: Exclude<ResolveStatus, 'error'>;
  product_id: string;
  url: string;
  slug: string | null;
  site_id: SiteId;
  country: string;
  fallback_url: string;
  final_url?: string;
  needs_browser?: boolean;
  warning?: string;
  source_url?: string;
}

interface BatchRow extends Partial<Omit<ResolvedProductUrl, 'status'>> {
  input: string;
  status: ResolveStatus;
  error?: string;
}

async function resolveProductUrl(rawProductId: unknown, site?: unknown): Promise<ResolvedProductUrl> {
  const productId = parseProductId(rawProductId);
  const siteMeta = siteFromArg(site, productId);
  const fallbackUrl = fallbackProductUrl(productId, siteMeta.origin);
  const base: Omit<ResolvedProductUrl, 'status' | 'url' | 'slug'> = {
    product_id: productId,
    site_id: siteMeta.site_id,
    country: siteMeta.country,
    fallback_url: fallbackUrl,
    source_url: sourceUrlFromInput(rawProductId),
  };

  let res: Response;
  try {
    res = await fetchCanonicalProductUrl(fallbackUrl);
  } catch (err) {
    return {
      ...base,
      status: 'partial',
      url: fallbackUrl,
      slug: null,
      needs_browser: true,
      warning: `Could not verify the canonical redirect (${err instanceof Error ? err.message : String(err)}). Open the fallback URL in the browser tool.`,
    };
  }

  if (!res.ok) {
    return {
      ...base,
      status: 'partial',
      url: fallbackUrl,
      slug: null,
      final_url: res.url,
      needs_browser: true,
      warning: `Mercado Libre returned HTTP ${res.status}. Open the fallback URL in the browser tool.`,
    };
  }

  const finalUrl = res.url;
  const slug = slugFromProductUrl(finalUrl);
  if (slug) {
    return {
      ...base,
      status: 'ok',
      url: finalUrl,
      slug,
      final_url: finalUrl,
    };
  }

  const blocked = isBlockedFinalUrl(finalUrl);
  const goUrl = extractGoUrl(finalUrl);
  return {
    ...base,
    status: blocked ? 'blocked' : 'partial',
    url: goUrl ?? fallbackUrl,
    slug: null,
    final_url: finalUrl,
    needs_browser: true,
    warning: blocked
      ? 'Mercado Libre redirected this request to verification. Open the fallback URL in the browser tool and continue there.'
      : 'Mercado Libre returned a page that did not include a canonical slug. Open the fallback URL in the browser tool.',
  };
}

function parseBatchInputs(args: Record<string, unknown>): string[] {
  const values: string[] = [];
  const productIds = args.product_ids;
  if (Array.isArray(productIds)) {
    values.push(...productIds.map((value) => String(value).trim()).filter(Boolean));
  }
  const text = typeof args.text === 'string' ? args.text : '';
  const matches = text.match(/[A-Z]{2,4}\d+/g);
  if (matches) values.push(...matches);
  return values.slice(0, MAX_BATCH_SIZE);
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows: BatchRow[]): string {
  const headers = ['input', 'status', 'product_id', 'url', 'slug', 'site_id', 'country', 'needs_browser', 'warning', 'final_url', 'fallback_url', 'error'];
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header as keyof BatchRow])).join(',')),
  ].join('\n');
}

app.tool('mercadolibre_resolve_product_url', {
  description:
    "Resolve one Mercado Libre product code to its canonical product page URL and URL metadata only. Use this first when the user mentions a Mercado Libre item (e.g. 'MLA19791378', 'MLA50469491', 'MLA54262263') or pastes a short '/p/{id}' link. This tool does not return title, price, seller, listing, order, or shipment details; after resolving the URL, use the browser tool to open the page and visually extract rich product details. If status is 'blocked' or 'partial', still use the returned url in the browser tool. Returns JSON: { status, url, slug, product_id, site_id, country, fallback_url, final_url, needs_browser, warning, source_url }.",
  parameters: {
    product_id: {
      type: 'string',
      description:
        "Mercado Libre product code in canonical form: 2–4 uppercase letters followed by digits, no separators (e.g. 'MLA19791378'). A '/p/{id}' URL is also accepted — the embedded id must match the same format. Country is inferred from the prefix; pass `site` to override.",
    },
    site: {
      type: 'string',
      enum: SITE_IDS,
      description:
        'Optional Mercado Libre site code override. Defaults to the site implied by the product ID prefix.',
    },
  },
  handler: async (args) => {
    return JSON.stringify(await resolveProductUrl(args.product_id, args.site), null, 2);
  },
});

app.tool('mercadolibre_resolve_product_urls', {
  description:
    `Resolve multiple Mercado Libre product codes to canonical product page URLs and minimal URL metadata. Use this for batch requests like "resolve these MercadoLibre products" or before opening product pages with the browser tool to extract title, price, seller, or other visual details. Rows may have status "ok", "blocked", "partial", or "error"; for blocked/partial rows, open the returned url with the browser tool. Accepts product_ids or pasted text containing IDs. Returns JSON rows by default, or CSV resolver rows when output_format is "csv". Maximum ${MAX_BATCH_SIZE} IDs per call.`,
  parameters: {
    product_ids: {
      type: 'array',
      items: { type: 'string' },
      description:
        "Mercado Libre product codes or '/p/{id}' URLs. Each ID should be 2-4 uppercase letters followed by digits, e.g. 'MLA19791378'.",
    },
    text: {
      type: 'string',
      description: 'Optional pasted text containing one or more Mercado Libre product IDs.',
    },
    site: {
      type: 'string',
      enum: SITE_IDS,
      description:
        'Optional Mercado Libre site code override for all inputs. Normally omit this and let the ID prefix choose the country.',
    },
    output_format: {
      type: 'string',
      enum: ['json', 'csv'],
      description: 'Response format for resolver rows. Defaults to json.',
    },
  },
  handler: async (args) => {
    const inputs = parseBatchInputs(args);
    if (inputs.length === 0) {
      throw new Error('Provide product_ids or text containing at least one Mercado Libre product code.');
    }

    const rows: BatchRow[] = [];
    for (const input of inputs) {
      try {
        rows.push({ input, ...(await resolveProductUrl(input, args.site)) });
      } catch (err) {
        rows.push({
          input,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const outputFormat = (args.output_format === 'csv' ? 'csv' : 'json') as OutputFormat;
    if (outputFormat === 'csv') return rowsToCsv(rows);
    return JSON.stringify({ rows, count: rows.length }, null, 2);
  },
});

export default app;
