import { supabase } from '../supabase.js';
import { initLayout } from '../layout.js';
import { esc, dateTime, errorText } from '../ui.js';

const PAGE = 50;
let lastId = null;

async function load(append = false) {
  let q = supabase
    .from('admin_audit_logs')
    .select('id, created_at, action, target_type, target_id, details, actor:profiles!admin_audit_logs_actor_id_fkey(email)')
    .order('id', { ascending: false })
    .limit(PAGE);
  if (append && lastId) q = q.lt('id', lastId);
  const { data, error } = await q;
  const err = document.getElementById('error');
  if (error) {
    err.textContent = errorText(error);
    err.classList.remove('d-none');
    return;
  }
  err.classList.add('d-none');
  const html = data.map((r) => `<tr>
      <td class="small text-nowrap">${dateTime(r.created_at)}</td>
      <td><code>${esc(r.action)}</code></td>
      <td class="small">${esc(r.target_type)} <span class="text-secondary">${esc(r.target_id)}</span></td>
      <td class="small">${esc(r.actor?.email ?? 'system')}</td>
      <td class="small text-secondary"><code>${esc(JSON.stringify(r.details))}</code></td>
    </tr>`).join('');
  const rows = document.getElementById('rows');
  rows.innerHTML = append ? rows.innerHTML + html : (html || '<tr><td colspan="5" class="text-center text-secondary py-4">No entries yet.</td></tr>');
  if (data.length) lastId = data[data.length - 1].id;
  document.getElementById('more').classList.toggle('d-none', data.length < PAGE);
}

document.getElementById('more').addEventListener('click', () => load(true));
if (await initLayout('Audit log')) load();
