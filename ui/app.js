/// <reference path="./construct.d.ts" />

construct.ready(() => {
  construct.ui.setTitle('Mercado Libre URL Resolver');

  const form = /** @type {HTMLFormElement} */ (document.getElementById('resolve-form'));
  const input = /** @type {HTMLInputElement} */ (document.getElementById('product-id'));
  const batchInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('product-ids'));
  const singleButton = /** @type {HTMLButtonElement} */ (document.getElementById('resolve-btn'));
  const batchButton = /** @type {HTMLButtonElement} */ (document.getElementById('batch-resolve-btn'));
  const result = /** @type {HTMLElement} */ (document.getElementById('result'));
  const singlePanel = /** @type {HTMLElement} */ (document.getElementById('single-panel'));
  const batchPanel = /** @type {HTMLElement} */ (document.getElementById('batch-panel'));

  /** @type {'single' | 'batch'} */
  let mode = 'single';
  let lastCsv = '';

  for (const chip of document.querySelectorAll('.example-chip')) {
    chip.addEventListener('click', () => {
      const el = /** @type {HTMLElement} */ (chip);
      const value = el.dataset.fill ?? '';
      if (mode === 'single') {
        input.value = value;
        input.focus();
      } else {
        batchInput.value = batchInput.value ? `${batchInput.value}\n${value}` : value;
        batchInput.focus();
      }
    });
  }

  for (const tab of document.querySelectorAll('.mode-tab')) {
    tab.addEventListener('click', () => {
      const el = /** @type {HTMLElement} */ (tab);
      mode = el.dataset.mode === 'batch' ? 'batch' : 'single';
      document.querySelectorAll('.mode-tab').forEach((node) => node.classList.toggle('active', node === tab));
      singlePanel.classList.toggle('active', mode === 'single');
      batchPanel.classList.toggle('active', mode === 'batch');
      result.className = 'result';
      result.innerHTML = '';
    });
  }

  /** @param {string} message */
  function showError(message) {
    result.className = 'result visible error';
    result.textContent = message;
  }

  function showLoading() {
    result.className = 'result visible';
    result.textContent = 'Resolving...';
  }

  /**
   * @param {string} label
   * @param {string | undefined} value
   * @param {string | undefined} href
   */
  function row(label, value, href) {
    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'value';
    if (href && value) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = value;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      valueEl.appendChild(a);
    } else {
      valueEl.textContent = value || '';
    }
    return [labelEl, valueEl];
  }

  /** @param {unknown} data */
  function showResult(data) {
    const resolved = /** @type {{ status?: string; url?: string; slug?: string | null; product_id?: string; site_id?: string; country?: string; fallback_url?: string; final_url?: string; needs_browser?: boolean; warning?: string; source_url?: string }} */ (data);
    lastCsv = [
      'status,product_id,url,slug,site_id,country,needs_browser,warning,final_url,fallback_url',
      [
        resolved.status,
        resolved.product_id,
        resolved.url,
        resolved.slug,
        resolved.site_id,
        resolved.country,
        resolved.needs_browser,
        resolved.warning,
        resolved.final_url,
        resolved.fallback_url,
      ].map(csvEscape).join(','),
    ].join('\n');

    result.className = 'result visible';
    result.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'result-grid';
    for (const node of row('Status', resolved.status || 'ok', undefined)) grid.appendChild(node);
    for (const node of row('URL', resolved.url, resolved.url)) grid.appendChild(node);
    for (const node of row('Slug', resolved.slug || undefined, undefined)) grid.appendChild(node);
    for (const node of row('Product ID', resolved.product_id, undefined)) grid.appendChild(node);
    for (const node of row('Site', [resolved.site_id, resolved.country].filter(Boolean).join(' - '), undefined)) grid.appendChild(node);
    if (resolved.warning) {
      for (const node of row('Warning', resolved.warning, undefined)) grid.appendChild(node);
    }
    if (resolved.fallback_url && resolved.fallback_url !== resolved.url) {
      for (const node of row('Fallback URL', resolved.fallback_url, resolved.fallback_url)) grid.appendChild(node);
    }
    if (resolved.final_url && resolved.final_url !== resolved.url) {
      for (const node of row('Final URL', resolved.final_url, resolved.final_url)) grid.appendChild(node);
    }
    result.appendChild(grid);
    result.appendChild(actionButton('Copy URL', () => copyText(resolved.url || '')));
    result.appendChild(actionButton('Copy CSV row', () => copyText(lastCsv)));
  }

  /** @param {{ rows?: Array<Record<string, unknown>> }} data */
  function showBatchResult(data) {
    const rows = data.rows || [];
    lastCsv = rowsToCsv(rows);
    result.className = 'result visible';
    result.innerHTML = '';

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.appendChild(actionButton('Copy resolver CSV', () => copyText(lastCsv)));
    actions.appendChild(actionButton('Copy URLs', () => copyText(rows.map((r) => r.url).filter(Boolean).join('\n'))));
    result.appendChild(actions);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Status</th><th>Product ID</th><th>URL</th><th>Slug</th><th>Site</th><th>Warning</th><th>Error</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const item of rows) {
      const tr = document.createElement('tr');
      appendCell(tr, String(item.status || ''), undefined);
      appendCell(tr, String(item.product_id || item.input || ''), undefined);
      appendCell(tr, String(item.url || ''), typeof item.url === 'string' ? item.url : undefined);
      appendCell(tr, String(item.slug || ''), undefined);
      appendCell(tr, [item.site_id, item.country].filter(Boolean).join(' - '), undefined);
      appendCell(tr, String(item.warning || ''), undefined, item.status === 'blocked' || item.status === 'partial');
      appendCell(tr, String(item.error || ''), undefined, item.status === 'error');
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    result.appendChild(tableWrap);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = mode === 'single' ? input.value.trim() : batchInput.value.trim();
    if (!value) {
      showError(mode === 'single' ? 'Enter a product code or /p/ URL.' : 'Paste one or more product codes.');
      return;
    }

    singleButton.disabled = true;
    batchButton.disabled = true;
    showLoading();

    try {
      const text = mode === 'single'
        ? await construct.tools.callText('mercadolibre_resolve_product_url', { product_id: value })
        : await construct.tools.callText('mercadolibre_resolve_product_urls', { text: value });
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        showError(text || 'Empty response from tool.');
        return;
      }
      if (mode === 'single') showResult(parsed);
      else showBatchResult(parsed);
    } catch (err) {
      const message = /** @type {Error} */ (err)?.message ?? String(err);
      showError(message);
    } finally {
      singleButton.disabled = false;
      batchButton.disabled = false;
    }
  });

  /**
   * @param {string} label
   * @param {() => void | Promise<void>} onClick
   */
  function actionButton(label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary-btn';
    button.textContent = label;
    button.addEventListener('click', () => void onClick());
    return button;
  }

  /** @param {string} text */
  async function copyText(text) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
  }

  /** @param {unknown} value */
  function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  /** @param {Array<Record<string, unknown>>} rows */
  function rowsToCsv(rows) {
    const headers = ['input', 'status', 'product_id', 'url', 'slug', 'site_id', 'country', 'needs_browser', 'warning', 'final_url', 'fallback_url', 'error'];
    return [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')),
    ].join('\n');
  }

  /**
   * @param {HTMLTableRowElement} tr
   * @param {string} value
   * @param {string | undefined} href
   * @param {boolean=} isError
   */
  function appendCell(tr, value, href, isError = false) {
    const td = document.createElement('td');
    if (isError) td.className = 'status-error';
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = value;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      td.appendChild(a);
    } else {
      td.textContent = value;
    }
    tr.appendChild(td);
  }
});
