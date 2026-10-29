// Payment return page (no sign-in, no network calls): shows the outcome passed back by the provider.
const q = new URLSearchParams(location.search);
const status = (q.get('status') || '').toLowerCase();
if (status === 'cancelled' || status === 'failed') {
  document.getElementById('title').textContent = 'Payment not completed';
  document.getElementById('message').textContent = 'No money was taken for this attempt. You can try again from the app.';
}
const ref = q.get('tx_ref');
if (ref && /^PF-[A-F0-9]+$/.test(ref)) document.getElementById('ref').textContent = 'Reference: ' + ref;
