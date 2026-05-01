/// <reference path="./construct.d.ts" />

construct.ready(() => {
  construct.ui.setTitle('Mercado Libre');

  const form = /** @type {HTMLFormElement} */ (document.getElementById('resolve-form'));
  const input = /** @type {HTMLInputElement} */ (document.getElementById('product-id'));
  const button = /** @type {HTMLButtonElement} */ (document.getElementById('resolve-btn'));
  const result = /** @type {HTMLElement} */ (document.getElementById('result'));
  const primaryLabel = /** @type {HTMLElement} */ (document.getElementById('result-primary-label'));
  const primary = /** @type {HTMLElement} */ (document.getElementById('result-primary'));
  const slug = /** @type {HTMLElement} */ (document.getElementById('result-slug'));
  const slugRow = /** @type {HTMLElement} */ (document.getElementById('result-slug-row'));
  const country = /** @type {HTMLElement} */ (document.getElementById('result-country'));
  const countryRow = /** @type {HTMLElement} */ (document.getElementById('result-country-row'));

  for (const chip of document.querySelectorAll('.example-chip')) {
    chip.addEventListener('click', () => {
      const el = /** @type {HTMLElement} */ (chip);
      input.value = el.dataset.fill ?? '';
      input.focus();
    });
  }

  /**
   * @param {string} text
   * @param {string} href
   */
  function setLink(text, href) {
    primary.innerHTML = '';
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    primary.appendChild(a);
  }

  function showError(message) {
    result.classList.add('visible', 'error');
    primaryLabel.textContent = 'Error';
    primary.textContent = message;
    slugRow.style.display = 'none';
    countryRow.style.display = 'none';
  }

  function showLoading() {
    result.classList.add('visible');
    result.classList.remove('error');
    primaryLabel.textContent = 'Status';
    primary.textContent = 'Resolving\u2026';
    slugRow.style.display = 'none';
    countryRow.style.display = 'none';
  }

  function showResult(data) {
    result.classList.add('visible');
    result.classList.remove('error');
    primaryLabel.textContent = 'URL';
    if (data.url) {
      setLink(data.url, data.url);
    } else {
      primary.textContent = '(no url)';
    }
    if (data.slug) {
      slug.textContent = data.slug;
      slugRow.style.display = '';
    } else {
      slugRow.style.display = 'none';
    }
    if (data.country) {
      country.textContent = data.country;
      countryRow.style.display = '';
    } else {
      countryRow.style.display = 'none';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;

    button.disabled = true;
    showLoading();

    try {
      const text = await construct.tools.callText('mercadolibre_resolve_product', {
        product_id: value,
      });
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        showError(text || 'Empty response from tool.');
        return;
      }
      showResult(parsed);
    } catch (err) {
      const message = /** @type {Error} */ (err)?.message ?? String(err);
      showError(message);
    } finally {
      button.disabled = false;
    }
  });
});
