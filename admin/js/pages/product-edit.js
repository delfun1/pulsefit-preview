import { supabase, publicUrl } from '../supabase.js';
import { initLayout, STORE } from '../layout.js';
import { esc, toast, errorText, toMinor, fromMinor, confirmAction } from '../ui.js';
import { loadCategoryOptions } from './products.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let productId = params.get('id');
let currencies = ['XAF'];

const TEXT_FIELDS = ['name', 'slug', 'brand', 'model', 'description', 'dimensions_cm', 'resistance_type', 'power_requirements',
  'warranty', 'ingredients', 'warnings', 'supplier', 'shipping_info', 'documentation_url', 'status', 'condition'];
const NUM_FIELDS = ['weight_kg', 'max_user_weight_kg'];

function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

/** "size=M, color=Blue" ⇄ {size:"M", color:"Blue"} */
const attrsToText = (a) => Object.entries(a || {}).map(([k, v]) => `${k}=${v}`).join(', ');
function textToAttrs(t) {
  const out = {};
  t.split(',').map((x) => x.trim()).filter(Boolean).forEach((pair) => {
    const [k, ...rest] = pair.split('=');
    if (k && rest.length) out[k.trim()] = rest.join('=').trim();
  });
  return out;
}

function variantRow(v = {}) {
  const tr = document.createElement('tr');
  tr.dataset.id = v.id || '';
  const cur = v.currency || 'XAF';
  tr.innerHTML = `
    <td><input class="form-control form-control-sm" name="sku" value="${esc(v.sku || '')}" required maxlength="60" aria-label="SKU" style="min-width:110px"></td>
    <td><input class="form-control form-control-sm" name="attributes" value="${esc(attrsToText(v.attributes))}" placeholder="size=M" aria-label="Options" style="min-width:150px"></td>
    <td><input class="form-control form-control-sm" name="price" type="number" min="0" step="any" value="${v.price_minor != null ? fromMinor(v.price_minor, cur) : ''}" required style="width:110px" aria-label="Price"></td>
    <td><input class="form-control form-control-sm" name="compare" type="number" min="0" step="any" value="${v.compare_at_minor != null ? fromMinor(v.compare_at_minor, cur) : ''}" style="width:100px" aria-label="Previous price"></td>
    <td><select class="form-select form-select-sm" name="currency" aria-label="Currency" style="min-width:86px">${currencies.map((c) => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
    <td>${v.id ? `<span class="fw-semibold">${v.stock_qty}</span>` : '<input class="form-control form-control-sm" name="stock" type="number" min="0" step="1" value="0" style="width:80px" aria-label="Initial stock">'}</td>
    <td><input class="form-control form-control-sm" name="threshold" type="number" min="0" value="${v.low_stock_threshold ?? 5}" style="width:70px" aria-label="Low stock alert"></td>
    <td><input class="form-check-input" type="checkbox" name="active" ${v.is_active === false ? '' : 'checked'} aria-label="On sale"></td>
    <td>${v.id ? '' : '<button type="button" class="btn btn-link btn-sm text-danger p-0" data-remove aria-label="Remove row"><i class="bi bi-x-lg"></i></button>'}</td>`;
  return tr;
}

function specRow(k = '', v = '') {
  const div = document.createElement('div');
  div.className = 'd-flex gap-2';
  div.innerHTML = `<input class="form-control form-control-sm" name="spec-key" value="${esc(k)}" placeholder="e.g. monitor" aria-label="Specification name">
    <input class="form-control form-control-sm" name="spec-val" value="${esc(v)}" placeholder="e.g. LCD, 6 metrics" aria-label="Specification value">
    <button type="button" class="btn btn-link btn-sm text-danger" data-remove-spec aria-label="Remove"><i class="bi bi-x-lg"></i></button>`;
  return div;
}

