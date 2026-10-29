import { supabase } from '../supabase.js';
import { initLayout } from '../layout.js';
import { esc, money, errorText, statusBadge, exportCsv, localDate, dayStartIso, fromMinor } from '../ui.js';

const COLORS = { subscription: '#2196D2', order: '#FFA500', appointment: '#28A745' };
const LABELS = { subscription: 'Subscriptions', order: 'Store', appointment: 'Coaching' };
const MEANING = {
  succeeded: ['Paid', true], partially_refunded: ['Paid, part refunded', true], refunded: ['Paid, fully refunded', true],
  pending: ['Waiting for the customer / provider — not money yet', false], failed: ['Payment failed', false],
  cancelled: ['Checkout abandoned', false], disputed: ['Paid amount did not match — needs review', false],
};
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Douala';
let report = null, chart = null;

function applyPreset() {
  const p = document.getElementById('preset').value, now = new Date();
  let from, to = now;
  if (p === 'this-month') from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (p === 'last-month') { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 0); }
  else if (p === 'this-year') from = new Date(now.getFullYear(), 0, 1);
  else if (p === 'custom') return;
  else from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(p) + 1);
  document.getElementById('from').value = localDate(from);
  document.getElementById('to').value = localDate(to);
  const days = (to - from) / 86400000;
  document.getElementById('group').value = days > 120 ? 'month' : days > 45 ? 'week' : 'day';
}

function params() {
  const f = document.getElementById('from').value, t = document.getElementById('to').value;
  const to = new Date(dayStartIso(t));
  to.setDate(to.getDate() + 1);
  return { p_from: dayStartIso(f), p_to: to.toISOString(), p_group: document.getElementById('group').value, p_tz: TZ };
}

const card = (label, value, sub = '', strong = false) => `<div class="col-6 col-md-4 col-xl-3"><div class="pf-card h-100">
  <div class="small text-secondary">${esc(label)}</div><div class="${strong ? 'fs-4 fw-bold' : 'fs-5 fw-semibold'}">${value}</div>
  ${sub ? `<div class="small text-secondary">${sub}</div>` : ''}</div></div>`;

