import { supabase } from '../supabase.js';
import { initLayout, STORE } from '../layout.js';
import { esc, money, toast, errorText, confirmAction, toMinor } from '../ui.js';

const $ = (id) => document.getElementById(id);
const couponModal = () => bootstrap.Modal.getOrCreateInstance($('coupon-modal'));
let coupons = [];
let editing = null;
let isAdmin = false;

async function loadCoupons() {
  const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
  if (error) {
    $('error').textContent = errorText(error);
    $('error').classList.remove('d-none');
    return;
  }
  coupons = data;
  const now = Date.now();
  $('coupons').innerHTML = data.map((c) => {
    const expired = c.ends_at && new Date(c.ends_at).getTime() < now;
    const used = `${c.redeemed_count}${c.max_redemptions ? ` / ${c.max_redemptions}` : ''}`;
    return `<tr class="${!c.is_active || expired ? 'opacity-50' : ''}">
      <td><code class="fw-bold">${esc(c.code)}</code>${c.description ? `<div class="small text-secondary">${esc(c.description)}</div>` : ''}</td>
      <td>${c.percent_off ? `${c.percent_off}%` : money(c.amount_off_minor, c.currency)}</td>
      <td class="small">${c.min_order_minor ? money(c.min_order_minor, 'XAF') : '—'}</td>
      <td>${used}</td>
      <td class="small">${c.starts_at ? c.starts_at.slice(0, 10) : '…'} → ${c.ends_at ? c.ends_at.slice(0, 10) : '…'}${expired ? ' <span class="badge text-bg-secondary">ended</span>' : ''}</td>
      <td><div class="form-check form-switch"><input class="form-check-input" type="checkbox" data-toggle="${esc(c.id)}" ${c.is_active ? 'checked' : ''} aria-label="Active"></div></td>
      <td class="text-end"><button class="btn btn-outline-primary btn-sm" data-edit="${esc(c.id)}">Edit</button></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="text-secondary text-center py-3">No discount codes yet.</td></tr>';
}

function openCoupon(c) {
  editing = c;
  $('coupon-form').classList.remove('was-validated');
  $('c-code').value = c?.code ?? '';
  $('c-code').disabled = Boolean(c?.redeemed_count);   // used codes keep their name
  $('c-type').value = c?.amount_off_minor ? 'amount' : 'percent';
  $('c-value').value = c ? (c.percent_off ?? c.amount_off_minor) : '';
  $('c-min').value = c?.min_order_minor ?? 0;
  $('c-max').value = c?.max_redemptions ?? '';
  $('c-desc').value = c?.description ?? '';
  $('c-start').value = c?.starts_at?.slice(0, 10) ?? '';
  $('c-end').value = c?.ends_at?.slice(0, 10) ?? '';
  $('c-active').checked = c?.is_active ?? true;
  couponModal().show();
}

$('coupon-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!form.checkValidity()) { form.classList.add('was-validated'); return; }
  const percent = $('c-type').value === 'percent';
  const value = Number($('c-value').value);
  if (percent && (value <= 0 || value > 100)) { toast('Percentage must be between 1 and 100', 'error'); return; }
  if ($('c-start').value && $('c-end').value && $('c-end').value < $('c-start').value) { toast('End date is before start date', 'error'); return; }
  const row = {
    code: $('c-code').value.trim().toUpperCase(),
    percent_off: percent ? value : null,
    amount_off_minor: percent ? null : toMinor(value, 'XAF'),
    currency: percent ? null : 'XAF',
    min_order_minor: toMinor($('c-min').value || 0, 'XAF'),
    max_redemptions: $('c-max').value ? Number($('c-max').value) : null,
    description: $('c-desc').value.trim() || null,
    starts_at: $('c-start').value ? new Date(`${$('c-start').value}T00:00:00`).toISOString() : null,
    ends_at: $('c-end').value ? new Date(`${$('c-end').value}T23:59:59`).toISOString() : null,
    is_active: $('c-active').checked,
    applies_to: 'orders',
  };
  if (editing?.redeemed_count) delete row.code;
  const { error } = editing
    ? await supabase.from('coupons').update(row).eq('id', editing.id)
    : await supabase.from('coupons').insert(row);
  if (error) { toast(error.code === '23505' ? 'That code already exists' : errorText(error), 'error'); return; }
  couponModal().hide();
  toast('Discount code saved');
  loadCoupons();
});

$('coupons').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit]');
  if (edit) openCoupon(coupons.find((c) => c.id === edit.dataset.edit));
  const t = e.target.closest('[data-toggle]');
  if (t) {
    const { error } = await supabase.from('coupons').update({ is_active: t.checked }).eq('id', t.dataset.toggle);
    if (error) { toast(errorText(error), 'error'); t.checked = !t.checked; }
  }
});

async function loadShipping() {
  const { data } = await supabase.from('shipping_settings').select('*').order('price_minor');
  $('shipping').innerHTML = (data || []).map((s) => `<li class="list-group-item d-flex align-items-center gap-2">
      <div class="flex-grow-1"><div class="fw-semibold">${esc(s.name)} <code class="small">${esc(s.method)}</code></div>
        <div class="small text-secondary">${esc(s.estimated_days || '')}</div></div>
      <input type="number" class="form-control form-control-sm" style="width:110px" min="0" value="${s.price_minor}" data-ship-price="${s.id}" aria-label="Price for ${esc(s.name)}">
      <span class="small">${esc(s.currency)}</span>
      <div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-ship-active="${s.id}" ${s.is_active ? 'checked' : ''} aria-label="Active"></div>
    </li>`).join('');
}

$('shipping').addEventListener('change', async (e) => {
  const price = e.target.dataset.shipPrice;
  const active = e.target.dataset.shipActive;
  const { error } = price
    ? await supabase.from('shipping_settings').update({ price_minor: Number(e.target.value) }).eq('id', price)
    : await supabase.from('shipping_settings').update({ is_active: e.target.checked }).eq('id', active);
  error ? toast(errorText(error), 'error') : toast('Delivery method updated');
});

$('new-ship').addEventListener('click', async () => {
  const name = prompt('Name shown to customers (e.g. "Express Yaoundé"):');
  if (!name) return;
  const method = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
  const price = Number(prompt('Price in FCFA:', '0'));
  if (!Number.isFinite(price) || price < 0) return;
  const { error } = await supabase.from('shipping_settings').insert({ method, name, currency: 'XAF', price_minor: Math.round(price), estimated_days: prompt('Delivery time (e.g. "1–2 days"):') || null });
  error ? toast(error.code === '23505' ? 'A method with this name exists' : errorText(error), 'error') : loadShipping();
});

async function loadTax() {
  const { data } = await supabase.from('tax_settings').select('*').order('country');
  $('tax').innerHTML = (data || []).map((t) => `<li class="list-group-item d-flex align-items-center gap-2">
      <div class="flex-grow-1"><span class="fw-semibold">${esc(t.country)}</span> · ${esc(t.name)} · ${t.rate_pct}%</div>
      <div class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-tax="${t.id}" ${t.is_active ? 'checked' : ''} ${isAdmin ? '' : 'disabled'} aria-label="Apply tax"></div>
    </li>`).join('') || '<li class="list-group-item text-secondary">No tax configured.</li>';
}

$('tax').addEventListener('change', async (e) => {
  const id = e.target.dataset.tax;
  if (!id) return;
  if (!confirmAction(e.target.checked ? 'Start charging this tax on new orders?' : 'Stop charging this tax on new orders?')) { e.target.checked = !e.target.checked; return; }
  const { error } = await supabase.from('tax_settings').update({ is_active: e.target.checked }).eq('id', id);
  error ? toast(errorText(error), 'error') : toast('Tax setting updated');
});

$('new-coupon').addEventListener('click', () => openCoupon(null));

const user = await initLayout('Coupons & delivery', STORE);
if (user) {
  isAdmin = user.roles.includes('admin');
  loadCoupons();
  loadShipping();
  loadTax();
}
