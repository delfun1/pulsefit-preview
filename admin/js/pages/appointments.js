import { supabase } from '../supabase.js';
import { initLayout } from '../layout.js';
import { esc, money, dateTime, errorText, toast, statusBadge, exportCsv, localDate, dayStartIso, confirmAction } from '../ui.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TONE = { requested: 'warning', confirmed: 'primary', completed: 'success', cancelled: 'secondary', declined: 'secondary', no_show: 'danger', expired: 'secondary' };
let weekStart = mondayOf(new Date());
let current = [];

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const isWeek = () => document.getElementById('view-week').checked;

function range() {
  if (isWeek()) return { from: weekStart, to: addDays(weekStart, 7) };
  const f = document.getElementById('from').value, t = document.getElementById('to').value;
  return { from: new Date(dayStartIso(f)), to: addDays(new Date(dayStartIso(t)), 1) };
}

function filters() {
  const { from, to } = range();
  return {
    p_from: from.toISOString(), p_to: to.toISOString(),
    p_coach: document.getElementById('coach').value || null,
    p_status: document.getElementById('status').value || null,
  };
}

function stat(label, value, tone = 'blue', icon = 'calendar-check') {
  return `<div class="col-6 col-md-4 col-xl-2"><div class="pf-card stat"><div class="icon icon-${tone}"><i class="bi bi-${icon}" aria-hidden="true"></i></div>
    <div><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div></div></div></div>`;
}

