// No dependencies: node tests/regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
for (const [, , code] of scripts) new vm.Script(code);
console.log(`PASS syntax: ${scripts.length} inline scripts`);

function fixture() {
  const events = {}, timers = [], frames = [], styles = new Map(), storage = new Map();
  const on = (type, handler) => (events[type] ||= []).push(handler);
  const root = {className: '', clientWidth: 1024, setAttribute() {}, style: {
    setProperty: (k, v) => styles.set(k, v), removeProperty: k => styles.delete(k),
    getPropertyValue: k => styles.get(k) || ''
  }};
  const window = {innerWidth: 1024, innerHeight: 900, addEventListener: on,
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    matchMedia: query => ({matches: query.includes('coarse')}),
    visualViewport: {width: 1024, height: 900, scale: 1, addEventListener: on}};
  const context = vm.createContext({window, visualViewport: window.visualViewport, document: {documentElement: root, readyState: 'loading', addEventListener() {}},
    navigator: {hardwareConcurrency: 4, language: 'en', userAgent: 'test'},
    localStorage: {getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v)},
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    setInterval() {}, clearInterval() {}, console});
  return {context, window, root, styles, storage, timers, events,
    emit(type) { for (const fn of events[type] || []) fn(); while (frames.length) frames.shift()(); }};
}
const f = fixture();
vm.runInContext(scripts[0][2], f.context);
assert.equal(f.styles.get('--appH'), '900px');
// Same width/orientation: Safari chrome settles AFTER the first resize.
f.window.innerHeight = f.window.visualViewport.height = 725;
f.emit('resize');
assert.equal(f.styles.get('--appH'), '725px');
f.window.visualViewport.height = 650;
f.emit('resize');
assert.equal(f.styles.get('--appH'), '650px');
// Rotation may report the old visual dimensions; don't keep the stale height.
f.window.innerWidth = 768; f.window.innerHeight = 1024;
f.window.visualViewport.width = 768; f.window.visualViewport.height = 1024;
f.emit('orientationchange');
assert.equal(f.styles.get('--appH'), '1024px');
f.window.innerWidth = 1024; f.window.innerHeight = 725;
f.window.visualViewport.height = 1024;
f.emit('resize');
assert.equal(f.styles.get('--appH'), '725px');
// Pinch zoom must not reclassify/reflow the console as a portrait phone.
f.window.visualViewport.scale = 2;
f.window.visualViewport.width = 512; f.window.visualViewport.height = 362;
f.emit('resize');
assert.equal(f.styles.get('--appH'), '725px');
assert.match(f.root.className, /dev-landscape/);
console.log('PASS viewport: same-width settling, rotation, stale visual height, pinch zoom');

for (const name of ['state', 'audio']) {
  const script = scripts.find(([, attrs]) => attrs.includes(`data-mono-module="${name}"`));
  vm.runInContext(script[2], f.context);
}
vm.runInContext(`
  for (const patch of MATERIAL_PATCHES) {
    const tr=mkTrack(); tr.steps[0].on=true; tr.steps[0].locks={'AMP.5':80};
    tr.out='NEIB'; const originalSteps=JSON.stringify(tr.steps);
    applyMaterialPatch(tr,patch.id);
    if(tr.machine!==patch.machine) throw Error('wrong machine');
    if(JSON.stringify(tr.steps)!==originalSteps||tr.out!=='NEIB') throw Error('notes/routing changed');
    for(const pg of PAGES) {
      if(tr.params[pg].length!==8||tr.params[pg].some(v=>!Number.isInteger(v)||v<0||v>127)) throw Error('invalid parameter');
    }
    for(const pg in patch.pages) for(const name in patch.pages[pg]) {
      if(!pageDef(tr,pg).some(d=>d&&d.n===name)) throw Error('unknown parameter '+name);
    }
    const first=JSON.stringify(tr.params); applyMaterialPatch(tr,patch.id);
    if(JSON.stringify(tr.params)!==first) throw Error('non-deterministic recipe');
  }
  const fp=factoryPatterns();
  if(fp[8].tracks[0].params.LFO1[7]!==96) throw Error('factory rubber missing');
  if(fp[10].tracks[1].machine!=='FMSTAT') throw Error('factory bubble missing');
  localStorage.setItem(LS_KEY,JSON.stringify({curPat:8,patterns:{8:{...fp[8],name:'MY OWN PATCH'}}}));
  loadSaved();
  if(S.patterns[8].name!=='MY OWN PATCH') throw Error('saved pattern overwritten');
`, f.context);
console.log('PASS six editable recipes, valid named parameters, factory defaults, saved pattern preservation');
vm.runInContext(`
  const sources=[];
  AE.ctx={createConstantSource(){
    const src={events:[],targets:[],offset:{
      setValueAtTime(v,t){src.events.push(['set',v,t]);},
      linearRampToValueAtTime(v,t){src.events.push(['ramp',v,t]);}
    },connect(target){src.targets.push(target);}};
    sources.push(src); return src;
  }};
  for(const id of ['rubber','bubble','plastic','latex']){
    const tr=mkTrack(); applyMaterialPatch(tr,id);
    const specs=audioPitchSpecs(tr.params,120);
    if(!specs||specs[0].duration<=0) throw Error('missing pitch envelope');
    const v={oscs:[{o:{detune:{}}},{o:{detune:{}}}],nodes:[]};
    scheduleAudioPitch(v,specs,10);
    const src=sources[sources.length-1];
    if(!v._audioPitch||src.targets.length!==2||src.events[1][1]!==0||src.events[1][2]<=10) throw Error('bad native automation');
    tr.params.LFO1[2]=0; // FREE must use the general LFO, not the one-shot path
    if(audioPitchSpecs(tr.params,120)!==null) throw Error('FREE incorrectly accelerated');
  }
  AE.ctx={};
  if(audioPitchSpecs(mkTrack().params,120)!==null) throw Error('no legacy fallback');
`, f.context);
console.log('PASS audio-clock pitch strikes, neutral ending, FREE/legacy fallback');
