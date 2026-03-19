function showBanner(msg, type = 'error') {
  const el = document.getElementById('banner');
  el.textContent  = msg;
  el.className    = `banner ${type}`;
  el.style.display = 'flex';
}

function hideBanner() {
  document.getElementById('banner').style.display = 'none';
}

function setLoading(formType, loading) {
  const btn     = document.getElementById(`btn-${formType}`);
  const text    = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  btn.disabled          = loading;
  text.style.display    = loading ? 'none' : '';
  spinner.style.display = loading ? 'inline-block' : 'none';
}

function showTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('tab-login').classList.toggle('active',  isLogin);
  document.getElementById('tab-signup').classList.toggle('active', !isLogin);
  document.getElementById('form-login').style.display  = isLogin  ? '' : 'none';
  document.getElementById('form-signup').style.display = !isLogin ? '' : 'none';
  hideBanner();
}

async function handleLogin(e) {
  e.preventDefault();
  hideBanner();
  setLoading('login', true);

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showBanner(data.error || 'Login failed. Please try again.');
      setLoading('login', false);
      return;
    }

    showBanner('Signed in! Redirecting...', 'success');
    setTimeout(() => window.location.href = '/dashboard', 600);

  } catch (err) {
    showBanner('Network error. Is the server running?');
    setLoading('login', false);
  }
}

async function handleSignup(e) {
  e.preventDefault();
  hideBanner();
  setLoading('signup', true);

  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;

  if (!name) {
    showBanner('Please enter your display name.');
    setLoading('signup', false);
    return;
  }

  if (password.length < 6) {
    showBanner('Password must be at least 6 characters.');
    setLoading('signup', false);
    return;
  }

  try {
    const res  = await fetch('/api/auth/signup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showBanner(data.error || 'Signup failed. Please try again.');
      setLoading('signup', false);
      return;
    }

    showBanner(`Welcome, ${data.user.name}! Redirecting...`, 'success');
    setTimeout(() => window.location.href = '/dashboard', 700);

  } catch (err) {
    showBanner('Network error. Is the server running?');
    setLoading('signup', false);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('error') === 'google')
    showBanner('Google sign-in failed. Please try again or use email/password.');
  if (params.get('signup') === '1')
    showTab('signup');
});
