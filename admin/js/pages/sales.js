import { supabase } from '../supabase.js';
import { initLayout, STORE } from '../layout.js';
import { esc, money, errorText } from '../ui.js';

const $ = (id) => document.getElementById(id);
const COLORS = ['#2196D2', '#FFA500', '#87CEEB', '#FFB366', '#28A745', '#172B3A', '#667788', '#DC3545'];
let dayChart, catChart;

async function run() {
  const from = new Date(`${$('from').value}T00:00:00`);
  const to = new Date(`${$('to').value}T23:59:59`);
  const { data: r, error } = await supabase.rpc('store_sales_report', { p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) {
    $('error').textContent = errorText(error);
    $('error').classList.remove('d-none');
    return;
  }
  $('error').classList.add('d-none');
  $('totals').innerHTML = (r.totals.length ? r.totals : [{ currency: 'XAF', revenue_minor: 0, orders: 0 }]).map((t) => `
    <div class="col-md-4"><div class="pf-card stat"><div class="icon icon-green"><i class="bi bi-cash-coin"></i></div>
      <div><div class="value">${money(t.revenue_minor, t.currency)}</div><div class="label">${t.orders} paid order(s) · ${esc(t.currency)}</div></div></div></div>`).join('');

  // Revenue per day (main currency), zero-filled so the chart is honest.
  const cur = r.totals[0]?.currency || 'XAF';
  const byDay = Object.fromEntries(r.by_day.filter((d) => d.currency === cur).map((d) => [d.day, d.revenue_minor]));
  // Days are counted in UTC (the database's calendar), so build the axis in UTC too.
  const labels = [], values = [];
  const last = new Date(`${$('to').value}T00:00:00Z`);
  for (let d = new Date(`${$('from').value}T00:00:00Z`); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    labels.push(k.slice(5));
    values.push((byDay[k] || 0) / (cur === 'XAF' || cur === 'XOF' ? 1 : 100));
  }
  dayChart?.destroy();
  dayChart = new Chart($('day-chart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: cur, data: values, backgroundColor: '#2196D2', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true }, x: { grid: { display: false } } } },
  });
  const cats = r.by_category.filter((c) => c.currency === cur);
  catChart?.destroy();
  catChart = new Chart($('cat-chart'), {
    type: 'doughnut',
    data: cats.length
      ? { labels: cats.map((c) => c.category), datasets: [{ data: cats.map((c) => c.revenue_minor), backgroundColor: COLORS }] }
      : { labels: ['No sales'], datasets: [{ data: [1], backgroundColor: ['#e6eef4'] }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '60%' },
  });
  $('top').innerHTML = r.top_products.map((p) => `<tr><td>${esc(p.name)}</td><td class="text-end">${p.units}</td><td class="text-end">${money(p.revenue_minor, p.currency)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="text-secondary">No sales in this period.</td></tr>';
  $('low').innerHTML = r.low_stock.map((v) => `<tr><td>${esc(v.name)} <code class="small">${esc(v.sku)}</code></td><td class="text-end text-danger fw-bold">${v.stock_qty}</td></tr>`).join('')
    || '<tr><td colspan="2" class="text-secondary">All good.</td></tr>';
}

if (await initLayout('Sales report', STORE)) {
  const today = new Date();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  $('to').value = ymd(today);
  $('from').value = ymd(new Date(today.getTime() - 29 * 86400000));
  $('run').addEventListener('click', run);
  run();
}
