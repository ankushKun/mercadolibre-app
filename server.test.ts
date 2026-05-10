import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATCH_ITEM_TIMEOUT_MS,
  MAX_BATCH_SIZE,
  MAX_PREPARE_BATCH_SIZE,
  buildPreparedProductBatch,
  collectBatchInputs,
  detailRowsToCsv,
  parseBatchInputs,
  resolveBatchRows,
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

test('batch input parsing normalizes lowercase IDs from text and arrays', () => {
  assert.deepEqual(
    parseBatchInputs({
      product_ids: ['mla123456', 'https://www.mercadolibre.com.ar/example/p/mla654321'],
      text: 'also check mlb999888 and MLM777666',
    }),
    ['MLA123456', 'MLA654321', 'MLB999888', 'MLM777666'],
  );

  const capped = collectBatchInputs({ text: 'mla1 mla2 mla3' }, 2);
  assert.deepEqual(capped.inputs, ['MLA1', 'MLA2']);
  assert.equal(capped.truncated, 1);
});

test('batch resolver runs with bounded concurrency instead of sequentially', async () => {
  const inputs = ['MLA500001', 'MLA500002', 'MLA500003', 'MLA500004', 'MLA500005'];
  let active = 0;
  let maxActive = 0;
  const rows = await resolveBatchRows(inputs, undefined, async (input) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 25));
    active -= 1;
    return mockResolved(String(input));
  });

  assert.equal(rows.length, inputs.length);
  assert.ok(maxActive > 1, 'batch resolver should overlap work');
  assert.deepEqual(rows.map((row) => row.product_id), inputs);
});

test('batch resolver returns partial fallback when a row exceeds the item budget', async () => {
  const startedAt = Date.now();
  const rows = await resolveBatchRows(['MLA600001'], undefined, async () => {
    await new Promise((resolve) => setTimeout(resolve, BATCH_ITEM_TIMEOUT_MS + 200));
    return mockResolved('MLA600001');
  });

  assert.equal(rows[0].status, 'partial');
  assert.equal(rows[0].product_id, 'MLA600001');
  assert.match(rows[0].warning || '', /batch budget/i);
  assert.ok(Date.now() - startedAt < BATCH_ITEM_TIMEOUT_MS + 1000);
});
