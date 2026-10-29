import { supabase } from '../supabase.js';
import { initLayout } from '../layout.js';
import { esc, money, toast, errorText, toMinor, fromMinor, confirmAction } from '../ui.js';

let plans = [];
let editing = null;
const modal = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('plan-modal'));
const $ = (id) => document.getElementById(id);

async function load() {
  const [{ data, error }, { data: subs }] = await Promise.all([
    supabase.from('subscription_plans').select('*').order('sort_order'),
    supabase.from('subscriptions').select('plan_id, status').in('status', ['trialing', 'active', 'past_due']),
  ]);
  if (error) {
    $('error').textContent = errorText(error);
    $('error').classList.remove('d-none');
    return;
  }
  plans = data;
  const live = {};
  (subs || []).forEach((s) => { live[s.plan_id] = (live[s.plan_id] || 0) + 1; });
  const interval = { month: '/month', year: '/year', one_time: ' one-time' };
  $('list').innerHTML = plans.map((p) => `
    <div class="col-md-6 col-xl-4">
      <div class="pf-card h-100 d-flex flex-column ${p.is_active ? '' : 'opacity-75'}">
        <div class="d-flex align-items-start">
          <div><h2 class="h5 fw-bold mb-0">${esc(p.name)}</h2><code class="small">${esc(p.code)}</code></div>
          <span class="badge ms-auto ${p.is_active ? 'text-bg-success' : 'text-bg-secondary'}">${p.is_active ? 'On sale' : 'Hidden'}</span>
        </div>
        <div class="fs-4 fw-bold text-primary my-2">${money(p.price_minor, p.currency)}<span class="fs-6 text-secondary fw-normal">${interval[p.billing_interval]}</span></div>
        <ul class="small ps-3 mb-2">${(p.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <div class="small text-secondary mt-auto">
          Access level ${p.access_level} · ${p.ai_daily_limit} AI msgs/day · trial ${p.trial_days} d · grace ${p.grace_days} d
          ${p.member_discount_pct > 0 ? ` · ${p.member_discount_pct}% discount` : ''}${p.priority_booking ? ' · priority booking' : ''}
          <br><strong>${live[p.id] || 0}</strong> live subscriber(s)
        </div>
        <div class="d-flex gap-2 mt-3">
          <button class="btn btn-outline-primary btn-sm" data-edit="${esc(p.id)}">Edit</button>
          <button class="btn btn-outline-secondary btn-sm" data-toggle="${esc(p.id)}">${p.is_active ? 'Hide from sale' : 'Put on sale'}</button>
          ${live[p.id] ? '' : `<button class="btn btn-outline-danger btn-sm ms-auto" data-delete="${esc(p.id)}">Delete</button>`}
        </div>
      </div>
    </div>`).join('') || '<div class="col-12 text-secondary">No plans yet.</div>';
}

function open(plan) {
  editing = plan;
  $('plan-title').textContent = plan ? `Edit ${plan.name}` : 'New plan';
  $('plan-form').classList.remove('was-validated');
  $('f-name').value = plan?.name ?? '';
  $('f-code').value = plan?.code ?? '';
  $('f-code').disabled = Boolean(plan); // codes are referenced by the apps; keep them stable
  $('f-description').value = plan?.description ?? '';
  $('f-currency').value = plan?.currency ?? 'XAF';
  $('f-price').value = plan ? fromMinor(plan.price_minor, plan.currency) : '';
  $('f-interval').value = plan?.billing_interval ?? 'month';
  $('f-trial').value = plan?.trial_days ?? 0;
  $('f-grace').value = plan?.grace_days ?? 3;
  $('f-level').value = plan?.access_level ?? 1;
  $('f-ai').value = plan?.ai_daily_limit ?? 5;
  $('f-discount').value = plan?.member_discount_pct ?? 0;
  $('f-order').value = plan?.sort_order ?? plans.length + 1;
  $('f-priority').checked = plan?.priority_booking ?? false;
  $('f-active').checked = plan?.is_active ?? true;
  $('f-features').value = (plan?.features ?? []).join('\n');
  modal().show();
}

$('plan-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!form.checkValidity()) { form.classList.add('was-validated'); return; }
  const currency = $('f-currency').value;
  const row = {
    name: $('f-name').value.trim(),
    description: $('f-description').value.trim() || null,
    price_minor: toMinor($('f-price').value, currency),
    currency,
    billing_interval: $('f-interval').value,
    trial_days: Number($('f-trial').value),
    grace_days: Number($('f-grace').value),
    access_level: Number($('f-level').value),
    ai_daily_limit: Number($('f-ai').value),
    member_discount_pct: Number($('f-discount').value),
    sort_order: Number($('f-order').value),
    priority_booking: $('f-priority').checked,
    is_active: $('f-active').checked,
    features: $('f-features').value.split('\n').map((s) => s.trim()).filter(Boolean),
  };
  if (editing && row.price_minor !== editing.price_minor &&
      !confirmAction(`Change the price from ${money(editing.price_minor, editing.currency)} to ${money(row.price_minor, currency)}? It applies to new payments and renewals.`)) return;
  const { error } = editing
    ? await supabase.from('subscription_plans').update(row).eq('id', editing.id)
    : await supabase.from('subscription_plans').insert({ ...row, code: $('f-code').value.trim() });
  if (error) { toast(errorText(error), 'error'); return; }
  modal().hide();
  toast('Plan saved');
  load();
});

$('list').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const plan = plans.find((p) => p.id === (b.dataset.edit || b.dataset.toggle || b.dataset.delete));
  if (b.dataset.edit) open(plan);
  if (b.dataset.toggle) {
    const { error } = await supabase.from('subscription_plans').update({ is_active: !plan.is_active }).eq('id', plan.id);
    error ? toast(errorText(error), 'error') : load();
  }
  if (b.dataset.delete && confirmAction(`Delete "${plan.name}" permanently? (Plans with past payments cannot be deleted — hide them instead.)`)) {
    const { error } = await supabase.from('subscription_plans').delete().eq('id', plan.id);
    if (error) toast(error.code === '23503' ? 'This plan has payment history. Hide it from sale instead.' : errorText(error), 'error');
    else { toast('Plan deleted'); load(); }
  }
});

$('new-plan').addEventListener('click', () => open(null));

if (await initLayout('Subscription plans')) {
  const { data: currencies } = await supabase.from('supported_currencies').select('code, name').eq('is_active', true);
  $('f-currency').innerHTML = (currencies || [{ code: 'XAF', name: 'CFA franc' }])
    .map((c) => `<option value="${esc(c.code)}">${esc(c.code)} — ${esc(c.name)}</option>`).join('');
  load();
}
