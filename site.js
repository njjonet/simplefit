
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(console.warn));
}
for (const a of document.querySelectorAll('.nav a')) {
  if (new URL(a.href).pathname.replace(/\/$/, '/index.html') === location.pathname.replace(/\/$/, '/index.html')) a.setAttribute('aria-current','page');
}
