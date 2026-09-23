(function () {
  var tl = gsap.timeline({ paused: true });
  var S = T.S;
  var E = 'power3.out';
  function rise(sel, at, dy, d) { tl.fromTo(sel, { opacity: 0, y: dy == null ? 28 : dy }, { opacity: 1, y: 0, duration: d || 0.7, ease: E }, at); }
  function fade(sel, at, d) { tl.fromTo(sel, { opacity: 0 }, { opacity: 1, duration: d || 0.5, ease: 'power1.out' }, at); }
  function fadeOut(sel, at, d) { tl.to(sel, { opacity: 0, duration: d || 0.4, ease: 'power1.in' }, at); }

  // ---- scene dissolves (inner wrappers; the framework owns clip visibility) ----
  for (var i = 1; i <= 11; i++) {
    var inner = '#s' + i + '-in';
    tl.fromTo(inner, { opacity: 0 }, { opacity: 1, duration: i === 1 ? 0.5 : 0.6, ease: 'power1.out' }, S[i - 1]);
    if (i < 11) tl.to(inner, { opacity: 0, duration: 0.45, ease: 'power1.in' }, S[i]);
  }

  // ---- audio-reactive ambient glow (music RMS + bass, 15fps) ----
  gsap.set('#glow', { transformOrigin: '50% 40%' });
  for (var f = 0; f < REACT.length; f++) {
    tl.set('#glow', { opacity: 0.5 + 0.5 * REACT[f][0], scale: 1 + 0.06 * REACT[f][1] }, f / 15);
  }

  // ---- 1 · hook ----
  rise('#s1-eb', 0.15, 18, 0.6);
  var counter = { v: 0 };
  var cEl = document.getElementById('s1-count');
  tl.fromTo(counter, { v: 0 }, { v: 107836, duration: 1.95, ease: 'power2.out', onUpdate: function () { cEl.textContent = Math.round(counter.v).toLocaleString('en-US'); } }, 0.25);
  fade('#s1-rows', 0.4, 0.6);
  rise('#s1-sub', T.s1Sub, 20);
  tl.fromTo('#s1-cities .pill', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: E, stagger: 0.09 }, T.s1Cities);
  tl.to('#s1-rows', { color: '#0b7380', duration: 0.4 }, T.s1Rows);
  rise('#s1-q', T.s1Q, 24, 0.8);

  // ---- 2 · rows, not answers ----
  tl.fromTo('#s2-sheet', { y: 0 }, { y: -300, duration: S[2] - S[1] + T.XF, ease: 'none' }, S[1]);
  rise('#s2-card', S[1] + 0.15, 30);
  rise('#s2-not', T.s2Not, 16, 0.6);

  // ---- 3 · reveal ----
  // beat-locked: logo lands on a strong cue of the vol-12 bed (see T.s3Logo)
  tl.fromTo('#s3-mark', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'back.out(1.6)' }, T.s3LogoT);
  tl.fromTo('#s3-word', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.8, ease: E }, T.s3LogoT + 0.15);
  rise('#s3-tag', T.s3Tag, 20);
  tl.to('#s3-top', { y: -300, duration: 1.1, ease: 'power3.inOut' }, T.s3Shot - 0.4);
  tl.fromTo('#s3-shot', { opacity: 0, y: 420 }, { opacity: 1, y: 0, duration: 1.3, ease: E }, T.s3Shot - 0.3);

  // ---- 4 · upload ----
  rise('#s4-frame', S[3] + 0.05, 24, 0.8);
  fade('#s4-dz', T.s4Chip - 0.1, 0.3);
  tl.fromTo('#s4-chip', { opacity: 0, y: -170 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.in' }, T.s4Chip - 0.35);
  tl.fromTo('#s4-card', { opacity: 0, x: 60 }, { opacity: 1, x: 0, duration: 0.7, ease: E }, T.s4Card);
  fade('#s4-local', T.s4Local, 0.5);
  for (var k = 0; k < 4; k++) {
    var act = k === 0 ? T.s4Card + 0.2 : T.s4Steps[k - 1];
    tl.to('#s4-st' + k, { color: '#121417', duration: 0.25 }, act);
    tl.to('#s4-b' + k, { borderColor: '#00929e', duration: 0.25 }, act);
    tl.fromTo('#s4-ck' + k, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' }, T.s4Steps[k]);
  }

  // ---- 5 · columns ----
  rise('#s5-in .s5-frame', S[4] + 0.05, 24, 0.8);
  rise('#s5-panel', S[4] + 0.3, 30);
  for (var r = 0; r < 4; r++) tl.fromTo('#s5-r' + r, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.55, ease: E }, T.s5Roles[r]);
  fade('#s5-h0', T.s5Roles[0], 0.35); fadeOut('#s5-h0', T.s5Roles[1], 0.35);
  fade('#s5-h2', T.s5Roles[2], 0.35); fadeOut('#s5-h2', T.s5Roles[3], 0.35);
  fade('#s5-h3', T.s5Roles[3], 0.35);

  // ---- 6 · summary: camera push ----
  var W6 = 1560, H6 = 880, K6 = 1560 / 1920, IH6 = 1200 * K6;
  function focus(px, py, s) {
    var x = W6 / 2 - px * K6 * s, y = H6 / 2 - py * K6 * s;
    x = Math.min(0, Math.max(W6 - W6 * s, x)); y = Math.min(0, Math.max(H6 - IH6 * s, y));
    return { x: x, y: y, scale: s };
  }
  var cam = '#s6-browser .cam';
  gsap.set(cam, { transformOrigin: '0 0' });
  rise('#s6-in .s6-frame', S[5] + 0.05, 24, 0.8);
  var f0 = focus(1128, 540, 1.3), f1 = focus(1128, 850, 1.14);
  tl.fromTo(cam, { x: 0, y: 0, scale: 1 }, { x: f0.x, y: f0.y, scale: f0.scale, duration: 1.6, ease: 'power2.inOut' }, T.s6Push);
  tl.to(cam, { x: f1.x, y: f1.y, scale: f1.scale, duration: 1.4, ease: 'power2.inOut' }, T.s6Take - 0.5);
  fade('#s6-r0', T.s6Tx, 0.35); fadeOut('#s6-r0', T.s6Rev, 0.3);
  fade('#s6-r1', T.s6Rev, 0.35); fadeOut('#s6-r1', T.s6Take - 0.5, 0.3);
  fade('#s6-r2', T.s6Take + 0.4, 0.4);

  // ---- 7 · where the money is ----
  rise('#s7-in .insight-head', S[6] + 0.15, 20);
  fade('#s7-in .legend', S[6] + 0.4);
  for (var c = 0; c < 5; c++) {
    tl.fromTo(['#s7-g' + c, '#s7-t' + c], { scaleX: 0, transformOrigin: '0 50%' }, { scaleX: 1, duration: 0.9, ease: 'power2.out' }, T.s7Bars + c * 0.12);
    tl.fromTo('#s7-p' + c + ' .bv', { opacity: 0 }, { opacity: 1, duration: 0.4 }, T.s7Bars + c * 0.12 + 0.5);
  }
  tl.to(['#s7-p1', '#s7-p2', '#s7-p3', '#s7-p4'], { opacity: 0.3, duration: 0.4 }, T.s7Elec);
  tl.to('#s7-p0', { opacity: 0.3, duration: 0.4 }, T.s7Groc);
  tl.to('#s7-p3', { opacity: 1, duration: 0.4 }, T.s7Groc);
  fadeOut('#s7-h1', T.s7Groc - 0.1, 0.3);
  tl.fromTo('#s7-h2', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: E }, T.s7Groc + 0.1);

  // ---- 8 · what's changing ----
  rise('#s8-in .insight-head', S[7] + 0.15, 20);
  rise('#s8-in .chart-card', S[7] + 0.3, 30);
  tl.fromTo('#s8-lt', { strokeDashoffset: T.s8Len.total }, { strokeDashoffset: 0, duration: 1.8, ease: 'power1.inOut' }, T.s8Total + 0.3);
  fade('#s8-dt', T.s8Total + 1.6, 0.4); fade('#s8-k0', T.s8Total + 0.3, 0.4);
  rise('#s8-c0', T.s8Pct, 24);
  tl.fromTo('#s8-le', { strokeDashoffset: T.s8Len.elec }, { strokeDashoffset: 0, duration: 1.4, ease: 'power1.inOut' }, T.s8Elec - 0.4);
  fade('#s8-de', T.s8Elec + 0.9, 0.4); fade('#s8-k1', T.s8Elec - 0.4, 0.4);
  tl.to(['#s8-lt', '#s8-dt'], { opacity: 0.4, duration: 0.5 }, T.s8Elec - 0.4);
  rise('#s8-c1', T.s8Elec, 24);
  fade('#s8-q', T.s8Q - 0.2, 0.5);
  tl.fromTo('#s8-la', { strokeDashoffset: T.s8Len.app }, { strokeDashoffset: 0, duration: 1.4, ease: 'power1.inOut' }, T.s8App - 0.4);
  fade('#s8-da', T.s8App + 0.9, 0.4); fade('#s8-k2', T.s8App - 0.4, 0.4);
  rise('#s8-c2', T.s8App, 24);

  // ---- 9 · every city, day and product ----
  rise('#s9-in .insight-head', S[8] + 0.15, 20);
  for (var q = 0; q < 3; q++) rise('#s9-c' + q, T.s9Cards[q], 60, 0.75);
  tl.fromTo('#s9-c0 .mh i', { scaleX: 0, transformOrigin: '0 50%' }, { scaleX: 1, duration: 0.7, ease: 'power2.out', stagger: 0.06 }, T.s9Cards[0] + 0.3);
  tl.fromTo('#s9-c1 .mv i', { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: 0.6, ease: 'power2.out', stagger: 0.05 }, T.s9Cards[1] + 0.3);
  tl.fromTo('#s9-c2 .mini-sq i.on', { opacity: 0.15 }, { opacity: 1, duration: 0.25, stagger: 0.04 }, T.s9Cards[2] + 0.3);

  // ---- 10 · act and share ----
  rise('#s10-in .insight-head', S[9] + 0.1, 16);
  rise('#s10-recs', T.s10Recs, 30, 0.8);
  rise('#s10-exl', T.s10Exp - 0.25, 16, 0.5);
  for (var e = 0; e < 4; e++) tl.fromTo('#s10-e' + e, { opacity: 0, y: 24, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.6)' }, T.s10Exp + e * 0.14);

  // ---- 11 · outro ----
  // beat-locked: outro logo lands on a strong cue (see T.s11Logo)
  tl.fromTo('#s11-mark', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.8, ease: 'back.out(1.6)' }, T.s11LogoT);
  tl.fromTo('#s11-word', { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.8, ease: E }, T.s11LogoT + 0.15);
  rise('#s11-tag', T.s11Tag, 20);
  rise('#s11-url', T.s11Url, 20);

  window.__timelines['main'] = tl;
})();
