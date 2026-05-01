import { ConstructApp } from '@construct-computer/app-sdk';

const app = new ConstructApp({ name: 'mercadolibre', version: '0.1.0' });

/**
 * Country code → Mercado Libre site origin.
 * The ID prefix (MLA/MLB/MLM/...) tells us which country site to query.
 */
const SITES: Record<string, string> = {
  MLA: 'https://www.mercadolibre.com.ar', // Argentina
  MLB: 'https://www.mercadolivre.com.br', // Brazil
  MLM: 'https://www.mercadolibre.com.mx', // Mexico
  MLC: 'https://www.mercadolibre.cl',     // Chile
  MLU: 'https://www.mercadolibre.com.uy', // Uruguay
  MLV: 'https://www.mercadolibre.com.ve', // Venezuela
  MCO: 'https://www.mercadolibre.com.co', // Colombia
  MPE: 'https://www.mercadolibre.com.pe', // Peru
  MEC: 'https://www.mercadolibre.com.ec', // Ecuador
};

const DEFAULT_SITE = SITES.MLA;

/**
 * Mercado Libre redirects /p/{id} → /{slug}/p/{id} only for app-style clients.
 * A generic browser User-Agent receives a 200 HTML "bot wall" with no Location header.
 */
const ML_APP_UA =
  'MercadoLibre/10.3.0 CFNetwork Darwin/23.0.0 AppleWebKit/605.1.15';

async function fetchCanonicalProductUrl(shortUrl: string): Promise<Response> {
  const headers = {
    'User-Agent': ML_APP_UA,
    Accept: '*/*',
  };
  let res = await fetch(shortUrl, { method: 'HEAD', redirect: 'follow', headers });
  if (res.status === 405 || res.status === 501) {
    res = await fetch(shortUrl, { method: 'GET', redirect: 'follow', headers });
  }
  return res;
}

/**
 * Mercado Libre product IDs are strictly `{2-4 uppercase letters}{digits}`
 * (e.g. `MLA61887851`). No separators, no lowercase, no whitespace. Reject
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
    throw new Error('product_id is required (e.g. MLA61887851).');
  }
  const urlMatch = s.match(/\/p\/([^/?#]+)/);
  const candidate = urlMatch ? urlMatch[1] : s;
  if (!PRODUCT_ID_RE.test(candidate)) {
    throw new Error(
      `Invalid product_id "${candidate}". Expected the canonical Mercado Libre format: 2–4 uppercase letters followed by digits, with no separators (e.g. MLA61887851).`,
    );
  }
  return candidate;
}

function siteForProductId(productId: string): string {
  const prefix = productId.slice(0, 3);
  return SITES[prefix] ?? DEFAULT_SITE;
}

app.tool('mercadolibre_resolve_product', {
  description:
    "Resolve a Mercado Libre product code to its full listing URL and SEO slug. Use this whenever the user mentions a Mercado Libre item (e.g. 'MLA61887851', 'MLB2974485636', 'MLM3193658272') or pastes a short '/p/{id}' link and you need the canonical product page URL or the slug. The ID prefix selects the country site automatically: MLA Argentina, MLB Brazil, MLM Mexico, MLC Chile, MLU Uruguay, MLV Venezuela, MCO Colombia, MPE Peru, MEC Ecuador. Returns JSON: { url, slug, product_id, country }.",
  parameters: {
    product_id: {
      type: 'string',
      description:
        "Mercado Libre product code in canonical form: 2–4 uppercase letters followed by digits, no separators (e.g. 'MLA61887851'). A '/p/{id}' URL is also accepted — the embedded id must match the same format. Country is inferred from the prefix; pass `site` to override.",
    },
    site: {
      type: 'string',
      description:
        'Optional Mercado Libre site origin to query. Defaults to the site implied by the product ID prefix (Argentina if no prefix match).',
    },
  },
  handler: async (args) => {
    const productId = parseProductId(args.product_id);

    const origin = String(args.site ?? siteForProductId(productId)).replace(/\/+$/, '');
    let siteUrl: URL;
    try {
      siteUrl = new URL(origin);
    } catch {
      throw new Error(`Invalid site URL: ${origin}`);
    }

    const shortUrl = new URL(`/p/${encodeURIComponent(productId)}`, siteUrl).href;
    const res = await fetchCanonicalProductUrl(shortUrl);

    if (!res.ok) {
      throw new Error(`Request failed (${res.status}) for ${shortUrl}`);
    }

    const finalUrl = res.url;
    const slug = slugFromProductUrl(finalUrl);
    if (!slug) {
      throw new Error(
        `Could not parse catalog slug from final URL (expected .../{slug}/p/${productId}): ${finalUrl}`,
      );
    }

    const country =
      Object.entries(SITES).find(([, url]) => url === origin)?.[0] ?? null;

    return JSON.stringify(
      { url: finalUrl, slug, product_id: productId, country },
      null,
      2,
    );
  },
});

export default app;
