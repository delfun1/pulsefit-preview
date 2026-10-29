import { supabase } from '../supabase.js';
import { initLayout } from '../layout.js';
import { esc, dateTime, toast, errorText, statusBadge, confirmAction, money, exportCsv } from '../ui.js';

let currentStatus = 'pending';

async function load() {
  const list = document.getElementById('list');
  list.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border" role="status"><span class="visually-hidden">Loading…</span></div></div>';
  const { data, error } = await supabase
    .from('coach_profiles')
    .select('*, profile:profiles!coach_profiles_user_id_fkey(full_name, email, phone), coach_certifications(*)')
    .eq('status', currentStatus)
    .order('created_at', { ascending: true })
    .limit(50);
  const err = document.getElementById('error');
  if (error) {
    err.textContent = errorText(error);
    err.classList.remove('d-none');
    list.innerHTML = '';
    return;
  }
  err.classList.add('d-none');
  if (!data.length) {
    list.innerHTML = `<div class="col-12"><div class="pf-card text-center text-secondary py-5">No ${esc(currentStatus)} coaches.</div></div>`;
    return;
  }
  list.innerHTML = data.map((c) => `
    <div class="col-xl-6">
      <div class="pf-card h-100">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div>
            <h2 class="h5 fw-bold mb-0">${esc(c.profile?.full_name || 'Unnamed')}</h2>
            <div class="text-secondary small">${esc(c.profile?.email)} ${c.profile?.phone ? '· ' + esc(c.profile.phone) : ''}</div>
          </div>
          ${statusBadge(c.status)}
        </div>
        <p class="fw-semibold mt-3 mb-1">${esc(c.headline)}</p>
        <p class="small mb-2" style="white-space:pre-line">${esc(c.bio)}</p>
        <div class="small text-secondary mb-2">
          ${esc(c.years_experience ?? '?')} yrs · ${esc(c.city ?? '')} ·
          ${c.offers_online ? 'online ' : ''}${c.offers_in_person ? 'in-person' : ''} ·
          ${c.hourly_rate_minor != null ? money(c.hourly_rate_minor, c.currency || 'XAF') + '/h' : 'no rate'}
        </div>
        <div class="mb-2">${(c.specializations || []).map((s) => `<span class="badge text-bg-light border me-1">${esc(s)}</span>`).join('')}</div>
        <h3 class="h6 mt-3">Certifications</h3>
        <ul class="list-unstyled small mb-3">
          ${(c.coach_certifications || []).map((x) => `
            <li class="d-flex align-items-center gap-2 mb-1">
              <i class="bi ${x.verified ? 'bi-patch-check-fill text-success' : 'bi-patch-question text-warning'}" aria-hidden="true"></i>
              <span>${esc(x.title)}${x.issuer ? ' — ' + esc(x.issuer) : ''}</span>
              ${x.verified ? '' : `<button class="btn btn-link btn-sm p-0 ms-auto" data-verify="${esc(x.id)}">Mark verified</button>`}
            </li>`).join('') || '<li class="text-secondary">None submitted</li>'}
        </ul>
        ${c.rejection_reason ? `<div class="alert alert-light small py-2">Reason: ${esc(c.rejection_reason)}</div>` : ''}
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-outline-secondary btn-sm" data-edit="${esc(c.user_id)}" data-headline="${esc(c.headline ?? '')}" data-specs="${esc((c.specializations || []).join(', '))}"><i class="bi bi-pencil"></i> Edit profile</button>
          ${c.status !== 'approved' ? `<button class="btn btn-primary btn-sm" data-approve="${esc(c.user_id)}"><i class="bi bi-check-lg"></i> Approve</button>` : ''}
          ${c.status === 'pending' ? `<button class="btn btn-outline-danger btn-sm" data-reject="${esc(c.user_id)}">Reject</button>` : ''}
          ${c.status === 'approved' ? `<button class="btn btn-outline-danger btn-sm" data-suspend="${esc(c.user_id)}">Suspend coach</button>` : ''}
          <span class="ms-auto text-secondary small">Applied ${dateTime(c.created_at)}</span>
        </div>
      </div>
    </div>`).join('');
}

async function run(promise, okMessage) {
  const { error } = await promise;
  if (error) toast(errorText(error), 'error');
  else {
    toast(okMessage);
    load();
  }
}

document.getElementById('list').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.approve && confirmAction('Approve this coach? Their profile becomes public and they can accept bookings.')) {
    run(supabase.rpc('admin_review_coach', { p_coach: b.dataset.approve, p_approve: true }), 'Coach approved');
  } else if (b.dataset.reject) {
    const reason = prompt('Reason for rejection (shown to the applicant):');
    if (reason !== null) run(supabase.rpc('admin_review_coach', { p_coach: b.dataset.reject, p_approve: false, p_reason: reason }), 'Application rejected');
  } else if (b.dataset.suspend) {
    const reason = prompt('Reason for suspension:');
    if (reason !== null) run(supabase.rpc('admin_suspend_coach', { p_coach: b.dataset.suspend, p_reason: reason }), 'Coach suspended');
  } else if (b.dataset.verify && confirmAction('Mark this certification as verified? Only do this after checking the document.')) {
    supabase.auth.getUser().then(({ data: { user } }) =>
      run(supabase.from('coach_certifications').update({ verified: true, verified_by: user.id }).eq('id', b.dataset.verify), 'Certification verified'));
  }
});

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-status]');
  if (!b) return;
  document.querySelectorAll('#tabs .nav-link').forEach((x) => x.classList.toggle('active', x === b));
  const perf = b.dataset.status === 'performance';
  document.getElementById('list').classList.toggle('d-none', perf);
  document.getElementById('perf').classList.toggle('d-none', !perf);
  if (perf) return loadPerformance();
  currentStatus = b.dataset.status;
  load();
});

