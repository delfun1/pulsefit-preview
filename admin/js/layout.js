// Renders the shared sidebar + top bar. Links are filtered by the user's roles.
import { supabase, requireStaff, rootPath } from './supabase.js';
import { esc } from './ui.js';
import { BRAND_NAME } from './config.js';

const ADMIN = ['admin'];
const STORE = ['admin', 'store_manager'];

const NAV = [
  { section: 'Platform' },
  { href: 'pages/dashboard.html', icon: 'speedometer2', label: 'Dashboard', roles: ADMIN },
  { href: 'pages/users.html', icon: 'people', label: 'Users', roles: ADMIN },
  { href: 'pages/coaches.html', icon: 'person-badge', label: 'Coaches', roles: ADMIN },
  { href: 'pages/appointments.html', icon: 'calendar-week', label: 'Appointments', roles: ADMIN },
  { href: 'pages/subscriptions.html', icon: 'arrow-repeat', label: 'Subscriptions', roles: ADMIN },
  { section: 'Finance' },
  { href: 'pages/finance.html', icon: 'cash-stack', label: 'Financial reports', roles: ADMIN },
  { href: 'pages/payments.html', icon: 'credit-card', label: 'Payments', roles: ADMIN },
  { href: 'pages/plans.html', icon: 'stars', label: 'Subscription plans', roles: ADMIN },
  { section: 'Store' },
  { href: 'pages/products.html', icon: 'box-seam', label: 'Products', roles: STORE },
  { href: 'pages/inventory.html', icon: 'clipboard-data', label: 'Inventory', roles: STORE },
  { href: 'pages/orders.html', icon: 'truck', label: 'Orders', roles: STORE },
  { href: 'pages/sales.html', icon: 'graph-up-arrow', label: 'Sales report', roles: STORE },
  { href: 'pages/store-settings.html', icon: 'gear', label: 'Coupons & delivery', roles: STORE },
  { section: 'Communication' },
  { href: 'pages/notifications.html', icon: 'bell', label: 'Notifications', roles: ADMIN },
  { href: 'pages/moderation.html', icon: 'flag', label: 'Moderation', roles: ADMIN },
  { section: 'Settings & security' },
  { href: 'pages/settings.html', icon: 'sliders', label: 'Platform settings', roles: ADMIN },
  { href: 'pages/audit.html', icon: 'journal-text', label: 'Audit log', roles: ADMIN },
  { href: 'pages/security.html', icon: 'shield-lock', label: 'Two-factor sign-in', roles: STORE },
];

/**
 * @param activeLabel  page title (must match a NAV label)
 * @param allowed      roles allowed on this page (default: admin only)
 */
export async function initLayout(activeLabel, allowed = ADMIN, options = {}) {
  const user = await requireStaff(allowed, options);
  if (!user) return null;
  const root = rootPath();
  const visible = NAV.filter((n) => !n.roles || n.roles.some((r) => user.roles.includes(r)));
  const links = visible
    .filter((n, i) => !(n.section && (!visible[i + 1] || visible[i + 1].section)))   // hide empty sections
    .map((n) => n.section
      ? `<div class="nav-section">${esc(n.section)}</div>`
      : `<a class="nav-link ${n.label === activeLabel ? 'active' : ''}" href="${root}${n.href}" ${n.label === activeLabel ? 'aria-current="page"' : ''}>
           <i class="bi bi-${n.icon}" aria-hidden="true"></i><span>${n.label}</span></a>`).join('');

  const home = user.roles.includes('admin') ? 'pages/dashboard.html' : 'pages/products.html';
  document.getElementById('sidebar').innerHTML = `
    <a class="brand" href="${root}${home}">
      <span class="brand-mark" aria-hidden="true"><i class="bi bi-activity"></i></span>
      <span>${esc(BRAND_NAME.slice(0, 5))}<b>${esc(BRAND_NAME.slice(5))}</b></span>
    </a>
    <nav class="nav flex-column" aria-label="Main">${links}</nav>`;

  document.getElementById('topbar').innerHTML = `
    <button class="btn btn-light d-lg-none" id="menu-toggle" aria-label="Open menu"><i class="bi bi-list"></i></button>
    <h1 class="h4 mb-0">${esc(activeLabel)}</h1>
    <div class="ms-auto d-flex align-items-center gap-3">
      <span class="text-secondary small d-none d-md-inline">${esc(user.email)}${user.roles.includes('admin') ? '' : ' · store manager'}</span>
      <button class="btn btn-outline-secondary btn-sm" id="sign-out"><i class="bi bi-box-arrow-right"></i> Sign out</button>
    </div>`;

  document.getElementById('sign-out').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.replace(root + 'index.html');
  });
  document.getElementById('menu-toggle')?.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
  return user;
}

export { ADMIN, STORE };
