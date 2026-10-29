import { supabase } from '../supabase.js';
import { initLayout } from '../layout.js';
import { esc, errorText, toast, dateTime } from '../ui.js';

const PROVIDERS = {
  anthropic: 'Claude AI (Anthropic)', flutterwave: 'Flutterwave payments', stripe: 'Stripe', resend: 'Resend email',
  fcm: 'Firebase push', mux: 'Video hosting (Mux)', google_calendar: 'Google Calendar',
};
let values = {};

async function load() {
  const [{ data: settings, error }, { data: currencies }, { data: taxes }, { data: integrations }] = await Promise.all([
    supabase.from('platform_settings').select('key, value, updated_at'),
    supabase.from('supported_currencies').select('*').order('code'),
    supabase.from('tax_settings').select('*').order('country'),
    supabase.from('integration_settings').select('provider, enabled, mode, updated_at').order('provider'),
  ]);
  if (error) return toast(errorText(error), 'error');
  values = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const def = document.getElementById('platform.default_currency');
  def.innerHTML = currencies.filter((c) => c.is_active).map((c) => `<option value="${esc(c.code)}">${esc(c.code)} — ${esc(c.name)}</option>`).join('');
  for (const el of document.querySelectorAll('[data-key]')) {
    const v = values[el.dataset.key];
    if (el.dataset.type === 'boolean') el.checked = v === true;
    else el.value = v ?? '';
  }
  document.getElementById('taxes').innerHTML = taxes.map((t) => `<tr data-tax="${t.id}">
      <td>${esc(t.country)}</td><td>${esc(t.name)}</td>
      <td><input class="form-control form-control-sm" type="number" min="0" max="100" step="0.01" value="${esc(t.rate_pct)}" aria-label="Rate for ${esc(t.name)}"></td>
      <td><div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" ${t.is_active ? 'checked' : ''} aria-label="Active"></div></td>
      <td class="text-end"><button class="btn btn-sm btn-outline-primary" data-save-tax>Save</button></td></tr>`).join('')
    || '<tr><td colspan="5" class="text-secondary">No taxes configured.</td></tr>';
  document.getElementById('currencies').innerHTML = currencies.map((c) => `<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.name)}</td><td>${Number(c.minor_units)}</td>
      <td><div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" data-currency="${esc(c.code)}" ${c.is_active ? 'checked' : ''}
        aria-label="${esc(c.code)} active" ${c.code === values['platform.default_currency'] ? 'disabled title="Default currency"' : ''}></div></td></tr>`).join('');
  document.getElementById('integrations').innerHTML = integrations.map((i) => `<tr><td>${esc(PROVIDERS[i.provider] ?? i.provider)}</td>
      <td>${i.enabled ? '<span class="badge text-bg-success">on</span>' : '<span class="badge text-bg-light border">off</span>'}</td>
      <td class="small">${esc(i.mode)}</td></tr>`).join('');
}

function readValue(el) {
  if (el.dataset.type === 'boolean') return el.checked;
  if (el.dataset.type === 'number') {
    const n = Number(String(el.value).replace(',', '.'));
    if (el.value === '' || !Number.isFinite(n)) throw new Error(`${el.labels?.[0]?.textContent ?? el.dataset.key}: enter a number`);
    return n;
  }
  return el.value.trim();
}

for (const form of document.querySelectorAll('.settings-form')) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const changed = [];
    try {
      for (const el of form.querySelectorAll('[data-key]')) {
        const v = readValue(el);
        if (JSON.stringify(v) !== JSON.stringify(values[el.dataset.key])) changed.push([el.dataset.key, v]);
      }
    } catch (err) {
      return toast(err.message, 'error');
    }
    if (!changed.length) return toast('Nothing changed');
    for (const [key, value] of changed) {
      // The database validates every value (type and allowed range) and audits the change.
      const { error } = await supabase.from('platform_settings').update({ value }).eq('key', key);
      if (error) return toast(errorText(error), 'error');
      values[key] = value;
    }
    toast(`Saved ${changed.length} setting${changed.length > 1 ? 's' : ''}`);
  });
}

document.getElementById('taxes').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-save-tax]');
  if (!b) return;
  const tr = b.closest('tr');
  const rate = Number(tr.querySelector('input[type=number]').value), active = tr.querySelector('input[type=checkbox]').checked;
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return toast('Rate must be between 0 and 100', 'error');
  const { error } = await supabase.from('tax_settings').update({ rate_pct: rate, is_active: active }).eq('id', tr.dataset.tax);
  if (error) return toast(errorText(error), 'error');
  toast('Tax saved');
});

document.getElementById('currencies').addEventListener('change', async (e) => {
  const c = e.target.closest('[data-currency]');
  if (!c) return;
  const { error } = await supabase.from('supported_currencies').update({ is_active: c.checked }).eq('code', c.dataset.currency);
  if (error) {
    c.checked = !c.checked;
    return toast(errorText(error), 'error');
  }
  toast(`${c.dataset.currency} ${c.checked ? 'activated' : 'deactivated'}`);
  load();
});

if (await initLayout('Platform settings')) load();
