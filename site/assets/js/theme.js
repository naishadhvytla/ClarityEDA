/* Runs before first paint: applies the saved theme and decides whether the
   landing page can be shown straight away (no stored session + landing route). */
(function () {
  var root = document.documentElement;
  try {
    var t = localStorage.getItem('clarity-theme');
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
  } catch (_) { /* storage blocked */ }
  try {
    var h = location.hash, signedIn = false;
    for (var i = 0; i < localStorage.length; i++) { if (/^sb-.*-auth-token$/.test(localStorage.key(i))) { signedIn = true; break; } }
    if ((!h || h === '#' || h === '#/') && !signedIn) root.classList.add('pre-landing');
  } catch (_) { if (!location.hash || location.hash === '#/') root.classList.add('pre-landing'); }
})();
