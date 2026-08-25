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

module.exports = { landingPage, registrationPage };
