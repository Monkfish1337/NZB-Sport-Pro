const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const configPath = path.resolve(__dirname, '..', 'config.js');
const snippet = 'const c=require(' + JSON.stringify(configPath) + ');process.stdout.write(JSON.stringify({id:c.addonId,name:c.addonName,enabled:c.experimentalNativeNewznab}));';

function run(source, flag) {
  const env = Object.assign({}, process.env);
  if (flag === undefined) delete env.EXPERIMENTAL_NATIVE_NEWZNAB;
  else env.EXPERIMENTAL_NATIVE_NEWZNAB = flag;
  const out = spawnSync(process.execPath, ['-e', source], { env, encoding: 'utf8' });
  assert.strictEqual(out.status, 0, out.stderr);
  return JSON.parse(out.stdout);
}

function load(flag) { return run(snippet, flag); }

const stable = load(undefined);
assert.deepStrictEqual(stable, {
  id: 'community.serioussportsync',
  name: 'SeriousSportSync',
  enabled: false,
});

const experimental = load('on');
assert.deepStrictEqual(experimental, {
  id: 'community.serioussportsync.experimental',
  name: 'SeriousSportSync Experimental',
  enabled: true,
});

const manifestPath = path.resolve(__dirname, '..', 'lib', 'manifest.js');
const toggleSnippet = 'const b=require(' + JSON.stringify(manifestPath) + ').buildManifest;'
  + 'const has=c=>b({user:{config:c}}).resources.some(r=>r.name==="stream");'
  + 'process.stdout.write(JSON.stringify({'
  + 'uuDefault:has({uuManifestUrl:"https://uu.example/stremio/key/manifest.json"}),'
  + 'uuOff:has({uuManifestUrl:"https://uu.example/stremio/key/manifest.json",uuEnabled:false}),'
  + 'easyDefault:has({easynewsUsername:"u",easynewsPassword:"p"}),'
  + 'easyOff:has({easynewsUsername:"u",easynewsPassword:"p",easynewsEnabled:false})}));';
assert.deepStrictEqual(run(toggleSnippet, undefined), {
  uuDefault: true,
  uuOff: false,
  easyDefault: true,
  easyOff: false,
});

const nativeToggleSnippet = 'const b=require(' + JSON.stringify(manifestPath) + ').buildManifest;'
  + 'const has=c=>b({user:{config:c}}).resources.some(r=>r.name==="stream");'
  + 'const base={torboxApiKey:"tb",newznabIndexers:[{url:"https://indexer.example/api",apiKey:"key"}]};'
  + 'process.stdout.write(JSON.stringify({nativeOn:has({...base,nativeNewznabEnabled:true}),nativeOff:has({...base,nativeNewznabEnabled:false})}));';
assert.deepStrictEqual(run(nativeToggleSnippet, 'on'), { nativeOn: true, nativeOff: false });

console.log('stable/experimental separation and pipeline-toggle tests passed');
