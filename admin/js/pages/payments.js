import { supabase } from '../supabase.js';
import { initLayout } from '../layout.js';
import { esc, money, dateTime, toast, errorText, statusBadge, toMinor, fromMinor, functionError, exportCsv } from '../ui.js';

const PAGE = 25;
let offset = 0;
let current = null; // transaction being refunded
const refundModal = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('refund-modal'));

const SELECT = 'id, reference, purpose, description, amount_minor, currency, fee_minor, status, payment_method, failure_reason, created_at, paid_at, provider_tx_id, user:profiles!payment_transactions_user_id_fkey(email, full_name), refunds(amount_minor, status)';
function query() {
  let q = supabase.from('payment_transactions').select(SELECT, { count: 'exact' }).order('created_at', { ascending: false });
  const ref = document.getElementById('q').value.trim();
  const status = document.getElementById('status').value;
  const purpose = document.getElementById('purpose').value;
  if (ref) q = q.ilike('reference', `%${ref.replace(/[%_]/g, '')}%`);
  if (status) q = q.eq('status', status);
  if (purpose) q = q.eq('purpose', purpose);
  return q;
}

document.getElementById('export').addEventListener('click', async () => {
  const all = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) return toast(errorText(error), 'error');
    all.push(...data);
    if (data.length < 1000) break;
  }
  const refunded = (t) => (t.refunds || []).filter((r) => r.status === 'succeeded').reduce((s, r) => s + r.amount_minor, 0);
  exportCsv(supabase, 'payments', 'pulsefit-payments', [
    { key: 'reference', label: 'Reference' }, { key: 'created_at', label: 'Created (UTC)' }, { key: 'paid_at', label: 'Paid (UTC)' },
    { label: 'Customer', value: (t) => t.user?.full_name ?? '' }, { label: 'Email', value: (t) => t.user?.email ?? '' },
    { key: 'purpose', label: 'For' }, { key: 'currency', label: 'Currency' }, { key: 'amount_minor', label: 'Amount (minor units)' },
    { key: 'fee_minor', label: 'Provider fee' }, { label: 'Refunded', value: refunded }, { key: 'status', label: 'Status' },
    { key: 'payment_method', label: 'Method' }, { key: 'failure_reason', label: 'Failure reason' }, { key: 'provider_tx_id', label: 'Provider id' },
  ], all, { q: document.getElementById('q').value, status: document.getElementById('status').value, purpose: document.getElementById('purpose').value });
});

async function load() {
  const rows = document.getElementById('rows');
  rows.innerHTML = '<tr><td colspan="8" class="text-center py-4"><div class="spinner-border spinner-border-sm" role="status"></div></td></tr>';
  const q = query().range(offset, offset + PAGE - 1);
  const { data, count, error } = await q;
  const err = document.getElementById('error');
  if (error) {
    err.textContent = errorText(error);
    err.classList.remove('d-none');
    rows.innerHTML = '';
    return;
  }
  err.classList.add('d-none');
  document.getElementById('count').textContent = count ? `${offset + 1}–${Math.min(offset + PAGE, count)} of ${count}` : 'No payments';
  document.getElementById('prev').disabled = offset === 0;
  document.getElementById('next').disabled = offset + PAGE >= (count ?? 0);

  rows.innerHTML = data.map((t) => {
    const refunded = (t.refunds || []).filter((r) => r.status !== 'failed').reduce((s, r) => s + r.amount_minor, 0);
    const refundable = ['succeeded', 'partially_refunded'].includes(t.status) && t.amount_minor - refunded > 0;
    return `<tr>
      <td class="small text-nowrap">${dateTime(t.created_at)}</td>
      <td><code class="small">${esc(t.reference)}</code></td>
      <td class="small">${esc(t.user?.full_name || '')}<br><span class="text-secondary">${esc(t.user?.email || '—')}</span></td>
      <td class="small">${esc(t.description || t.purpose)}</td>
      <td class="text-end text-nowrap">${money(t.amount_minor, t.currency)}
        ${t.fee_minor ? `<div class="small text-secondary">fee ${money(t.fee_minor, t.currency)}</div>` : ''}
        ${refunded ? `<div class="small text-danger">refunded ${money(refunded, t.currency)}</div>` : ''}</td>
      <td class="small">${esc(t.payment_method || '—')}</td>
      <td>${statusBadge(t.status)}${t.failure_reason ? `<div class="small text-secondary" style="max-width:220px">${esc(t.failure_reason)}</div>` : ''}</td>
      <td class="text-end">${refundable ? `<button class="btn btn-outline-danger btn-sm" data-refund="${esc(t.id)}" data-max="${t.amount_minor - refunded}" data-cur="${esc(t.currency)}" data-ref="${esc(t.reference)}">Refund</button>` : ''}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="text-center text-secondary py-4">No payments match.</td></tr>';
}

document.getElementById('rows').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-refund]');
  if (!b) return;
  current = { id: b.dataset.refund, max: Number(b.dataset.max), cur: b.dataset.cur };
  document.getElementById('refund-info').textContent = `Payment ${b.dataset.ref}. Up to ${money(current.max, current.cur)} can be refunded.`;
  document.getElementById('refund-cur').textContent = current.cur;
  const amount = document.getElementById('refund-amount');
  amount.max = fromMinor(current.max, current.cur);
  amount.step = current.cur === 'XAF' || current.cur === 'XOF' ? '1' : '0.01';
  amount.value = fromMinor(current.max, current.cur);
  document.getElementById('refund-reason').value = '';
  refundModal().show();
});

document.getElementById('refund-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!form.checkValidity()) { form.classList.add('was-validated'); return; }
  const amountMinor = toMinor(document.getElementById('refund-amount').value, current.cur);
  if (amountMinor <= 0 || amountMinor > current.max) { toast('Amount is above what can be refunded', 'error'); return; }
  if (!confirm(`Refund ${money(amountMinor, current.cur)} now? This cannot be undone.`)) return;
  const btn = document.getElementById('refund-submit');
  btn.disabled = true;
  const { data, error } = await supabase.functions.invoke('admin-refund', {
    body: { transaction_id: current.id, amount_minor: amountMinor, reason: document.getElementById('refund-reason').value.trim() },
  });
  btn.disabled = false;
  if (error) { toast(await functionError(error), 'error'); return; }
  refundModal().hide();
  toast(data.status === 'succeeded' ? 'Refund sent' : 'Refund is processing');
  load();
});

document.getElementById('filters').addEventListener('submit', (e) => { e.preventDefault(); offset = 0; load(); });
document.getElementById('prev').addEventListener('click', () => { offset = Math.max(0, offset - PAGE); load(); });
document.getElementById('next').addEventListener('click', () => { offset += PAGE; load(); });

if (await initLayout('Payments')) load();
