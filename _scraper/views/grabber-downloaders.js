// 0.2.0 — Grabber Downloaders page (moved from views/downloaders.js).
//
// Configure qBit + SAB targets for the Grabber's send-to buttons. All routes
// now live under /grabber/downloaders/* for visual separation from the rest
// of the scraper. /downloaders/* paths are kept as 301 redirects in
// server.js for any bookmarked URLs.

const { layout, escapeHtml } = require('./layout');
const downloaders = require('../lib/downloaders');
const qbit = require('../lib/downloaders/qbittorrent');
const sab  = require('../lib/downloaders/sabnzbd');
const torbox = require('../lib/downloaders/torbox');
const log = require('../lib/log-buffer');

function render(req, res) {
  const flash = req.query.flash || '';
  const qb = downloaders.getQbit();
  const sa = downloaders.getSab();
  const tb = downloaders.getTorbox();

  let body = '';
  body += '<h1>Grabber Downloaders</h1>';
  body += '<p class="hint">Where the Grabber\'s "Send to qBit" / "Send to SAB" buttons dispatch grabbed releases. URLs are container-network hostnames (e.g. <code>http://gluetun:8090</code>, <code>http://sabnzbd:8080</code>).</p>';

  if (flash) {
    body += '<div class="card" style="border-color:var(--accent);"><strong>'
      + escapeHtml(flash) + '</strong></div>';
  }

  // ---------- qBittorrent ----------
  body += '<div class="card">';
  body += '<h2 style="margin-top:0;">qBittorrent</h2>';
  body += '<p class="hint">Receives torrent results. Test fetches <code>/api/v2/app/version</code> via the saved credentials.</p>';
  body += '<form method="POST" action="/grabber/downloaders/qbit">';
  body += '<label class="lbl" for="qbit-url">URL</label>'
    + '<input class="inp mono" id="qbit-url" name="url" type="url" value="' + escapeHtml(qb.url) + '" placeholder="http://gluetun:8090" required>';
  body += '<label class="lbl" for="qbit-username">Username</label>'
    + '<input class="inp mono" id="qbit-username" name="username" type="text" value="' + escapeHtml(qb.username) + '" autocomplete="off">';
  body += '<label class="lbl" for="qbit-password">Password</label>'
    + '<input class="inp mono" id="qbit-password" name="password" type="password" value="' + escapeHtml(qb.password) + '" autocomplete="off">';
  body += '<label class="lbl" for="qbit-category">Default category</label>'
    + '<input class="inp mono" id="qbit-category" name="category" type="text" value="' + escapeHtml(qb.category) + '" placeholder="general">';
  body += '<div style="display:flex;gap:10px;margin-top:14px;">';
  body += '<button class="btn-primary" type="submit">Save qBit</button>';
  body += '<button class="btn btn-ghost" type="button" data-test="qbit">Test connection</button>';
  body += '<span class="test-result" data-for="qbit"></span>';
  body += '</div></form>';
  body += '</div>';

  // ---------- SABnzbd ----------
  body += '<div class="card">';
  body += '<h2 style="margin-top:0;">SABnzbd</h2>';
  body += '<p class="hint">Receives usenet results. API key: SABnzbd → Config → General → API Key.</p>';
  body += '<form method="POST" action="/grabber/downloaders/sab">';
  body += '<label class="lbl" for="sab-url">URL</label>'
    + '<input class="inp mono" id="sab-url" name="url" type="url" value="' + escapeHtml(sa.url) + '" placeholder="http://sabnzbd:8080" required>';
  body += '<label class="lbl" for="sab-apikey">API key</label>'
    + '<input class="inp mono" id="sab-apikey" name="apiKey" type="password" value="' + escapeHtml(sa.apiKey) + '" autocomplete="off">';
  body += '<label class="lbl" for="sab-category">Default category</label>'
    + '<input class="inp mono" id="sab-category" name="category" type="text" value="' + escapeHtml(sa.category) + '" placeholder="general">';
  body += '<div style="display:flex;gap:10px;margin-top:14px;">';
  body += '<button class="btn-primary" type="submit">Save SAB</button>';
  body += '<button class="btn btn-ghost" type="button" data-test="sab">Test connection</button>';
  body += '<span class="test-result" data-for="sab"></span>';
  body += '</div></form>';
  body += '</div>';

  // ---------- TorBox (0.2.2) ----------
  body += '<div class="card">';
  body += '<h2 style="margin-top:0;">TorBox</h2>';
  body += '<p class="hint">Receives both torrent and usenet results. Sends magnets / .torrent URLs to <code>/torrents/createtorrent</code> and NZB URLs to <code>/usenet/createusenetdownload</code>. Get API key at torbox.app → Settings → API Key.</p>';
  body += '<form method="POST" action="/grabber/downloaders/torbox">';
  body += '<label class="lbl" for="tb-url">URL</label>'
    + '<input class="inp mono" id="tb-url" name="url" type="url" value="' + escapeHtml(tb.url) + '" placeholder="https://api.torbox.app/v1/api" required>';
  body += '<label class="lbl" for="tb-apikey">API key</label>'
    + '<input class="inp mono" id="tb-apikey" name="apiKey" type="password" value="' + escapeHtml(tb.apiKey) + '" autocomplete="off">';
  body += '<label class="lbl" for="tb-category">Default category</label>'
    + '<input class="inp mono" id="tb-category" name="category" type="text" value="' + escapeHtml(tb.category) + '" placeholder="general (unused by TorBox — kept for parity)">';
  body += '<div style="display:flex;gap:10px;margin-top:14px;">';
  body += '<button class="btn-primary" type="submit">Save TorBox</button>';
  body += '<button class="btn btn-ghost" type="button" data-test="torbox">Test connection</button>';
  body += '<span class="test-result" data-for="torbox"></span>';
  body += '</div></form>';
  body += '</div>';

  body += `<script>
(function(){
  document.querySelectorAll('[data-test]').forEach(function(btn){
    btn.addEventListener('click', async function(){
      var which = btn.getAttribute('data-test');
      var out = document.querySelector('.test-result[data-for="' + which + '"]');
      out.textContent = 'Testing…';
      out.style.color = '';
      try {
        var res = await fetch('/grabber/downloaders/' + which + '/test', { method: 'POST' });
        var j = await res.json();
        if (j.ok) {
          out.textContent = 'OK · v' + (j.version || '?');
          out.style.color = 'var(--good, #4ade80)';
        } else {
          out.textContent = 'FAIL · ' + (j.error || 'unknown');
          out.style.color = 'var(--bad, #f87171)';
        }
      } catch (err) {
            out.textContent = 'ERR · ' + err.message;
        out.style.color = 'var(--bad, #f87171)';
      }
    });
  });
})();
</script>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(layout(req, { title: 'Grabber Downloaders', body, active: 'grabber-downloaders' }));
}

function saveQbit(req, res) {
  const b = req.body || {};
  try {
    downloaders.setQbit({
      url: b.url, username: b.username, password: b.password, category: b.category,
    });
    log.info('system', 'qbit config saved (url=' + (b.url || '') + ')');
    res.redirect('/grabber/downloaders?flash=' + encodeURIComponent('qBit settings saved.'));
  } catch (err) {
    res.redirect('/grabber/downloaders?flash=' + encodeURIComponent('Save failed: ' + err.message));
  }
}

function saveSab(req, res) {
  const b = req.body || {};
  try {
    downloaders.setSab({ url: b.url, apiKey: b.apiKey, category: b.category });
    log.info('system', 'sab config saved (url=' + (b.url || '') + ')');
    res.redirect('/grabber/downloaders?flash=' + encodeURIComponent('SAB settings saved.'));
  } catch (err) {
    res.redirect('/grabber/downloaders?flash=' + encodeURIComponent('Save failed: ' + err.message));
  }
}

async function testQbit(req, res) {
  const cfg = downloaders.getQbit();
  const result = await qbit.testConnection(cfg);
  res.json(result);
}

async function testSab(req, res) {
  const cfg = downloaders.getSab();
  const result = await sab.testConnection(cfg);
  res.json(result);
}

// 0.2.2 — TorBox save + test handlers.
function saveTorbox(req, res) {
  const b = req.body || {};
  try {
    downloaders.setTorbox({ url: b.url, apiKey: b.apiKey, category: b.category });
    log.info('system', 'torbox config saved (url=' + (b.url || '') + ')');
    res.redirect('/grabber/downloaders?flash=' + encodeURIComponent('TorBox settings saved.'));
  } catch (err) {
    res.redirect('/grabber/downloaders?flash=' + encodeURIComponent('Save failed: ' + err.message));
  }
}

async function testTorbox(req, res) {
  const cfg = downloaders.getTorbox();
  const result = await torbox.testConnection(cfg);
  res.json(result);
}

module.exports = { render, saveQbit, saveSab, testQbit, testSab, saveTorbox, testTorbox };
