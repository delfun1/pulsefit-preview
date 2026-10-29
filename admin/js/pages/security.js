// Two-factor sign-in (authenticator app, TOTP) for staff, and the
// organisation-wide "require it for administrators" switch.
import { supabase, verifiedTotpFactor } from '../supabase.js';
import { initLayout, STORE } from '../layout.js';
import { esc, errorText } from '../ui.js';

const $ = (id) => document.getElementById(id);
let pending = null; // factor being set up (declared before the first render)


function message(id, text) {
  for (const k of ['error', 'ok']) $(k).classList.add('d-none');
  if (text) { $(id).textContent = text; $(id).classList.remove('d-none'); }
}

async function render() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return message('error', errorText(error));
  const verified = (data?.totp || []).filter((f) => f.status === 'verified');
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  $('status').innerHTML = verified.length
    ? `<span class="badge text-bg-success"><i class="bi bi-shield-check"></i> On</span>
       ${aal?.currentLevel === 'aal2' ? '<span class="text-secondary small ms-2">This session was confirmed with a code.</span>'
                                     : '<span class="text-secondary small ms-2">Sign out and back in to confirm this session with a code.</span>'}`
    : '<span class="badge text-bg-secondary">Off</span>';
  $('start').classList.toggle('d-none', verified.length > 0 || pending !== null);
  $('factors').classList.toggle('d-none', verified.length === 0);
  $('factor-rows').innerHTML = verified.map((f) => `<tr>
      <td>${esc(f.friendly_name || 'Authenticator app')}</td>
      <td class="small text-secondary">${esc(new Date(f.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }))}</td>
      <td class="text-end"><button class="btn btn-outline-danger btn-sm" data-remove="${esc(f.id)}">Remove</button></td></tr>`).join('');
}

$('start').addEventListener('click', async () => {
  message();
  // Old unfinished set-ups would block a new one: remove them first.
  const { data } = await supabase.auth.mfa.listFactors();
  for (const f of (data?.all || []).filter((x) => x.factor_type === 'totp' && x.status !== 'verified')) {
    await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data: enrolled, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
  });
  if (error) return message('error', errorText(error));
  pending = enrolled.id;
  $('qr').src = enrolled.totp.qr_code;
  $('secret').textContent = enrolled.totp.secret;
  $('enrol').classList.remove('d-none');
  $('start').classList.add('d-none');
  $('enrol-code').value = '';
  $('enrol-code').focus();
});

$('enrol-verify').addEventListener('click', async () => {
  const code = $('enrol-code').value.replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return message('error', 'Enter the 6 digits shown in your authenticator app.');
  $('enrol-verify').disabled = true;
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: pending, code });
  $('enrol-verify').disabled = false;
  if (error) return message('error', /invalid|expired/i.test(error.message || '') ? 'That code is not correct. Check the time on your phone and try the current code.' : errorText(error));
  pending = null;
  $('enrol').classList.add('d-none');
  message('ok', 'Two-factor sign-in is on. From now on you will enter a code after your password.');
  await render();
  if (new URLSearchParams(location.search).get('setup') === 'required') {
    setTimeout(() => location.replace('dashboard.html'), 1500);
  }
});

$('enrol-cancel').addEventListener('click', async () => {
  if (pending) await supabase.auth.mfa.unenroll({ factorId: pending });
  pending = null;
  $('enrol').classList.add('d-none');
  await render();
});

$('factor-rows').addEventListener('click', async (e) => {
  const id = e.target.closest('[data-remove]')?.dataset.remove;
  if (!id) return;
  // Built-in confirmation step (no browser dialogs).
  const btn = e.target.closest('button');
  if (btn.dataset.confirm !== '1') {
    btn.dataset.confirm = '1';
    btn.textContent = 'Click again to remove';
    return;
  }
  const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
  if (error) {
    return message('error', /aal2|assurance/i.test(error.message || '')
      ? 'Sign in with your code first, then you can remove the authenticator.' : errorText(error));
  }
  message('ok', 'Authenticator removed. Two-factor sign-in is off for your account.');
  await render();
});

async function renderOrg() {
  const { data, error } = await supabase.from('platform_settings').select('value').eq('key', 'security.admin_mfa_required').maybeSingle();
  if (error || !data) return;   // not visible without an admin session
  $('org').classList.remove('d-none');
  $('require-mfa').checked = data.value === true;
}

$('require-mfa').addEventListener('change', async (e) => {
  const on = e.target.checked;
  const { data, error } = await supabase.from('platform_settings')
    .update({ value: on }).eq('key', 'security.admin_mfa_required').select('value');
  if (error || !data?.length) {
    e.target.checked = !on;
    return message('error', error ? errorText(error) : 'Sign in with your code first to change this.');
  }
  message('ok', on ? 'Every administrator now needs a code to use the dashboard.' : 'Two-factor sign-in is now optional for administrators.');
});

// Start last, so every button already has its handler when the page is drawn.
// This page must stay reachable before two-factor is set up, so skip the gate.
const user = await initLayout('Two-factor sign-in', STORE, { skipMfa: true });
if (user) {
  if (new URLSearchParams(location.search).get('setup') === 'required') $('required').classList.remove('d-none');
  await render();
  if (user.roles.includes('admin')) await renderOrg();
}
