import { supabase, publicUrl } from '../supabase.js';
import { initLayout, STORE } from '../layout.js';
import { esc, money, errorText, statusBadge } from '../ui.js';

const PAGE = 25;
let offset = 0;
const $ = (id) => document.getElementById(id);

export async function loadCategoryOptions(select, withAll = false) {
  const { data } = await supabase.from('product_categories').select('id, slug, name_en, parent_id').order('sort_order');
  const parents = (data || []).filter((c) => !c.parent_id);
  const html = parents.map((p) => {
    const kids = data.filter((c) => c.parent_id === p.id);
    return `<optgroup label="${esc(p.name_en)}"><option value="${p.id}" data-slug="${esc(p.slug)}">${esc(p.name_en)} (general)</option>
      ${kids.map((k) => `<option value="${k.id}" data-slug="${esc(k.slug)}">${esc(k.name_en)}</option>`).join('')}</optgroup>`;
  }).join('');
  select.insertAdjacentHTML('beforeend', html);
  if (withAll) return data;
  return data;
}

async function load() {
  const rows = $('rows');
  rows.innerHTML = '<tr><td colspan="7" class="text-center py-4"><div class="spinner-border spinner-border-sm" role="status"></div></td></tr>';
  let q = supabase.from('products')
    .select('id, slug, name, brand, status, is_equipment, category:product_categories(name_en), product_variants(price_minor, currency, stock_qty, low_stock_threshold, is_active), product_images(storage_path, position)', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(offset, offset + PAGE - 1);
  const term = $('q').value.trim().replace(/[%,()]/g, '');
  if (term) q = q.or(`name.ilike.%${term}%,brand.ilike.%${term}%,slug.ilike.%${term}%`);
  if ($('status').value) q = q.eq('status', $('status').value);
  if ($('category').value) q = q.eq('category_id', $('category').value);
  const { data, count, error } = await q;
  if (error) {
    $('error').textContent = errorText(error);
    $('error').classList.remove('d-none');
    rows.innerHTML = '';
    return;
  }
  $('error').classList.add('d-none');
  $('count').textContent = count ? `${offset + 1}–${Math.min(offset + PAGE, count)} of ${count}` : 'No products';
  $('prev').disabled = offset === 0;
  $('next').disabled = offset + PAGE >= (count ?? 0);
  rows.innerHTML = data.map((p) => {
    const vs = (p.product_variants || []).filter((v) => v.is_active);
    const prices = vs.map((v) => v.price_minor);
    const cur = vs[0]?.currency || 'XAF';
    const stock = vs.reduce((s, v) => s + v.stock_qty, 0);
    const low = vs.some((v) => v.stock_qty <= v.low_stock_threshold);
    const img = (p.product_images || []).sort((a, b) => a.position - b.position)[0];
    const price = prices.length ? (Math.min(...prices) === Math.max(...prices) ? money(prices[0], cur)
      : `${money(Math.min(...prices), cur)} – ${money(Math.max(...prices), cur)}`) : '<span class="text-danger">no price</span>';
    return `<tr>
      <td>${img ? `<img class="thumb" src="${esc(publicUrl('product-images', img.storage_path))}" alt="">` : `<div class="thumb d-grid place-items-center text-primary"><i class="bi bi-${p.is_equipment ? 'bicycle' : 'bag'}"></i></div>`}</td>
      <td><a href="product-edit.html?id=${esc(p.id)}" class="fw-semibold text-decoration-none">${esc(p.name)}</a><div class="small text-secondary">${esc(p.brand || '')}</div></td>
      <td class="small">${esc(p.category?.name_en || '')}${p.is_equipment ? ' <span class="badge text-bg-light border">equipment</span>' : ''}</td>
      <td class="text-end small text-nowrap">${price}</td>
      <td class="text-end ${low ? 'text-danger fw-bold' : ''}">${stock}${low ? ' <i class="bi bi-exclamation-triangle" title="Low stock"></i>' : ''}</td>
      <td>${statusBadge(p.status)}</td>
      <td class="text-end"><a class="btn btn-outline-primary btn-sm" href="product-edit.html?id=${esc(p.id)}">Edit</a></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="text-center text-secondary py-4">No products yet. Click “New product”.</td></tr>';
}

if (location.pathname.endsWith('/products.html') && await initLayout('Products', STORE)) {
  await loadCategoryOptions($('category'));
  $('filters').addEventListener('submit', (e) => { e.preventDefault(); offset = 0; load(); });
  $('prev').addEventListener('click', () => { offset = Math.max(0, offset - PAGE); load(); });
  $('next').addEventListener('click', () => { offset += PAGE; load(); });
  load();
}
