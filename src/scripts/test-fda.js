const tests = [
  { name: 'openFDA enforcement', url: 'https://api.fda.gov/food/enforcement.json?limit=1' },
  { name: 'openFDA SV search', url: 'https://api.fda.gov/food/enforcement.json?search=country_code:"SV"&limit=1' },
  { name: 'FDA Refusal Charges CSV', url: 'https://datadashboard.fda.gov/oii/download/ACT_SECTION_CHARGES.CSV' },
];

(async () => {
  console.log('=== TradeFlow SV — Test de conectividad FDA ===\n');
  for (const t of tests) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const r = await fetch(t.url, { signal: controller.signal });
      clearTimeout(timer);
      const contentType = r.headers.get('content-type') || '';
      const size = r.headers.get('content-length') || '?';
      if (r.ok) {
        if (contentType.includes('json')) {
          const data = await r.json();
          const total = data?.meta?.results?.total || data?.results?.length || '?';
          console.log(`✓ ${t.name} — OK (${r.status}, ${total} resultados)`);
        } else {
          const text = await r.text();
          console.log(`✓ ${t.name} — OK (${r.status}, ${text.length} bytes)`);
        }
      } else {
        console.log(`✗ ${t.name} — HTTP ${r.status}`);
      }
    } catch (err) {
      console.log(`✗ ${t.name} — ${err.message}`);
    }
  }
  console.log('\nSi todos dicen ✓, el auto-sync va a funcionar.');
  console.log('Si alguno dice ✗, corré: node scripts/import-fda.js para importar datos manualmente.\n');
})();
