/* MONOMACHINE WEB — audio engine: machines, track chain, FX, LFOs, sequencer.
   Clean-room Web Audio recreation. Envelope laws & SWAVE behaviour follow
   MONO2K's published calibration notes measured against OS 1.32B. */
'use strict';
const AE={ctx:null,started:false,tracks:[],uiQueue:[],lfoOff:[],midiOutPort:null,workletOK:false,_stopMuted:false,_stopSerial:0};
const $AE=()=>AE.ctx;
const nowT=()=>AE.ctx?AE.ctx.currentTime:0;
function seededRand(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/* ---------- waves ---------- */
function makeWaves32(ctx){
  const waves=[];
  for(let i=0;i<32;i++){
    const R=seededRand(1000+i*77), NH=64, re=new Float32Array(NH+1), im=new Float32Array(NH+1);
    const kind=i%8;
    for(let k=1;k<=NH;k++){
      let a=0;
      if(kind===0) a=1/k*(0.6+R()*0.6);                       // bright digital saw-ish
      else if(kind===1) a=(k%2?1/(k*k):0)*(0.7+R()*0.5);     // hollow
      else if(kind===2) a=(k===1||k===4||k===7||k===11)?(0.7/k):0.02*R(); // bell-ish
      else if(kind===3) a=Math.exp(-Math.pow(k-(4+R()*8),2)/8)*0.8+ (k===1?0.4:0); // formant
      else if(kind===4) a=(k%3===0?0.5/k:(k===1?0.8:0.03));
      else if(kind===5) a=Math.pow(0.82,k)*(0.4+R());          // spike
      else if(kind===6) a=(k<=6?1/k:0.25*Math.exp(-(k-10)/6)*R());
      else a=(R()<0.3? (0.5/k):0.01);
      const ph=R()<0.5?0:Math.PI/2*(R()-0.5);
      re[k]=a*Math.cos(ph); im[k]=a*Math.sin(ph);
      // 12-bit character: quantize harmonic amps coarsely for grit
      re[k]=Math.round(re[k]*2048)/2048; im[k]=Math.round(im[k]*2048)/2048;
    }
    waves.push(ctx.createPeriodicWave(re,im,{normalize:true}));
  }
  return waves;
}
function makeClassicWaves(ctx){ // slots 33..64 stand-ins (like MONO2K/Monomodule stand-in bank)
  const defs=[];
  const H=(fn)=>{const NH=64,re=new Float32Array(NH+1),im=new Float32Array(NH+1);for(let k=1;k<=NH;k++){re[k]=0;im[k]=fn(k);}return ctx.createPeriodicWave(re,im,{normalize:true});};
  defs.push(H(k=>k===1?1:0)); defs.push(H(k=>k%2?1/(k*k)*( (k%4===1)?1:-1):0));
  defs.push(H(k=>1/k)); defs.push(H(k=>k%2?1/k:0)); defs.push(H(k=>k%2?1/k:0.3/k));
  defs.push(H(k=>k<=5?1:0)); defs.push(H(k=>(k===1||k===2||k===3||k===4)?1/Math.sqrt(k):0));
  defs.push(H(k=>k%2?1/Math.sqrt(k):0)); defs.push(H(k=>Math.exp(-k/9)));
  defs.push(H(k=>Math.exp(-Math.pow(k-6,2)/10)+0.3*(k===1?1:0)));
  for(let i=defs.length;i<32;i++){ const R=seededRand(5000+i*31); defs.push(H(k=>Math.pow(0.9,k)*R()*(k%((i%4)+2)===1?1:0.25))); }
  return defs;
}
function waveFromSamples(ctx,samples){
  const N=samples.length, NH=96, re=new Float32Array(NH+1), im=new Float32Array(NH+1);
  for(let k=1;k<=NH;k++){ let r=0,i2=0; for(let n=0;n<N;n++){ const ph=2*Math.PI*k*n/N; r+=samples[n]*Math.cos(ph); i2-=samples[n]*Math.sin(ph);} re[k]=2*r/N; im[k]=2*i2/N; }
  return ctx.createPeriodicWave(re,im,{normalize:true});
}
AE._w64cache={};
function getWave64(idx){
  idx=clamp(idx,0,63);
  const uw=S.userWaves[idx];
  if(uw){ if(AE._w64cache[idx]!==uw){ AE._w64cache[idx]=uw; AE._w64cache['w'+idx]=waveFromSamples(AE.ctx,uw.data);} return AE._w64cache['w'+idx]; }
  return idx<32? AE.waves32[idx] : AE.wavesClassic[idx-32];
}

/* ---------- helpers ---------- */
function mkGain(v=1){const g=AE.ctx.createGain();g.gain.value=v;return g;}
function mkFilter(type,f,q=0.7){const o=AE.ctx.createBiquadFilter();o.type=type;o.frequency.value=f;o.Q.value=q;return o;}
function mkOsc(type,f){const o=AE.ctx.createOscillator();o.type=type;o.frequency.value=f;return o;}
function mkWaveOsc(w,f){const o=AE.ctx.createOscillator();o.setPeriodicWave(w);o.frequency.value=f;return o;}
let _stepCurve=null;
function stepCurve(){ if(_stepCurve) return _stepCurve; const c=new Float32Array(512); for(let i=0;i<512;i++){const x=i/255.5-1; c[i]=x<0?-0.85:0.85;} return _stepCurve=c; }
function quantCurve(bits){ const n=Math.pow(2,bits), c=new Float32Array(1024); for(let i=0;i<1024;i++){const x=i/511.5-1; c[i]=Math.round(x*n)/n;} return c; }
const _qc={}; function setQuant(sh,bits){ bits=clamp(Math.round(bits),2,16); if(!_qc[bits])_qc[bits]=quantCurve(bits); sh.curve=_qc[bits]; }
function distCurveFor(k){ const c=new Float32Array(512); for(let i=0;i<512;i++){const x=i/255.5-1; c[i]=Math.tanh(k*x)/Math.tanh(k*0.7)*0.85;} return c; }
let _delayCurve=null;
function delayCurve(){ // near-unity small-signal gain: the feedback coefficient, not the clipper, decides decay
  if(_delayCurve) return _delayCurve;
  const c=new Float32Array(512); for(let i=0;i<512;i++){ const x=i/255.5-1; c[i]=Math.tanh(1.05*x)*0.96; }
  return _delayCurve=c;
}
function setParamFast(param,t,v,tau=0.012){
  if(!param) return;
  try{ param.cancelScheduledValues(t); }catch(e){}
  try{ param.setTargetAtTime(v,t,tau); }catch(e){ param.value=v; }
}
/* variable-width pulse: saw + DC offset -> step waveshaper (true PWM via offset.gain) */
function pulseOsc(f,pw01){
  const ctx=AE.ctx, saw=mkOsc('sawtooth',f), sum=mkGain(1), off=ctx.createConstantSource(), offG=mkGain(1), sh=ctx.createWaveShaper();
  sh.curve=stepCurve(); off.offset.value=clamp(1-2*pw01,-0.98,0.98);
  saw.connect(sum); off.connect(offG); offG.connect(sum); sum.connect(sh);
  const out=mkGain(1); sh.connect(out);
  return {osc:saw, out, pwParam:off.offset, start(t){saw.start(t);off.start(t);}, stop(t){try{saw.stop(t);}catch(e){} try{off.stop(t);}catch(e){}}};
}
const pwToOffset=pw01=>clamp(1-2*clamp(pw01,0.02,0.98),-0.98,0.98);
const FREQ=v=>clamp(20*Math.pow(1000,clamp(v,0,140)/127),18,19000);
const QMAP=v=>0.5+Math.pow(v/127,2)*16;
const atkSec=v=>Math.min(10,0.0009*Math.exp(0.0814*v));           // MONO2K calibration
const decTau=v=>Math.min(8,(0.0083*Math.exp(0.0665*v))/1.2);      // 20 dB in 8.3ms*e^(0.0665v)
const holdSec=v=>v*0.0146;                                          // 14.6 ms per step
const FM_RATIOS=[0.25,0.5,0.75,1,1.001,1.5,2,2.5,3,3.5,4,5,6,7,8,9,10,11,12,14,16,18,20,24,28,32,40,48];
const fmRatio=raw=>FM_RATIOS[clamp(Math.floor(raw/128*FM_RATIOS.length),0,FM_RATIOS.length-1)];

/* effective params = kit params + step locks + LFO snapshot offsets */
function effParams(tr,locks,ti){
  const e={}; for(const pg of PAGES) e[pg]=tr.params[pg].slice();
  e._ptchCents=0;
  const off=(ti!=null&&AE.lfoOff[ti])?AE.lfoOff[ti]:null;
  if(off){ for(const k in off){ if(k==='PTCH'){e._ptchCents=off[k];continue;} const [pg,i]=k.split('.'); if(e[pg]) e[pg][+i]=R127(e[pg][+i]+off[k]); } }
  if(locks) for(const k in locks){ const [pg,i]=k.split('.'); if(e[pg]) e[pg][+i]=locks[k]; }
  return e;
}

function safeAudioResume(timeoutMs){
  const ctx=AE.ctx;
  if(!ctx||!ctx.resume) return Promise.resolve(false);
  if(ctx.state==='running') return Promise.resolve(true);
  const limit=(typeof timeoutMs==='number'&&timeoutMs>0)?timeoutMs:450;
  try{
    const p=ctx.resume();
    if(p&&typeof p.then==='function'){
      let timer=null;
      const settled=p.then(()=>ctx.state==='running').catch(e=>{ AE._resumeError=e; return false; });
      // Firefox (and some embedded WebViews) can leave resume() pending
      // forever when output is unavailable/blocked. Never let POWER/PLAY
      // handlers await that promise indefinitely: after a short grace
      // period, let the UI continue and retry on the next real gesture.
      const timed=new Promise(resolve=>{
        timer=setTimeout(()=>{
          AE._resumeError=new Error('AudioContext.resume() timeout; state='+ctx.state);
          resolve(false);
        },limit);
      });
      return Promise.race([settled,timed]).then(v=>{ if(timer)clearTimeout(timer); return v; });
    }
  }catch(e){ AE._resumeError=e; return Promise.resolve(false); }
  return Promise.resolve(ctx.state==='running');
}
AE.resume=safeAudioResume;
function safeAudioSuspend(){
  const ctx=AE.ctx;
  if(!ctx||!ctx.suspend) return Promise.resolve(false);
  try{
    const p=ctx.suspend();
    if(p&&typeof p.then==='function') return p.then(()=>true).catch(()=>false);
  }catch(e){ return Promise.resolve(false); }
  return Promise.resolve(true);
}
AE.suspend=safeAudioSuspend;

/* ---------- engine init ---------- */
async function initAudio(){
  if(AE.started) { safeAudioResume(); return; }
  if(AE._initPromise) return AE._initPromise;
  AE._initPromise=initAudioOnce().catch(e=>{ AE._initPromise=null; throw e; });
  return AE._initPromise;
}
async function initAudioOnce(){
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC) throw new Error('Web Audio недоступен в этом браузере');
  let ctx;
  try{ ctx=new AC({latencyHint:'interactive'}); }catch(e){ ctx=new AC(); }
  AE.ctx=ctx;
  AE.busSum=mkGain(1); AE.master=mkGain(S.masterVol);
  AE.comp=ctx.createDynamicsCompressor(); AE.comp.threshold.value=-14; AE.comp.ratio.value=4; AE.comp.knee.value=18;
  AE.analyser=ctx.createAnalyser(); AE.analyser.fftSize=512;
  AE.busSum.connect(AE.master); AE.master.connect(AE.comp); AE.comp.connect(AE.analyser); AE.analyser.connect(ctx.destination);
  try{ AE.streamDest=ctx.createMediaStreamDestination?ctx.createMediaStreamDestination():null; if(AE.streamDest) AE.master.connect(AE.streamDest); }
  catch(e){ AE.streamDest=null; } // PCM WAV recording has its own ScriptProcessor path; this must never block audio on old Safari.
  AE.inputGain=mkGain(0); // getUserMedia source connects here (gain set in enableInput)
  const nb=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate), d=nb.getChannelData(0);
  for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
  AE.noiseBuf=nb;
  AE.waves32=makeWaves32(ctx); AE.wavesClassic=makeClassicWaves(ctx);
  // SRR worklet (sample & hold). Fallback: quantizer shaper.
  try{
    const code=`class C extends AudioWorkletProcessor{static get parameterDescriptors(){return[{name:'factor',defaultValue:1,minValue:1,maxValue:96},{name:'bits',defaultValue:16,minValue:2,maxValue:16}]}constructor(){super();this.h=new Float32Array(2);this.n=new Float32Array(2)}process(i,o,p){const inp=i[0],out=o[0];if(!inp||!inp.length)return true;const f=p.factor[0]||1,bits=p.bits[0]||16;if(f<=1.001&&bits>=15.5){for(let ch=0;ch<out.length;ch++)out[ch].set(inp[ch]||inp[0]);return true}const steps=Math.pow(2,bits-1),inv=1/steps;for(let ch=0;ch<out.length;ch++){const ic=inp[ch]||inp[0],oc=out[ch];let h=this.h[ch],n=this.n[ch];for(let j=0;j<oc.length;j++){n-=1;if(n<=0){n=f;h=Math.round(ic[j]*steps)*inv}oc[j]=h}this.h[ch]=h;this.n[ch]=n}return true}}registerProcessor('mm-crush',C)`;
    const url=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));
    let workletTimer=null;
    await Promise.race([
      ctx.audioWorklet.addModule(url),
      new Promise((resolve,reject)=>{ workletTimer=setTimeout(()=>reject(new Error('AudioWorklet load timeout')),1500); })
    ]);
    if(workletTimer) clearTimeout(workletTimer);
    AE.workletOK=true;
  }catch(e){ AE.workletOK=false; }
  AE.tracks=[];
  for(let i=0;i<6;i++) AE.tracks.push(buildTrackChain(i));
  // neighbour taps
  for(let i=0;i<6;i++){
    const ta=AE.tracks[i], prev=AE.tracks[(i+5)%6];
    prev.level.connect(ta.srcNei);
  }
  AE.busTap=mkGain(0.7); AE.busSum.connect(AE.busTap);
  AE.busDelay=ctx.createDelay(0.1); AE.busDelay.delayTime.value=0.012; AE.busTap.connect(AE.busDelay);
  AE.tracks.forEach(ta=>{ AE.busDelay.connect(ta.srcBus); AE.inputGain.connect(ta.srcInp); rebuildFX(ta, curPat().tracks[ta.idx].machine); });
  AE.started=true;
  AE._initPromise=null;
  for(let i=0;i<6;i++){ applyChain(i, effParams(curPat().tracks[i],null,i), nowT()); }
  setInterval(lfoTick,40);
  ctx.addEventListener && ctx.addEventListener('statechange',()=>{ if(ctx.state==='interrupted') safeAudioResume(); });
}
AE.init=initAudio;

