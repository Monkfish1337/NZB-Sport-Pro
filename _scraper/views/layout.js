// Shared page chrome. All views/*.js call layout(req, { title, body, ... }).
//
// Visual style: dark, dense, monospace-leaning — Prowlarr/Dozzle-inflected.
// Critical bits inlined (CSS in /public/style.css for editing without restart).

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function navItem(href, label, active) {
  const cls = active ? 'nav-item active' : 'nav-item';
  return '<a href="' + href + '" class="' + cls + '">' + escapeHtml(label) + '</a>';
}

function layout(req, { title, body, active }) {
  const pkg = require('../package.json');
  return ''
    + '<!doctype html>'
    + '<html lang="en"><head>'
    +   '<meta charset="utf-8">'
    +   '<meta name="viewport" content="width=device-width,initial-scale=1">'
    +   '<title>' + escapeHtml(title || 'SeriousSportSync Scraper') + '</title>'
    +   '<link rel="stylesheet" href="/public/style.css">'
    // 0.2.7 — PWA: installable to home screen, standalone fullscreen on mobile.
    +   '<link rel="manifest" href="/public/manifest.json">'
    +   '<meta name="theme-color" content="#0e1116">'
    +   '<meta name="apple-mobile-web-app-capable" content="yes">'
    +   '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
    +   '<link rel="apple-touch-icon" href="/public/icon.svg">'
    +   '<link rel="icon" href="/public/icon.svg" type="image/svg+xml">'
    + '</head><body>'
    +   '<header class="topbar">'
    +     '<div class="brand">'
    +       '<span class="brand-mark">SSS</span>'
    +       '<span class="brand-name">SeriousSportSync Scraper</span>'
    +       '<span class="brand-version">v' + escapeHtml(pkg.version) + '</span>'
    +     '</div>'
    // 0.2.7 — mobile nav toggle (CSS hides it on desktop).
    +     '<button class="nav-toggle" type="button" aria-label="Menu" '
    +       'onclick="document.querySelector(\'.nav\').classList.toggle(\'open\')">☰</button>'
    +     '<nav class="nav">'
    +       navItem('/',         'Dashboard', active === 'dashboard')

    // Sport-scraping (drives /scrape used by SSS for sport events).
    +       '<span class="nav-sep">Sport</span>'
    +       navItem('/sources', 'Sport Sources', active === 'sources')
    +       navItem('/search',  'Sport Search',  active === 'search')

    // Grabber — independent general-purpose search + grab pipeline.
    +       '<span class="nav-sep">Grabber</span>'
    +       navItem('/grabber/sources',     'Grabber Sources',     active === 'grabber-sources')
    +       navItem('/grabber/search',      'Grabber Search',      active === 'grabber-search')
    +       navItem('/grabber/downloaders', 'Grabber Downloaders', active === 'grabber-downloaders')

    +       '<span class="nav-sep">Ops</span>'
    +       navItem('/logs',     'Logs',      active === 'logs')
    +       navItem('/history',  'History',   active === 'history')
    +       navItem('/settings', 'Settings',  active === 'settings')
    +     '</nav>'
    +   '</header>'
    +   '<main class="content">' + body + '</main>'
    +   '<script src="/public/app.js" defer></script>'
    + '</body></html>';
}

module.exports = { layout, escapeHtml };
// 0.2.7
