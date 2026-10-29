import { supabase } from '../supabase.js';
import { initLayout } from '../layout.js';
import { esc, money, dateTime, errorText, toast, statusBadge, exportCsv } from '../ui.js';

const PAGE = 25;
let offset = 0;

const EVENT_LABELS = {
  created: 'New subscription', renewed: 'Renewed', trial_started: 'Trial started', trial_converted: 'Trial converted to paid',
  plan_changed: 'Plan changed', cancel_requested: 'Cancelled by member (at period end)', cancel_reverted: 'Cancellation withdrawn',
  cancel_requested_by_admin: 'Cancelled by admin (at period end)', cancelled_by_admin: 'Ended immediately by admin',
  past_due: 'Payment overdue', expired: 'Expired', expired_unpaid: 'Expired (unpaid)', ended_by_refund: 'Ended by full refund',
  extended_by_admin: 'Extended by admin',
};

function stat(label, value, tone = 'blue', icon = 'arrow-repeat') {
  return `<div class="col-6 col-md-4 col-xl-2"><div class="pf-card stat"><div class="icon icon-${tone}"><i class="bi bi-${icon}" aria-hidden="true"></i></div>
    <div><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div></div></div></div>`;
}

function filters() {
  return {
    p_query: document.getElementById('q').value.trim() || null,
    p_status: document.getElementById('status').value || null,
    p_plan: document.getElementById('plan').value || null,
  };
}

