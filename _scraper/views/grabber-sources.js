// 0.2.0 — Grabber sources page.
//
// Operator-facing CRUD for the Grabber's independent indexer list. Mirrors
// views/sources.js (sport-side) but reads/writes lib/grabber-sources.js and
// all URLs live under /grabber/sources/* so the two contexts never collide.

const { layout, escapeHtml } = require('./layout');
const grabberSources = require('../lib/grabber-sources');
const registry = require('../lib/sources/registry');
const log = require('../lib/log-buffer');

function pill(text, kind) { return '<span class="pill ' + kind + '">' + escapeHtml(text) + '</span>'; }

function renderField(field, currentValue) {
  const name = field.name;
  const label = field.label || field.name;
  const hint = field.hint ? '<div class="hint">' + escapeHtml(field.hint) + '</div>' : '';
  const val = currentValue == null ? (field.default == null ? '' : field.default) : currentValue;
  const placeholder = field.placeholder ? ' placeholder="' + escapeHtml(field.placeholder) + '"' : '';
  const required = field.required ? ' required' : '';

  if (field.type === 'bool') {
    return '<label class="lbl">'
      + '<input type="checkbox" name="' + escapeHtml(name) + '" value="1"' + (val ? ' checked' : '') + '> '
      + escapeHtml(label) + '</label>' + hint;
  }
  if (field.type === 'number') {
    return '<label class="lbl" for="f-' + escapeHtml(name) + '">' + escapeHtml(label) + '</label>'
      + '<input class="inp mono" type="number" id="f-' + escapeHtml(name) + '" name="' + escapeHtml(name)
      + '" value="' + escapeHtml(String(val)) + '"' + placeholder + required + '>' + hint;
  }
  if (field.type === 'secret') {
    return '<label class="lbl" for="f-' + escapeHtml(name) + '">' + escapeHtml(label) + '</label>'
      + '<input class="inp mono" type="password" id="f-' + escapeHtml(name) + '" name="' + escapeHtml(name)
      + '" value="' + escapeHtml(String(val)) + '"' + placeholder + required + ' autocomplete="off">'
      + hint;
  }
  return '<label class="lbl" for="f-' + escapeHtml(name) + '">' + escapeHtml(label) + '</label>'
    + '<input class="inp mono" type="' + (field.type === 'url' ? 'url' : 'text')
    + '" id="f-' + escapeHtml(name) + '" name="' + escapeHtml(name)
    + '" value="' + escapeHtml(String(val)) + '"' + placeholder + required + ' autocomplete="off">'
    + hint;
}

function renderForm(typeMod, existing) {
  const cfg = existing ? (existing.config || {}) : {};
  let html = '';
  html += '<input type="hidden" name="type" value="' + escapeHtml(typeMod.type) + '">';
  if (existing) html += '<input type="hidden" name="id" value="' + escapeHtml(existing.id) + '">';
  html += '<label class="lbl" for="f-name">Display name</label>'
    + '<input class="inp" type="text" id="f-name" name="name" value="'
    + escapeHtml(existing ? existing.name : '') + '" placeholder="' + escapeHtml(typeMod.label)
    + '" required>';
  html += '<label class="lbl"><input type="checkbox" name="enabled" value="1"'
    + ((existing ? existing.enabled !== false : true) ? ' checked' : '') + '> Enabled</label>';
  for (const f of typeMod.schema) {
    html += renderField(f, cfg[f.name]);
  }
  return html;
}

