(() => {
  'use strict';

  const script = document.currentScript;
  const page = script && script.dataset.analyticsPath;
  if (!page || !page.startsWith('/')) return;

  const params = new URLSearchParams({
    p: page,
    ns: '1',
    rnd: Math.random().toString(36).slice(2, 9)
  });
  const url = `https://simplefit.goatcounter.com/count?${params}`;
  const options = {
    mode: 'no-cors',
    credentials: 'omit',
    cache: 'no-store',
    keepalive: true,
    referrerPolicy: 'no-referrer'
  };

  if (typeof fetch !== 'function') return;
  fetch(url, options).catch(() => {});
})();