async function load() {
  const { data, error } = await supabase.rpc('admin_financial_report', params());
  const err = document.getElementById('error');
  if (error) {
    err.textContent = errorText(error);
    err.classList.remove('d-none');
    return;
  }
  err.classList.add('d-none');
  report = data;
  document.getElementById('tz').textContent = `Days in ${data.timezone}`;
  document.getElementById('currencies').innerHTML = data.currencies.length ? data.currencies.map((c) => {
    const m = (v) => money(v ?? 0, c.currency);
    const net = (c.gross_minor ?? 0) - (c.refunds_minor ?? 0) - (c.fees_minor ?? 0);
    const coachShare = (c.booking_minor ?? 0) - (c.platform_commission_minor ?? 0);
    return `<h2 class="h6 fw-bold mt-2">${esc(c.currency)}</h2><div class="row g-3 mb-3">
      ${card('Gross revenue', m(c.gross_minor), `${Number(c.transactions)} payments`, true)}
      ${card('Refunds', m(c.refunds_minor), 'completed in the period')}
      ${card('Provider fees', m(c.fees_minor), 'where the provider reported them')}
      ${card('Net revenue', m(net), 'gross − refunds − fees', true)}
      ${card('Subscriptions', m(c.subscription_minor))}
      ${card('Store (products)', m(c.product_minor))}
      ${card('Coaching sessions', m(c.booking_minor), `coaches' share before refunds: ${m(coachShare)}`)}
      ${card('Platform commission', m(c.platform_commission_minor), 'on coaching, after refunds')}
    </div>`;
  }).join('') : '<div class="pf-card text-center text-secondary py-4 mb-3">No confirmed payments in this period.</div>';

  // Chart: one currency at a time, stacked by source.
  const currs = [...new Set(data.series.map((x) => x.currency))];
  const sel = document.getElementById('chart-currency');
  const keep = currs.includes(sel.value) ? sel.value : currs[0];
  sel.innerHTML = currs.map((c) => `<option ${c === keep ? 'selected' : ''}>${esc(c)}</option>`).join('');
  drawChart(keep);

  document.getElementById('categories').innerHTML = data.sales_by_category.map((s) => `<tr><td>${esc(s.category)}</td>
      <td class="text-end">${Number(s.units)}</td><td class="text-end">${money(s.amount_minor, s.currency)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="text-secondary text-center py-3">No store sales.</td></tr>';
  document.getElementById('statuses').innerHTML = data.by_status.map((s) => {
    const [meaning, revenue] = MEANING[s.status] ?? [s.status, false];
    return `<tr class="${revenue ? 'table-success' : ''}"><td>${statusBadge(s.status)}</td><td class="small">${esc(meaning)}</td><td>${esc(s.currency)}</td>
      <td class="text-end">${Number(s.count)}</td><td class="text-end">${money(s.amount_minor, s.currency)}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="text-secondary text-center py-3">No payment attempts.</td></tr>';
}

function periodsBetween() {
  // Every period in range (so empty days show as zero, not as gaps).
  const g = report.group, out = [];
  const [fy, fm, fd] = document.getElementById('from').value.split('-').map(Number);
  const [ty, tm, td] = document.getElementById('to').value.split('-').map(Number);
  let d = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  if (g === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (g === 'month') d = new Date(d.getFullYear(), d.getMonth(), 1);
  while (d <= end && out.length < 400) {
    out.push(localDate(d));
    if (g === 'day') d.setDate(d.getDate() + 1);
    else if (g === 'week') d.setDate(d.getDate() + 7);
    else d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return out;
}

function drawChart(currency) {
  chart?.destroy();
  if (!currency) return;
  const periods = periodsBetween();
  const rows = report.series.filter((x) => x.currency === currency);
  const datasets = ['subscription', 'order', 'appointment'].map((p) => ({
    label: LABELS[p], backgroundColor: COLORS[p], borderRadius: 4,
    data: periods.map((per) => {
      const r = rows.find((x) => x.period === per && x.purpose === p);
      return r ? fromMinor(r.amount_minor, currency) : 0;
    }),
  }));
  chart = new Chart(document.getElementById('series-chart'), {
    type: 'bar',
    data: { labels: periods.map((p) => (report.group === 'month' ? p.slice(0, 7) : p.slice(5))), datasets },
    options: {
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toLocaleString()} ${currency}` } } },
    },
  });
}

document.getElementById('preset').addEventListener('change', () => { applyPreset(); load(); });
for (const id of ['from', 'to']) document.getElementById(id).addEventListener('change', () => { document.getElementById('preset').value = 'custom'; load(); });
document.getElementById('group').addEventListener('change', load);
document.getElementById('chart-currency').addEventListener('change', (e) => drawChart(e.target.value));
document.getElementById('export').addEventListener('click', () => {
  if (!report) return;
  const rows = [
    ...report.currencies.map((c) => ({ section: 'summary', currency: c.currency, item: 'gross', amount: c.gross_minor })),
    ...report.currencies.flatMap((c) => ['refunds_minor', 'fees_minor', 'subscription_minor', 'product_minor', 'booking_minor', 'platform_commission_minor']
      .map((k) => ({ section: 'summary', currency: c.currency, item: k.replace('_minor', ''), amount: c[k] ?? 0 }))),
    ...report.currencies.map((c) => ({ section: 'summary', currency: c.currency, item: 'net', amount: (c.gross_minor ?? 0) - (c.refunds_minor ?? 0) - (c.fees_minor ?? 0) })),
    ...report.series.map((x) => ({ section: 'series', period: x.period, currency: x.currency, item: x.purpose, amount: x.amount_minor })),
    ...report.by_status.map((x) => ({ section: 'status', currency: x.currency, item: x.status, count: x.count, amount: x.amount_minor })),
    ...report.sales_by_category.map((x) => ({ section: 'category', currency: x.currency, item: x.category, count: x.units, amount: x.amount_minor })),
  ];
  exportCsv(supabase, 'financial_report', 'pulsefit-finance', [
    { key: 'section', label: 'Section' }, { key: 'period', label: 'Period' }, { key: 'currency', label: 'Currency' },
    { key: 'item', label: 'Item' }, { key: 'count', label: 'Count' }, { key: 'amount', label: 'Amount (minor units)' },
  ], rows, { from: document.getElementById('from').value, to: document.getElementById('to').value, group: report.group });
});

if (await initLayout('Financial reports')) {
  applyPreset();
  load();
}
