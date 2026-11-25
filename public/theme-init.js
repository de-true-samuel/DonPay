// Applies theme ('obsidian' | 'daylight') and effects tier ('full' | 'lite' | 'min') before first paint.
(function () {
  try {
    var path = window.location && window.location.pathname || '/';
    var isPublicCustomer = /^\/(pay|p|receipt)(\/|$)/.test(path);
    var mqDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    var mqLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
    var resolvedTheme = 'obsidian';

    if (isPublicCustomer) {
      resolvedTheme = mqLight && mqLight.matches ? 'daylight' : 'obsidian';
    } else {
      var saved = localStorage.getItem('paidar.theme');
      if (saved === 'light' || saved === 'daylight') resolvedTheme = 'daylight';
      else if (saved === 'dark' || saved === 'obsidian') resolvedTheme = 'obsidian';
      else if (saved === 'system') resolvedTheme = mqLight && mqLight.matches ? 'daylight' : 'obsidian';
      else resolvedTheme = 'obsidian';
    }

    document.documentElement.setAttribute('data-theme', resolvedTheme);
    var meta = document.getElementById('pd-theme-color');
    if (meta) meta.setAttribute('content', resolvedTheme === 'daylight' ? '#F2F4F9' : '#090B11');

    var fxPref = localStorage.getItem('paidar.fx') || 'auto';
    var resolvedFx = 'lite';
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var conn = navigator && navigator.connection;
    var saveData = !!(conn && conn.saveData);
    var mem = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null;
    var cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;

    if (fxPref === 'full' || fxPref === 'lite' || fxPref === 'min') {
      resolvedFx = fxPref;
    } else if (reduced || saveData) {
      resolvedFx = 'min';
    } else if ((mem !== null && mem <= 2) || (cores !== null && cores <= 4)) {
      resolvedFx = 'lite';
    } else if (mem === null && cores === null) {
      resolvedFx = 'lite';
    } else {
      resolvedFx = 'full';
    }
    document.documentElement.setAttribute('data-fx', resolvedFx);
  } catch (e) {
    try {
      document.documentElement.setAttribute('data-theme', 'obsidian');
      document.documentElement.setAttribute('data-fx', 'lite');
    } catch (_) {}
  }
})();