async function load() {
  document.getElementById('week-nav').classList.toggle('d-none', !isWeek());
  document.getElementById('range').classList.toggle('d-none', isWeek());
  document.getElementById('range').classList.toggle('d-flex', !isWeek());
  document.getElementById('week').classList.toggle('d-none', !isWeek());
  document.getElementById('list').classList.toggle('d-none', isWeek());
  const { from, to } = range();
  document.getElementById('range-label').textContent = isWeek()
    ? `${from.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${addDays(to, -1).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : '';
  const f = filters();
  const [list, report] = await Promise.all([
    supabase.rpc('admin_list_appointments', { ...f, p_limit: 2000, p_offset: 0 }),
    supabase.rpc('admin_booking_report', { p_from: f.p_from, p_to: f.p_to }),
  ]);
  const err = document.getElementById('error');
  if (list.error || report.error) {
    err.textContent = errorText(list.error || report.error);
    err.classList.remove('d-none');
    return;
  }
  err.classList.add('d-none');
  current = list.data;
  const r = report.data, st = r.by_status || {}, cb = r.cancelled_by || {};
  document.getElementById('stats').innerHTML = [
    stat('Requested', st.requested ?? 0, 'orange', 'hourglass-split'),
    stat('Confirmed', st.confirmed ?? 0, 'blue', 'calendar-check'),
    stat('Completed', st.completed ?? 0, 'green', 'check2-circle'),
    stat('Cancelled', `${st.cancelled ?? 0}`, 'orange', 'x-circle'),
    stat('No-show rate', r.no_show_rate_pct == null ? '—' : `${r.no_show_rate_pct} %`, 'red', 'person-x'),
    stat('Online / in person', `${r.by_mode?.online ?? 0} / ${r.by_mode?.in_person ?? 0}`, 'blue', 'camera-video'),
  ].join('') + (Object.keys(cb).length
    ? `<div class="col-12 small text-secondary">Cancelled by: ${Object.entries(cb).map(([k, v]) => `${esc(k)} ${Number(v)}`).join(' · ')} (whole period, all coaches)</div>` : '');
  isWeek() ? renderWeek() : renderList();
  renderAvailability();
}

function chip(a) {
  return `<button class="appt-chip border-start border-4 border-${TONE[a.status] ?? 'secondary'} w-100 text-start" data-id="${esc(a.id)}">
    <div class="fw-semibold small">${time(a.starts_at)}–${time(a.ends_at)}</div>
    <div class="small text-truncate">${esc(a.service)}</div>
    <div class="small text-secondary text-truncate">${esc(a.coach_name ?? '')} · ${esc(a.clients ?? '')}</div>
    <div>${statusBadge(a.status)}</div></button>`;
}

function renderWeek() {
  const today = localDate();
  const cols = [...Array(7)].map((_, i) => {
    const day = addDays(weekStart, i), ymd = localDate(day);
    const items = current.filter((a) => localDate(new Date(a.starts_at)) === ymd);
    return `<div class="week-col ${ymd === today ? 'is-today' : ''}">
      <div class="week-head"><span>${DAYS[i]}</span> <b>${day.getDate()}</b></div>
      ${items.map(chip).join('') || '<div class="text-secondary small text-center py-3">—</div>'}</div>`;
  });
  document.getElementById('week').innerHTML = `<div class="week-grid">${cols.join('')}</div>`;
}

function renderList() {
  document.getElementById('rows').innerHTML = current.map((a) => `<tr>
      <td class="small text-nowrap">${dateTime(a.starts_at)}</td><td>${esc(a.service)}<div class="small text-secondary">${a.mode === 'online' ? 'Online' : 'In person'}</div></td>
      <td>${esc(a.coach_name ?? '')}</td><td class="small">${esc(a.clients ?? '')}</td>
      <td>${statusBadge(a.status)}${a.cancelled_by_role ? `<div class="small text-secondary">by ${esc(a.cancelled_by_role)}</div>` : ''}</td>
      <td class="small">${a.price_minor > 0 ? `${money(a.price_minor, a.currency)}<br>${statusBadge(a.payment_status)}` : 'Free'}</td>
      <td class="text-end"><button class="btn btn-sm btn-light" data-id="${esc(a.id)}">Open</button></td></tr>`).join('')
    || '<tr><td colspan="7" class="text-center text-secondary py-4">No sessions in this range.</td></tr>';
}

async function renderAvailability() {
  const box = document.getElementById('availability');
  const coach = document.getElementById('coach').value;
  box.classList.toggle('d-none', !coach);
  if (!coach) return;
  const [{ data: av }, { data: off }] = await Promise.all([
    supabase.from('coach_availability').select('weekday, start_time, end_time, mode').eq('coach_id', coach).order('weekday').order('start_time'),
    supabase.from('coach_time_off').select('period, reason').eq('coach_id', coach),
  ]);
  const byDay = DAYS.map((d, i) => {
    const slots = (av || []).filter((x) => x.weekday === i + 1);
    return `<div class="col"><div class="small fw-semibold">${d}</div>${slots.map((s) => `<div class="small">${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}${s.mode ? ` <span class="text-secondary">(${esc(s.mode === 'online' ? 'online' : 'in person')})</span>` : ''}</div>`).join('') || '<div class="small text-secondary">—</div>'}</div>`;
  }).join('');
  const upcomingOff = (off || []).filter((o) => { const end = o.period.split(',')[1]?.replace(/[)\]"]/g, ''); return !end || new Date(end) > new Date(); });
  box.innerHTML = `<h2 class="h6 fw-bold">Weekly availability <span class="text-secondary fw-normal small">(coach's own time zone)</span></h2>
    <div class="row row-cols-7 g-2">${byDay}</div>
    ${upcomingOff.length ? `<div class="small mt-2"><b>Time off:</b> ${upcomingOff.map((o) => esc(o.period.replace(/[[\]()"]/g, '').replace(',', ' → ')) + (o.reason ? ` (${esc(o.reason)})` : '')).join('; ')}</div>` : ''}`;
}

function openAppointment(id) {
  const a = current.find((x) => x.id === id);
  if (!a) return;
  const live = ['requested', 'confirmed'].includes(a.status);
  const past = new Date(a.starts_at) < new Date();
  const z = (n) => String(n).padStart(2, '0');
  const s = new Date(a.starts_at);
  const localValue = `${s.getFullYear()}-${z(s.getMonth() + 1)}-${z(s.getDate())}T${z(s.getHours())}:${z(s.getMinutes())}`;
  document.getElementById('appt-title').textContent = a.service;
  document.getElementById('appt-body').innerHTML = `
    <dl class="row small">
      <dt class="col-4">When</dt><dd class="col-8">${dateTime(a.starts_at)} – ${time(a.ends_at)}</dd>
      <dt class="col-4">Coach</dt><dd class="col-8">${esc(a.coach_name ?? '')}</dd>
      <dt class="col-4">Client(s)</dt><dd class="col-8">${esc(a.clients ?? '')}</dd>
      <dt class="col-4">Mode</dt><dd class="col-8">${a.mode === 'online' ? 'Online' : 'In person'}</dd>
      <dt class="col-4">Status</dt><dd class="col-8">${statusBadge(a.status)}</dd>
      <dt class="col-4">Payment</dt><dd class="col-8">${a.price_minor > 0 ? `${money(a.price_minor, a.currency)} · ${statusBadge(a.payment_status)}` : 'Free'}</dd>
      ${a.cancel_reason ? `<dt class="col-4">Cancellation</dt><dd class="col-8">${esc(a.cancel_reason)} ${a.cancelled_by_role ? `(by ${esc(a.cancelled_by_role)}, ${dateTime(a.cancelled_at)})` : ''}</dd>` : ''}
    </dl>
    ${live && !past ? `
      <form id="resched" class="border-top pt-3">
        <label class="form-label fw-semibold" for="new-start">Move to (your local time)</label>
        <input type="datetime-local" class="form-control mb-2" id="new-start" value="${localValue}" required>
        <input class="form-control mb-2" id="resched-reason" placeholder="Reason (sent to coach and client)" required maxlength="200">
        <button class="btn btn-primary btn-sm" type="submit"><i class="bi bi-calendar2-range"></i> Reschedule</button>
      </form>` : ''}
    <div class="d-flex flex-wrap gap-2 border-top pt-3 mt-3">
      ${a.status === 'confirmed' && past ? `<button class="btn btn-success btn-sm" data-mark="completed">Mark completed</button>
        <button class="btn btn-outline-danger btn-sm" data-mark="no_show">Mark no-show</button>` : ''}
      ${live ? `<button class="btn btn-outline-danger btn-sm ms-auto" data-cancel="1"><i class="bi bi-x-circle"></i> Cancel session</button>` : ''}
    </div>
    ${a.payment_status === 'paid' && live ? '<p class="small text-secondary mt-2 mb-0">This session is paid. If you cancel it, refund the client on the Payments page.</p>' : ''}`;
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('appt-modal'));
  modal.show();
  const body = document.getElementById('appt-body');
  body.querySelector('#resched')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const when = new Date(document.getElementById('new-start').value);
    const { error } = await supabase.rpc('admin_reschedule_appointment', {
      p_appointment: a.id, p_new_start: when.toISOString(), p_reason: document.getElementById('resched-reason').value.trim(),
    });
    if (error) return toast(errorText(error), 'error');
    modal.hide();
    toast('Session moved — coach and client notified');
    load();
  });
  body.querySelector('[data-cancel]')?.addEventListener('click', async () => {
    const reason = prompt('Reason for cancelling (sent to coach and client):');
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc('cancel_appointment', { p_appointment: a.id, p_reason: reason.trim() });
    if (error) return toast(errorText(error), 'error');
    modal.hide();
    toast('Session cancelled');
    load();
  });
  body.querySelectorAll('[data-mark]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirmAction(`Mark this session as ${b.dataset.mark === 'completed' ? 'completed' : 'no-show'}?`)) return;
    const { error } = await supabase.rpc('coach_update_appointment', { p_appointment: a.id, p_status: b.dataset.mark });
    if (error) return toast(errorText(error), 'error');
    modal.hide();
    toast('Status saved');
    load();
  }));
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('#week [data-id], #rows [data-id]');
  if (b) openAppointment(b.dataset.id);
});
document.getElementById('prev-week').addEventListener('click', () => { weekStart = addDays(weekStart, -7); load(); });
document.getElementById('next-week').addEventListener('click', () => { weekStart = addDays(weekStart, 7); load(); });
document.getElementById('this-week').addEventListener('click', () => { weekStart = mondayOf(new Date()); load(); });
for (const id of ['view-week', 'view-list', 'coach', 'status', 'from', 'to']) document.getElementById(id).addEventListener('change', load);
document.getElementById('export').addEventListener('click', () => exportCsv(supabase, 'appointments', 'pulsefit-appointments', [
  { key: 'starts_at', label: 'Start (UTC)' }, { key: 'ends_at', label: 'End (UTC)' }, { key: 'service', label: 'Service' }, { key: 'mode', label: 'Mode' },
  { key: 'coach_name', label: 'Coach' }, { key: 'clients', label: 'Clients' }, { key: 'status', label: 'Status' },
  { key: 'currency', label: 'Currency' }, { key: 'price_minor', label: 'Price (minor units)' }, { key: 'payment_status', label: 'Payment' },
  { key: 'cancelled_by_role', label: 'Cancelled by' }, { key: 'cancel_reason', label: 'Cancellation reason' }, { key: 'created_at', label: 'Booked at (UTC)' },
], current, filters()));

if (await initLayout('Appointments')) {
  document.getElementById('from').value = localDate(addDays(new Date(), -30));
  document.getElementById('to').value = localDate(addDays(new Date(), 30));
  // approved AND suspended coaches, so past bookings of a suspended coach stay reachable
  const { data: coaches } = await supabase.from('coach_profiles')
    .select('user_id, status, profile:profiles!coach_profiles_user_id_fkey(full_name)').in('status', ['approved', 'suspended']);
  document.getElementById('coach').insertAdjacentHTML('beforeend', (coaches || [])
    .sort((x, y) => (x.profile?.full_name ?? '').localeCompare(y.profile?.full_name ?? ''))
    .map((c) => `<option value="${esc(c.user_id)}">${esc(c.profile?.full_name ?? 'Coach')}${c.status === 'suspended' ? ' (suspended)' : ''}</option>`).join(''));
  load();
}