function render(req, res) {
  const sources = grabberSources.listSources();
  const types = registry.list();
  const editingId = req.query.edit || '';
  const addingType = req.query.add || '';
  const flash = req.query.flash || '';

  let body = '';
  body += '<h1>Grabber Sources</h1>';
  body += '<p class="hint">Indexers used by the Grabber\'s general-purpose search + grab pipeline. Independent from Sport Sources — changes here do NOT affect /scrape calls from SeriousSportSync.</p>';
  if (flash) {
    body += '<div class="card" style="border-color:var(--accent);"><strong>'
      + escapeHtml(flash) + '</strong></div>';
  }

  // ---------- existing sources table ----------
  body += '<div class="card">';
  body += '<h2 style="margin-top:0;">Configured</h2>';
  if (sources.length === 0) {
    body += '<p class="dim">No grabber sources yet. Use the Add Source panel below to create one.</p>';
  } else {
    body += '<table class="t"><thead><tr>'
      + '<th>Name</th><th>Type</th><th>Enabled</th><th>Actions</th>'
      + '</tr></thead><tbody>';
    for (const s of sources) {
      const mod = registry.get(s.type);
      const enabledToggle = s.enabled === false
        ? '<form method="POST" action="/grabber/sources/' + escapeHtml(s.id) + '/enable" style="display:inline;"><button class="btn-ghost">Enable</button></form>'
        : '<form method="POST" action="/grabber/sources/' + escapeHtml(s.id) + '/disable" style="display:inline;"><button class="btn-ghost">Disable</button></form>';
      const testOutId = 'test-' + s.id + '-out';
      body += '<tr>'
        + '<td><strong>' + escapeHtml(s.name) + '</strong></td>'
        + '<td>' + escapeHtml((mod && mod.label) || s.type) + '</td>'
        + '<td>' + enabledToggle + ' <span id="' + testOutId + '" class="dim" style="margin-left:8px;"></span></td>'
        + '<td>'
        +   '<a class="btn btn-ghost" href="/grabber/sources?edit=' + escapeHtml(s.id) + '">Edit</a> '
        +   '<button class="btn-ghost" data-action="post" data-url="/grabber/sources/' + escapeHtml(s.id) + '/test" data-out="#' + escapeHtml(testOutId) + '">Test</button> '
        +   '<form method="POST" action="/grabber/sources/' + escapeHtml(s.id) + '/delete" style="display:inline;" onsubmit="return confirm(\'Delete this grabber source?\');">'
        +     '<button class="btn-danger">Delete</button>'
        +   '</form>'
        + '</td>'
        + '</tr>';
    }
    body += '</tbody></table>';
  }
  body += '</div>';

  // ---------- edit form ----------
  if (editingId) {
    const existing = grabberSources.getSource(editingId);
    if (existing) {
      const mod = registry.get(existing.type);
      if (mod) {
        body += '<div class="card">';
        body += '<h2 style="margin-top:0;">Edit: ' + escapeHtml(existing.name) + '</h2>';
        body += '<p class="hint">' + escapeHtml(mod.description) + '</p>';
        body += '<form method="POST" action="/grabber/sources">';
        body += renderForm(mod, existing);
        body += '<div style="margin-top:14px;">'
          + '<button class="btn">Save</button> '
          + '<a class="btn btn-ghost" href="/grabber/sources">Cancel</a>'
          + '</div>';
        body += '</form>';
        body += '</div>';
      }
    }
  }

  // ---------- add form (chosen type) ----------
  if (addingType) {
    const mod = registry.get(addingType);
    if (mod) {
      body += '<div class="card">';
      body += '<h2 style="margin-top:0;">Add: ' + escapeHtml(mod.label) + '</h2>';
      body += '<p class="hint">' + escapeHtml(mod.description) + '</p>';
      body += '<form method="POST" action="/grabber/sources">';
      body += renderForm(mod, null);
      body += '<div style="margin-top:14px;">'
        + '<button class="btn">Add source</button> '
        + '<a class="btn btn-ghost" href="/grabber/sources">Cancel</a>'
        + '</div>';
      body += '</form>';
      body += '</div>';
    }
  }

  // ---------- type picker ----------
  if (!editingId && !addingType) {
    body += '<div class="card">';
    body += '<h2 style="margin-top:0;">Add new source</h2>';
    body += '<div style="display:flex;gap:10px;flex-wrap:wrap;">';
    for (const mod of types) {
      body += '<a class="btn btn-ghost" href="/grabber/sources?add=' + escapeHtml(mod.type) + '">+ '
        + escapeHtml(mod.label) + '</a>';
    }
    body += '</div></div>';
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(layout(req, { title: 'Grabber Sources', body, active: 'grabber-sources' }));
}

function save(req, res) {
  const b = req.body || {};
  const type = String(b.type || '').trim();
  const id = String(b.id || '').trim();
  const mod = registry.get(type);
  if (!mod) return res.redirect('/grabber/sources?flash=' + encodeURIComponent('Unknown type'));
  const sourceConfig = {};
  for (const f of mod.schema) {
    const raw = b[f.name];
    if (f.type === 'bool')        sourceConfig[f.name] = raw === '1' || raw === 'on' || raw === true;
    else if (f.type === 'number') sourceConfig[f.name] = raw === '' || raw == null ? undefined : Number(raw);
    else                          sourceConfig[f.name] = raw == null ? '' : String(raw);
  }
  const name = String(b.name || mod.label).trim();
  const enabled = b.enabled === '1' || b.enabled === 'on' || b.enabled === true;
  try {
    if (id) {
      grabberSources.updateSource(id, { name, enabled, config: sourceConfig });
      log.info('system', 'grabber source updated: ' + name + ' (' + id + ')');
    } else {
      const entry = grabberSources.addSource({ type, name, enabled, config: sourceConfig });
      log.info('system', 'grabber source added: ' + name + ' (' + entry.id + ')');
    }
    res.redirect('/grabber/sources?flash=' + encodeURIComponent('Saved.'));
  } catch (err) {
    res.redirect('/grabber/sources?flash=' + encodeURIComponent('Save failed: ' + err.message));
  }
}

function remove(req, res) {
  try { grabberSources.deleteSource(req.params.id); }
  catch (_) {}
  log.info('system', 'grabber source deleted: ' + req.params.id);
  res.redirect('/grabber/sources?flash=' + encodeURIComponent('Deleted.'));
}

function enable(req, res) {
  try { grabberSources.updateSource(req.params.id, { enabled: true }); } catch (_) {}
  res.redirect('/grabber/sources');
}
function disable(req, res) {
  try { grabberSources.updateSource(req.params.id, { enabled: false }); } catch (_) {}
  res.redirect('/grabber/sources');
}

async function test(req, res) {
  const s = grabberSources.getSource(req.params.id);
  if (!s) return res.status(404).json({ ok: false, message: 'source not found' });
  const mod = registry.get(s.type);
  if (!mod || typeof mod.test !== 'function') {
    return res.status(400).json({ ok: false, message: 'source type has no test()' });
  }
  const tlog = {
    info:  (cat, msg) => log.info(cat,  msg, s.name),
    warn:  (cat, msg) => log.warn(cat,  msg, s.name),
    error: (cat, msg) => log.error(cat, msg, s.name),
    debug: (cat, msg) => log.debug(cat, msg, s.name),
  };
  try {
    const result = await mod.test(s.config || {}, tlog);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

module.exports = { render, save, remove, enable, disable, test };