function buildTrackChain(idx){
  const ctx=AE.ctx;
  const ta={idx, voice:null, voices:[], curFreq:440, curNote:60, fltEnvUntil:0, gen:0, lastDist:-1, _chainKey:null, _tailMuted:false, _fxGateState:null, lfoState:[0,1,2].map(()=>({ph:Math.random(),val:0,held:0,active:true}))};
  ta.in=mkGain(1);
  ta.distPre=mkGain(1); ta.dist=ctx.createWaveShaper(); ta.dist.curve=distCurveFor(1); ta.distPost=mkGain(1);
  ta.crushQ=ctx.createWaveShaper(); setQuant(ta.crushQ,16);
  if(AE.workletOK){ ta.crush=new AudioWorkletNode(ctx,'mm-crush',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]}); }
  else ta.crush=mkGain(1);
  ta.hp=mkFilter('highpass',20,0.7); ta.lp1=mkFilter('lowpass',19000,0.7); ta.lp2=mkFilter('lowpass',19000,0.7);
  ta.eq=mkFilter('peaking',1200,0.9); ta.eq.gain.value=0;
  ta.ampEnv=mkGain(0); ta.lfoVol=mkGain(1); ta.postAmp=mkGain(1);
  ta.pan=ctx.createStereoPanner?ctx.createStereoPanner():mkGain(1);
  ta.level=mkGain(0.8); ta.outGain=mkGain(1);
  ta.in.connect(ta.distPre); ta.distPre.connect(ta.dist); ta.dist.connect(ta.distPost);
  // With the worklet present, do not also run a 16-bit WaveShaper on every sample.
  if(AE.workletOK) ta.distPost.connect(ta.crush);
  else { ta.distPost.connect(ta.crushQ); ta.crushQ.connect(ta.crush); }
  ta.crush.connect(ta.hp); ta.hp.connect(ta.lp1); ta.lp1.connect(ta.lp2); ta.lp2.connect(ta.eq);
  ta.eq.connect(ta.ampEnv); ta.ampEnv.connect(ta.lfoVol); ta.lfoVol.connect(ta.postAmp); ta.postAmp.connect(ta.pan);
  if(ta.pan.connect) ta.pan.connect(ta.level);
  ta.level.connect(ta.outGain); ta.outGain.connect(AE.busSum);
  // tape-style per-track delay (filtered feedback loop)
  ta.dSend=mkGain(0); ta.delay=ctx.createDelay(2.5); ta.delay.delayTime.value=0.28;
  ta.dFb=mkGain(0.35); ta.dHp=mkFilter('highpass',120,0.5); ta.dLp=mkFilter('lowpass',6000,0.5);
  ta.dClip=ctx.createWaveShaper(); ta.dClip.curve=delayCurve();
  ta.dRet=mkGain(0.9);
  ta.postAmp.connect(ta.dSend); ta.dSend.connect(ta.delay);
  ta.delay.connect(ta.dHp); ta.dHp.connect(ta.dLp); ta.dLp.connect(ta.dClip); ta.dClip.connect(ta.dFb); ta.dFb.connect(ta.delay);
  ta.delay.connect(ta.dRet); ta.dRet.connect(ta.pan);
  // FX machine input section
  ta.srcNei=mkGain(0); ta.srcInp=mkGain(0); ta.srcBus=mkGain(0);
  ta.fxIn=mkGain(1); ta.srcNei.connect(ta.fxIn); ta.srcInp.connect(ta.fxIn); ta.srcBus.connect(ta.fxIn);
  ta.fxProcIn=mkGain(1); ta.fxProcOut=mkGain(1); ta.fxOn=mkGain(0);
  ta.fxIn.connect(ta.fxProcIn); ta.fxProcOut.connect(ta.fxOn); ta.fxOn.connect(ta.in);
  ta.fxNodes=null; ta.fxMachine=null;
  return ta;
}

