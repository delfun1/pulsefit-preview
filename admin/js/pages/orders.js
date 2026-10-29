import { supabase } from '../supabase.js';
import { initLayout, STORE } from '../layout.js';
import { esc, money, dateTime, toast, errorText, statusBadge, confirmAction, exportCsv } from '../ui.js';

const $ = (id) => document.getElementById(id);
const PAGE = 25;
let offset = 0;
const panel = () => bootstrap.Offcanvas.getOrCreateInstance($('detail'));
const LABEL = { pending_payment: 'awaiting payment', paid: 'paid — to prepare', processing: 'processing', shipped: 'shipped', delivered: 'delivered', cancelled: 'cancelled', refunded: 'refunded' };

function query() {
  let q = supabase.from('orders')
    .select('id, order_number, created_at, status, payment_status, subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor, currency, shipping_method, shipping_address, customer:profiles!orders_user_id_fkey(email, full_name)', { count: 'exact' })
    .order('created_at', { ascending: false });
  const term = $('q').value.trim().replace(/[%,()]/g, '');
  if (term) q = q.ilike('order_number', `%${term}%`);
  if ($('status').value) q = q.eq('status', $('status').value);
  return q;
}

$('export').addEventListener('click', async () => {
  const all = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) return toast(errorText(error), 'error');
    all.push(...data);
    if (data.length < 1000) break;
  }
  exportCsv(supabase, 'orders', 'pulsefit-orders', [
    { key: 'order_number', label: 'Order' }, { key: 'created_at', label: 'Created (UTC)' }, { key: 'status', label: 'Status' },
    { key: 'payment_status', label: 'Payment' }, { label: 'Customer', value: (o) => o.shipping_address?.recipient || o.customer?.full_name || '' },
    { label: 'Email', value: (o) => o.customer?.email ?? '' }, { label: 'City', value: (o) => o.shipping_address?.city ?? '' },
    { key: 'currency', label: 'Currency' }, { key: 'subtotal_minor', label: 'Subtotal (minor units)' }, { key: 'discount_minor', label: 'Discount' },
    { key: 'shipping_minor', label: 'Delivery' }, { key: 'tax_minor', label: 'Tax' }, { key: 'total_minor', label: 'Total' }, { key: 'shipping_method', label: 'Delivery method' },
  ], all, { q: $('q').value, status: $('status').value });
});

async function load() {
  const { data, count, error } = await query().range(offset, offset + PAGE - 1);
  if (error) {
    $('error').textContent = errorText(error);
    $('error').classList.remove('d-none');
    return;
  }
  $('error').classList.add('d-none');
  $('count').textContent = count ? `${offset + 1}–${Math.min(offset + PAGE, count)} of ${count}` : 'No orders';
  $('prev').disabled = offset === 0;
  $('next').disabled = offset + PAGE >= (count ?? 0);
  $('rows').innerHTML = data.map((o) => `<tr>
      <td><code>${esc(o.order_number)}</code></td>
      <td class="small text-nowrap">${dateTime(o.created_at)}</td>
      <td class="small">${esc(o.shipping_address?.recipient || o.customer?.full_name || '')}<div class="text-secondary">${esc(o.customer?.email || '')}</div></td>
      <td class="text-end text-nowrap">${money(o.total_minor, o.currency)}</td>
      <td>${statusBadge(o.payment_status)}</td>
      <td>${statusBadge(LABEL[o.status] || o.status)}</td>
      <td class="text-end"><button class="btn btn-outline-primary btn-sm" data-open="${esc(o.id)}">Open</button></td></tr>`).join('')
    || '<tr><td colspan="7" class="text-center text-secondary py-4">No orders match.</td></tr>';
}

