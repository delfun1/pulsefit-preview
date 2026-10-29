import { supabase } from '../supabase.js';
import { initLayout } from '../layout.js';
import { esc, dateTime, errorText, toast, confirmAction, statusBadge } from '../ui.js';

async function load() {
  const status = document.getElementById('status').value || null;
  const { data, error } = await supabase.rpc('admin_list_reports', { p_status: status });
  const err = document.getElementById('error');
  if (error) {
    err.textContent = errorText(error);
    err.classList.remove('d-none');
    return;
  }
  err.classList.add('d-none');
  document.getElementById('rows').innerHTML = data.length ? data.map((r) => `<tr>
      <td class="small text-nowrap">${dateTime(r.created_at)}<br>${statusBadge(r.status)}</td>
      <td class="small">${esc(r.reason)}</td>
      <td class="small" style="max-width:320px">${r.content == null && !r.has_attachment
        ? '<span class="text-secondary">(message already removed)</span>'
        : `${esc(r.content ?? '')}${r.has_attachment ? ' <span class="badge text-bg-light">photo</span>' : ''}<div class="text-secondary">${dateTime(r.content_at)}</div>`}</td>
      <td class="small">${esc(r.author_name ?? '–')}<br><span class="text-secondary">${esc(r.author_email ?? '')}</span>
        ${r.author_status && r.author_status !== 'active' ? statusBadge(r.author_status) : ''}</td>
      <td class="small">${esc(r.reporter_name ?? '–')}<br><span class="text-secondary">${esc(r.reporter_email ?? '')}</span></td>
      <td class="text-end text-nowrap">${r.status === 'open' ? `
        <button class="btn btn-sm btn-outline-secondary" data-act="dismissed" data-id="${esc(r.id)}">Dismiss</button>
        <button class="btn btn-sm btn-danger" data-act="remove" data-id="${esc(r.id)}">Remove message</button>
        ${r.author_id && r.author_status === 'active' ? `<button class="btn btn-sm btn-outline-danger" data-act="suspend" data-id="${esc(r.id)}" data-user="${esc(r.author_id)}">Suspend author</button>` : ''}`
        : ''}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-center text-secondary py-4">Nothing to review.</td></tr>';
}

document.getElementById('rows').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  let res;
  if (b.dataset.act === 'dismissed') {
    res = await supabase.rpc('admin_resolve_report', { p_report: b.dataset.id, p_action: 'dismissed' });
  } else if (b.dataset.act === 'remove') {
    if (!confirmAction('Remove this message for both people? This cannot be undone.')) return;
    res = await supabase.rpc('admin_resolve_report', { p_report: b.dataset.id, p_action: 'actioned', p_remove_content: true });
  } else if (b.dataset.act === 'suspend') {
    if (!confirmAction('Suspend this account? They will not be able to sign in or send messages until reactivated on the Users page.')) return;
    res = await supabase.rpc('admin_set_account_status', { p_user: b.dataset.user, p_status: 'suspended' });
    if (!res.error) res = await supabase.rpc('admin_resolve_report', { p_report: b.dataset.id, p_action: 'actioned', p_remove_content: true });
  }
  if (res.error) return toast(errorText(res.error), 'error');
  toast('Decision saved');
  load();
});
document.getElementById('status').addEventListener('change', load);

// ---------- Reviews ----------
async function loadReviews() {
  const f = document.getElementById('rv-filter').value;
  const { data, error } = await supabase.rpc('admin_list_reviews', {
    p_kind: document.getElementById('rv-kind').value,
    p_hidden: f === 'hidden' ? true : f === 'visible' ? false : null,
    p_max_rating: f === 'low' ? 2 : null,
  });
  if (error) return toast(errorText(error), 'error');
  document.getElementById('rv-rows').innerHTML = data.map((r) => `<tr class="${r.is_hidden ? 'table-light text-secondary' : ''}">
      <td class="small text-nowrap">${dateTime(r.created_at)}</td><td>${esc(r.subject ?? '—')}</td>
      <td class="text-nowrap" aria-label="${Number(r.rating)} stars">${'★'.repeat(r.rating)}<span class="text-secondary">${'☆'.repeat(5 - r.rating)}</span></td>
      <td class="small" style="max-width:360px">${esc(r.comment ?? '')}${r.is_hidden ? ' <span class="badge text-bg-secondary">hidden</span>' : ''}</td>
      <td class="small">${esc(r.author_name ?? '—')}<br><span class="text-secondary">${esc(r.author_email ?? '')}</span></td>
      <td class="text-end">${r.is_hidden
        ? `<button class="btn btn-sm btn-outline-secondary" data-review="${esc(r.id)}" data-hide="false">Show again</button>`
        : `<button class="btn btn-sm btn-outline-danger" data-review="${esc(r.id)}" data-hide="true">Hide</button>`}</td></tr>`).join('')
    || '<tr><td colspan="6" class="text-center text-secondary py-4">No reviews match.</td></tr>';
}
document.getElementById('rv-rows').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-review]');
  if (!b) return;
  const hide = b.dataset.hide === 'true';
  const reason = hide ? prompt('Why are you hiding this review? (kept in the audit log)') : 'restored';
  if (hide && !reason?.trim()) return;
  const { error } = await supabase.rpc('admin_set_review_hidden', {
    p_kind: document.getElementById('rv-kind').value, p_review: b.dataset.review, p_hidden: hide, p_reason: reason.trim(),
  });
  if (error) return toast(errorText(error), 'error');
  toast(hide ? 'Review hidden' : 'Review visible again');
  loadReviews();
});
document.getElementById('rv-kind').addEventListener('change', loadReviews);
document.getElementById('rv-filter').addEventListener('change', loadReviews);
document.getElementById('mod-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  document.querySelectorAll('#mod-tabs .nav-link').forEach((x) => x.classList.toggle('active', x === b));
  const reviews = b.dataset.tab === 'reviews';
  document.getElementById('reviews-card').classList.toggle('d-none', !reviews);
  document.getElementById('reports-card').classList.toggle('d-none', reviews);
  reviews ? loadReviews() : load();
});

if (await initLayout('Moderation')) load();
