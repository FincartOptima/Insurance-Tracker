const {JSDOM} = require('jsdom');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/workspace.js'), 'utf8');
function setup(awaitData = true, reduce = false) {
  const dom = new JSDOM(`<body data-await-data="${awaitData}"><div id="loading-screen" hidden><span id="loading-status"></span><button id="loading-continue" hidden>Continue</button></div><div id="app-shell"><main id="main" tabindex="-1"></main><span id="workspace-date"></span></div></body>`, {runScripts:'outside-only'});
  const w = dom.window, timers = new Map(); let id = 0;
  w.matchMedia = () => ({matches:reduce});
  w.setTimeout = (fn, ms) => {timers.set(++id, {fn,ms});return id;};
  w.clearTimeout = (id) => timers.delete(id);
  w.eval(source);
  const tick = (ms) => {for(const [id,t] of [...timers]) if(t.ms === ms){timers.delete(id);t.fn();}};
  return {w, tick, el:(id)=>w.document.getElementById(id)};
}
for(const reduce of [false,true]) {
  const {w,tick,el}=setup(true,reduce);
  assert.equal(el('loading-screen').hidden,false);
  assert.equal(el('app-shell').inert,true);
  w.FincartLoader.finish();tick(reduce ? 0 : 240);
  assert.equal(el('loading-screen').hidden,true);
  assert.equal(el('app-shell').inert,false);
  w.close();
}
{
  const {w,tick,el}=setup();tick(6000);
  assert.equal(el('loading-continue').hidden,false);
  el('loading-continue').focus();el('loading-continue').click();tick(240);
  assert.equal(el('app-shell').inert,false);
  assert.equal(w.document.activeElement.id,'main');w.close();
}
{
  const {w,tick,el}=setup();tick(12000);tick(240);
  assert.equal(el('loading-screen').hidden,true);
  assert.equal(el('app-shell').inert,false);w.close();
}
{
  const {w,tick,el}=setup(false);tick(240);
  assert.equal(el('loading-screen').hidden,true);w.close();
}
console.log('PASS: data-ready exit, reduced motion, slow-request escape, focus restoration, timeout fallback, empty/import pages.');