async function loadImages() {
  if (!productId) return;
  const { data } = await supabase.from('product_images').select('*').eq('product_id', productId).order('position');
  $('images').innerHTML = (data || []).map((img, i) => `
    <div class="img-tile">
      <img src="${esc(publicUrl('product-images', img.storage_path))}" alt="${esc(img.alt_text || '')}">
      <div class="d-flex justify-content-between mt-1">
        <button type="button" class="btn btn-light btn-sm" data-move="${img.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move left"><i class="bi bi-arrow-left"></i></button>
        <button type="button" class="btn btn-light btn-sm text-danger" data-del-img="${img.id}" data-path="${esc(img.storage_path)}" aria-label="Delete photo"><i class="bi bi-trash"></i></button>
        <button type="button" class="btn btn-light btn-sm" data-move="${img.id}" data-dir="1" ${i === data.length - 1 ? 'disabled' : ''} aria-label="Move right"><i class="bi bi-arrow-right"></i></button>
      </div>
    </div>`).join('') || '<span class="small text-secondary">No photos yet.</span>';
  $('images').dataset.list = JSON.stringify(data || []);
}

async function load() {
  if (!productId) {
    $('variants').appendChild(variantRow());
    return;
  }
  const { data: p, error } = await supabase.from('products').select('*, product_variants(*)').eq('id', productId).single();
  if (error) {
    $('error').textContent = errorText(error);
    $('error').classList.remove('d-none');
    return;
  }
  TEXT_FIELDS.forEach((f) => { $(f).value = p[f] ?? ''; });
  NUM_FIELDS.forEach((f) => { $(f).value = p[f] ?? ''; });
  $('category_id').value = p.category_id;
  $('is_featured').checked = p.is_featured;
  $('is_equipment').checked = p.is_equipment;
  $('slug').dataset.touched = '1';
  (p.product_variants || []).sort((a, b) => a.price_minor - b.price_minor).forEach((v) => $('variants').appendChild(variantRow(v)));
  Object.entries(p.specifications || {}).forEach(([k, v]) => $('specs').appendChild(specRow(k, v)));
  $('photo').disabled = false;
  $('photo-hint').textContent = 'JPG, PNG or WebP, max 5 MB each. The first photo is the main one.';
  loadImages();
}

async function save(e) {
  e.preventDefault();
  const form = $('form');
  if (!form.checkValidity()) {
    form.classList.add('was-validated');
    toast('Please fill in the required fields', 'error');
    return;
  }
  const rows = [...$('variants').querySelectorAll('tr')];
  if (!rows.length) { toast('Add at least one variant with a price', 'error'); return; }
  if ($('status').value === 'active' && !rows.some((r) => r.querySelector('[name=active]').checked)) {
    toast('An active product needs at least one variant on sale', 'error');
    return;
  }
  const specs = {};
  $('specs').querySelectorAll('.d-flex').forEach((d) => {
    const k = d.querySelector('[name=spec-key]').value.trim();
    const v = d.querySelector('[name=spec-val]').value.trim();
    if (k && v) specs[k] = v;
  });
  const product = { specifications: specs, category_id: Number($('category_id').value),
    is_featured: $('is_featured').checked, is_equipment: $('is_equipment').checked };
  TEXT_FIELDS.forEach((f) => { product[f] = $(f).value.trim() || null; });
  NUM_FIELDS.forEach((f) => { product[f] = $(f).value === '' ? null : Number($(f).value); });
  product.status = product.status || 'draft';
  product.condition = product.condition || 'new';

  $('save').disabled = true;
  try {
    let error;
    if (productId) ({ error } = await supabase.from('products').update(product).eq('id', productId));
    else {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.from('products').insert({ ...product, created_by: session.user.id }).select('id').single();
      error = res.error;
      if (!error) productId = res.data.id;
    }
    if (error) throw error;

    for (const r of rows) {
      const cur = r.querySelector('[name=currency]').value;
      const v = {
        product_id: productId,
        sku: r.querySelector('[name=sku]').value.trim(),
        attributes: textToAttrs(r.querySelector('[name=attributes]').value),
        price_minor: toMinor(r.querySelector('[name=price]').value, cur),
        compare_at_minor: r.querySelector('[name=compare]').value === '' ? null : toMinor(r.querySelector('[name=compare]').value, cur),
        currency: cur,
        low_stock_threshold: Number(r.querySelector('[name=threshold]').value || 0),
        is_active: r.querySelector('[name=active]').checked,
      };
      if (r.dataset.id) {
        ({ error } = await supabase.from('product_variants').update(v).eq('id', r.dataset.id));
        if (error) throw error;
      } else {
        const res = await supabase.from('product_variants').insert({ ...v, stock_qty: 0 }).select('id').single();
        if (res.error) throw res.error;
        r.dataset.id = res.data.id;
        const initial = Number(r.querySelector('[name=stock]')?.value || 0);
        if (initial > 0) {   // initial stock goes through the logged stock function
          const adj = await supabase.rpc('adjust_stock', { p_variant: res.data.id, p_change: initial, p_reason: 'restock', p_note: 'Initial stock' });
          if (adj.error) throw adj.error;
        }
      }
    }
    toast('Product saved');
    if (!params.get('id')) location.replace(`product-edit.html?id=${productId}`);
    else location.reload();
  } catch (err) {
    toast(err.code === '23505' ? 'That URL name or SKU is already used by another product' : errorText(err), 'error');
  } finally {
    $('save').disabled = false;
  }
}

