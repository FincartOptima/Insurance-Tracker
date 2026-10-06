const { JSDOM, VirtualConsole } = require('jsdom');
const assert = require('node:assert/strict');
const base = 'http://127.0.0.1:5003';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Chart drawing is checked separately in a browser; this exercises page data flow.
(async () => {
  const errors = [], exports = [];
  let failOverdue = false, failSummary = false;
  let releaseInitial;
  const initialGate = new Promise(resolve => { releaseInitial=resolve; });
  let holdInitial = true;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const html = (await (await fetch(base)).text()).replace(/<script src="[^"]*chart\.min\.js"><\/script>/, '');
  const dom = new JSDOM(html, {
    url:base, resources:'usable', runScripts:'dangerously', virtualConsole,
    beforeParse(w) {
      w.Chart=class {constructor(el,config){this.config=config;w.testCharts ??={};w.testCharts[el.id]=this;}destroy(){}};
      w.AbortController=AbortController;
      w.URL.createObjectURL=()=> 'blob:test-export';w.URL.revokeObjectURL=()=>{};
      w.HTMLAnchorElement.prototype.click=function() {};
      w.fetch=async (path, options) => {
        if(path.startsWith('/api/renewals/export?')) exports.push(new URL(path,base));
        else if(path.startsWith('/api/renewals?')) {
          if(holdInitial){holdInitial=false;await initialGate;}
          if(failOverdue) return {ok:false};
        } else if(path === '/api/overview' && failSummary) return {ok:false};
        return fetch(new URL(path,base),options);
      };
    }
  });
  const w=dom.window, $=id=>w.document.getElementById(id);
  async function until(fn) {for(let i=0;i<150;i++){if(fn())return;await delay(20);}throw new Error('Timed out');}
  const loaded=()=>until(()=>$('overdue-section').getAttribute('aria-busy') === 'false');
  const change=(id,value,event='change')=>{$(id).value=value;$(id).dispatchEvent(new w.Event(event,{bubbles:true}));};
  await until(()=>$('ov-active').textContent === '70');
  assert.equal($('loading-screen').hidden,false, 'Loader waits for overdue data too');
  releaseInitial();await loaded();await until(()=>$('loading-screen').hidden);
  assert.equal($('overdue-table-body').rows.length,5);
  assert.equal($('od-export').disabled,false);
  assert.equal($('od-error').hidden,true);
  const chart=w.testCharts['overdue-team-chart'];
  const chosenTeam=chart.config.data.labels[0];
  chart.config.options.onClick({},[{index:0}]);await loaded();
  assert.equal($('od-team-filter').value,chosenTeam);
  assert.equal($('overdue-table-body').rows.length,chosenTeam === 'West' ? 3 : 2);
  // Month, team, RM and type work together and are retained by export.
  const month=[...$('od-month-filter').options].find(o=>o.value !== 'all').value;
  change('od-month-filter',month);await loaded();
  $('od-export').click();await until(()=>exports.length === 1);await until(()=>$('od-export').querySelector('span').textContent !== 'Preparing Excel…');
  assert.equal(exports[0].searchParams.get('bucket'),'overdue');
  assert.equal(exports[0].searchParams.get('team'),chosenTeam);
  assert.equal(exports[0].searchParams.get('month'),month);
  change('od-search','NO SUCH CLIENT','input');
  assert.equal($('od-export').disabled,true,'Export is disabled during debounce');
  await delay(300);await loaded();
  assert.match($('overdue-table-body').textContent,/No overdue policies match/);
  assert.equal($('od-export').disabled,true);
  $('od-clear-filters').click();await loaded();
  assert.equal($('overdue-table-body').rows.length,5);
  failOverdue=true;change('od-status-filter','Done');await loaded();
  assert.equal($('od-error').hidden,false);
  assert.equal($('od-export').disabled,true,'Failed refresh cannot export stale results');
  failOverdue=false;$('od-retry').click();await loaded();
  assert.equal($('od-error').hidden,true);
  assert.equal($('overdue-table-body').rows.length,1);
  failSummary=true;$('overview-retry').click();await until(()=>!$('overview-error').hidden);
  failSummary=false;$('overview-retry').click();await until(()=>$('ov-asof').textContent.startsWith('As of'));
  assert.equal($('overview-error').hidden,true);
  assert.deepEqual(errors,[]);
  dom.window.close();
  console.log('PASS: Overview dual-request loading, overdue filters, chart/team sync, filtered Excel query, pending/empty/error export guards, resets and independent retries.');
})().catch(error=>{console.error(error);process.exit(1);});
