import { ConstructApp } from '@construct-computer/app-sdk';

const app = new ConstructApp({ name: 'mercadolibre', version: '0.1.2' });

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
  MPA: { origin: 'https://www.mercadolibre.com.pa', country: 'Panama' },
  MPY: { origin: 'https://www.mercadolibre.com.py', country: 'Paraguay' },
  MRD: { origin: 'https://www.mercadolibre.com.do', country: 'Dominican Republic' },
  MBO: { origin: 'https://www.mercadolibre.com.bo', country: 'Bolivia' },
  MNI: { origin: 'https://www.mercadolibre.com.ni', country: 'Nicaragua' },
  MCR: { origin: 'https://www.mercadolibre.co.cr', country: 'Costa Rica' },
  MSV: { origin: 'https://www.mercadolibre.com.sv', country: 'El Salvador' },
  MHN: { origin: 'https://www.mercadolibre.com.hn', country: 'Honduras' },
  MGT: { origin: 'https://www.mercadolibre.com.gt', country: 'Guatemala' },
} as const;

type SiteId = keyof typeof SITES;
type OutputFormat = 'json' | 'csv';
type ResolveStatus = 'ok' | 'blocked' | 'partial' | 'error';
type RecommendedNextAction = 'open_url_in_browser';
type BrowserStatus = 'not_attempted' | 'filled' | 'blocked' | 'not_requested' | 'not_attempted_budget_limit';

const SITE_IDS = Object.keys(SITES) as SiteId[];
const MAX_BATCH_SIZE = 25;
const MAX_PREPARE_BATCH_SIZE = 250;
const FETCH_TIMEOUT_MS = 8_000;
const RECOMMENDED_NEXT_ACTION: RecommendedNextAction = 'open_url_in_browser';
const BROWSER_GUIDANCE =
  'This resolver returns URL metadata only. Open open_in_browser_url with the browser tool to view title, price, seller, shipping, and other visible product details.';
const DETAIL_FIELDS = ['title', 'brand', 'model', 'price', 'original_price', 'power_w'] as const;
const DETAIL_CSV_COLUMNS = [
  'input',
  'product_id',
  'status',
  'site_id',
  'country',
  'url',
  'open_in_browser_url',
  'slug',
  'needs_browser',
  'title',
  'brand',
  'model',
  'price',
  'currency',
  'original_price',
  'power_w',
  'seller',
  'condition',
  'shipping',
  'browser_status',
  'notes',
] as const;
const SITE_CURRENCIES: Record<SiteId, string> = {
  MLA: 'ARS',
  MLB: 'BRL',
  MLM: 'MXN',
  MLC: 'CLP',
  MLU: 'UYU',
  MLV: 'VES',
  MCO: 'COP',
  MPE: 'PEN',
  MEC: 'USD',
  MPA: 'USD',
  MPY: 'PYG',
  MRD: 'DOP',
  MBO: 'BOB',
  MNI: 'NIO',
  MCR: 'CRC',
  MSV: 'USD',
  MHN: 'HNL',
  MGT: 'GTQ',
};

/**
 * Mercado Libre redirects /p/{id} → /{slug}/p/{id} only for app-style clients.
 * A generic browser User-Agent receives a 200 HTML "bot wall" with no Location header.
 */
const ML_APP_UA =
  'MercadoLibre/10.3.0 CFNetwork Darwin/23.0.0 AppleWebKit/605.1.15';

