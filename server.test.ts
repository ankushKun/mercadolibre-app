import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BATCH_SIZE,
  MAX_PREPARE_BATCH_SIZE,
  buildPreparedProductBatch,
  detailRowsToCsv,
} from './server';

function mockResolved(productId: string) {
  return {
    status: 'ok' as const,
    product_id: productId,
    url: `https://www.mercadolibre.com.ar/example/p/${productId}`,
    slug: 'example',
    site_id: 'MLA' as const,
    country: 'Argentina',
    fallback_url: `https://www.mercadolibre.com.ar/p/${productId}`,
    needs_browser: true,
    recommended_next_action: 'open_url_in_browser' as const,
    open_in_browser_url: `https://www.mercadolibre.com.ar/example/p/${productId}`,
    browser_guidance: 'Open open_in_browser_url with the browser tool.',
    final_url: `https://www.mercadolibre.com.ar/example/p/${productId}`,
  };
}

test('prepare product batch dedupes inputs and chunks by resolver batch size', async () => {
  const productIds = Array.from({ length: 60 }, (_, i) => `MLA${100000 + i}`);
  const prepared = await buildPreparedProductBatch(
    { product_ids: [...productIds, productIds[0], productIds[1]] },
    async (input) => mockResolved(String(input)),
  );

  assert.equal(prepared.counts.input, 62);
  assert.equal(prepared.counts.unique, 60);
  assert.equal(prepared.counts.duplicate, 2);
  assert.equal(prepared.chunks.length, 3);
  assert.deepEqual(prepared.chunks.map((chunk) => chunk.size), [MAX_BATCH_SIZE, MAX_BATCH_SIZE, 10]);
  assert.equal(prepared.max_input, MAX_PREPARE_BATCH_SIZE);
});

test('prepare product batch caps input and reports truncation', async () => {
  const productIds = Array.from({ length: MAX_PREPARE_BATCH_SIZE + 5 }, (_, i) => `MLA${200000 + i}`);
  const prepared = await buildPreparedProductBatch(
    { product_ids: productIds },
    async (input) => mockResolved(String(input)),
  );

  assert.equal(prepared.counts.unique, MAX_PREPARE_BATCH_SIZE);
  assert.equal(prepared.counts.truncated, 5);
  assert.equal(prepared.chunks.length, Math.ceil(MAX_PREPARE_BATCH_SIZE / MAX_BATCH_SIZE));
});

test('prepared CSV scaffold uses product-detail headers and blank browser-fill fields', async () => {
  const prepared = await buildPreparedProductBatch(
    { product_ids: ['MLA300001'] },
    async (input) => mockResolved(String(input)),
  );

  assert.match(prepared.csv_preview, /Product ID,Status/);
  assert.match(prepared.csv_preview, /Price \(ARS\)/);
  assert.match(prepared.csv_preview, /Original Price \(ARS\)/);
  assert.match(prepared.csv_preview, /Power \(W\)/);
  assert.equal(prepared.rows_preview[0].title, '');
  assert.equal(prepared.rows_preview[0].browser_status, 'not_attempted');
  assert.equal(prepared.construct_artifact.filename, 'mercadolibre_products.csv');
  assert.match(prepared.construct_artifact.content, /MLA300001/);
});

test('detail rows CSV preserves stable product-detail columns', () => {
  const csv = detailRowsToCsv([
    {
      input: 'MLA400001',
      status: 'ok',
      product_id: 'MLA400001',
      site_id: 'MLA',
      country: 'Argentina',
      url: 'https://www.mercadolibre.com.ar/example/p/MLA400001',
      open_in_browser_url: 'https://www.mercadolibre.com.ar/example/p/MLA400001',
      slug: 'example',
      needs_browser: true,
      title: 'Licuadora Oster',
      brand: 'Oster',
      model: 'BLSTBG4655B',
      price: '157131.87',
      currency: 'ARS',
      original_price: '168959',
      power_w: '600',
      seller: '',
      condition: '',
      shipping: '',
      browser_status: 'filled',
      notes: '',
    },
  ]);

  assert.match(csv, /Title,Brand,Model/);
  assert.match(csv, /Price \(ARS\),Currency,Original Price \(ARS\),Power \(W\)/);
  assert.match(csv, /Licuadora Oster,Oster,BLSTBG4655B/);
});
