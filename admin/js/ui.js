// Small UI helpers shared by all admin pages.

/** Escape text before inserting into HTML (prevents XSS from user-entered data). */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const MINOR_UNITS = { XAF: 0, XOF: 0, NGN: 2, USD: 2, EUR: 2 };

/** Amounts are integers in minor units; never mix currencies in one total. */
export function money(minor, currency) {
  const digits = MINOR_UNITS[currency] ?? 2;
  const value = Number(minor ?? 0) / 10 ** digits;
  if (currency === 'XAF' || currency === 'XOF') {
    return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${currency === 'XAF' ? 'FCFA' : 'CFA'}`;
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits }).format(value);
}

export function dateTime(iso) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '–';
}

export function toast(message, type = 'success') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type === 'error' ? 'danger' : 'success'} border-0`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="d-flex"><div class="toast-body">${esc(message)}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
  host.appendChild(el);
  new bootstrap.Toast(el, { delay: 4000 }).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

/** Turn a Supabase error into a readable sentence. */
export function errorText(error) {
  return error?.message || 'Something went wrong. Please try again.';
}

/** Ask for confirmation before destructive operations. */
export function confirmAction(message) {
  return window.confirm(message);
}

export function statusBadge(status) {
  const map = {
    pending: 'warning', requested: 'warning', approved: 'success', active: 'success', confirmed: 'success',
    succeeded: 'success', paid: 'success', rejected: 'danger', suspended: 'danger', failed: 'danger',
    cancelled: 'secondary', expired: 'secondary', refunded: 'info', disputed: 'danger',
  };
  return `<span class="badge rounded-pill text-bg-${map[status] ?? 'secondary'}">${esc(status)}</span>`;
}

/** Major units typed by an admin (e.g. 12.50 USD) → integer minor units for the database. */
export function toMinor(value, currency) {
  const digits = MINOR_UNITS[currency] ?? 2;
  return Math.round(Number(value) * 10 ** digits);
}

export function fromMinor(minor, currency) {
  const digits = MINOR_UNITS[currency] ?? 2;
  return Number(minor) / 10 ** digits;
}

/** Reads the readable error returned by an Edge Function. */
export async function functionError(error) {
  try {
    const body = await error?.context?.json();
    if (body?.error) return body.error;
  } catch { /* ignore */ }
  return errorText(error);
}

/**
 * CSV cell: numbers stay numbers; text that a spreadsheet could treat as a
 * formula (= + - @ tab CR) gets a leading apostrophe (CSV-injection guard).
 */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(c.value ? c.value(r) : r[c.key])).join(','));
  return [head, ...body].join('\r\n');
}

/**
 * Downloads rows as a CSV file that opens correctly in Excel (UTF-8 BOM).
 * The export is first recorded in the audit log by the server; if that is
 * refused, nothing is downloaded.
 */
export async function exportCsv(supabaseClient, kind, filename, columns, rows, filters = {}) {
  const { error } = await supabaseClient.rpc('admin_log_export', { p_kind: kind, p_rows: rows.length, p_filters: filters });
  if (error) {
    toast(errorText(error), 'error');
    return false;
  }
  const blob = new Blob(['﻿' + toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(`Exported ${rows.length} rows`);
  return true;
}

/** yyyy-mm-dd in the browser's local time (for date inputs). */
export function localDate(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

/** Start of a local day as an ISO timestamp (date input value → query bound). */
export function dayStartIso(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}