async function uploadPhotos() {
  const files = [...$('photo').files];
  const existing = JSON.parse($('images').dataset.list || '[]');
  let pos = existing.length;
  for (const f of files) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024) {
      toast(`${f.name}: use JPG/PNG/WebP under 5 MB`, 'error');
      continue;
    }
    const ext = f.type.split('/')[1].replace('jpeg', 'jpg');
    const path = `${productId}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('product-images').upload(path, f, { contentType: f.type, upsert: false });
    if (up.error) { toast(errorText(up.error), 'error'); continue; }
    const ins = await supabase.from('product_images').insert({ product_id: productId, storage_path: path, alt_text: $('name').value, position: pos++ });
    if (ins.error) toast(errorText(ins.error), 'error');
  }
  $('photo').value = '';
  loadImages();
}

async function imageAction(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const list = JSON.parse($('images').dataset.list || '[]');
  if (b.dataset.delImg && confirmAction('Delete this photo?')) {
    await supabase.storage.from('product-images').remove([b.dataset.path]);
    await supabase.from('product_images').delete().eq('id', b.dataset.delImg);
    loadImages();
  }
  if (b.dataset.move) {
    const i = list.findIndex((x) => x.id === b.dataset.move);
    const j = i + Number(b.dataset.dir);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((img, idx) => supabase.from('product_images').update({ position: idx }).eq('id', img.id)));
    loadImages();
  }
}

if (await initLayout('Products', STORE)) {
  const { data: cur } = await supabase.from('supported_currencies').select('code').eq('is_active', true);
  currencies = (cur || []).map((c) => c.code);
  if (!currencies.length) currencies = ['XAF'];
  await loadCategoryOptions($('category_id'));
  $('name').addEventListener('input', () => { if (!$('slug').dataset.touched) $('slug').value = slugify($('name').value); });
  $('slug').addEventListener('input', () => { $('slug').dataset.touched = '1'; });
  $('add-variant').addEventListener('click', () => $('variants').appendChild(variantRow()));
  $('variants').addEventListener('click', (e) => { if (e.target.closest('[data-remove]')) e.target.closest('tr').remove(); });
  $('add-spec').addEventListener('click', () => $('specs').appendChild(specRow()));
  $('specs').addEventListener('click', (e) => { if (e.target.closest('[data-remove-spec]')) e.target.closest('.d-flex').remove(); });
  $('form').addEventListener('submit', save);
  $('photo').addEventListener('change', uploadPhotos);
  $('images').addEventListener('click', imageAction);
  document.querySelector('h1').textContent = productId ? 'Edit product' : 'New product';
  load();
}