/* ---------- FX machines (process NEIB / INP / BUS) ---------- */
function clearFX(ta){
  if(ta.fxNodes){ ta.fxNodes.all.forEach(n=>{ try{n.disconnect();}catch(e){} if(n.stop)try{n.stop();}catch(e){} }); }
  try{ta.fxProcIn.disconnect();}catch(e){}
  ta.fxProcIn.connect(ta.fxProcOut); // temporary passthrough, replaced below if FX
  ta.fxNodes=null;
}
function rebuildFX(ta,machineId){
  ta._chainKey=null; ta._fxGateState=null;
  clearFX(ta);
  ta.fxMachine=machineId;
  const ctx=AE.ctx, isFX=!!MACH[machineId].fx;
  ta.fxOn.gain.value=isFX?1:0;
  if(!isFX) return;
  try{ta.fxProcIn.disconnect(ta.fxProcOut);}catch(e){}
  const all=[], N=n=>{all.push(n);return n;};
  const dry=N(mkGain(0.5)), wet=N(mkGain(0.5)), procIn=N(mkGain(1));
  ta.fxProcIn.connect(procIn); ta.fxProcIn.connect(dry); dry.connect(ta.fxProcOut); wet.connect(ta.fxProcOut);
  const fx={all,dry,wet,procIn};
  if(machineId==='THRU'){ procIn.connect(wet); dry.gain.value=0; wet.gain.value=1; }
  else if(machineId==='REVERB'){
    fx.hp=N(mkFilter('highpass',150,0.5)); fx.lp=N(mkFilter('lowpass',8000,0.5)); fx.conv=N(ctx.createConvolver());
    procIn.connect(fx.hp); fx.hp.connect(fx.conv); fx.conv.connect(fx.lp); fx.lp.connect(wet);
    fx.irKey=''; regenIR(ta,80,60,0);
  } else if(machineId==='CHORUS'||machineId==='FLANGER'){
    const fl=machineId==='FLANGER';
    fx.dly=N(ctx.createDelay(0.1)); fx.dly.delayTime.value=fl?0.003:0.018;
    fx.lfo=N(mkOsc('sine',0.6)); fx.lfoG=N(mkGain(fl?0.0012:0.0022));
    fx.lfo.connect(fx.lfoG); fx.lfoG.connect(fx.dly.delayTime); fx.lfo.start();
    fx.fb=N(mkGain(fl?0.55:0.15)); fx.lp=N(mkFilter('lowpass',12000,0.5));
    procIn.connect(fx.dly); fx.dly.connect(fx.lp); fx.lp.connect(wet); fx.lp.connect(fx.fb); fx.fb.connect(fx.dly);
    fx.dly2=N(ctx.createDelay(0.1)); fx.dly2.delayTime.value=fl?0.004:0.023; // width: second tap to opposite pan side
    fx.widPan=ctx.createStereoPanner?N(ctx.createStereoPanner()):N(mkGain(0));
    procIn.connect(fx.dly2); fx.dly2.connect(fx.widPan); if(fx.widPan.connect)fx.widPan.connect(wet);
  } else if(machineId==='DYNAMIX'){
    fx.comp=N(ctx.createDynamicsCompressor()); fx.makeup=N(mkGain(1));
    procIn.connect(fx.comp); fx.comp.connect(fx.makeup); fx.makeup.connect(wet);
  } else if(machineId==='RINGMOD'){
    fx.ring=N(mkGain(0)); fx.carrier=N(mkOsc('sine',220)); fx.carG=N(mkGain(1));
    fx.carrier.connect(fx.carG); fx.carG.connect(fx.ring.gain); fx.carrier.start();
    procIn.connect(fx.ring); fx.ring.connect(wet);
  } else if(machineId==='PHASER'){
    fx.aps=[]; fx.lfo=N(mkOsc('sine',0.4)); fx.fb=N(mkGain(0.3)); fx.lfo.start();
    let prev=procIn;
    for(let i=0;i<4;i++){ const ap=N(mkFilter('allpass',600,1.2)); const lg=N(mkGain(400)); fx.lfo.connect(lg); lg.connect(ap.frequency); fx.aps.push(ap); prev.connect(ap); prev=ap; if(i===0)fx.lfoG=lg; else lg.gain.value=400; }
    prev.connect(wet); prev.connect(fx.fb); fx.fb.connect(fx.aps[0]);
  }
  ta.fxNodes=fx;
}
let _irTimer={};
function regenIR(ta,dec,damp,gate){
  const key=dec+'/'+damp+'/'+gate; if(ta.fxNodes&&ta.fxNodes.irKey===key) return;
  clearTimeout(_irTimer[ta.idx]);
  _irTimer[ta.idx]=setTimeout(()=>{
    const ctx=AE.ctx; if(!ta.fxNodes||!ta.fxNodes.conv) return;
    const dur=0.25+Math.pow(dec/127,1.4)*5.5, sr=ctx.sampleRate, len=Math.floor(sr*dur);
    const buf=ctx.createBuffer(2,len,sr);
    const gateLen=gate>2? Math.floor(len*(1-gate/160)) : len;
    for(let ch=0;ch<2;ch++){ const dd=buf.getChannelData(ch); let lp=0; const coeff=1-Math.pow(damp/127,1.5)*0.92;
      for(let i=0;i<len;i++){ const w=Math.random()*2-1; lp+=coeff*(w-lp); const env=Math.exp(-3.2*i/len)*(i>gateLen?0:1); dd[i]=lp*env; } }
    ta.fxNodes.conv.buffer=buf; ta.fxNodes.irBuffer=buf; ta.fxNodes.irKey=key;
  },120);
}
function applyFXParams(ta,eff){
  const fx=ta.fxNodes; if(!fx) return; const v=eff.SYN, m=ta.fxMachine, t=nowT();
  if(fx.conv&&!fx.conv.buffer&&fx.irBuffer) fx.conv.buffer=fx.irBuffer;
  const mix=i=>{ if(fx.dry){const x=v[i]/127; fx.dry.gain.setTargetAtTime(1-x,t,0.03); fx.wet.gain.setTargetAtTime(x*1.1,t,0.03);} };
  if(m==='REVERB'){ regenIR(ta,v[0],v[1],v[2]); mix(3); fx.hp.frequency.setTargetAtTime(FREQ(v[4]),t,0.05); fx.lp.frequency.setTargetAtTime(FREQ(v[5]+20),t,0.05); }
  else if(m==='CHORUS'||m==='FLANGER'){ const fl=m==='FLANGER';
    fx.dly.delayTime.setTargetAtTime(fl?0.0006+v[0]/127*0.009:0.006+v[0]/127*0.03,t,0.05);
    fx.lfoG.gain.setTargetAtTime((v[1]/127)*(fl?0.004:0.006),t,0.05);
    fx.lfo.frequency.setTargetAtTime(0.05+Math.pow(v[2]/127,1.6)*9,t,0.05); mix(3);
    fx.fb.gain.setTargetAtTime(clamp((v[4]-64)/63*(fl?0.92:0.7),-0.95,0.95)*(fl?1:1)+ (fl?0:0),t,0.05);
    if(fx.widPan&&fx.widPan.pan) fx.widPan.pan.setTargetAtTime((v[5]/127)*0.9,t,0.05);
    if(fx.lp&&m==='CHORUS') fx.lp.frequency.setTargetAtTime(FREQ(v[6]+15),t,0.05);
  }
  else if(m==='DYNAMIX'){ const c=fx.comp;
    c.attack.setTargetAtTime(0.001+Math.pow(v[0]/127,2)*0.25,t,0.03);
    c.release.setTargetAtTime(0.03+Math.pow(v[1]/127,2)*0.9,t,0.03);
    c.threshold.setTargetAtTime(-54+v[2]/127*48,t,0.03); mix(3);
    c.ratio.setTargetAtTime(1+Math.pow(v[4]/127,1.5)*19,t,0.03);
    fx.makeup.gain.setTargetAtTime(Math.pow(10,((v[5]-64)/63*18)/20),t,0.03);
    c.knee.setTargetAtTime(v[6]/127*30,t,0.03);
  }
  else if(m==='RINGMOD'){ const waves=['sine','triangle','sawtooth','square']; fx.carrier.type=waves[enumIdx(MACH.RINGMOD.syn[0],v[0])]; mix(3); }
  else if(m==='PHASER'){ const c=FREQ(v[0]+10); fx.aps.forEach(ap=>ap.frequency.setTargetAtTime(c,t,0.05));
    fx.aps.forEach((ap,i)=>{}); if(fx.lfoG) fx.lfoG.gain.setTargetAtTime((v[1]/127)*c*0.9,t,0.05);
    fx.all.forEach(n=>{ if(n.gain&&n!==fx.dry&&n!==fx.wet&&n!==fx.fb&&n!==fx.procIn&&n!==fx.lfoG){ try{n.gain.setTargetAtTime((v[1]/127)*c*0.9,t,0.05);}catch(e){} }});
    fx.lfo.frequency.setTargetAtTime(0.03+Math.pow(v[2]/127,1.6)*7,t,0.05); mix(3);
    fx.fb.gain.setTargetAtTime(v[4]/127*0.85,t,0.05);
  }
  // INP source select
  const inp=enumIdx({e:INP_LIST}, v[7]);
  ta.srcNei.gain.setTargetAtTime(inp===0||inp===3?1:0,t,0.02);
  ta.srcInp.gain.setTargetAtTime(inp===1||inp===3?1:0,t,0.02);
  ta.srcBus.gain.setTargetAtTime(inp===2?0.8:0,t,0.02);
}

/* ---------- track chain params ---------- */
function applyChain(ti,eff,t){
  const ta=AE.tracks[ti]; if(!ta) return; const tr=curPat().tracks[ti];
  const A=eff.AMP,F=eff.FILT,E=eff.EFX;
  const tailMuted=!!(AE._stopMuted||ta._tailMuted||tr.muted);
  const sdNow=stepDur(curPat());
  const chainKey=[A[4],A[5],A[6],F[0],F[1],F[2],F[3],E[0],E[1],E[2],E[3],E[4],E[5],E[6],E[7],tr.level,tr.out,sdNow.toFixed(5),tailMuted?1:0,S.playing?1:0,
    MACH[tr.machine].fx?eff.SYN.join(','):''].join('|');
  if(ta._chainKey===chainKey&&t>=ta.fltEnvUntil) return;
  ta._chainKey=chainKey;
  // DIST: bipolar — below 64 lowers level, above adds drive (as on hardware)
  if(A[4]!==ta.lastDist){ ta.lastDist=A[4];
    if(A[4]<=64){ ta.distPre.gain.value=(A[4]+4)/68; ta.dist.curve=distCurveFor(1); ta.distPost.gain.value=1; }
    else { const k=1+(A[4]-64)/63*36; ta.distPre.gain.value=1; ta.dist.curve=distCurveFor(k); ta.distPost.gain.value=0.9; }
  }
  // SRR
  if(AE.workletOK&&ta.crush.parameters){ const f=1+Math.round(Math.pow(E[2]/127,1.7)*70); ta.crush.parameters.get('factor').setTargetAtTime(f,t,0.02); setQuant(ta.crushQ,16); }
  else setQuant(ta.crushQ, 16-Math.round(E[2]/127*12));
  // filter static position (env guarded in noteOn scheduling)
  if(t>=ta.fltEnvUntil){
    ta.hp.frequency.setTargetAtTime(FREQ(F[0]),t,0.02);
    const lp=FREQ(F[0]+F[1]); ta.lp1.frequency.setTargetAtTime(lp,t,0.02); ta.lp2.frequency.setTargetAtTime(lp,t,0.02);
  }
  ta.hp.Q.setTargetAtTime(QMAP(F[2])*0.7,t,0.02);
  ta.lp1.Q.setTargetAtTime(QMAP(F[3]),t,0.02); ta.lp2.Q.setTargetAtTime(QMAP(F[3])*0.6,t,0.02);
  ta.eq.frequency.setTargetAtTime(FREQ(E[0]+8),t,0.02);
  ta.eq.gain.setTargetAtTime((E[1]-64)/63*15,t,0.02);
  if(ta.pan.pan) ta.pan.pan.setTargetAtTime((A[6]-64)/63,t,0.02);
  ta.level.gain.setTargetAtTime(Math.pow(tr.level/127,1.4)*1.1,t,0.02);
  ta.outGain.gain.setTargetAtTime(tailMuted||tr.out==='NEIB'?0:1,t,0.02);
  // delay (tape style: smooth time changes)
  const dSteps=0.25+ (E[3]/127)*15.75;
  ta.delay.delayTime.setTargetAtTime(tailMuted?0.02:clamp(sdNow*dSteps,0.02,2.4),t,tailMuted?0.03:0.09);
  ta.dSend.gain.setTargetAtTime(tailMuted?0:Math.pow(E[4]/127,1.5)*1.0,t,0.02);
  ta.dFb.gain.setTargetAtTime(tailMuted?0:clamp(Math.pow(E[5]/127,0.85)*0.92,0,0.92),t,0.02);
  ta.dRet.gain.setTargetAtTime(tailMuted?0:0.9,t,0.02);
  ta.dHp.frequency.setTargetAtTime(FREQ(E[6]),t,0.02); ta.dLp.frequency.setTargetAtTime(FREQ(E[6]+E[7]),t,0.02);
  const fxGate=MACH[tr.machine].fx&&!tailMuted?1:0;
  if(ta._fxGateState!==fxGate){ ta._fxGateState=fxGate; setParamFast(ta.fxOn.gain,t,fxGate,0.01); setParamFast(ta.fxProcIn.gain,t,fxGate,0.01); }
  if(MACH[tr.machine].fx) applyFXParams(ta,eff);
  // FX audition: gate open while stopped so you can hear the neighbour through it.
  // An explicit STOP/mute wins over audition until the next PLAY/note clears the tail gate.
  if(MACH[tr.machine].fx && !S.playing && !tailMuted){ ta.ampEnv.gain.setTargetAtTime(Math.pow(A[5]/127,1.3),t,0.05); }
}
AE.applyChain=applyChain;
AE.setMachine=ti=>{ const ta=AE.tracks[ti]; if(!ta)return; stopVoice(ta,nowT(),true); rebuildFX(ta,curPat().tracks[ti].machine); applyChain(ti,effParams(curPat().tracks[ti],null,ti),nowT()); };

