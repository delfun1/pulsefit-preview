import { supabase, myRoles, verifiedTotpFactor } from '../supabase.js';
import { errorText } from '../ui.js';

const form = document.getElementById('login-form');
const codeForm = document.getElementById('code-form');
const alertBox = document.getElementById('alert');
const submit = document.getElementById('submit');
const codeSubmit = document.getElementById('code-submit');
const codeInput = document.getElementById('code');

function show(message, type = 'danger') {
  alertBox.className = `alert alert-${type}`;
  alertBox.textContent = message;
}
function hideAlert() { alertBox.className = 'alert d-none'; }

if (new URLSearchParams(location.search).has('denied')) {
  show('This account does not have administrator access.');
}

// Staff land on their home page: admins → dashboard, store managers → products.
async function goHome() {
  const roles = await myRoles();
  if (roles.includes('admin')) { location.replace('pages/dashboard.html'); return true; }
  if (roles.includes('store_manager')) { location.replace('pages/products.html'); return true; }
  return false;
}

/** After the password: ask for the authenticator code if this account uses two-factor sign-in. */
async function continueAfterPassword() {
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === 'aal2' && aal?.currentLevel !== 'aal2') {
    form.classList.add('d-none');
    codeForm.classList.remove('d-none');
    codeInput.value = '';
    codeInput.focus();
    return true;
  }
  return goHome();
}

const { data: { session } } = await supabase.auth.getSession();
if (session) await continueAfterPassword();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!form.checkValidity()) {
    form.classList.add('was-validated');
    return;
  }
  hideAlert();
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  const { error } = await supabase.auth.signInWithPassword({
    email: document.getElementById('email').value.trim(),
    password: document.getElementById('password').value,
  });
  if (error) {
    show(errorText(error));
  } else {
    const roles = await myRoles();
    if (roles.includes('admin') || roles.includes('store_manager')) {
      if (await continueAfterPassword()) {
        submit.disabled = false;
        submit.textContent = 'Sign in';
        return;
      }
    }
    await supabase.auth.signOut();
    show('This account does not have staff access.');
  }
  submit.disabled = false;
  submit.textContent = 'Sign in';
});

codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = codeInput.value.replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) {
    show('Enter the 6 digits shown in your authenticator app.');
    return;
  }
  hideAlert();
  codeSubmit.disabled = true;
  codeSubmit.textContent = 'Checking…';
  const factor = await verifiedTotpFactor();
  const { error } = factor
    ? await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
    : { error: { message: 'No authenticator is set up for this account.' } };
  codeSubmit.disabled = false;
  codeSubmit.textContent = 'Verify';
  if (error) {
    show(/invalid|expired/i.test(error.message || '') ? 'That code is not correct or has expired. Try the current code.' : errorText(error));
    codeInput.select();
    return;
  }
  await goHome();
});

document.getElementById('other-account').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.replace('index.html');
});
