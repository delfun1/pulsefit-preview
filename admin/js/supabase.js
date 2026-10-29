// Single Supabase client for the admin site + the staff access guard.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Roles of the signed-in user, read from the database (never trusted from the browser). */
export async function myRoles() {
  const { data, error } = await supabase.rpc('my_roles');
  if (error) return [];
  return (data || []).map((r) => (typeof r === 'string' ? r : r.my_roles));
}

/**
 * Ensures a signed-in staff member with one of `allowed` roles is viewing the page.
 * This only controls what the page shows — the database independently rejects
 * every action a role is not allowed to do (RLS + server functions).
 */
export async function requireStaff(allowed = ['admin'], { skipMfa = false } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.replace(rootPath() + 'index.html');
    return null;
  }
  const roles = await myRoles();
  if (!roles.some((r) => allowed.includes(r))) {
    if (roles.includes('store_manager')) {   // a store manager opened an admin-only page
      location.replace(rootPath() + 'pages/products.html');
      return null;
    }
    await supabase.auth.signOut();
    location.replace(rootPath() + 'index.html?denied=1');
    return null;
  }
  if (!skipMfa && !(await mfaSatisfied(roles))) return null;
  return { ...session.user, roles };
}

/**
 * Two-factor sign-in gate.
 *  - Anyone who has set up an authenticator must enter a code before using
 *    the dashboard (redirect to the sign-in page's code step).
 *  - When the platform requires it for administrators, an admin without an
 *    authenticator is sent to the set-up page.
 * The database enforces the requirement independently (is_admin() needs an
 * aal2 session) — this only routes people to the right screen.
 */
async function mfaSatisfied(roles) {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel === 'aal2') return true;
  if (aal?.nextLevel === 'aal2') {
    location.replace(rootPath() + 'index.html?code=1');
    return false;
  }
  if (roles.includes('admin')) {
    const { data: status } = await supabase.rpc('my_security_status');
    if (status?.mfa_required) {
      location.replace(rootPath() + 'pages/security.html?setup=required');
      return false;
    }
  }
  return true;
}

/** The verified authenticator-app factor of the signed-in user, if any. */
export async function verifiedTotpFactor() {
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.totp || []).find((f) => f.status === 'verified') || null;
}

/** Back-compat helper for admin-only pages. */
export const requireAdmin = () => requireStaff(['admin']);

export function rootPath() {
  return location.pathname.includes('/pages/') ? '../' : './';
}

/** Public URL of a file in a public storage bucket. */
export function publicUrl(bucket, path) {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