/* ---------- envelopes ---------- */
function scheduleAmpEnv(param,eff,t,peak,lenSec){
  const A=eff.AMP, atk=atkSec(A[0]), hold=holdSec(A[1]), decT=decTau(A[2]), relT=decTau(A[3]);
  param.cancelScheduledValues(t);
  param.setValueAtTime(0.0001,t);
  param.linearRampToValueAtTime(Math.max(0.0002,peak),t+Math.max(0.001,atk));
  const hd=t+Math.max(0.001,atk)+hold;
  param.setValueAtTime(Math.max(0.0002,peak),hd);
  if(A[2]<127) param.setTargetAtTime(0,hd,Math.max(0.004,decT));
  const tOff=t+lenSec;
  if(A[2]>=127 || hd+decT*4>tOff){ /* release handled by caller noteOff */ }
  return {tOff,relT,decT,hd};
}
function releaseAmp(param,t,relTauV){ param.cancelScheduledValues(t); try{param.setValueAtTime(Math.max(0.0001,param.value),t);}catch(e){} param.setTargetAtTime(0,t,Math.max(0.004,relTauV)); }
function scheduleFiltEnv(ta,eff,t){
  const F=eff.FILT, atk=atkSec(F[4]), decT=decTau(F[5]);
  const b0=F[0], wEnd=F[0]+F[1], bPk=clamp(b0+(F[6]-64)*1.4,0,140), wPk=clamp(wEnd+(F[7]-64)*1.4,0,150);
  if((F[6]===64&&F[7]===64)) return;
  const hd=t+Math.max(0.001,atk);
  [ta.hp,ta.lp1,ta.lp2].forEach(f=>f.frequency.cancelScheduledValues(t));
  ta.hp.frequency.setValueAtTime(FREQ(b0),t); ta.hp.frequency.linearRampToValueAtTime(FREQ(bPk),hd); ta.hp.frequency.setTargetAtTime(FREQ(b0),hd,Math.max(0.005,decT));
  const lpS=FREQ(wEnd), lpP=FREQ(wPk);
  [ta.lp1,ta.lp2].forEach(f=>{ f.frequency.setValueAtTime(lpS,t); f.frequency.linearRampToValueAtTime(lpP,hd); f.frequency.setTargetAtTime(lpS,hd,Math.max(0.005,decT)); });
  ta.fltEnvUntil=hd+decT*4;
}

/* ---------- voice management ---------- */
function regOsc(v,osc,ratio=1,det=0){ v.oscs.push({o:osc,ratio,det}); if(det) osc.detune.value=det; return osc; }
function newVoice(dest){ const out=mkGain(1); out.connect(dest); return {out,oscs:[],nodes:[],syn:{},stopped:false,
  startAll(t){ this.nodes.forEach(n=>{if(n.start&&!n._st){try{n.start(t);}catch(e){} n._st=1;}}); },
  stop(t){ if(this.stopped)return; this.stopped=true; const o=this.out; o.gain.cancelScheduledValues(t); o.gain.setTargetAtTime(0,t,0.004);
    const oscs=this.oscs, nodes=this.nodes; setTimeout(()=>{ oscs.forEach(x=>{try{x.o.stop();}catch(e){}}); nodes.forEach(n=>{if(n.stop)try{n.stop();}catch(e){} try{n.disconnect();}catch(e){}}); try{o.disconnect();}catch(e){} },Math.max(30,(t-nowT())*1000+120)); },
  glide(f,t,sec){ this.oscs.forEach(x=>{ if(x.o.frequency) x.o.frequency.exponentialRampToValueAtTime(Math.max(8,f*x.ratio),t+Math.max(0.005,sec)); if(x.o.playbackRate&&x.rate0) x.o.playbackRate.exponentialRampToValueAtTime(Math.max(0.05,x.rate0*(f/this.baseF)),t+Math.max(0.005,sec)); }); if(this.onGlide)this.onGlide(f,t,sec); this.baseF=f; }
};}
function stopVoice(ta,t,hard){ if(ta.voice){ ta.voice.stop(t); ta.voice=null; } }
function noiseSrc(rate=1,loop=true){ const s=AE.ctx.createBufferSource(); s.buffer=AE.noiseBuf; s.loop=loop; s.playbackRate.value=rate; return s; }

