import { supabase } from '../supabase.js';
import { initLayout } from '../layout.js';
import { esc, money, dateTime, errorText, statusBadge } from '../ui.js';

const BLUE = '#2196D2', SKY = '#87CEEB', ORANGE = '#FFA500', GREEN = '#28A745', RED = '#DC3545', GREY = '#667788';
let signupsChart, txChart;

function stat(label, value, icon, tone = 'blue') {
  return `<div class="col-6 col-md-4 col-xl-3"><div class="pf-card stat">
    <div class="icon icon-${tone}"><i class="bi bi-${icon}" aria-hidden="true"></i></div>
    <div><div class="value">${esc(value)}</div><div class="label">${esc(label)}</div></div></div></div>`;
}

async function load() {
  const days = Number(document.getElementById('period').value);
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const { data: s, error } = await supabase.rpc('admin_dashboard_stats', { p_from: from, p_to: new Date().toISOString() });
  const errBox = document.getElementById('error');
  if (error) {
    errBox.textContent = errorText(error);
    errBox.classList.remove('d-none');
    return;
  }
  errBox.classList.add('d-none');
  document.getElementById('generated').textContent = `Updated ${dateTime(s.generated_at)}`;

  document.getElementById('stats').innerHTML = [
    stat('Registered clients', s.clients_total, 'people'),
    stat('Active clients (30 d)', s.clients_active_30d, 'activity', 'green'),
    stat('Pending coach applications', s.coaches_pending, 'hourglass-split', 'orange'),
    stat('Approved coaches', s.coaches_approved, 'person-check'),
    stat('Active subscriptions', s.subs_active, 'credit-card', 'green'),
    stat('Past-due subscriptions', s.subs_past_due, 'exclamation-triangle', 'red'),
    stat('Cancellations (period)', s.subs_cancelled_period, 'x-circle', 'orange'),
    stat('Expired subscriptions', s.subs_expired, 'calendar-x'),
    stat('Orders (period)', s.orders_total, 'bag'),
    stat('Orders to process', s.orders_pending, 'box-seam', 'orange'),
    stat('Low-stock variants', s.low_stock_variants, 'exclamation-diamond', 'red'),
    stat('Upcoming sessions', `${s.appointments_upcoming} (+${s.appointments_requested} req.)`, 'calendar-event', 'green'),
  ].join('');

  // Revenue table — per currency & source, succeeded payments only.
  const rows = s.revenue_by_currency ?? [];
  document.getElementById('revenue').innerHTML = rows.length
    ? rows.map((r) => `<tr><td>${esc(r.currency)}</td><td class="text-capitalize">${esc(r.purpose)}</td>
        <td class="text-end">${money(r.gross_minor, r.currency)}</td>
        <td class="text-end">${money(r.fees_minor, r.currency)}</td>
        <td class="text-end">${money(r.refunded_minor, r.currency)}</td>
        <td class="text-end fw-bold">${money((r.gross_minor ?? 0) - (r.fees_minor ?? 0) - (r.refunded_minor ?? 0), r.currency)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="text-secondary text-center py-4">No confirmed payments in this period.</td></tr>';

  // Registrations per day (fill missing days with 0 so the chart is honest).
  const byDay = Object.fromEntries((s.signups_by_day ?? []).map((d) => [d.day, d.count]));
  const labels = [], counts = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    labels.push(d.slice(5));
    counts.push(byDay[d] ?? 0);
  }
  signupsChart?.destroy();
  signupsChart = new Chart(document.getElementById('signups-chart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Sign-ups', data: counts, backgroundColor: BLUE, borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  });

  const tx = s.transactions_by_status ?? {};
  const colors = { succeeded: GREEN, pending: SKY, failed: RED, refunded: ORANGE, partially_refunded: ORANGE, disputed: RED, cancelled: GREY };
  txChart?.destroy();
  const keys = Object.keys(tx);
  txChart = new Chart(document.getElementById('tx-chart'), {
    type: 'doughnut',
    data: keys.length
      ? { labels: keys, datasets: [{ data: keys.map((k) => tx[k]), backgroundColor: keys.map((k) => colors[k] ?? GREY) }] }
      : { labels: ['No transactions'], datasets: [{ data: [1], backgroundColor: ['#e6eef4'] }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '65%' },
  });
}

async function loadRecent() {
  const { data, error } = await supabase.rpc('admin_recent_activity', { p_limit: 8 });
  if (error) return;
  document.getElementById('recent-payments').innerHTML = data.payments.map((t) => `<tr>
      <td class="small text-nowrap">${dateTime(t.at)}</td><td class="small">${esc(t.email ?? '—')}</td>
      <td class="small text-capitalize">${esc(t.purpose)}</td><td class="text-end">${money(t.amount_minor, t.currency)}</td><td>${statusBadge(t.status)}</td></tr>`).join('')
    || '<tr><td class="text-secondary text-center py-3">No payments yet.</td></tr>';
  document.getElementById('recent-users').innerHTML = data.registrations.map((u) => `<li class="d-flex justify-content-between border-bottom py-2 small">
      <span><b>${esc(u.full_name || '—')}</b><br><span class="text-secondary">${esc(u.email)}</span></span><span class="text-secondary text-nowrap">${dateTime(u.created_at)}</span></li>`).join('')
    || '<li class="text-secondary">No registrations yet.</li>';
}

if (await initLayout('Dashboard')) {
  document.getElementById('period').addEventListener('change', load);
  load();
  loadRecent();
}
