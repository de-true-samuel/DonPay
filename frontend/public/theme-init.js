// Applies a saved light/dark choice before first paint, so the screen never flashes the wrong theme.
try { var t = localStorage.getItem('paidar.theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}