// ---------- Profile corrections ----------
function openProfile(b) {
  document.getElementById('pf-coach').value = b.dataset.edit;
  document.getElementById('pf-headline').value = b.dataset.headline ?? '';
  document.getElementById('pf-specs').value = b.dataset.specs ?? '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('profile-modal')).show();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-edit]');
  if (b) openProfile(b);
});
document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const specs = document.getElementById('pf-specs').value.split(',').map((x) => x.trim()).filter(Boolean);
  const { error } = await supabase.rpc('admin_update_coach_profile', {
    p_coach: document.getElementById('pf-coach').value, p_headline: document.getElementById('pf-headline').value, p_specializations: specs,
  });
  if (error) return toast(errorText(error), 'error');
  bootstrap.Modal.getInstance(document.getElementById('profile-modal')).hide();
  toast('Profile updated');
  document.getElementById('perf').classList.contains('d-none') ? load() : loadPerformance();
});

// ---------- Performance & commission ----------
let perfRows = [];
async function loadPerformance() {
  const days = Number(document.getElementById('perf-period').value);
  const to = new Date(), from = new Date(Date.now() - days * 86400000);
  const [{ data, error }, { data: setting }] = await Promise.all([
    supabase.rpc('admin_coach_report', { p_from: from.toISOString(), p_to: to.toISOString() }),
    supabase.from('platform_settings').select('value').eq('key', 'booking.default_commission_pct').maybeSingle(),
  ]);
  document.getElementById('default-commission').textContent = setting ? `${setting.value} %` : '—';
  const err = document.getElementById('error');
  if (error) {
    err.textContent = errorText(error);
    err.classList.remove('d-none');
    return;
  }
  err.classList.add('d-none');
  perfRows = data;
  const moneyCell = (m, k) => (m || []).map((x) => money(x[k], x.currency)).join('<br>') || '—';
  document.getElementById('perf-rows').innerHTML = data.length ? data.map((c) => `<tr>
      <td><div class="fw-semibold">${esc(c.full_name || '—')}</div><div class="small text-secondary">${esc(c.email)}</div>${c.coach_status === 'suspended' ? statusBadge('suspended') : ''}</td>
      <td class="text-end">${Number(c.sessions_completed)}</td><td class="text-end">${Number(c.sessions_upcoming)}</td>
      <td class="text-end">${Number(c.sessions_cancelled)}</td><td class="text-end">${Number(c.sessions_no_show)}</td>
      <td class="text-end">${Number(c.rating_count) ? `★ ${Number(c.rating_avg).toFixed(1)} <span class="text-secondary small">(${Number(c.rating_count)})</span>` : '—'}</td>
      <td class="small">${moneyCell(c.money, 'net_minor')}</td>
      <td class="small">${(c.money || []).map((x) => `${money(x.platform_commission_minor, x.currency)} / ${money(x.coach_share_minor, x.currency)}`).join('<br>') || '—'}</td>
      <td>${Number(c.commission_pct)} % ${c.commission_is_default ? '<span class="badge text-bg-light border">default</span>' : ''}</td>
      <td class="text-end text-nowrap"><button class="btn btn-sm btn-outline-secondary" data-commission="${esc(c.coach_id)}" data-current="${c.commission_is_default ? '' : esc(c.commission_pct)}">Set commission</button></td>
    </tr>`).join('') : '<tr><td colspan="10" class="text-center text-secondary py-4">No approved coaches yet.</td></tr>';
}
document.getElementById('perf-rows').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-commission]');
  if (!b) return;
  const v = prompt('Commission for this coach in % (0–100). Leave empty to use the platform default.', b.dataset.current);
  if (v === null) return;
  const pct = v.trim() === '' ? null : Number(v.replace(',', '.'));
  if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return toast('Enter a number between 0 and 100', 'error');
  const { error } = await supabase.rpc('admin_set_coach_commission', { p_coach: b.dataset.commission, p_pct: pct });
  if (error) return toast(errorText(error), 'error');
  toast('Commission saved');
  loadPerformance();
});
document.getElementById('perf-period').addEventListener('change', loadPerformance);
document.getElementById('perf-export').addEventListener('click', () => {
  const rows = perfRows.flatMap((c) => (c.money?.length ? c.money : [{}]).map((m) => ({ ...c, ...m })));
  exportCsv(supabase, 'coach_report', 'pulsefit-coach-report', [
    { key: 'full_name', label: 'Coach' }, { key: 'email', label: 'Email' }, { key: 'coach_status', label: 'Status' },
    { key: 'sessions_completed', label: 'Completed' }, { key: 'sessions_upcoming', label: 'Upcoming' },
    { key: 'sessions_cancelled', label: 'Cancelled' }, { key: 'sessions_no_show', label: 'No-show' }, { key: 'sessions_declined', label: 'Declined' },
    { label: 'Rating', value: (r) => Number(r.rating_avg) }, { key: 'rating_count', label: 'Reviews' },
    { key: 'commission_pct', label: 'Commission %' }, { key: 'currency', label: 'Currency' },
    { key: 'gross_minor', label: 'Gross (minor units)' }, { key: 'refunded_minor', label: 'Refunded' }, { key: 'net_minor', label: 'Net' },
    { key: 'platform_commission_minor', label: 'Platform commission' }, { key: 'coach_share_minor', label: 'Coach share' }, { key: 'fees_minor', label: 'Provider fees' },
  ], rows, { days: Number(document.getElementById('perf-period').value) });
});

if (await initLayout('Coaches')) load();