function formatPrice(price: number, currency: string): string {
  return `${currency} ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPriceRange(prices: number[], currency: string): string {
  if (prices.length === 0) return `No ${currency} prices`;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatPrice(min, currency) : `${formatPrice(min, currency)} - ${formatPrice(max, currency)}`;
}

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
  needs_browser: boolean;
  recommended_next_action: RecommendedNextAction;
  open_in_browser_url: string;
  browser_guidance: string;
  final_url?: string;
  warning?: string;
  source_url?: string;
}

interface BatchRow extends Partial<Omit<ResolvedProductUrl, 'status'>> {
  input: string;
  status: ResolveStatus;
  error?: string;
}

interface ProductDetailScaffoldRow extends BatchRow {
  title: string;
  brand: string;
  model: string;
  price: string;
  currency: string;
  original_price: string;
  power_w: string;
  seller: string;
  condition: string;
  shipping: string;
  browser_status: BrowserStatus;
  notes: string;
}

interface PreparedProductBatch {
  summary: string;
  counts: {
    input: number;
    unique: number;
    duplicate: number;
    truncated: number;
    ok: number;
    partial: number;
    blocked: number;
    error: number;
  };
  max_input: number;
  chunk_size: number;
  chunks: Array<{ index: number; size: number; product_ids: string[] }>;
  csv_columns: string[];
  csv_headers: string[];
  detail_fields: string[];
  missing_browser_fields: string[];
  recommended_browser_strategy: string;
  browser_fill_plan: {
    total_urls: number;
    groups: Array<{ site_id: string; country: string; count: number; urls: string[] }>;
    statuses: Record<string, number>;
  };
  rows_preview: ProductDetailScaffoldRow[];
  csv_preview: string;
  construct_artifact: {
    filename: string;
    content_type: 'text/csv';
    content: string;
    summary: string;
    preview_rows: ProductDetailScaffoldRow[];
  };
}

async function resolveProductUrl(rawProductId: unknown, site?: unknown): Promise<ResolvedProductUrl> {
  const productId = parseProductId(rawProductId);
  const siteMeta = siteFromArg(site, productId);
  const fallbackUrl = fallbackProductUrl(productId, siteMeta.origin);
  const base: Omit<ResolvedProductUrl, 'status' | 'url' | 'slug' | 'needs_browser' | 'recommended_next_action' | 'open_in_browser_url' | 'browser_guidance'> = {
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
      recommended_next_action: RECOMMENDED_NEXT_ACTION,
      open_in_browser_url: fallbackUrl,
      browser_guidance: BROWSER_GUIDANCE,
      warning: `Could not verify the canonical redirect (${err instanceof Error ? err.message : String(err)}). Open open_in_browser_url with the browser tool.`,
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
      recommended_next_action: RECOMMENDED_NEXT_ACTION,
      open_in_browser_url: fallbackUrl,
      browser_guidance: BROWSER_GUIDANCE,
      warning: `Mercado Libre returned HTTP ${res.status}. Open open_in_browser_url with the browser tool.`,
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
      needs_browser: true,
      recommended_next_action: RECOMMENDED_NEXT_ACTION,
      open_in_browser_url: finalUrl,
      browser_guidance: BROWSER_GUIDANCE,
    };
  }

  const blocked = isBlockedFinalUrl(finalUrl);
  const goUrl = extractGoUrl(finalUrl);
  const browserUrl = goUrl ?? fallbackUrl;
  return {
    ...base,
    status: blocked ? 'blocked' : 'partial',
    url: browserUrl,
    slug: null,
    final_url: finalUrl,
    needs_browser: true,
    recommended_next_action: RECOMMENDED_NEXT_ACTION,
    open_in_browser_url: browserUrl,
    browser_guidance: BROWSER_GUIDANCE,
    warning: blocked
      ? 'Mercado Libre redirected this request to verification. Open open_in_browser_url with the browser tool and continue there.'
      : 'Mercado Libre returned a page that did not include a canonical slug. Open open_in_browser_url with the browser tool.',
  };
}

function collectBatchInputs(args: Record<string, unknown>, max: number): { inputs: string[]; truncated: number } {
  const values: string[] = [];
  const productIds = args.product_ids;
  if (Array.isArray(productIds)) {
    values.push(...productIds.map((value) => String(value).trim()).filter(Boolean));
  }
  const text = typeof args.text === 'string' ? args.text : '';
  const matches = text.match(/[A-Z]{2,4}\d+/g);
  if (matches) values.push(...matches);
  return {
    inputs: values.slice(0, max),
    truncated: Math.max(0, values.length - max),
  };
}

function parseBatchInputs(args: Record<string, unknown>): string[] {
  return collectBatchInputs(args, MAX_BATCH_SIZE).inputs;
}

function dedupeInputs(inputs: string[]): { inputs: string[]; duplicate: number } {
  const seen = new Set<string>();
  const unique: string[] = [];
  let duplicate = 0;

  for (const input of inputs) {
    let key: string;
    try {
      key = parseProductId(input);
    } catch {
      key = input;
    }
    if (seen.has(key)) {
      duplicate += 1;
      continue;
    }
    seen.add(key);
    unique.push(input);
  }

  return { inputs: unique, duplicate };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowsToCsv(rows: BatchRow[]): string {
  const headers = ['input', 'status', 'product_id', 'url', 'slug', 'site_id', 'country', 'needs_browser', 'recommended_next_action', 'open_in_browser_url', 'browser_guidance', 'warning', 'final_url', 'fallback_url', 'error'];
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header as keyof BatchRow])).join(',')),
  ].join('\n');
}

function currencyForSite(siteId: unknown): string {
  return typeof siteId === 'string' && SITE_IDS.includes(siteId as SiteId)
    ? SITE_CURRENCIES[siteId as SiteId]
    : '';
}

function scaffoldRow(row: BatchRow): ProductDetailScaffoldRow {
  const browserStatus: BrowserStatus = row.status === 'error'
    ? 'not_requested'
    : row.status === 'blocked'
      ? 'blocked'
      : 'not_attempted';
  return {
    ...row,
    title: '',
    brand: '',
    model: '',
    price: '',
    currency: currencyForSite(row.site_id),
    original_price: '',
    power_w: '',
    seller: '',
    condition: '',
    shipping: '',
    browser_status: browserStatus,
    notes: row.error || row.warning || '',
  };
}

function detailCsvHeaders(rows: ProductDetailScaffoldRow[]): string[] {
  const currencies = [...new Set(rows.map((row) => row.currency).filter(Boolean))];
  const currency = currencies.length === 1 ? currencies[0] : '';
  return [
    'Input',
    'Product ID',
    'Status',
    'Site',
    'Country',
    'URL',
    'Open In Browser URL',
    'Slug',
    'Needs Browser',
    'Title',
    'Brand',
    'Model',
    currency ? `Price (${currency})` : 'Price',
    'Currency',
    currency ? `Original Price (${currency})` : 'Original Price',
    'Power (W)',
    'Seller',
    'Condition',
    'Shipping',
    'Browser Status',
    'Notes',
  ];
}

function detailRowsToCsv(rows: ProductDetailScaffoldRow[]): string {
  const headers = detailCsvHeaders(rows);
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => DETAIL_CSV_COLUMNS.map((column) => csvEscape(row[column])).join(',')),
  ].join('\n');
}

function countStatuses(rows: BatchRow[]): PreparedProductBatch['counts'] {
  const counts = {
    input: 0,
    unique: 0,
    duplicate: 0,
    truncated: 0,
    ok: 0,
    partial: 0,
    blocked: 0,
    error: 0,
  };
  for (const row of rows) {
    counts[row.status] += 1;
  }
  return counts;
}

function buildBrowserFillPlan(rows: ProductDetailScaffoldRow[]): PreparedProductBatch['browser_fill_plan'] {
  const groups = new Map<string, { site_id: string; country: string; count: number; urls: string[] }>();
  const statuses: Record<string, number> = {};

  for (const row of rows) {
    statuses[row.status] = (statuses[row.status] || 0) + 1;
    if (!row.open_in_browser_url || row.status === 'error') continue;
    const key = `${row.site_id || 'unknown'}:${row.country || 'unknown'}`;
    const group = groups.get(key) || {
      site_id: row.site_id || 'unknown',
      country: row.country || 'unknown',
      count: 0,
      urls: [],
    };
    group.count += 1;
    if (group.urls.length < 10) group.urls.push(row.open_in_browser_url);
    groups.set(key, group);
  }

  return {
    total_urls: rows.filter((row) => row.open_in_browser_url && row.status !== 'error').length,
    groups: [...groups.values()],
    statuses,
  };
}

async function buildPreparedProductBatch(
  args: Record<string, unknown>,
  resolver: (input: unknown, site?: unknown) => Promise<ResolvedProductUrl> = resolveProductUrl,
): Promise<PreparedProductBatch> {
  const collected = collectBatchInputs(args, MAX_PREPARE_BATCH_SIZE);
  const deduped = dedupeInputs(collected.inputs);
  if (deduped.inputs.length === 0) {
    throw new Error('Provide product_ids or text containing at least one Mercado Libre product code.');
  }

  const rows: BatchRow[] = [];
  for (const input of deduped.inputs) {
    try {
      rows.push({ input, ...(await resolver(input, args.site)) });
    } catch (err) {
      rows.push({
        input,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const scaffoldRows = rows.map(scaffoldRow);
  const chunks = chunkArray(scaffoldRows, MAX_BATCH_SIZE).map((chunk, index) => ({
    index,
    size: chunk.length,
    product_ids: chunk.map((row) => row.product_id || row.input),
  }));
  const counts = countStatuses(rows);
  counts.input = collected.inputs.length;
  counts.unique = deduped.inputs.length;
  counts.duplicate = deduped.duplicate;
  counts.truncated = collected.truncated;

  const csv = detailRowsToCsv(scaffoldRows);
  const previewRows = scaffoldRows.slice(0, 5);
  const summary = [
    `Prepared MercadoLibre product-detail CSV scaffold for ${counts.unique} unique product(s).`,
    counts.duplicate ? `${counts.duplicate} duplicate input(s) removed.` : '',
    counts.truncated ? `${counts.truncated} input(s) skipped because the limit is ${MAX_PREPARE_BATCH_SIZE}.` : '',
    `${counts.ok} resolved, ${counts.partial} partial, ${counts.blocked} blocked, ${counts.error} error.`,
    'Browser-fill fields: title, brand, model, price, original_price, power_w, seller, condition, shipping.',
  ].filter(Boolean).join(' ');

  return {
    summary,
    counts,
    max_input: MAX_PREPARE_BATCH_SIZE,
    chunk_size: MAX_BATCH_SIZE,
    chunks,
    csv_columns: [...DETAIL_CSV_COLUMNS],
    csv_headers: detailCsvHeaders(scaffoldRows),
    detail_fields: [...DETAIL_FIELDS],
    missing_browser_fields: [...DETAIL_FIELDS],
    recommended_browser_strategy: 'Use this CSV scaffold first. Only open open_in_browser_url in the browser for rows where the user needs product details such as title, brand, model, price, original price, or specs like power. Mark browser_status for each attempted row.',
    browser_fill_plan: buildBrowserFillPlan(scaffoldRows),
    rows_preview: previewRows,
    csv_preview: detailRowsToCsv(previewRows),
    construct_artifact: {
      filename: 'mercadolibre_products.csv',
      content_type: 'text/csv',
      content: csv,
      summary,
      preview_rows: previewRows,
    },
  };
}

app.tool('mercadolibre_resolve_product_url', {
  description:
    "Resolve one Mercado Libre product code to its canonical product page URL and URL metadata only. Use this app tool first when the user mentions a Mercado Libre item (e.g. 'MLA19791378', 'MLA50469491', 'MLA54262263') or pastes a short '/p/{id}' link. Do not use terminal, curl, Python requests, raw Mercado Libre API probing, vendor CLIs, search-engine scraping, or generic web search to resolve these IDs before trying this app. This tool does not return title, price, seller, listing, order, or shipment details; after resolving, pass open_in_browser_url to the browser tool to inspect the real product page. If status is 'blocked' or 'partial', still open open_in_browser_url in the browser. Returns JSON: { status, url, slug, product_id, site_id, country, fallback_url, final_url, needs_browser, recommended_next_action, open_in_browser_url, browser_guidance, warning, source_url }.",
  parameters: {
    product_id: {
      type: 'string',
      description:
        "Mercado Libre product code in canonical form: 2-4 uppercase letters followed by digits, no separators (e.g. 'MLA19791378'). A '/p/{id}' URL is also accepted; the embedded id must match the same format. Country is inferred from the prefix; pass `site` to override.",
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
    `Resolve multiple Mercado Libre product codes to canonical product page URLs and minimal URL metadata. Use this app tool first for pasted ID lists like "MLA20032017 MLA11145437 MLA16987442" or requests like "fetch details for all these MercadoLibre products." Do not use terminal, curl, Python requests, raw Mercado Libre API probing, vendor CLIs, search-engine scraping, or generic web search to resolve these IDs before trying this app. This batch resolver returns browser-ready URLs only; it does not return title, price, seller, listing, order, or shipment details. For each non-error row, pass open_in_browser_url to the browser tool to inspect the real product page and extract visible details. Rows may have status "ok", "blocked", "partial", or "error"; for blocked/partial rows, still open open_in_browser_url in the browser. Accepts product_ids or pasted text containing IDs. Returns JSON rows by default, or CSV resolver rows when output_format is "csv". Maximum ${MAX_BATCH_SIZE} IDs per call.`,
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

app.tool('mercadolibre_prepare_product_batch', {
  description:
    `Prepare a high-volume Mercado Libre product-detail batch for CSV output. Use this app tool first for large requests like "fetch details for these 100 MercadoLibre IDs and prepare a CSV." It accepts up to ${MAX_PREPARE_BATCH_SIZE} product IDs or pasted text, deduplicates inputs, resolves browser-ready product URLs internally, and returns a compact summary plus a CSV artifact scaffold. The scaffold includes columns for Product ID, Title, Brand, Model, Price, Original Price, Power, URL, browser status, and notes. This tool does not itself extract rendered page details; title, brand, model, price, original_price, power_w, seller, condition, and shipping are marked as browser-fill fields. After this tool returns, use browser only for requested rich fields and write those values into the CSV scaffold. Do not use terminal, curl, Python requests, raw Mercado Libre API probing, vendor CLIs, search-engine scraping, or repeated single-ID calls before this batch tool.`,
  parameters: {
    product_ids: {
      type: 'array',
      items: { type: 'string' },
      description:
        `Mercado Libre product codes or '/p/{id}' URLs. Up to ${MAX_PREPARE_BATCH_SIZE} inputs are accepted; duplicates are removed before resolution.`,
    },
    text: {
      type: 'string',
      description:
        `Optional pasted text containing one or more Mercado Libre product IDs. Use this for large pasted lists; the tool extracts up to ${MAX_PREPARE_BATCH_SIZE} IDs.`,
    },
    site: {
      type: 'string',
      enum: SITE_IDS,
      description:
        'Optional Mercado Libre site code override for all inputs. Normally omit this and let the ID prefix choose the country.',
    },
  },
  handler: async (args) => {
    return JSON.stringify(await buildPreparedProductBatch(args), null, 2);
  },
});

export {
  MAX_BATCH_SIZE,
  MAX_PREPARE_BATCH_SIZE,
  DETAIL_CSV_COLUMNS,
  buildPreparedProductBatch,
  detailRowsToCsv,
};

export default app;
