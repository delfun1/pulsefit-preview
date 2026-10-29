import { supabase } from '../supabase.js';
import { initLayout } from '../layout.js';
import { esc, dateTime, errorText, toast } from '../ui.js';

const LABELS = { queued: 'Waiting', sending: 'Sending', sent: 'Delivered', failed: 'Failed', not_required: '—' };

function stats(el, counts) {
  el.innerHTML = ['sent', 'queued', 'failed'].map((k) => `
    <div class="col"><div class="fs-4 fw-bold ${k === 'failed' && counts[k] ? 'text-danger' : ''}">${Number(counts[k] ?? 0) + (k === 'queued' ? Number(counts.sending ?? 0) : 0)}</div>
    <div class="small text-secondary">${LABELS[k]}</div></div>`).join('');
}

async function load() {
  const err = document.getElementById('error');
  const { data, error } = await supabase.rpc('admin_notification_stats', { p_days: 7 });
  if (error) {
    err.textContent = errorText(error);
    err.classList.remove('d-none');
    return;
  }
  err.classList.add('d-none');
  document.getElementById('sw-resend').checked = !!data.integrations?.resend;
  document.getElementById('sw-fcm').checked = !!data.integrations?.fcm;
  stats(document.getElementById('email-stats'), data.email ?? {});
  stats(document.getElementById('push-stats'), data.push ?? {});
  document.getElementById('push-stats').insertAdjacentHTML('beforeend',
    `<div class="col-12 small text-secondary mt-2">${Number(data.devices?.total ?? 0)} registered devices (${Number(data.devices?.android ?? 0)} Android, ${Number(data.devices?.web ?? 0)} web)</div>`);
  const rows = data.recent_failures ?? [];
  document.getElementById('failures').innerHTML = rows.length
    ? rows.map((r) => `<tr>
        <td class="small text-nowrap">${dateTime(r.created_at)}</td>
        <td><code>${esc(r.type)}</code></td>
        <td class="small">${esc(r.email)}</td>
        <td class="small">${esc(LABELS[r.email_status] ?? r.email_status)}</td>
        <td class="small">${esc(LABELS[r.push_status] ?? r.push_status)}</td>
        <td class="small text-secondary">${esc([r.email_error, r.push_error].filter(Boolean).join(' · '))}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="text-center text-secondary py-4">No problems in the last 7 days.</td></tr>';
}

for (const sw of document.querySelectorAll('[data-provider]')) {
  sw.addEventListener('change', async () => {
    const { error } = await supabase.from('integration_settings')
      .update({ enabled: sw.checked, updated_at: new Date().toISOString() }).eq('provider', sw.dataset.provider);
    if (error) {
      sw.checked = !sw.checked;
      toast(errorText(error), 'error');
    } else {
      toast(`${sw.dataset.provider === 'resend' ? 'Email' : 'Push'} ${sw.checked ? 'switched on' : 'switched off'}`);
    }
  });
}

document.getElementById('send-test').addEventListener('click', async (e) => {
  e.target.disabled = true;
  const { data, error } = await supabase.rpc('admin_send_test_notification');
  e.target.disabled = false;
  const out = document.getElementById('test-result');
  if (error) return toast(errorText(error), 'error');
  const parts = [];
  parts.push(data.email_status === 'queued' ? 'Email queued for sending.' : 'No email queued (email is switched off).');
  parts.push(data.push_status === 'queued' ? 'Push queued for your devices.' : 'No push queued (push is off or you have no registered device).');
  out.textContent = parts.join(' ');
  load();
});
document.getElementById('refresh').addEventListener('click', load);

if (await initLayout('Notifications')) load();