/* ---------- machines ---------- */
const BUILDERS={
 GND(){ return {empty:true}; },
 SIN(v,f,P){ const o=mkOsc('sine',f); regOsc(v,o,1); o.connect(v.out); v.nodes.push(o); },
 NOIS(v,f,P){ const S=P.SYN; const red=S[1]/127; const rate=(0.25+f/220)*(1-red*0.85);
   const n=noiseSrc(Math.max(0.05,rate)); v.oscs.push({o:n,ratio:1,det:0,rate0:rate});
   const bp=mkFilter('bandpass',clamp(f*(1+red*3),60,16000),0.6+S[0]/127*4); const g=mkGain(0.9);
   n.connect(bp); bp.connect(g); g.connect(v.out); v.nodes.push(n);
   v.syn[1]=val=>{ n.playbackRate.setTargetAtTime(Math.max(0.05,(0.25+v.baseF/220)*(1-val/127*0.85)),nowT(),0.03); };
 },
 SID(v,f,P,ti){ const S=P.SYN, wave=enumIdx(MACH.SID.syn[3],S[3]), mod=enumIdx(MACH.SID.syn[4],S[4]), msrc=enumIdx(MACH.SID.syn[5],S[5]);
   const sh=AE.ctx.createWaveShaper(); setQuant(sh,10); const post=mkGain(0.9); sh.connect(post); post.connect(v.out); v.nodes.push(sh);
   let carrierIn=sh, ringG=null;
   if(mod===1){ ringG=mkGain(0); ringG.connect(sh); carrierIn=ringG; v.nodes.push(ringG); }
   const pw01=0.5+(S[0]-64)/127; const p=pulseOsc(f,clamp(pw01,0.03,0.97)); regOsc(v,p.osc,1); v.nodes.push(p);
   const mk=o=>{o.connect(carrierIn);};
   if(wave===1){ const o=mkOsc('sawtooth',f); regOsc(v,o,1); mk(o); v.nodes.push(o); }
   else if(wave===0){ const o=mkOsc('triangle',f); regOsc(v,o,1); mk(o); v.nodes.push(o); }
   else if(wave===2){ p.out.connect(carrierIn); }
   else if(wave===3){ const o1=mkOsc('sawtooth',f),o2=mkOsc('triangle',f); regOsc(v,o1,1); regOsc(v,o2,1); const g1=mkGain(0.5),g2=mkGain(0.35); o1.connect(g1);g1.connect(carrierIn); o2.connect(g2);g2.connect(carrierIn); p.out.connect(carrierIn); v.nodes.push(o1,o2); }
   else { const n=noiseSrc(Math.max(0.05,f/160)); v.oscs.push({o:n,ratio:1,det:0,rate0:Math.max(0.05,f/160)}); const bp=mkFilter('bandpass',clamp(f*2,80,15000),0.8); n.connect(bp); bp.connect(carrierIn); v.nodes.push(n); }
   if(p.out&&wave!==2&&wave!==3){ /* unused pulse unit still started cheaply only if connected */ }
   // PW sweep (PWAD): slow triangle LFO on pulse offset, restarted on trig if PWRS
   if(S[1]>0&&(wave===2||wave===3)){ const lfo=mkOsc('triangle',0.15+S[1]/127*5), lg=mkGain(S[1]/127*0.75); lfo.connect(lg); lg.connect(p.pwParam); v.nodes.push(lfo); }
   const mf = msrc===1? (AE.tracks[(ti+5)%6].curFreq||f) : f*(0.25+Math.pow(S[6]/127,1.6)*15.75);
   if(mod===1){ const m=mkOsc('sine',mf), mg=mkGain(1); m.connect(mg); mg.connect(ringG.gain); v.nodes.push(m); regOsc(v,m,mf/f); }
   if(mod===2){ const m=mkOsc('sine',mf), mg=mkGain(f*(1+S[6]/127*3)); m.connect(mg); v.oscs.forEach(x=>{if(x.o.frequency)mg.connect(x.o.frequency);}); v.nodes.push(m); }
   v.syn[0]=val=>{ p.pwParam.setTargetAtTime(pwToOffset(0.5+(val-64)/127),nowT(),0.02); };
 },
 SAW(v,f,P){ const S=P.SYN, unil=S[0]/127, uniw=S[1]/127*55, unix=S[2]/127;
   const add=(type,ratio,det,lvl,freqMul=1)=>{ const o=mkOsc(type,f*ratio*freqMul); regOsc(v,o,ratio*freqMul,det); const g=mkGain(lvl); o.connect(g); g.connect(v.out); v.nodes.push(o); return o; };
   add('sawtooth',1,0,0.55); add('sawtooth',1,uniw,0.4*unil); add('sawtooth',1,-uniw,0.4*unil);
   add('sawtooth',1,uniw*2,0.32*unix); add('sawtooth',1,-uniw*2,0.32*unix);
   if(S[4]>0) add('square',0.5,0,0.5*S[4]/127);
   if(S[5]>0) add('sine',0.5,0,0.55*S[5]/127);
   if(S[6]>0) add('sine',0.25,0,0.55*S[6]/127);
 },
 PULS(v,f,P){ const S=P.SYN, unil=S[0]/127, uniw=S[1]/127*45, pw01=clamp(0.5+(S[4]-64)/127,0.04,0.96);
   const mkp=(det,lvl)=>{ const p=pulseOsc(f,pw01); regOsc(v,p.osc,1,det); if(det)p.osc.detune.value=det; const g=mkGain(lvl); p.out.connect(g); g.connect(v.out); v.nodes.push(p); return p; };
   const p0=mkp(0,0.6); let pAll=[p0];
   if(unil>0.01){ pAll.push(mkp(uniw,0.45*unil)); pAll.push(mkp(-uniw,0.45*unil)); }
   if(S[2]>0){ const o=mkOsc('sine',f/2); regOsc(v,o,0.5); const g=mkGain(0.5*S[2]/127); o.connect(g); g.connect(v.out); v.nodes.push(o); }
   if(S[3]>0){ const o=mkOsc('sine',f/4); regOsc(v,o,0.25); const g=mkGain(0.5*S[3]/127); o.connect(g); g.connect(v.out); v.nodes.push(o); }
   if(S[5]>0){ const lfo=mkOsc('triangle',0.12+S[5]/127*4.5); pAll.forEach(p=>{ const lg=mkGain(S[5]/127*0.7); lfo.connect(lg); lg.connect(p.pwParam); }); v.nodes.push(lfo); }
   v.syn[4]=val=>pAll.forEach(p=>p.pwParam.setTargetAtTime(pwToOffset(0.5+(val-64)/127),nowT(),0.02));
 },
 ENS(v,f,P){ ensVoice(v,f,P,null); },
 DENS(v,f,P){ ensVoice(v,f,P,getWave64(enumIdx(MACH.DENS.syn[3],P.SYN[3]))); },
 DWAVE(v,f,P,ti){ const S=P.SYN, wi=enumIdx(MACH.DWAVE.syn[0],S[0]);
   const o1=mkWaveOsc(AE.waves32[wi],f), o2=mkWaveOsc(AE.waves32[(wi+1)%32],f);
   regOsc(v,o1,1); regOsc(v,o2,1);
   const g2=mkGain(Math.pow(S[1]/127,1.4)), g1=mkGain(1-Math.pow(S[1]/127,1.4)*0.9);
   const sh=AE.ctx.createWaveShaper(); setQuant(sh,12); const post=mkGain(0.85); sh.connect(post); post.connect(v.out);
   o1.connect(g1); g1.connect(sh); o2.connect(g2); g2.connect(sh); v.nodes.push(o1,o2,sh);
   if(S[2]>0){ const lfo=mkOsc('triangle',0.1+S[2]/127*3.2), lg=mkGain(0.45), lg2=mkGain(-0.4); lfo.connect(lg); lg.connect(g2.gain); lfo.connect(lg2); lg2.connect(g1.gain); v.nodes.push(lfo); }
   const sync=enumIdx(MACH.DWAVE.syn[4],S[4]);
   if(sync>0){ const sf=sync===1?(AE.tracks[(ti+5)%6].curFreq||f): f*(0.5+S[5]/127*7.5); const m=mkOsc('sine',sf), mg=mkGain(f*1.6); m.connect(mg); mg.connect(o1.frequency); mg.connect(o2.frequency); v.nodes.push(m); }
   v.syn[1]=val=>{ const x=Math.pow(val/127,1.4); g2.gain.setTargetAtTime(x,nowT(),0.03); g1.gain.setTargetAtTime(1-x*0.9,nowT(),0.03); };
 },
 DDRW(v,f,P){ const S=P.SYN, w1=getWave64(enumIdx(MACH.DDRW.syn[0],S[0])), w2=getWave64(enumIdx(MACH.DDRW.syn[2],S[2]));
   const det=(S[5]-64)/63*24; // WID semitones ±12 each side
   const o1=mkWaveOsc(w1,f*Math.pow(2,-det/24)), o2=mkWaveOsc(w2,f*Math.pow(2,det/24));
   regOsc(v,o1,Math.pow(2,-det/24)); regOsc(v,o2,Math.pow(2,det/24));
   const mix=S[1]/127, g1=mkGain(1-mix*0.85), g2=mkGain(mix);
   const sh1=AE.ctx.createWaveShaper(), sh2=AE.ctx.createWaveShaper();
   setQuant(sh1,16-S[4]/127*13); setQuant(sh2,16-S[6]/127*13);
   o1.connect(sh1); sh1.connect(g1); g1.connect(v.out); o2.connect(sh2); sh2.connect(g2); g2.connect(v.out);
   v.nodes.push(o1,o2,sh1,sh2);
   v.syn[1]=val=>{ const tc=0.02+(P.SYN[3]/127)*1.4, x=val/127; g1.gain.setTargetAtTime(1-x*0.85,nowT(),tc); g2.gain.setTargetAtTime(x,nowT(),tc); };
   v.syn[4]=val=>setQuant(sh1,16-val/127*13); v.syn[6]=val=>setQuant(sh2,16-val/127*13);
 },
 BBOX(v,f,P,ti,midi,t,lenSec){ bboxVoice(v,f,P,midi,t,lenSec); },
 FMSTAT(v,f,P){ const S=P.SYN;
   const car=mkOsc('sine',f); regOsc(v,car,1);
   const tone=mkFilter('lowpass',250+Math.pow(S[6]/127,1.6)*14000,0.5); const cg=mkGain(0.75); car.connect(tone); tone.connect(cg); cg.connect(v.out);
   const m1=mkOsc('sine',f*fmRatio(S[0])); regOsc(v,m1,fmRatio(S[0]),(S[1]-64)); m1.detune.value=(S[1]-64);
   const g1=mkGain(0); m1.connect(g1); g1.connect(car.frequency);
   if(S[3]>0){ const fb=mkGain(S[3]/127*f*1.4); m1.connect(fb); fb.connect(m1.frequency); }
   const m2=mkOsc('sine',f*fmRatio(S[4])); regOsc(v,m2,fmRatio(S[4])); const g2=mkGain(S[5]/127*0.5); m2.connect(g2); g2.connect(tone);
   v.nodes.push(car,m1,m2); v._fmEnv=[{g:g1,raw:S[2],f}];
   v.syn[2]=val=>g1.gain.setTargetAtTime(val/127*f*3.2,nowT(),0.03);
 },
 FMPAR(v,f,P){ const S=P.SYN;
   const car=mkOsc('sine',f); regOsc(v,car,1);
   const tone=mkFilter('lowpass',250+Math.pow(S[6]/127,1.6)*14000,0.5); const cg=mkGain(0.75); car.connect(tone); tone.connect(cg); cg.connect(v.out);
   v._fmEnv=[];
   [[0,1],[2,3],[4,5]].forEach(([fi,ei])=>{ const m=mkOsc('sine',f*fmRatio(S[fi])); regOsc(v,m,fmRatio(S[fi])); const g=mkGain(0); m.connect(g); g.connect(car.frequency); v.nodes.push(m); v._fmEnv.push({g,raw:S[ei],f}); v.syn[ei]=val=>g.gain.setTargetAtTime(val/127*f*2.6,nowT(),0.03); });
   v.nodes.push(car);
 },
 FMDYN(v,f,P,ti,midi,t){ const S=P.SYN;
   const car=mkOsc('sine',f); regOsc(v,car,1); const cg=mkGain(0.78); car.connect(cg); cg.connect(v.out);
   const r1=fmRatio(S[0]), m1=mkOsc('sine',f*r1); regOsc(v,m1,r1); const g1=mkGain(0); m1.connect(g1); g1.connect(car.frequency);
   // 1FEN: pitch envelope on modulator 1
   const fenv=(S[1]-64)/63; m1.frequency.setValueAtTime(Math.max(8,f*r1*Math.pow(2,fenv*2)),t); m1.frequency.exponentialRampToValueAtTime(Math.max(8,f*r1),t+0.04+Math.abs(fenv)*0.5);
   const m2=mkOsc('sine',f*fmRatio(S[4])); regOsc(v,m2,fmRatio(S[4])); const g2=mkGain(0); m2.connect(g2); g2.connect(m1.frequency);
   if(S[6]>0){ const fb=mkGain(S[6]/127*f*1.6); m2.connect(fb); fb.connect(m2.frequency); }
   v.nodes.push(car,m1,m2); v._fmEnv=[{g:g1,raw:S[3],vol:S[2],f},{g:g2,raw:S[5],f}];
 },
 VO6(v,f,P,ti,midi,t){ const S=P.SYN, ctx=AE.ctx;
   const voiced=mkOsc('square',f); regOsc(v,voiced,1); const vlp=mkFilter('lowpass',2400,0.4);
   const voic=S[3]/127, vg=mkGain(1-voic*0.9), ng=mkGain(voic*0.85);
   const noise=noiseSrc(0.9); v.nodes.push(voiced,noise);
   const src=mkGain(1); voiced.connect(vlp); vlp.connect(vg); vg.connect(src); noise.connect(ng); ng.connect(src);
   const F1v=()=>150*Math.pow(8,S[0]/127), F2v=()=>400*Math.pow(8.75,S[1]/127);
   const vowelG=mkGain(0.0001); vowelG.connect(v.out);
   const bp1=mkFilter('bandpass',F1v(),5), bp2=mkFilter('bandpass',F2v(),6), bp3=mkFilter('bandpass',2500,7);
   const g1=mkGain(2.6), g2=mkGain(1.9), g3=mkGain(0.8);
   src.connect(bp1); bp1.connect(g1); g1.connect(vowelG); src.connect(bp2); bp2.connect(g2); g2.connect(vowelG); src.connect(bp3); bp3.connect(g3); g3.connect(vowelG);
   const body=mkGain(0.22); src.connect(body); body.connect(vowelG);
   // consonant burst
   const cons=CONS_LIST[enumIdx(MACH.VO6.syn[4],S[4])];
   const clen=0.02+(S[5]/127)*0.4, cvol=0.9*S[6]/127;
   let vStart=t+0.012;
   if(cons!=='-'&&cvol>0.01){
     vStart=t+clen;
     const cg2=mkGain(0); cg2.connect(v.out); v.nodes.push(cg2);
     const plos=['B','P','D','T','G','K'].includes(cons), nas=['M','N'].includes(cons);
     if(nas){ const o=mkOsc('sine',118), bp=mkFilter('bandpass',280,2); o.connect(bp); bp.connect(cg2); v.nodes.push(o);
       cg2.gain.setValueAtTime(cvol*0.9,t); cg2.gain.setTargetAtTime(0,t+clen*0.7,0.03); }
     else{ const n=noiseSrc(1.1); const ff=plos?900:(cons==='S'||cons==='Z')?6800:(cons==='SH'||cons==='CH')?3400:(cons==='F'||cons==='V'||cons==='TH')?5200:2200;
       const bp=mkFilter('bandpass',ff,plos?0.8:1.4); n.connect(bp); bp.connect(cg2); v.nodes.push(n);
       cg2.gain.setValueAtTime(cvol,t); if(plos){ cg2.gain.exponentialRampToValueAtTime(Math.max(0.001,cvol*0.15),t+Math.min(0.06,clen)); cg2.gain.setTargetAtTime(0,t+Math.min(0.07,clen),0.015);} else cg2.gain.setTargetAtTime(0,t+clen*0.75,0.03); }
   }
   const vOn=S[2]>=64||cons==='-';
   vowelG.gain.setValueAtTime(0.0001,t);
   if(vOn) vowelG.gain.setTargetAtTime(0.5,vStart,0.018); else vowelG.gain.setTargetAtTime(0.0001,t+0.02,0.02);
   v.syn[0]=val=>bp1.frequency.setTargetAtTime(150*Math.pow(8,val/127),nowT(),0.03);
   v.syn[1]=val=>bp2.frequency.setTargetAtTime(400*Math.pow(8.75,val/127),nowT(),0.03);
   v.syn[3]=val=>{ const x=val/127; vg.gain.setTargetAtTime(1-x*0.9,nowT(),0.03); ng.gain.setTargetAtTime(x*0.85,nowT(),0.03); };
 },
};
function ensVoice(v,f,P,wave){
  const S=P.SYN, ctx=AE.ctx;
  const mix=mkGain(0.8); mix.connect(v.out);
  // ensemble chorus (per-voice, stops with voice)
  const chrl=S[5]/127, chrw=S[6]/127;
  const wetG=mkGain(chrl*0.75); mix.connect(wetG);
  const dly=ctx.createDelay(0.08); dly.delayTime.value=0.017; const lfo=mkOsc('sine',0.55), lg=mkGain(0.0016+chrw*0.0034);
  lfo.connect(lg); lg.connect(dly.delayTime); wetG.connect(dly); dly.connect(v.out); v.nodes.push(lfo); lfo.start(nowT()); lfo._st=1;
  const semis=[0,pchSemis(S[0]),pchSemis(S[1]),pchSemis(S[2])].filter(x=>x!==null);
  const wv=S[3]/127;
  semis.forEach(sm=>{
    const ff=f*Math.pow(2,sm/12);
    if(wave){ const o=mkWaveOsc(wave,ff); regOsc(v,o,Math.pow(2,sm/12)); const g=mkGain(0.4); o.connect(g); g.connect(mix); v.nodes.push(o); }
    else{
      // two saws, 2nd phase-shifted by PW*period; WAVE crossfades sum/difference (MONO2K calibration)
      const o1=mkOsc('sawtooth',ff), o2=mkOsc('sawtooth',ff); regOsc(v,o1,Math.pow(2,sm/12)); regOsc(v,o2,Math.pow(2,sm/12));
      const dl=ctx.createDelay(0.06); dl.delayTime.value=clamp((S[4]/127)/Math.max(20,ff),0.0001,0.05);
      const sumN=mkGain(0.26*(1-wv)+0.05), difN=mkGain(0.30*wv), inv=mkGain(-1);
      o1.connect(sumN); o2.connect(dl); dl.connect(sumN); dl.connect(inv); o1.connect(difN); inv.connect(difN);
      sumN.connect(mix); difN.connect(mix); v.nodes.push(o1,o2);
    }
  });
}
function bboxVoice(v,f,P,midi,t,lenSec){
  const S=P.SYN, ctx=AE.ctx;
  const di=clamp(((midi-36)%24+24)%24,0,23), name=BBOX_DRUMS[di];
  const pf=Math.pow(2,(S[0]-64)/32); // PTCH law 2^((v-64)/32)
  const strt=S[1]/127;
  if(S.userSamplesBuf&&S.userSamplesBuf[di]){
    const src=ctx.createBufferSource(); src.buffer=S.userSamplesBuf[di]; src.playbackRate.value=pf;
    const g=mkGain(0.95); src.connect(g); g.connect(v.out); v.nodes.push(src);
    v._bboxStart=(tt)=>{ try{src.start(tt,strt*src.buffer.duration*0.9);}catch(e){} };
    return;
  }
  const g=mkGain(0.0001); g.connect(v.out); v.nodes.push(g);
  const env=(pk,dec,delay=0)=>{ g.gain.setValueAtTime(0.0001,t+delay); g.gain.linearRampToValueAtTime(pk*(1-strt*0.6),t+delay+0.002+strt*0.01); g.gain.setTargetAtTime(0,t+delay+0.004,Math.max(0.006,dec*(1-strt*0.35))); };
  const sineHit=(f0,f1,dec,pk=0.95)=>{ const o=mkOsc('sine',f0*pf*(1-strt*0.4)); o.frequency.exponentialRampToValueAtTime(Math.max(18,f1*pf),t+0.09); regOsc(v,o,(f0*pf)/f||1); o.connect(g); v.nodes.push(o); env(pk,dec); };
  const noiseHit=(ftype,ff,q,dec,pk=0.7)=>{ const n=noiseSrc(1,false); const fl=mkFilter(ftype,ff,q); n.connect(fl); fl.connect(g); v.nodes.push(n); env(pk,dec); };
  switch(name){
    case 'KICK': sineHit(160,42,0.13); break;
    case 'KICK2': sineHit(120,36,0.2); break;
    case 'SUB': sineHit(Math.max(30,f/2),Math.max(28,f/2.05),0.25); break;
    case 'SNARE': noiseHit('bandpass',1900,0.7,0.07); {const o=mkOsc('triangle',196*pf);regOsc(v,o,196*pf/f);const gg=mkGain(0.4);o.connect(gg);gg.connect(g);v.nodes.push(o);} break;
    case 'SNAR2': noiseHit('bandpass',2600,0.8,0.05); break;
    case 'CLAP': { const n=noiseSrc(1,false); const fl=mkFilter('bandpass',1250,1.6); n.connect(fl); fl.connect(g); v.nodes.push(n);
      g.gain.setValueAtTime(0.0001,t); [0,0.018,0.036].forEach(d=>{g.gain.linearRampToValueAtTime(0.75,t+d+0.002); g.gain.setTargetAtTime(0.18,t+d+0.004,0.006);}); g.gain.setTargetAtTime(0,t+0.055,0.07);} break;
    case 'RIM': case 'STICK': noiseHit('bandpass',1700,5,0.02,0.6); break;
    case 'CLICK': noiseHit('highpass',3000,0.7,0.008,0.5); break;
    case 'HATC': noiseHit('highpass',8200,0.6,0.02,0.5); break;
    case 'HATO': noiseHit('highpass',8200,0.6,0.14,0.5); break;
    case 'CYMB': case 'CRASH': noiseHit('highpass',6500,0.5,name==='CRASH'?0.5:0.3,0.5); break;
    case 'SHAKE': noiseHit('bandpass',6000,0.9,0.05,0.45); break;
    case 'NOISE': noiseHit('bandpass',clamp(f*4,300,9000),1,0.1,0.6); break;
    case 'TOMH': sineHit(210,120,0.11,0.8); break;
    case 'TOMM': sineHit(160,92,0.13,0.8); break;
    case 'TOML': sineHit(118,62,0.16,0.85); break;
    case 'COWB': [545,815].forEach(fr=>{const o=mkOsc('square',fr*pf);regOsc(v,o,fr*pf/f);const bp=mkFilter('bandpass',fr*pf,3);o.connect(bp);bp.connect(g);v.nodes.push(o);}); env(0.5,0.09); break;
    case 'METAL': [412,623,891,1240].forEach(fr=>{const o=mkOsc('square',fr*pf);regOsc(v,o,fr*pf/f);const gg=mkGain(0.13);o.connect(gg);gg.connect(g);v.nodes.push(o);}); env(0.6,0.12); break;
    case 'ZAP': {const o=mkOsc('sawtooth',2400*pf); o.frequency.exponentialRampToValueAtTime(90,t+0.14); regOsc(v,o,2400*pf/f); o.connect(g); v.nodes.push(o); env(0.6,0.06);} break;
    case 'BLIP': sineHit(f*2,f*1.98,0.05,0.6); break;
    case 'PERC1': sineHit(820,540,0.04,0.55); break;
    case 'PERC2': sineHit(540,330,0.06,0.55); break;
    default: sineHit(150,50,0.12);
  }
  // RTRG/RTIM retriggers handled by scheduler (re-trig note)
}

