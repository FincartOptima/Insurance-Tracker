/* The opening screen follows actual data readiness, with a bounded fallback. */
(() => {
  const screen = document.getElementById('loading-screen');
  const shell = document.getElementById('app-shell');
  const status = document.getElementById('loading-status');
  const continueButton = document.getElementById('loading-continue');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let complete = false;
  let slowTimer, fallbackTimer;
  const finish = () => {
    if (complete) return;
    complete = true;
    clearTimeout(slowTimer);
    clearTimeout(fallbackTimer);
    screen.classList.add('is-ready');
    setTimeout(() => {
      const restoreFocus = screen.contains(document.activeElement);
      screen.hidden = true;
      shell.inert = false;
      document.body.classList.remove('is-loading');
      if (restoreFocus) document.getElementById('main').focus();
    }, reducedMotion ? 0 : 240);
  };
  window.FincartLoader = { finish };
  document.getElementById('workspace-date').textContent = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric'
  }).format(new Date()) + ' · IST';
  screen.hidden = false;
  shell.inert = true;
  document.body.classList.add('is-loading');
  continueButton.addEventListener('click', finish);
  if (document.body.dataset.awaitData === 'true') {
    status.textContent = 'Loading your renewal data…';
    slowTimer = setTimeout(() => {
      status.textContent = 'This is taking a little longer. You can continue while your data loads.';
      continueButton.hidden = false;
    }, 6000);
    fallbackTimer = setTimeout(finish, 12000);
  } else {
    finish();
  }
  window.addEventListener('pageshow', (event) => { if (event.persisted) finish(); });
})();
