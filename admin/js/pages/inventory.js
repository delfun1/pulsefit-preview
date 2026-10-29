import { supabase } from '../supabase.js';
import { initLayout, STORE } from '../layout.js';
import { esc, dateTime, toast, errorText } from '../ui.js';

const $ = (id) => document.getElementById(id);
let current = null;
const modal = () => bootstrap.Modal.getOrCreateInstance($('adjust-modal'));
const REASONS = { order_reserved: 'Order', order_released: 'Order cancelled / expired', restock: 'Restock', return: 'Return', adjustment: 'Correction', damaged: 'Damaged / lost' };

async function load() {
  const { data, error } = await supabase.from('product_variants')
    .select('id, sku, attributes, stock_qty, low_stock_threshold, is_active, product:products!inner(name, status)')
    .order('stock_qty', { ascending: true })
    .limit(200);
  if (error) {
    $('error').textContent = errorText(error);
    $('error').classList.remove('d-none');
    return;
  }
  const term = $('q').value.trim().toLowerCase();
  const rows = data.filter((v) => (!term || v.sku.toLowerCase().includes(term) || v.product.name.toLowerCase().includes(term))
    && (!$('low').checked || v.stock_qty <= v.low_stock_threshold));
  $('rows').innerHTML = rows.map((v) => {
    const low = v.stock_qty <= v.low_stock_threshold;
    const opts = Object.values(v.attributes || {}).join(' / ');
    return `<tr class="${v.product.status !== 'active' || !v.is_active ? 'opacity-50' : ''}">
      <td><button class="btn btn-link p-0 text-start" data-history="${esc(v.id)}" data-label="${esc(v.product.name)} ${esc(opts)}">${esc(v.product.name)}</button>
        <div class="small text-secondary">${esc(opts)}</div></td>
      <td><code class="small">${esc(v.sku)}</code></td>
      <td class="text-end fw-bold ${low ? 'text-danger' : ''}">${v.stock_qty}</td>
      <td class="text-end text-secondary">${v.low_stock_threshold}</td>
      <td class="text-end"><button class="btn btn-outline-primary btn-sm" data-adjust="${esc(v.id)}" data-sku="${esc(v.sku)}" data-stock="${v.stock_qty}">Adjust</button></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="text-center text-secondary py-4">Nothing to show.</td></tr>';
}

async function history(id, label) {
  $('hist-title').textContent = `Stock history — ${label}`;
  $('hist-hint').textContent = 'Most recent first.';
  const { data } = await supabase.from('inventory_movements')
    .select('change_qty, reason, note, created_at, order:orders(order_number)')
    .eq('variant_id', id).order('created_at', { ascending: false }).limit(50);
  $('history').innerHTML = (data || []).map((m) => `<li class="list-group-item d-flex gap-2">
      <span class="fw-bold ${m.change_qty > 0 ? 'text-success' : 'text-danger'}" style="width:48px">${m.change_qty > 0 ? '+' : ''}${m.change_qty}</span>
      <span class="flex-grow-1">${esc(REASONS[m.reason] || m.reason)} ${m.order ? `<code>${esc(m.order.order_number)}</code>` : ''}
        ${m.note ? `<div class="text-secondary">${esc(m.note)}</div>` : ''}</span>
      <span class="text-secondary text-nowrap">${dateTime(m.created_at)}</span></li>`).join('') || '<li class="list-group-item text-secondary">No changes yet.</li>';
}

$('rows').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.history) history(b.dataset.history, b.dataset.label);
  if (b.dataset.adjust) {
    current = { id: b.dataset.adjust, stock: Number(b.dataset.stock) };
    $('adjust-info').textContent = `${b.dataset.sku}: currently ${b.dataset.stock} in stock.`;
    $('adj-change').value = '';
    $('adj-note').value = '';
    modal().show();
  }
});

$('adjust-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const change = Number($('adj-change').value);
  if (!Number.isInteger(change) || change === 0) { toast('Enter a whole number other than 0', 'error'); return; }
  if (current.stock + change < 0) { toast(`Stock cannot go below zero (currently ${current.stock})`, 'error'); return; }
  const { data, error } = await supabase.rpc('adjust_stock', {
    p_variant: current.id, p_change: change, p_reason: $('adj-reason').value, p_note: $('adj-note').value.trim() || null,
  });
  if (error) { toast(errorText(error), 'error'); return; }
  modal().hide();
  toast(`Stock is now ${data}`);
  load();
  history(current.id, $('adjust-info').textContent.split(':')[0]);
});

$('filters').addEventListener('submit', (e) => { e.preventDefault(); load(); });
$('low').addEventListener('change', load);
if (await initLayout('Inventory', STORE)) {
  if (new URLSearchParams(location.search).has('low')) $('low').checked = true;
  load();
}