/* ---------- note on/off ---------- */
function tuneOf(tr,eff){ const defs=MACH[tr.machine].syn; const i=defs.findIndex(d=>d&&d.n==='TUNE'); return i>=0? tuneSemis(eff.SYN[i]) : 0; }
AE.noteOn=function(ti,midi,t,vel=1,opt={}){
  if(!AE.started) return null;
  if(AE._stopMuted) clearStopMute();
  const ta=AE.tracks[ti], tr=curPat().tracks[ti], mach=MACH[tr.machine];
  const eff=effParams(tr,opt.locks,ti);
  const lenSec=opt.len||0.3;
  const tune=tuneOf(tr,eff);
  const f=mtof(midi+tune+(eff._ptchCents||0)/100);
  ta.curFreq=f; ta.curNote=midi;
  // LFO trig modes (hardware patterns can trig AMP / FILTER / LFO independently)
  if(opt.ltrig!==false) ta.lfoState.forEach((ls,li)=>{ const Lp=tr.params['LFO'+(li+1)]; const tm=enumIdx(PAGE_DEFS.LFO1[2],Lp[2]);
    if(tm===1||tm===3||tm===4){ ls.ph=0; ls.active=true; } else if(tm===2){ ls.held=ls.val; } });
  applyChain(ti,eff,t);
  if(mach.fx){
    // FX machine: note gates the processed signal through AMP/FILT envs; sets ringmod carrier
    const peak=Math.pow(eff.AMP[5]/127,1.3)*(0.35+0.65*vel);
    scheduleAmpEnv(ta.ampEnv.gain,eff,t,peak,lenSec);
    const relT=decTau(eff.AMP[3]);
    setTimeout(()=>{ if(!S.playing) return; releaseAmp(ta.ampEnv.gain,nowT(),relT); },Math.max(10,(t+lenSec-nowT())*1000));
    if(opt.ftrig!==false) scheduleFiltEnv(ta,eff,t);
    if(ta.fxNodes&&ta.fxNodes.carrier) ta.fxNodes.carrier.frequency.setTargetAtTime(f,t,0.01);
    return null;
  }
  if(tr.machine==='GND') return null;
  const portSec=eff.AMP[7]>0? Math.pow(eff.AMP[7]/127,1.6)*1.2 : 0;
  // slide: glide existing voice, no env retrig (hardware slide trig behaviour)
  if(opt.slide&&ta.voice&&!ta.voice.stopped){
    ta.voice.glide(f,t,Math.max(0.03,portSec||stepDur(curPat())*0.9));
    applyChain(ti,eff,t);
    if(opt.locks){ const v=ta.voice; for(const k in opt.locks){ const [pg,i]=k.split('.'); if(pg==='SYN'&&v.syn[+i]) v.syn[+i](opt.locks[k]); } }
    return ta.voice;
  }
  const polyLive=!!opt.poly;
  if(!polyLive) stopVoice(ta,t);
  const v=newVoice(ta.in); v.baseF=f; v.midi=midi;
  const build=BUILDERS[tr.machine]||BUILDERS.SIN;
  build(v,f,eff,ti,midi,t,lenSec);
  if(v.empty){ return null; }
  // portamento: start from previous frequency
  if(portSec>0&&ta._prevF&&ta._prevF!==f){ const pf=ta._prevF; v.oscs.forEach(x=>{ if(x.o.frequency){ x.o.frequency.setValueAtTime(Math.max(8,pf*x.ratio),t); x.o.frequency.exponentialRampToValueAtTime(Math.max(8,f*x.ratio),t+portSec); } }); }
  ta._prevF=f;
  // FM internal envelopes
  if(v._fmEnv) v._fmEnv.forEach(({g,raw,vol})=>{ const amt=(vol!=null?vol/127:1)*(raw/127); const dev=amt*f*4.2; g.gain.setValueAtTime(dev,t); g.gain.setTargetAtTime(dev*0.22,t,0.02+raw/127*0.5); });
  if(v._bboxStart){ /* sample voice starts itself */ v._bboxStart(t); }
  else v.startAll(t);
  v.nodes.forEach(n=>{ if(n.start&&!n._st){ try{ if(n!==v){} }catch(e){} }});
  const peak=Math.pow(eff.AMP[5]/127,1.3)*(0.3+0.7*vel)*0.95;
  const gen=++ta.gen;
  if(polyLive){
    v.out.gain.setValueAtTime(1,t);
    scheduleAmpEnv(v.out.gain,eff,t,peak*1.6,lenSec);
    ta.ampEnv.gain.setTargetAtTime(1,t,0.01);
    ta.voices.push(v); if(ta.voices.length>6){ const old=ta.voices.shift(); old.stop(t); }
  } else {
    scheduleAmpEnv(ta.ampEnv.gain,eff,t,peak,lenSec);
    if(opt.ftrig!==false) scheduleFiltEnv(ta,eff,t);
    ta.voice=v;
    const relT=decTau(eff.AMP[3]);
    const aDec=eff.AMP[2];
    const stopAt=t+Math.max(lenSec+relT*4+0.15, atkSec(eff.AMP[0])+holdSec(eff.AMP[1])+(aDec<127?decTau(aDec)*5:0)+relT*4);
    setTimeout(()=>{ if(ta.gen===gen&&ta.voice===v){ releaseAmp(ta.ampEnv.gain,nowT(),relT); } },Math.max(8,(t+lenSec-nowT())*1000));
    setTimeout(()=>{ if(ta.voice===v){ v.stop(nowT()); ta.voice=null; } },Math.max(30,(stopAt-nowT())*1000));
    v._stopAt=stopAt; v._lenEnd=t+lenSec; v._relT=relT;
  }
  return v;
};
AE.noteOff=function(ti,midi,t){
  const ta=AE.tracks[ti]; if(!ta) return; const tr=curPat().tracks[ti]; t=t||nowT();
  const eff=effParams(tr,null,ti); const relT=decTau(eff.AMP[3]);
  if(ta.voices.length){ const i=ta.voices.findIndex(v=>v.midi===midi); if(i>=0){ const v=ta.voices.splice(i,1)[0]; releaseAmp(v.out.gain,t,relT); setTimeout(()=>v.stop(nowT()),relT*4000+120); } return; }
  if(ta.voice){ releaseAmp(ta.ampEnv.gain,t,relT); const v=ta.voice; ta.gen++; setTimeout(()=>{ if(ta.voice===v){ v.stop(nowT()); ta.voice=null; } },relT*4000+120); }
  else if(MACH[tr.machine].fx && S.playing) releaseAmp(ta.ampEnv.gain,t,relT);
};
function silenceTrack(ta,tr,t,flush){
  if(!ta) return;
  ta.gen++; // invalidate note-release timers belonging to already-scheduled notes
  stopVoice(ta,t,true);
  if(ta.voices&&ta.voices.length){ ta.voices.forEach(v=>{ try{v.stop(t);}catch(e){} }); ta.voices=[]; }
  // The old STOP only appended a new gain target. Future setValueAtTime() points from
  // look-ahead notes could therefore reopen the gate seconds later. Cancel them.
  setParamFast(ta.ampEnv.gain,t,0,0.01);
  setParamFast(ta.lfoVol&&ta.lfoVol.gain,t,1,0.01);
  [ta.hp,ta.lp1,ta.lp2].forEach(f=>{ if(f&&f.frequency) try{f.frequency.cancelScheduledValues(t);}catch(e){} });
  ta.fltEnvUntil=0;
  if(flush){
    ta._tailMuted=true; ta._chainKey=null;
    setParamFast(ta.dSend.gain,t,0,0.008);
    setParamFast(ta.dFb.gain,t,0,0.008);
    setParamFast(ta.dRet.gain,t,0,0.008);
    setParamFast(ta.delay.delayTime,t,0.02,0.025); // run stored samples out quickly while muted
    setParamFast(ta.outGain.gain,t,0,0.008);
    ta._fxGateState=0;
    setParamFast(ta.fxOn.gain,t,0,0.008);
    setParamFast(ta.fxProcIn.gain,t,0,0.008);
    const fx=ta.fxNodes;
    if(fx){
      if(fx.fb) setParamFast(fx.fb.gain,t,0,0.008);
      if(fx.wet) setParamFast(fx.wet.gain,t,0,0.008);
      if(fx.conv){ if(fx.conv.buffer&&!fx.irBuffer) fx.irBuffer=fx.conv.buffer; try{fx.conv.buffer=null;}catch(e){} }
    }
  }
}
function restoreTrackChain(ti,t){
  const ta=AE.tracks[ti]; if(!ta) return;
  ta._tailMuted=false; ta._chainKey=null;
  const fx=ta.fxNodes;
  if(fx&&fx.conv&&!fx.conv.buffer&&fx.irBuffer) fx.conv.buffer=fx.irBuffer;
  applyChain(ti,effParams(curPat().tracks[ti],null,ti),t||nowT());
}
function clearStopMute(){
  if(!AE._stopMuted||!AE.started) return;
  AE._stopMuted=false;
  const t=nowT();
  if(AE.busTap) setParamFast(AE.busTap.gain,t,0.7,0.015);
  for(let i=0;i<6;i++) restoreTrackChain(i,t);
}
AE.clearStopMute=clearStopMute;
AE.killTrack=function(ti){ const ta=AE.tracks[ti]; if(ta) silenceTrack(ta,curPat().tracks[ti],nowT(),true); };
AE.restoreTrack=function(ti){ restoreTrackChain(ti,nowT()); };
AE.allNotesOff=function(opts={}){
  if(!AE.started) return;
  const t=nowT(), flush=!!opts.flush;
  if(flush){ AE._stopMuted=true; if(AE.busTap) setParamFast(AE.busTap.gain,t,0,0.008); }
  AE.tracks.forEach((ta,i)=>silenceTrack(ta,curPat().tracks[i],t,flush));
};

