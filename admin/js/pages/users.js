import { supabase } from '../supabase.js';
import { initLayout } from '../layout.js';
import { esc, dateTime, toast, errorText, statusBadge, confirmAction, money, exportCsv } from '../ui.js';

const PAGE = 25;
let offset = 0;
let total = 0;
let me = null;

function filters() {
  return {
    p_query: document.getElementById('q').value.trim() || null,
    p_role: document.getElementById('role').value || null,
    p_status: document.getElementById('status').value || null,
    p_plan: document.getElementById('plan').value || null,
  };
}

async function load() {
  const rows = document.getElementById('rows');
  rows.innerHTML = '<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm" role="status"></div></td></tr>';
  const { data, error } = await supabase.rpc('admin_search_users', { ...filters(), p_limit: PAGE, p_offset: offset });
  const err = document.getElementById('error');
  if (error) {
    err.textContent = errorText(error);
    err.classList.remove('d-none');
    rows.innerHTML = '';
    return;
  }
  err.classList.add('d-none');
  total = data[0]?.total_count ?? 0;
  document.getElementById('count').textContent = total ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}` : 'No users found';
  document.getElementById('prev').disabled = offset === 0;
  document.getElementById('next').disabled = offset + PAGE >= total;

  rows.innerHTML = data.map((u) => {
    const isSelf = u.id === me.id;
    const roles = u.roles || [];
    return `<tr>
      <td class="fw-semibold"><button class="btn btn-link p-0 fw-semibold text-start" data-view="${esc(u.id)}">${esc(u.full_name || '—')}</button></td>
      <td>${esc(u.email)}</td>
      <td>${roles.map((r) => `<span class="badge text-bg-light border me-1">${esc(r)}</span>`).join('')}</td>
      <td>${esc(u.plan_name || 'Free')}</td>
      <td>${statusBadge(u.status)}</td>
      <td class="small text-secondary">${dateTime(u.created_at)}</td>
      <td class="text-end">
        <div class="dropdown">
          <button class="btn btn-light btn-sm dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">Manage</button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><button class="dropdown-item" data-view="${esc(u.id)}">View record</button></li>
            ${isSelf ? '<li><span class="dropdown-item-text small text-secondary">You cannot change your own account here.</span></li>' : `<li><hr class="dropdown-divider"></li>
            ${u.status === 'active'
              ? `<li><button class="dropdown-item text-danger" data-status="suspended" data-id="${esc(u.id)}">Suspend account</button></li>`
              : `<li><button class="dropdown-item" data-status="active" data-id="${esc(u.id)}">Reactivate account</button></li>`}
            <li><hr class="dropdown-divider"></li>
            ${roles.includes('store_manager')
              ? `<li><button class="dropdown-item" data-role="store_manager" data-grant="false" data-id="${esc(u.id)}">Remove store manager</button></li>`
              : `<li><button class="dropdown-item" data-role="store_manager" data-grant="true" data-id="${esc(u.id)}">Make store manager</button></li>`}
            ${roles.includes('admin')
              ? `<li><button class="dropdown-item text-danger" data-role="admin" data-grant="false" data-id="${esc(u.id)}">Remove administrator</button></li>`
              : `<li><button class="dropdown-item" data-role="admin" data-grant="true" data-id="${esc(u.id)}">Make administrator</button></li>`}`}
          </ul>
        </div>
      </td></tr>`;
  }).join('') || '<tr><td colspan="7" class="text-center text-secondary py-4">No users match.</td></tr>';
}

document.getElementById('rows').addEventListener('click', async (e) => {
  const v = e.target.closest('button[data-view]');
  if (v) return showDetail(v.dataset.view);
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  let res;
  if (b.dataset.status) {
    if (!confirmAction(b.dataset.status === 'suspended' ? 'Suspend this account? The user loses access immediately.' : 'Reactivate this account?')) return;
    res = await supabase.rpc('admin_set_account_status', { p_user: b.dataset.id, p_status: b.dataset.status });
  } else if (b.dataset.role) {
    const grant = b.dataset.grant === 'true';
    const what = b.dataset.role === 'admin' ? 'administrator' : 'store manager';
    if (!confirmAction(`${grant ? 'Give' : 'Remove'} ${what} access ${grant ? 'to' : 'from'} this user?`)) return;
    res = await supabase.rpc('admin_set_role', { p_user: b.dataset.id, p_role: b.dataset.role, p_grant: grant });
  }
  if (res?.error) toast(errorText(res.error), 'error');
  else {
    toast('Saved');
    load();
  }
});

document.getElementById('filters').addEventListener('submit', (e) => {
  e.preventDefault();
  offset = 0;
  load();
});
document.getElementById('prev').addEventListener('click', () => { offset = Math.max(0, offset - PAGE); load(); });
document.getElementById('next').addEventListener('click', () => { offset += PAGE; load(); });

// ---------- Member record (no health data, no messages; opening it is audited) ----------
const section = (title, inner) => `<h3 class="h6 fw-bold mt-4 mb-2">${esc(title)}</h3>${inner}`;
const table = (head, rows, empty) => rows.length
  ? `<div class="table-responsive"><table class="table table-sm align-middle"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
  : `<p class="text-secondary small">${esc(empty)}</p>`;