async function open(id) {
  const { data: o, error } = await supabase.from('orders').select('*, order_items(*), shipments(*)').eq('id', id).single();
  if (error) { toast(errorText(error), 'error'); return; }
  const a = o.shipping_address || {};
  const canProcess = o.payment_status === 'paid' && o.status === 'paid';
  const canShip = o.payment_status === 'paid' && ['paid', 'processing'].includes(o.status);
  const canCancel = o.status === 'pending_payment' && ['unpaid', 'failed'].includes(o.payment_status);
  $('detail-title').textContent = o.order_number;
  $('detail-body').innerHTML = `
    <div class="mb-3">${statusBadge(LABEL[o.status] || o.status)} ${statusBadge(o.payment_status)}</div>
    <h3 class="h6 fw-bold">Items</h3>
    <ul class="list-group list-group-flush mb-3">${(o.order_items || []).map((i) => `<li class="list-group-item d-flex">
      <span>${i.quantity} × ${esc(i.product_name)} <span class="text-secondary small">${esc(Object.values(i.attributes || {}).join(' / '))} · ${esc(i.sku)}</span></span>
      <span class="ms-auto">${money(i.line_total_minor, o.currency)}</span></li>`).join('')}</ul>
    <table class="table table-sm small mb-3"><tbody>
      <tr><td>Subtotal</td><td class="text-end">${money(o.subtotal_minor, o.currency)}</td></tr>
      ${o.member_discount_minor ? `<tr><td>Member discount</td><td class="text-end">− ${money(o.member_discount_minor, o.currency)}</td></tr>` : ''}
      ${o.discount_minor ? `<tr><td>Discount code</td><td class="text-end">− ${money(o.discount_minor, o.currency)}</td></tr>` : ''}
      <tr><td>Delivery (${esc(o.shipping_method)})</td><td class="text-end">${money(o.shipping_minor, o.currency)}</td></tr>
      ${o.tax_minor ? `<tr><td>Tax</td><td class="text-end">${money(o.tax_minor, o.currency)}</td></tr>` : ''}
      <tr class="fw-bold"><td>Total</td><td class="text-end">${money(o.total_minor, o.currency)}</td></tr></tbody></table>
    <h3 class="h6 fw-bold">Deliver to</h3>
    <p class="small">${[a.recipient, a.phone, a.line1, a.line2, a.city, a.region, a.country].filter(Boolean).map(esc).join('<br>')}</p>
    ${(o.shipments || []).map((s) => `<div class="alert alert-light small">Shipment: ${esc(s.carrier || '')} ${s.tracking_number ? `· tracking <code>${esc(s.tracking_number)}</code>` : ''} · ${esc(s.status)}</div>`).join('')}
    <div class="vstack gap-2 mt-3">
      ${canProcess ? '<button class="btn btn-outline-primary" data-act="processing">Mark as being prepared</button>' : ''}
      ${canShip ? `<div class="pf-card p-3"><h3 class="h6 fw-bold">Ship this order</h3>
         <input class="form-control form-control-sm mb-2" id="carrier" placeholder="Carrier (e.g. Campost, own courier)" aria-label="Carrier">
         <input class="form-control form-control-sm mb-2" id="tracking" placeholder="Tracking number (optional)" aria-label="Tracking number">
         <button class="btn btn-primary btn-sm" data-act="ship">Mark as shipped & notify customer</button></div>` : ''}
      ${o.status === 'shipped' ? '<button class="btn btn-success" data-act="delivered">Mark as delivered</button>' : ''}
      ${canCancel ? '<button class="btn btn-outline-danger" data-act="cancel">Cancel unpaid order (returns stock)</button>' : ''}
      ${['paid', 'partially_refunded'].includes(o.payment_status) ? '<a class="btn btn-light" href="payments.html">Refunds are made from Payments (admins)</a>' : ''}
    </div>`;
  $('detail-body').dataset.id = o.id;
  panel().show();
}

$('detail-body').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = $('detail-body').dataset.id;
  let res;
  if (b.dataset.act === 'processing') res = await supabase.rpc('update_order_status', { p_order: id, p_status: 'processing' });
  if (b.dataset.act === 'ship') {
    const carrier = $('carrier').value.trim();
    if (!carrier) { toast('Enter the carrier', 'error'); return; }
    res = await supabase.rpc('ship_order', { p_order: id, p_carrier: carrier, p_tracking: $('tracking').value.trim() || null });
  }
  if (b.dataset.act === 'delivered') {
    if (!confirmAction('Confirm the customer received this order?')) return;
    res = await supabase.rpc('mark_order_delivered', { p_order: id });
  }
  if (b.dataset.act === 'cancel') {
    if (!confirmAction('Cancel this unpaid order and return its items to stock?')) return;
    res = await supabase.rpc('release_order', { p_order: id, p_reason: 'cancelled by store' });
  }
  if (res?.error) { toast(errorText(res.error), 'error'); return; }
  toast('Order updated');
  load();
  open(id);
});

$('rows').addEventListener('click', (e) => { const b = e.target.closest('button[data-open]'); if (b) open(b.dataset.open); });
$('filters').addEventListener('submit', (e) => { e.preventDefault(); offset = 0; load(); });
$('prev').addEventListener('click', () => { offset = Math.max(0, offset - PAGE); load(); });
$('next').addEventListener('click', () => { offset += PAGE; load(); });

if (await initLayout('Orders', STORE)) {
  const s = new URLSearchParams(location.search).get('status');
  if (s) $('status').value = s;
  load();
}