/* ---------- LFOs ---------- */
const LFO_MULTVAL=[1,2,4,8,16,32,64,128];
const PTCH_SCALES=[8,20,45,100,210,430,1250,5000]; // cents at DPTH 127 per DEST A..H (vibrato..16 oct)
function lfoWaveVal(type,ph){
  const p=ph-Math.floor(ph);
  switch(type){
    case 0: return p<0.5? p*4-1 : 3-p*4; case 1: return -(p<0.5? p*4-1 : 3-p*4);
    case 2: return Math.sin(p*2*Math.PI); case 3: return -Math.sin(p*2*Math.PI);
    case 4: return p*2-1; case 5: return 1-p*2;
    case 6: return p<0.5?1:-1; case 7: return p<0.5?-1:1;
    case 8: return Math.pow(1-p,2)*2-1; case 9: return 1-Math.pow(p,2)*2;
    case 10: return Math.random()*2-1;
  } return 0;
}
let _lfoLast=0;
function lfoTick(){
  if(!AE.started||(AE.ctx&&AE.ctx.state&&AE.ctx.state!=='running')) return;
  const t=nowT(); const dt=_lfoLast? Math.min(0.1,t-_lfoLast):0.03; _lfoLast=t;
  const pat=curPat(), bpm=pat.bpm;
  for(let ti=0;ti<6;ti++){
    const ta=AE.tracks[ti], tr=pat.tracks[ti]; if(!ta) continue;
    const off={}; let ptchCents=0;
    for(let li=0;li<3;li++){
      const Lp=tr.params['LFO'+(li+1)], ls=ta.lfoState[li];
      const dpth=Lp[7]; if(dpth===0){ ls.val=0; continue; }
      const mult=LFO_MULTVAL[enumIdx(PAGE_DEFS.LFO1[4],Lp[4])];
      const freq=(bpm/60)/4*mult*Math.pow(2,(Lp[5]-64)/30);
      const tm=enumIdx(PAGE_DEFS.LFO1[2],Lp[2]);
      if(tm===2){ ls.val=ls.held; }
      else{
        if(ls.active) ls.ph+=dt*freq;
        if(tm===3&&ls.ph>=1){ ls.active=false; ls.ph=0.999; }
        if(tm===4&&ls.ph>=0.5){ ls.active=false; ls.ph=0.5; }
        ls.val=lfoWaveVal(enumIdx(PAGE_DEFS.LFO1[3],Lp[3]),ls.ph);
      }
      let val=ls.val;
      if(Lp[6]>0){ const gates=2+Lp[6]/6; if(((ls.ph*gates)%1)<0.5) val=0; } // INTL interlace
      const page=LFO_PAGES[enumIdx(PAGE_DEFS.LFO1[0],Lp[0])], dest=enumIdx(PAGE_DEFS.LFO1[1],Lp[1]);
      if(page==='PTCH') ptchCents+=val*(dpth/127)*PTCH_SCALES[dest];
      else { const k=page+'.'+dest; off[k]=(off[k]||0)+val*dpth; }
    }
    off.PTCH=ptchCents; AE.lfoOff[ti]=off;
    // continuous application
    const has=k=>off[k]!==undefined;
    if(ptchCents&&ta.voice) ta.voice.oscs.forEach(x=>{ if(x.o.detune) x.o.detune.setTargetAtTime((x.det||0)+ptchCents,t,0.025); });
    if((has('FILT.0')||has('FILT.1'))&&t>=ta.fltEnvUntil){ const F=tr.params.FILT; const b=R127(F[0]+(off['FILT.0']||0)); const w=F[1]+(off['FILT.1']||0);
      ta.hp.frequency.setTargetAtTime(FREQ(b),t,0.025); const lp=FREQ(b+w); ta.lp1.frequency.setTargetAtTime(lp,t,0.025); ta.lp2.frequency.setTargetAtTime(lp,t,0.025); }
    if(has('AMP.5')) ta.lfoVol.gain.setTargetAtTime(clamp(1+off['AMP.5']/110,0,1.6),t,0.025);
    if(has('AMP.6')&&ta.pan.pan) ta.pan.pan.setTargetAtTime(clamp(((tr.params.AMP[6]+off['AMP.6'])-64)/63,-1,1),t,0.025);
    if(has('EFX.4')&&!AE._stopMuted&&!ta._tailMuted&&!tr.muted) ta.dSend.gain.setTargetAtTime(clamp(Math.pow(R127(tr.params.EFX[4]+off['EFX.4'])/127,1.5),0,1),t,0.025);
    if(has('EFX.0')) ta.eq.frequency.setTargetAtTime(FREQ(R127(tr.params.EFX[0]+off['EFX.0'])+8),t,0.025);
    if(has('EFX.1')) ta.eq.gain.setTargetAtTime((R127(tr.params.EFX[1]+off['EFX.1'])-64)/63*15,t,0.025);
    for(let i=0;i<8;i++){ const k='SYN.'+i; if(has(k)&&ta.voice&&ta.voice.syn[i]) ta.voice.syn[i](R127(tr.params.SYN[i]+off[k])); }
  }
}