async function loadReport() {
  const days = Number(document.getElementById('period').value);
  const { data: r, error } = await supabase.rpc('admin_subscription_report', {
    p_from: new Date(Date.now() - days * 86400000).toISOString(), p_to: new Date().toISOString(),
  });
  const err = document.getElementById('error');
  if (error) {
    err.textContent = errorText(error);
    err.classList.remove('d-none');
    return;
  }
  err.classList.add('d-none');
  const sc = r.status_counts || {}, ev = r.events || {};
  document.getElementById('stats').innerHTML = [
    stat('Active now', (sc.active ?? 0) + (sc.trialing ?? 0), 'green', 'check-circle'),
    stat('Past due now', sc.past_due ?? 0, 'red', 'exclamation-triangle'),
    stat('Renewals (period)', ev.renewed ?? 0, 'blue', 'arrow-repeat'),
    // a plan change or trial conversion also creates a "created" event, so those are not new members
    stat('New members (period)', Math.max(0, (ev.created ?? 0) - (ev.plan_changed ?? 0) - (ev.trial_converted ?? 0) + (ev.trial_started ?? 0)), 'blue', 'person-plus'),
    stat('Cancellations (period)', (ev.cancel_requested ?? 0) + (ev.cancel_requested_by_admin ?? 0) + (ev.cancelled_by_admin ?? 0) - (ev.cancel_reverted ?? 0), 'orange', 'x-circle'),
    stat('Failed payments (period)', (r.failed_payments || []).length, 'red', 'credit-card-2-back'),
  ].join('');
  document.getElementById('by-plan').innerHTML = (r.active_by_plan || []).map((p) => `<tr><td>${esc(p.plan)}</td>
      <td class="small">${money(p.price_minor, p.currency)} / ${esc(p.interval)}</td><td class="text-end fw-semibold">${Number(p.count)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="text-secondary text-center py-3">No active members.</td></tr>';
  document.getElementById('failed').innerHTML = (r.failed_payments || []).slice(0, 15).map((f) => `<tr><td class="small text-nowrap">${dateTime(f.at)}</td>
      <td class="small">${esc(f.email ?? '—')}</td><td>${money(f.amount_minor, f.currency)}</td><td class="small text-secondary">${esc(f.reason ?? '—')}</td></tr>`).join('')
    || '<tr><td colspan="4" class="text-secondary text-center py-3">No failed payments in this period.</td></tr>';
}

async function load() {
  const rows = document.getElementById('rows');
  const { data, error } = await supabase.rpc('admin_list_subscriptions', { ...filters(), p_limit: PAGE, p_offset: offset });
  if (error) {
    rows.innerHTML = `<tr><td colspan="6" class="text-danger">${esc(errorText(error))}</td></tr>`;
    return;
  }
  const total = data[0]?.total_count ?? 0;
  document.getElementById('count').textContent = total ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}` : 'No subscriptions found';
  document.getElementById('prev').disabled = offset === 0;
  document.getElementById('next').disabled = offset + PAGE >= total;
  const live = (s) => ['active', 'trialing', 'past_due'].includes(s.status);
  rows.innerHTML = data.map((s) => `<tr>
      <td><div class="fw-semibold">${esc(s.full_name || '—')}</div><div class="small text-secondary">${esc(s.email)}</div></td>
      <td>${esc(s.plan_name)}<div class="small text-secondary">${money(s.price_minor, s.currency)} / ${esc(s.billing_interval)}</div></td>
      <td>${statusBadge(s.status)}${s.cancel_at_period_end ? '<div class="small text-warning-emphasis">ends at period end</div>' : ''}</td>
      <td class="small">${dateTime(s.current_period_start)}<br>→ ${dateTime(s.status === 'trialing' ? (s.trial_ends_at ?? s.current_period_end) : s.current_period_end)}</td>
      <td class="small">${s.last_payment_status ? `${statusBadge(s.last_payment_status)}<br>${dateTime(s.last_payment_at)}` : '—'}</td>
      <td class="text-end text-nowrap">
        <button class="btn btn-sm btn-light" data-hist="${esc(s.id)}" data-name="${esc(s.full_name || s.email)}">History</button>
        ${live(s) ? `<button class="btn btn-sm btn-outline-primary" data-act="extend" data-id="${esc(s.id)}" data-name="${esc(s.full_name || s.email)}">Extend</button>
        <button class="btn btn-sm btn-outline-danger" data-act="cancel" data-id="${esc(s.id)}" data-name="${esc(s.full_name || s.email)}" ${s.cancel_at_period_end ? 'data-ending="1"' : ''}>Cancel</button>` : ''}
      </td></tr>`).join('') || '<tr><td colspan="6" class="text-center text-secondary py-4">No subscriptions match.</td></tr>';
}

async function showHistory(id, name) {
  const body = document.getElementById('hist-body');
  document.getElementById('hist-title').textContent = `History — ${name}`;
  body.innerHTML = '<div class="text-center py-4"><div class="spinner-border" role="status"></div></div>';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('hist-modal')).show();
  const { data, error } = await supabase.rpc('admin_subscription_history', { p_subscription: id });
  if (error) {
    body.innerHTML = `<div class="alert alert-danger">${esc(errorText(error))}</div>`;
    return;
  }
  body.innerHTML = `<h3 class="h6 fw-bold">Events</h3>
    <ul class="list-group list-group-flush mb-4">${data.events.map((e) => `<li class="list-group-item px-0 small">
      <span class="text-secondary">${dateTime(e.at)}</span> · <b>${esc(EVENT_LABELS[e.event] ?? e.event)}</b>
      ${e.from_plan || e.to_plan ? ` · ${esc(e.from_plan ?? '')}${e.from_plan && e.to_plan ? ' → ' : ''}${esc(e.to_plan ?? '')}` : ''}
      ${e.details?.reason ? `<div class="text-secondary">Reason: ${esc(e.details.reason)}</div>` : ''}
      ${e.details?.days ? `<div class="text-secondary">+${Number(e.details.days)} days</div>` : ''}</li>`).join('') || '<li class="list-group-item px-0 text-secondary">No events.</li>'}</ul>
    <h3 class="h6 fw-bold">Payments</h3>
    <div class="table-responsive"><table class="table table-sm"><thead><tr><th>Date</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead><tbody>
    ${data.payments.map((p) => `<tr><td class="small">${dateTime(p.paid_at ?? p.created_at)}</td><td><code class="small">${esc(p.reference)}</code></td>
      <td>${money(p.amount_minor, p.currency)}</td><td>${statusBadge(p.status)}${p.failure_reason ? `<div class="small text-secondary">${esc(p.failure_reason)}</div>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="4" class="text-secondary">No payments.</td></tr>'}</tbody></table></div>`;
}

function openAction(b) {
  const extend = b.dataset.act === 'extend';
  document.getElementById('act-id').value = b.dataset.id;
  document.getElementById('act-kind').value = b.dataset.act;
  document.getElementById('act-title').textContent = `${extend ? 'Extend' : 'Cancel'} — ${b.dataset.name}`;
  document.getElementById('act-help').textContent = extend
    ? 'Adds free days to the current period (for example after an outage or a payment problem). A past-due plan becomes active again. The member is notified.'
    : (b.dataset.ending ? 'This plan already ends at the end of its period. You can end it immediately instead.' : 'The member is notified.');
  document.getElementById('act-days-wrap').classList.toggle('d-none', !extend);
  document.getElementById('act-when-wrap').classList.toggle('d-none', extend);
  document.getElementById('act-end').disabled = !!b.dataset.ending;
  document.getElementById(b.dataset.ending ? 'act-now' : 'act-end').checked = true;
  document.getElementById('act-reason').value = '';
  document.getElementById('act-submit').className = `btn ${extend ? 'btn-primary' : 'btn-danger'}`;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('act-modal')).show();
}

