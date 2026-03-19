(async function () {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return;
    const user = await res.json();

    const input = document.getElementById('display-name');
    if (input && user.name) input.value = user.name;

    const footer = document.querySelector('.landing-footer');
    if (footer) {
      const a = document.createElement('a');
      a.href = '/dashboard';
      a.style.cssText = 'display:block;margin-top:10px;font-size:11px;font-family:var(--mono);color:var(--ink-2);text-decoration:none;';
      a.textContent   = '← Back to dashboard';
      footer.appendChild(a);
    }
  } catch (_) {}
})();