/* ---------- sequencer ---------- */
function stepDur(p){ const mult=p.scale||1; return (60/p.bpm/4)/mult; }
AE.stepDur=stepDur;
const CHORDS={'---':[0],MIN:[0,3,7],MAJ:[0,4,7],MIN7:[0,3,7,10],MAJ7:[0,4,7,11],SUS4:[0,5,7],DIM:[0,3,6],POW:[0,7,12]};
function trigTrackStep(ti,st,t,sd){
  const tr=curPat().tracks[ti];
  if(st.prob<100&&Math.random()*100>=st.prob) return;
  const eff0=effParams(tr,st.locks,ti);
  const arpDef=PAGE_DEFS.ARP, mode=enumIdx(arpDef[0],eff0.ARP[0]);
  const trsp=Math.round((eff0.ARP[4]-64)/2.66);
  const rat=clamp(st.rat||1,1,8);
  const micOff=(st.mic||0)/32*sd*0.5;
  const baseT=t+micOff;
  const lenSteps=clamp(st.len||eff0.ARP[3]/8||2,0.25,64);
  const midiOut=(note,tt,dur,vel)=>{ if(S.midiOut&&AE.midiOutPort){ const ts=performance.now()+Math.max(0,(tt-nowT())*1000); try{AE.midiOutPort.send([0x90+ti,note,Math.round(vel*110)],ts); AE.midiOutPort.send([0x80+ti,note,0],ts+dur*1000);}catch(e){} } };
  const doTrig=(note,tt,ls,slide)=>{
    AE.noteOn(ti,note,tt,(st.vel||100)/127,{len:ls*sd,locks:st.locks,slide:!!slide,ftrig:st._ftrig!==false,ltrig:st._ltrig!==false});
    midiOut(note,tt,ls*sd,(st.vel||100)/127);
  };
  if(mode>0&&!MACH[tr.machine].fx&&tr.machine!=='BBOX'){
    const spdF=[4,3,2,1,0.5,1/3,0.25][enumIdx(arpDef[1],eff0.ARP[1])];
    const range=enumIdx(arpDef[2],eff0.ARP[2])+1;
    let tones=st.arp&&st.arp.length? st.arp.slice() : CHORDS[PAGE_DEFS.ARP[6].e[enumIdx(arpDef[6],eff0.ARP[6])]].slice();
    let seqNotes=[];
    for(let o=0;o<range;o++) tones.forEach(iv=>seqNotes.push(iv+o*12));
    if(mode===2) seqNotes.reverse(); else if(mode===3&&seqNotes.length>2) seqNotes=seqNotes.concat(seqNotes.slice(1,-1).reverse());
    else if(mode===5){ seqNotes=tones.slice(); }
    const nSteps=Math.max(1,Math.floor(lenSteps/spdF));
    for(let k=0;k<nSteps;k++){
      const iv=mode===4? seqNotes[Math.floor(Math.random()*seqNotes.length)] : seqNotes[k%seqNotes.length];
      const leg=eff0.ARP[5]>=64&&k>0;
      doTrig(st.note+trsp+iv, baseT+k*spdF*sd, spdF*0.92, st.slide&&k===0?true:leg);
    }
    return;
  }
  for(let r=0;r<rat;r++){
    doTrig(st.note+trsp, baseT+r*(sd/rat), Math.min(lenSteps,1/rat)*0.95, st.slide&&r===0);
  }
  // BBOX internal retrig RTRG/RTIM
  if(tr.machine==='BBOX'){
    const rtrg=eff0.SYN[4]; if(rtrg>0){ const n=rtrg>=127?16:Math.round(rtrg/127*16); const iv=0.02+(eff0.SYN[5]/127)*0.4;
      for(let k=1;k<=n;k++) AE.noteOn(ti,st.note,baseT+k*iv,(st.vel||100)/127,{len:iv*0.9,locks:st.locks}); }
  }
}
AE._step=0; AE._nextT=0; AE._timer=null;
function applyTriglessStep(ti,st,t){
  const ta=AE.tracks[ti]; if(!ta) return;
  const tr=curPat().tracks[ti];
  const eff=effParams(tr,st.locks,ti);
  applyChain(ti,eff,t);
  if(st._ftrig) scheduleFiltEnv(ta,eff,t);
  if(st._ltrig) ta.lfoState.forEach((ls,li)=>{ const Lp=tr.params['LFO'+(li+1)]; const tm=enumIdx(PAGE_DEFS.LFO1[2],Lp[2]);
    if(tm===1||tm===3||tm===4){ ls.ph=0; ls.active=true; } else if(tm===2){ ls.held=ls.val; } });
  if(ta.voice&&st.locks) for(const k in st.locks){ const [pg,i]=k.split('.'); if(pg==='SYN'&&ta.voice.syn[+i]) ta.voice.syn[+i](st.locks[k]); }
}
AE.applyTriglessStep=applyTriglessStep;
function scheduleStep(s,t){
  const pat=curPat(), sd=stepDur(pat);
  const swingOff=(s%2===1)? ((pat.swing-50)/100)*sd : 0;
  for(let ti=0;ti<6;ti++){
    const tr=pat.tracks[ti]; if(tr.muted) continue;
    const st=tr.steps[s]; if(!st||!st.on) continue;
    if(st.trigless) applyTriglessStep(ti,st,t+swingOff);
    else trigTrackStep(ti,st,t+swingOff,sd);
  }
  AE.uiQueue.push({step:s,time:t,pat:S.curPat});
  if(AE.onStepScheduled) AE.onStepScheduled(s,t);
}
function schedTick(){
  const pat=curPat(), sd=stepDur(pat);
  while(AE._nextT<nowT()+0.16){
    scheduleStep(AE._step,AE._nextT);
    AE._nextT+=stepDur(curPat());
    AE._step++;
    if(AE._step>=curPat().len){
      AE._step=0;
      if(S.chain&&S.chain.length){ S.curPat=S.chain.shift(); patternChanged(); }
      else if(S.queuedPat!=null){ S.curPat=S.queuedPat; S.queuedPat=null; patternChanged(); }
      else if(S.songMode&&S.song.length){
        const row=S.song[S.songPos%S.song.length]; S.songCount++;
        if(S.songCount>=(row.rep||1)){ S.songCount=0; S.songPos=(S.songPos+1)%S.song.length; const np=S.song[S.songPos].pat; if(np!==S.curPat){ S.curPat=np; patternChanged(); } }
      }
    }
  }
}
function patternChanged(){
  const p=curPat();
  for(let i=0;i<6;i++){ const ta=AE.tracks[i]; if(!ta) continue; if(ta.fxMachine!==p.tracks[i].machine) rebuildFX(ta,p.tracks[i].machine); applyChain(i,effParams(p.tracks[i],null,i),nowT()); }
  if(AE.onPattern) AE.onPattern(S.curPat);
  saveSoon();
}
AE.patternChanged=patternChanged;
AE.play=function(fromStep=0){
  if(!AE.started) return;
  safeAudioResume();
  AE.allNotesOff();
  clearStopMute();
  S.playing=true; AE._step=fromStep||0; AE._nextT=nowT()+0.07;
  patternChanged(); // restore delay/FX/output gains that STOP flushed
  // close FX gates until their trigs fire
  AE.tracks.forEach((ta,i)=>{ if(MACH[curPat().tracks[i].machine].fx) setParamFast(ta.ampEnv.gain,nowT(),0,0.012); });
  clearInterval(AE._timer); AE._timer=setInterval(schedTick,25);
  if(S.midiOut&&AE.midiOutPort) try{AE.midiOutPort.send([0xFA]);}catch(e){}
};
AE.stop=function(){
  S.playing=false; clearInterval(AE._timer); AE._timer=null; AE.uiQueue.length=0;
  AE.allNotesOff({flush:true}); S.playStep=-1;
  if(S.midiOut&&AE.midiOutPort) try{AE.midiOutPort.send([0xFC]);}catch(e){}
};
AE.enableInput=async function(){
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  AE.inputSrc=AE.ctx.createMediaStreamSource(stream); AE.inputSrc.connect(AE.inputGain); AE.inputGain.gain.value=0.9;
  return true;
};