document.getElementById('act-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('act-id').value, reason = document.getElementById('act-reason').value.trim();
  const res = document.getElementById('act-kind').value === 'extend'
    ? await supabase.rpc('admin_extend_subscription', { p_subscription: id, p_days: Number(document.getElementById('act-days').value), p_reason: reason })
    : await supabase.rpc('admin_cancel_subscription', { p_subscription: id, p_immediately: document.getElementById('act-now').checked, p_reason: reason });
  if (res.error) return toast(errorText(res.error), 'error');
  bootstrap.Modal.getInstance(document.getElementById('act-modal')).hide();
  toast(document.getElementById('act-kind').value === 'extend' ? `Extended until ${dateTime(res.data)}` : 'Subscription cancelled');
  load();
  loadReport();
});

document.getElementById('rows').addEventListener('click', (e) => {
  const h = e.target.closest('button[data-hist]');
  if (h) return showHistory(h.dataset.hist, h.dataset.name);
  const a = e.target.closest('button[data-act]');
  if (a) openAction(a);
});
document.getElementById('filters').addEventListener('submit', (e) => { e.preventDefault(); offset = 0; load(); });
document.getElementById('prev').addEventListener('click', () => { offset = Math.max(0, offset - PAGE); load(); });
document.getElementById('next').addEventListener('click', () => { offset += PAGE; load(); });
document.getElementById('period').addEventListener('change', loadReport);
document.getElementById('export').addEventListener('click', async () => {
  const { data, error } = await supabase.rpc('admin_list_subscriptions', { ...filters(), p_limit: 1000, p_offset: 0 });
  if (error) return toast(errorText(error), 'error');
  exportCsv(supabase, 'subscriptions', 'pulsefit-subscriptions', [
    { key: 'full_name', label: 'Member' }, { key: 'email', label: 'Email' }, { key: 'plan_name', label: 'Plan' },
    { key: 'currency', label: 'Currency' }, { key: 'price_minor', label: 'Price (minor units)' }, { key: 'billing_interval', label: 'Interval' },
    { key: 'status', label: 'Status' }, { key: 'current_period_start', label: 'Period start (UTC)' }, { key: 'current_period_end', label: 'Period end (UTC)' },
    { key: 'cancel_at_period_end', label: 'Ends at period end' }, { key: 'cancelled_at', label: 'Cancelled at' },
    { key: 'last_payment_status', label: 'Last payment' }, { key: 'last_payment_at', label: 'Last payment at' }, { key: 'created_at', label: 'Created' },
  ], data, filters());
});

if (await initLayout('Subscriptions')) {
  const { data: plans } = await supabase.from('subscription_plans').select('id, name, billing_interval').order('sort_order');
  document.getElementById('plan').insertAdjacentHTML('beforeend',
    (plans || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.billing_interval)})</option>`).join(''));
  loadReport();
  load();
}