async function showDetail(id) {
  const body = document.getElementById('detail-body');
  body.innerHTML = '<div class="text-center py-5"><div class="spinner-border" role="status"></div></div>';
  bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('detail')).show();
  const { data: d, error } = await supabase.rpc('admin_user_detail', { p_user: id });
  if (error) {
    body.innerHTML = `<div class="alert alert-danger">${esc(errorText(error))}</div>`;
    return;
  }
  const p = d.profile;
  document.getElementById('detail-title').textContent = p.full_name || p.email;
  const paid = Object.entries(d.totals.paid || {}).map(([c, v]) => money(v, c)).join(' · ') || '—';
  body.innerHTML = `
    <div class="d-flex flex-wrap gap-2 align-items-center mb-2">${statusBadge(p.status)}
      ${(d.roles || []).map((r) => `<span class="badge text-bg-light border">${esc(r)}</span>`).join('')}
      ${d.reports_against ? `<span class="badge text-bg-danger">${Number(d.reports_against)} reported message(s)</span>` : ''}</div>
    <dl class="row small mb-0">
      <dt class="col-4">Email</dt><dd class="col-8">${esc(p.email)}</dd>
      <dt class="col-4">Phone</dt><dd class="col-8">${esc(p.phone || '—')}</dd>
      <dt class="col-4">Location</dt><dd class="col-8">${esc([p.city, p.country].filter(Boolean).join(', ') || '—')}</dd>
      <dt class="col-4">Language · time zone</dt><dd class="col-8">${esc(p.locale)} · ${esc(p.timezone)}</dd>
      <dt class="col-4">Joined</dt><dd class="col-8">${dateTime(p.created_at)}</dd>
      <dt class="col-4">Current plan</dt><dd class="col-8">${esc(d.current_plan?.name || 'Free')}</dd>
      <dt class="col-4">Total paid</dt><dd class="col-8">${paid}</dd>
      ${d.coach ? `<dt class="col-4">Coach</dt><dd class="col-8">${statusBadge(d.coach.status)} ★ ${Number(d.coach.rating_avg).toFixed(1)} (${Number(d.coach.rating_count)})</dd>` : ''}
    </dl>
    ${section('Subscriptions', table(['Plan', 'Status', 'Period end', 'Note'], d.subscriptions.map((s) => `<tr><td>${esc(s.plan)}</td><td>${statusBadge(s.status)}</td>
        <td class="small">${dateTime(s.current_period_end)}</td><td class="small">${s.cancel_at_period_end ? 'ends at period end' : ''}</td></tr>`), 'No subscriptions.'))}
    ${section('Orders', table(['Order', 'Status', 'Total', 'Date'], d.orders.map((o) => `<tr><td><code>${esc(o.order_number)}</code></td><td>${statusBadge(o.status)}</td>
        <td>${money(o.total_minor, o.currency)}</td><td class="small">${dateTime(o.created_at)}</td></tr>`), 'No orders.'))}
    ${section('Appointments', table(['When', 'Service', 'Coach', 'Status'], d.appointments.map((a) => `<tr><td class="small">${dateTime(a.starts_at)}</td><td>${esc(a.service)}</td>
        <td>${esc(a.coach_name || '')}</td><td>${statusBadge(a.status)}</td></tr>`), 'No appointments.'))}
    ${section('Payments', table(['Reference', 'For', 'Amount', 'Status'], d.payments.map((t) => `<tr><td><code class="small">${esc(t.reference)}</code></td><td>${esc(t.purpose)}</td>
        <td>${money(t.amount_minor, t.currency)}</td><td>${statusBadge(t.status)}</td></tr>`), 'No payments.'))}
    <p class="text-secondary small mt-4 mb-0"><i class="bi bi-shield-lock"></i> Health data, workouts, progress photos and private messages are not shown to administrators. Opening this record is recorded in the audit log.</p>`;
}

document.getElementById('export').addEventListener('click', async () => {
  const all = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.rpc('admin_search_users', { ...filters(), p_limit: 1000, p_offset: off });
    if (error) return toast(errorText(error), 'error');
    all.push(...data);
    if (data.length < 1000 || all.length >= 20000) break;
  }
  await exportCsv(supabase, 'users', 'pulsefit-users', [
    { key: 'full_name', label: 'Name' }, { key: 'email', label: 'Email' },
    { label: 'Roles', value: (r) => (r.roles || []).join(' ') }, { key: 'plan_name', label: 'Plan' },
    { key: 'status', label: 'Status' }, { key: 'created_at', label: 'Joined (UTC)' },
  ], all, filters());
});

me = await initLayout('Users');
if (me) load();
