const APP_VERSION = require('../package.json').version || '';

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function shell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#090909">
  <title>${escapeHtml(title)} — NZB-Sport-Pro</title>
  <style>
    :root{color-scheme:dark;--bg:#090909;--panel:#111214;--panel2:#17181b;--ink:#f7f7f5;--muted:#9b9da3;--line:#2a2b2f;--orange:#ff7a18;--orange2:#ff9d2e;--green:#40d39c}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 75% 0,rgba(255,122,24,.15),transparent 30rem),radial-gradient(circle at 15% 35%,rgba(255,157,46,.07),transparent 28rem),var(--bg);color:var(--ink);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;min-height:100vh}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.16;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(to bottom,#000,transparent 75%)}
    a{color:inherit}.wrap{width:min(1120px,calc(100% - 32px));margin:auto;position:relative}.nav{height:76px;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:11px;text-decoration:none;font-weight:800;letter-spacing:-.02em}.mark{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(145deg,var(--orange2),var(--orange));box-shadow:0 12px 32px rgba(255,122,24,.25);color:#111;font-weight:1000}.navlinks{display:flex;gap:10px;align-items:center}.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:11px 16px;text-decoration:none;background:rgba(255,255,255,.025);font-weight:700;color:var(--ink);cursor:pointer}.btn:hover{border-color:#4b4c51;background:rgba(255,255,255,.05)}.btn.primary{background:linear-gradient(135deg,var(--orange2),var(--orange));border-color:transparent;color:#111;box-shadow:0 14px 36px rgba(255,122,24,.19)}
    .hero{padding:76px 0 64px;display:grid;grid-template-columns:1.25fr .75fr;gap:54px;align-items:center}.eyebrow{display:inline-flex;gap:8px;align-items:center;color:var(--orange2);font-weight:800;text-transform:uppercase;letter-spacing:.13em;font-size:12px}.eyebrow:before{content:"";width:22px;height:2px;background:var(--orange)}h1{font-size:clamp(46px,8vw,84px);line-height:.96;letter-spacing:-.065em;margin:20px 0 24px;max-width:820px}.accent{color:var(--orange)}.lead{font-size:clamp(17px,2vw,21px);color:#b8bac0;max-width:690px}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:31px}.fine{color:var(--muted);font-size:13px;margin-top:15px}.status{background:linear-gradient(155deg,rgba(255,122,24,.14),rgba(255,255,255,.025));border:1px solid #36302b;border-radius:20px;padding:24px;box-shadow:0 28px 80px rgba(0,0,0,.35)}.status h2{font-size:18px;margin:0 0 20px}.flow{display:grid;gap:12px}.step{display:flex;gap:13px;align-items:flex-start;padding:13px;border-radius:12px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.055)}.num{flex:0 0 27px;height:27px;border-radius:8px;background:rgba(255,122,24,.14);color:var(--orange2);display:grid;place-items:center;font-weight:900}.step strong{display:block}.step span{display:block;color:var(--muted);font-size:13px}.pill{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(64,211,156,.24);background:rgba(64,211,156,.08);color:#7ce2bc;border-radius:100px;padding:7px 10px;font-size:12px;font-weight:800;margin-top:18px}.pill:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(64,211,156,.1)}
    .section{padding:38px 0 78px}.section h2{font-size:34px;letter-spacing:-.04em;margin:0 0 10px}.section-intro{color:var(--muted);max-width:650px;margin:0 0 28px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.card{background:linear-gradient(160deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:16px;padding:22px}.card b{display:block;font-size:17px;margin-bottom:8px}.card p{margin:0;color:var(--muted)}.icon{font-size:21px;color:var(--orange2);margin-bottom:28px}.footer{border-top:1px solid var(--line);padding:25px 0 40px;color:var(--muted);display:flex;justify-content:space-between;gap:20px}
    .auth{width:min(560px,calc(100% - 32px));margin:7vh auto}.auth .brand{margin-bottom:24px}.auth-card{border:1px solid var(--line);background:linear-gradient(155deg,var(--panel2),var(--panel));border-radius:20px;padding:clamp(24px,5vw,42px);box-shadow:0 30px 90px rgba(0,0,0,.4)}.auth h1{font-size:39px;margin:0 0 12px;letter-spacing:-.045em}.auth p{color:var(--muted)}label{display:block;font-weight:750;margin:18px 0 7px}.input{width:100%;border:1px solid #34353a;background:#0b0c0e;color:var(--ink);border-radius:10px;padding:13px 14px;font:inherit;outline:none}.input:focus{border-color:var(--orange);box-shadow:0 0 0 3px rgba(255,122,24,.12)}.auth .btn{width:100%;margin-top:22px}.error{border:1px solid rgba(255,93,93,.32);background:rgba(255,93,93,.08);color:#ffaaaa;border-radius:10px;padding:12px 14px}.back{display:inline-block;margin-top:18px;color:var(--muted)}
    @media(max-width:820px){.hero{grid-template-columns:1fr;padding-top:45px}.grid{grid-template-columns:1fr}.navlinks .secondary{display:none}.footer{flex-direction:column}.status{max-width:620px}}
  </style>
</head><body>${body}</body></html>`;
}

function landingPage({ registrationOpen = true } = {}) {
  const configureHref = registrationOpen ? '/configure' : '/login';
  const configureText = registrationOpen ? 'Configure addon' : 'Sign in';
  return shell('Sports Usenet, streamlined', `
  <div class="wrap">
    <nav class="nav">
      <a class="brand" href="/"><span class="mark">N</span><span>NZB-Sport-Pro</span></a>
      <div class="navlinks"><a class="btn secondary" href="/login">Sign in</a><a class="btn primary" href="${configureHref}">${configureText}</a></div>
    </nav>
    <main class="hero">
      <div>
        <div class="eyebrow">Powered by SeriousSportSync metadata</div>
        <h1>Sports metadata.<br><span class="accent">Your Usenet.</span></h1>
        <p class="lead">A focused Stremio and Nuvio addon that searches your own Newznab indexers and sends selected releases directly to your TorBox account.</p>
        <div class="actions"><a class="btn primary" href="${configureHref}">${configureText} →</a><a class="btn" href="https://github.com/Monkfish1337/NZB-Sport-Pro">View source</a></div>
        <div class="fine">No shared scraper account. No media proxy. Your credentials are encrypted at rest.</div>
      </div>
      <aside class="status">
        <h2>One private playback path</h2>
        <div class="flow">
          <div class="step"><span class="num">1</span><div><strong>Choose the event</strong><span>Combat sports, wrestling, football and motorsport metadata.</span></div></div>
          <div class="step"><span class="num">2</span><div><strong>Search your indexers</strong><span>Event-aware queries run only when an event is opened.</span></div></div>
          <div class="step"><span class="num">3</span><div><strong>Play or queue in TorBox</strong><span>Owned downloads play immediately; new releases queue explicitly.</span></div></div>
        </div>
        <span class="pill">Request-only discovery</span>
      </aside>
    </main>
    <section class="section">
      <h2>Built for a public instance</h2>
      <p class="section-intro">Each user receives a private manifest and controls their own services. The server provides metadata and orchestration, not the media itself.</p>
      <div class="grid">
        <article class="card"><div class="icon">◇</div><b>Personal configuration</b><p>Your TorBox key and up to five Newznab indexers are isolated per account.</p></article>
        <article class="card"><div class="icon">↯</div><b>Honest cache status</b><p>Existing library jobs are instant. Uncached results are clearly marked as queue actions.</p></article>
        <article class="card"><div class="icon">◎</div><b>Shared sports metadata</b><p>Catalog definitions and refresh adapters sync from SeriousSportSync automatically.</p></article>
      </div>
    </section>
    <footer class="footer"><span>NZB-Sport-Pro v${escapeHtml(APP_VERSION)}</span><span>Metadata by SeriousSportSync · Playback by your TorBox account</span></footer>
  </div>`);
}

function registrationPage({ error = '', username = '' } = {}) {
  return shell('Configure', `<main class="auth">
    <a class="brand" href="/"><span class="mark">N</span><span>NZB-Sport-Pro</span></a>
    <section class="auth-card">
      <div class="eyebrow">Private configuration</div>
      <h1>Create your install</h1>
      <p>Create a configuration account, then add your TorBox key and Newznab indexers. Your final manifest URL is private.</p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <form method="post" action="/configure">
        <label for="username">Username</label>
        <input class="input" id="username" name="username" value="${escapeHtml(username)}" minlength="3" maxlength="32" pattern="[A-Za-z0-9_.-]{3,32}" autocomplete="username" required autofocus>
        <label for="password">Password</label>
        <input class="input" id="password" name="password" type="password" minlength="8" autocomplete="new-password" required>
        <button class="btn primary" type="submit">Continue to configuration →</button>
      </form>
      <a class="back" href="/login">Already configured? Sign in</a>
    </section>
  </main>`);
}

function configurationPage({ config = {}, promotions = [], token = '' } = {}) {
  const indexers = Array.isArray(config.newznabIndexers) && config.newznabIndexers.length
    ? config.newznabIndexers : [{ name: '', url: '', apiKey: '' }];
  const selected = new Set(Array.isArray(config.catalogs) ? config.catalogs : []);
  const selectAll = selected.size === 0;
  const indexerRows = indexers.map((item) => `
    <div class="indexer-row">
      <div><label>Name</label><input class="input ix-name" value="${escapeHtml(item.name || '')}" placeholder="NZBGeek"></div>
      <div><label>Newznab API URL</label><input class="input ix-url" type="url" value="${escapeHtml(item.url || '')}" placeholder="https://api.example.com/api"></div>
      <div><label>API key</label><div class="secret"><input class="input ix-key" type="password" value="${escapeHtml(item.apiKey || '')}" autocomplete="off"><button type="button" class="reveal">Show</button></div></div>
      <button class="remove" type="button">Remove</button>
    </div>`).join('');
  const catalogGroups = promotions.map((promotion) => `
    <div class="catalog-group"><strong>${escapeHtml(promotion.name)}</strong>
      <div class="catalog-grid">${promotion.catalogs.map((catalog) => `
        <label class="check"><input type="checkbox" class="catalog" value="${escapeHtml(catalog.id)}"${selectAll || selected.has(catalog.id) ? ' checked' : ''}><span>${escapeHtml(catalog.name)}</span></label>`).join('')}
      </div>
    </div>`).join('');
  const editNote = token
    ? '<span class="edit-pill">Editing existing configuration</span>' : '';

  return shell('Configure', `
  <style>
    .config-wrap{width:min(880px,calc(100% - 28px));margin:0 auto;padding:28px 0 70px}.config-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:26px}.config-head .brand{font-size:24px}.config-head p{margin:3px 0 0;color:var(--muted);font-size:13px}.edit-pill{border:1px solid rgba(255,122,24,.3);background:rgba(255,122,24,.08);color:var(--orange2);border-radius:100px;padding:6px 10px;font-size:11px;font-weight:800}.config-card{background:linear-gradient(160deg,#151619,#101113);border:1px solid var(--line);border-radius:17px;padding:clamp(18px,4vw,30px);box-shadow:0 28px 90px rgba(0,0,0,.35)}.config-card h1{font-size:30px;line-height:1.1;letter-spacing:-.04em;margin:0 0 8px}.intro{color:var(--muted);margin:0 0 26px}.block{border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.018);margin:12px 0;overflow:hidden}.block-head{padding:15px 17px;border-bottom:1px solid var(--line);font-weight:800}.block-body{padding:17px}.block p.help{color:var(--muted);font-size:13px;margin:0 0 15px}.secret{display:flex}.secret .input{border-radius:10px 0 0 10px}.reveal{border:1px solid #34353a;border-left:0;background:#1b1c20;color:var(--muted);padding:0 14px;border-radius:0 10px 10px 0;cursor:pointer}.indexer-row{display:grid;grid-template-columns:.8fr 1.45fr 1fr auto;gap:10px;align-items:end;padding:14px 0;border-top:1px solid rgba(255,255,255,.055)}.indexer-row:first-child{border-top:0;padding-top:0}.indexer-row label,.field label{display:block;margin:0 0 6px;font-size:12px;color:#c6c7cb;font-weight:750}.remove{background:transparent;border:0;color:#ff827b;padding:12px 4px;cursor:pointer}.small-btn{border:1px solid #44454a;background:transparent;color:var(--ink);border-radius:8px;padding:8px 11px;cursor:pointer;font-weight:700;font-size:12px}.toggle{display:flex;gap:11px;align-items:flex-start;margin:12px 0}.toggle input,.check input{accent-color:var(--orange)}.toggle b{display:block}.toggle span{display:block;color:var(--muted);font-size:12px}.fold{border:1px solid var(--line);border-radius:13px;margin:12px 0;background:rgba(255,255,255,.018)}.fold summary{cursor:pointer;padding:15px 17px;font-weight:800;list-style:none}.fold summary:after{content:"⌄";float:right;color:var(--muted)}.fold[open] summary{border-bottom:1px solid var(--line)}.fold-body{padding:17px}.catalog-group+ .catalog-group{margin-top:18px}.catalog-group strong{display:block;margin-bottom:8px;color:var(--orange2)}.catalog-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.check{display:flex;gap:8px;align-items:center;border:1px solid rgba(255,255,255,.055);padding:9px 10px;border-radius:8px;color:#c9cacf}.advanced-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.actions-bar{display:flex;gap:10px;justify-content:center;margin-top:22px;flex-wrap:wrap}.actions-bar .btn{min-width:150px}.output{display:none;margin-top:18px;padding:14px;border:1px solid rgba(64,211,156,.25);background:rgba(64,211,156,.06);border-radius:11px}.output.show{display:block}.output label{display:block;color:#8ee8c5;font-size:12px;font-weight:800;margin-bottom:7px}.output-row{display:flex;gap:8px}.output .input{font-size:11px}.message{min-height:20px;text-align:center;color:var(--muted);font-size:13px;margin-top:12px}.danger{color:#ff9a94}.privacy{display:flex;justify-content:center;gap:7px;color:var(--muted);font-size:12px;margin-top:18px}.privacy b{color:#c9cacf}@media(max-width:760px){.indexer-row{grid-template-columns:1fr}.catalog-grid,.advanced-grid{grid-template-columns:1fr}.remove{text-align:left;padding:2px}.config-head{align-items:flex-start}.edit-pill{display:none}}
  </style>
  <main class="config-wrap">
    <header class="config-head"><a class="brand" href="/configure"><span class="mark">N</span><span>NZB-Sport-Pro</span></a>${editNote}</header>
    <section class="config-card">
      <div class="eyebrow">Private manifest generator</div>
      <h1>Configure NZB-Sport-Pro</h1>
      <p class="intro">Add your own services, choose your catalogs, then install or copy the generated manifest.</p>

      <div class="block"><div class="block-head">TorBox</div><div class="block-body">
        <p class="help">Requires a TorBox plan with Usenet access. The key is encrypted into your manifest configuration and is not stored in the user database.</p>
        <div class="field"><label for="torbox-key">TorBox API key</label><div class="secret"><input class="input" id="torbox-key" type="password" value="${escapeHtml(config.torboxApiKey || '')}" autocomplete="off" placeholder="Paste your TorBox API key"><button class="reveal" type="button">Show</button></div></div>
      </div></div>

      <div class="block"><div class="block-head">Newznab indexers</div><div class="block-body">
        <p class="help">Add up to five HTTPS Newznab endpoints. Searches happen only when you open a sports event.</p>
        <div id="indexers">${indexerRows}</div>
        <button id="add-indexer" class="small-btn" type="button">+ Add indexer</button>
      </div></div>

      <details class="fold"><summary>Catalogs</summary><div class="fold-body">
        <label class="toggle"><input id="show-home" type="checkbox"${config.showCatalogsOnHome === false ? '' : ' checked'}><span><b>Show catalogs on Home</b>Disable to retain collection sources while asking compatible Nuvio clients to hide catalog rows.</span></label>
        ${catalogGroups}
      </div></details>

      <details class="fold"><summary>Advanced settings</summary><div class="fold-body">
        <div class="advanced-grid">
          <div class="field"><label for="max-streams">Maximum results per event</label><input class="input" id="max-streams" type="number" min="0" max="20" value="${escapeHtml(String(config.maxStreams || 0))}"><small class="fine">0 uses the server default.</small></div>
          <div><label class="toggle"><input id="direct-link" type="checkbox"${config.nativeNewznabDirectLinkEnabled ? ' checked' : ''}><span><b>Direct indexer-link attachment</b>Allows TorBox to receive a credential-bearing NZB URL for eligible cache matches.</span></label></div>
        </div>
      </div></details>

      <div class="actions-bar"><button class="btn primary" id="install" type="button">Install</button><button class="btn" id="copy" type="button">Copy Link</button></div>
      <div class="message" id="message" aria-live="polite"></div>
      <div class="output${token ? ' show' : ''}" id="output"><label>Your private manifest URL</label><div class="output-row"><input class="input" id="manifest-url" readonly><button class="small-btn" id="copy-output" type="button">Copy</button></div><div style="margin-top:10px"><a id="collection-link" class="fine" href="#">Download Nuvio collection JSON</a></div></div>
      <div class="privacy">🔒 <span><b>Stateless configuration.</b> Credentials are authenticated-encrypted in the URL; keep the manifest private.</span></div>
    </section>
  </main>
  <template id="indexer-template"><div class="indexer-row"><div><label>Name</label><input class="input ix-name" placeholder="NZBGeek"></div><div><label>Newznab API URL</label><input class="input ix-url" type="url" placeholder="https://api.example.com/api"></div><div><label>API key</label><div class="secret"><input class="input ix-key" type="password" autocomplete="off"><button type="button" class="reveal">Show</button></div></div><button class="remove" type="button">Remove</button></div></template>
  <script>
  (function(){
    var root=document.getElementById('indexers'),add=document.getElementById('add-indexer'),template=document.getElementById('indexer-template');
    function rows(){return Array.prototype.slice.call(root.querySelectorAll('.indexer-row'));}
    function sync(){add.disabled=rows().length>=5;}
    add.addEventListener('click',function(){if(rows().length>=5)return;root.appendChild(template.content.cloneNode(true));sync();});
    root.addEventListener('click',function(e){var remove=e.target.closest('.remove');if(!remove)return;var row=remove.closest('.indexer-row');if(rows().length===1){row.querySelectorAll('input').forEach(function(i){i.value='';});}else row.remove();sync();});sync();
    document.addEventListener('click',function(e){var button=e.target.closest('.reveal');if(!button)return;var input=button.parentElement.querySelector('input');var show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'Hide':'Show';});
    function payload(){return {torboxApiKey:document.getElementById('torbox-key').value.trim(),newznabIndexers:rows().map(function(row){return {name:row.querySelector('.ix-name').value.trim(),url:row.querySelector('.ix-url').value.trim(),apiKey:row.querySelector('.ix-key').value.trim()};}).filter(function(x){return x.url||x.apiKey||x.name;}),catalogs:Array.prototype.slice.call(document.querySelectorAll('.catalog:checked')).map(function(i){return i.value;}),showCatalogsOnHome:document.getElementById('show-home').checked,nativeNewznabDirectLinkEnabled:document.getElementById('direct-link').checked,maxStreams:parseInt(document.getElementById('max-streams').value||'0',10)};}
    async function generate(action){var message=document.getElementById('message'),buttons=[document.getElementById('install'),document.getElementById('copy')];buttons.forEach(function(b){b.disabled=true;});message.className='message';message.textContent='Encrypting configuration…';try{var response=await fetch('/configure/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload())});var data=await response.json();if(!response.ok)throw new Error(data.error||'Configuration failed.');document.getElementById('manifest-url').value=data.manifestUrl;document.getElementById('collection-link').href=data.collectionUrl;document.getElementById('output').classList.add('show');history.replaceState(null,'',data.configureUrl);if(action==='copy'){await copyText(data.manifestUrl);message.textContent='Manifest link copied.';}else{message.textContent='Opening Stremio…';window.location.href=data.installUrl;}}catch(err){message.className='message danger';message.textContent=err.message;}finally{buttons.forEach(function(b){b.disabled=false;});}}
    async function copyText(text){if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(text);var area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();}
    document.getElementById('install').addEventListener('click',function(){generate('install');});document.getElementById('copy').addEventListener('click',function(){generate('copy');});document.getElementById('copy-output').addEventListener('click',async function(){await copyText(document.getElementById('manifest-url').value);document.getElementById('message').textContent='Manifest link copied.';});
    ${token ? `var initialOrigin=window.location.origin,initialToken=${JSON.stringify(token)};document.getElementById('manifest-url').value=initialOrigin+'/c/'+encodeURIComponent(initialToken)+'/manifest.json';document.getElementById('collection-link').href=initialOrigin+'/c/'+encodeURIComponent(initialToken)+'/nuvio-collections.json';` : ''}
  })();
  </script>`);
}

module.exports = { landingPage, registrationPage, configurationPage };
