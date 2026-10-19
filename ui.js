/* MONOMACHINE WEB — UI (touch-first, iPhone) */
'use strict';
const $=s=>document.querySelector(s);
const el=(tag,cls,txt)=>{const e=document.createElement(tag); if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e;};
function hasState(){ return typeof S!=='undefined'&&!!S; }
function initUiStateFields(){
  if(!hasState()) return false;
  if(!Array.isArray(S.lastNote)||S.lastNote.length<6) S.lastNote=[60,60,60,60,60,36];
  if(S._popupTxt==null) S._popupTxt='';
  if(S._popupUntil==null) S._popupUntil=0;
  if(S._popupT0==null) S._popupT0=0;
  if(S._lcdWipeT0==null) S._lcdWipeT0=0;
  if(S._lastParam==null) S._lastParam=-1;
  if(S._lastParamPage==null) S._lastParamPage='';
  if(!S._rndScope) S._rndScope='SOUND';
  if(!S._rndAmount) S._rndAmount='RANDOM';
  if(!S._rndMachines) S._rndMachines='THEME';
  if(!S._rndTheme) S._rndTheme='AUTO';
  return true;
}
initUiStateFields();
const _domCache={};
let _lcdCtx=null,_lcdDirty=true,_knobsDirty=true,_stepsDirty=true,_lastVibrate=0;
function cachedEl(selector){ return _domCache[selector]||(_domCache[selector]=$(selector)); }

/* Older Safari/WKWebView fallback: translate touch/mouse into the pointer
   events used by knobs and trig keys. No-op on every modern browser. */
function installPointerFallback(){
  if(window.PointerEvent||window.__monoPointerFallback) return;
  window.__monoPointerFallback=true;
  const proto=window.Element&&Element.prototype;
  if(proto&&!proto.setPointerCapture) proto.setPointerCapture=function(){};
  if(proto&&!proto.releasePointerCapture) proto.releasePointerCapture=function(){};
  const targets={}; let mouseTarget=null;
  const dispatch=(type,target,src,id,pointerType)=>{
    if(!target||!target.dispatchEvent) return true;
    let ev;
    try{ ev=new Event(type,{bubbles:true,cancelable:true}); }
    catch(err){ ev=document.createEvent('Event'); ev.initEvent(type,true,true); }
    ev.pointerId=id; ev.pointerType=pointerType; ev.isPrimary=true;
    ['clientX','clientY','pageX','pageY','screenX','screenY','button','buttons','altKey','shiftKey','ctrlKey','metaKey'].forEach(k=>{ try{ ev[k]=src[k]; }catch(err){} });
    return target.dispatchEvent(ev);
  };
  const touchHandler=type=>e=>{
    const list=e.changedTouches||[];
    for(let i=0;i<list.length;i++){
      const t=list[i];
      let target=type==='pointerdown'?t.target:(targets[t.identifier]||t.target);
      if(type==='pointerdown') targets[t.identifier]=target;
      const ok=dispatch(type,target,t,t.identifier||1,'touch');
      if(!ok&&e.cancelable) e.preventDefault();
      if(type==='pointerup'||type==='pointercancel') delete targets[t.identifier];
    }
  };
  document.addEventListener('touchstart',touchHandler('pointerdown'),{capture:true,passive:false});
  document.addEventListener('touchmove',touchHandler('pointermove'),{capture:true,passive:false});
  document.addEventListener('touchend',touchHandler('pointerup'),{capture:true,passive:false});
  document.addEventListener('touchcancel',touchHandler('pointercancel'),{capture:true,passive:false});
  document.addEventListener('mousedown',e=>{ mouseTarget=e.target; if(!dispatch('pointerdown',mouseTarget,e,1,'mouse')&&e.cancelable)e.preventDefault(); },true);
  document.addEventListener('mousemove',e=>{ if(mouseTarget) dispatch('pointermove',mouseTarget,e,1,'mouse'); },true);
  document.addEventListener('mouseup',e=>{ if(mouseTarget) dispatch('pointerup',mouseTarget,e,1,'mouse'); mouseTarget=null; },true);
}
installPointerFallback();
let muteMode=false, sheetType=null, recMode=0; // recMode 0=GRID 1=LIVE 2=KEYS(OFF)
let slideEdit=false, funcHeld=false, funcLatch=false, funcUsedFlag=false, powered=false, _powerBusy=false, _playBusy=false;
let lcdMode='off', bootT0=0, bootTimer=null; // off | boot | main
initUiStateFields();
let _tempoEditUntil=0;
function tempoEditActive(){ return performance.now()<_tempoEditUntil; }
function lcdTransition(){ S._lcdWipeT0=performance.now(); }
function updateTempoReadout(){ const tv=$('#tempoVal'); if(tv) tv.textContent=Number(curPat().bpm||120).toFixed(1); }
function showTempoPopup(ms=1600){
  const now=performance.now();
  S._popupTxt='TEMPO '+Number(curPat().bpm).toFixed(1);
  S._popupUntil=now+ms; S._popupT0=now; _tempoEditUntil=now+2300;
  updateTempoReadout(); renderLCDTop();
}
function setTempo(v,opts={}){
  const p=curPat();
  const nv=clamp(Math.round((+v||120)*10)/10,30,300);
  const changed=nv!==p.bpm;
  p.bpm=nv;
  showTempoPopup(opts.ms||1600);
  if(changed) renderKnobs();
  if(opts.save!==false) saveSoon();
  return nv;
}
const PAGE_PRINT=[['SYN','SYNTHESIS'],['AMP','AMPLIFICATION'],['FILT','FILTER'],['EFX','EFFECTS'],['LFO1','LFO 1'],['LFO2','LFO 2'],['LFO3','LFO 3']];
function isFunc(){ return funcHeld||funcLatch; }
function consumeFunc(){ const f=isFunc(); if(f&&funcHeld) funcUsedFlag=true; if(funcLatch){ funcLatch=false; renderTracksPages(); } return f; }
function finishBoot(){
  if(lcdMode!=='boot') return;
  if(bootTimer) clearTimeout(bootTimer);
  bootTimer=null; lcdMode='main'; drawLCD();
}
function skipBoot(force){ if(lcdMode==='boot'&&(force||performance.now()-bootT0>120)) finishBoot(); }
function startBoot(){
  bootT0=performance.now();
  if(bootTimer) clearTimeout(bootTimer);
  bootTimer=setTimeout(()=>{ bootTimer=null; finishBoot(); },1080);
}

/* ---------- messages ---------- */
let msgTimer=null;
function showMsg(m,ms=1700){
  const now=performance.now(); S.msg=m; S._popupT0=now;
  const t=cachedEl('#toast');
  if(t){ if(t._mmText!==m){ t.textContent=m; t._mmText=m; } t.classList.add('show'); }
  renderLCDTop(); clearTimeout(msgTimer);
  msgTimer=setTimeout(()=>{ S.msg=''; if(t)t.classList.remove('show'); renderLCDTop(); },ms);
  if(navigator.vibrate&&now-_lastVibrate>280){ _lastVibrate=now; try{navigator.vibrate(6);}catch(e){} }
}

/* ---------- param access ---------- */
function curDefs(){ return pageDef(curTrk(),S.page); }
function getRaw(page,i){
  if(S.lockStep>=0){ const st=curTrk().steps[S.lockStep]; const k=page+'.'+i; if(k in st.locks) return st.locks[k]; }
  return curTrk().params[page][i];
}
function isLocked(page,i){ if(S.lockStep<0) return false; return (page+'.'+i) in curTrk().steps[S.lockStep].locks; }
let _audThrottle=0;
function audition(ti,note,len=0.5,locks=null){ if(!AE.started) return; AE.noteOn(ti,note==null?S.lastNote[ti]:note,nowT()+0.01,0.9,{len,locks,poly:S.poly}); }
function setParam(i,raw){
  raw=R127(raw); const page=S.page, tr=curTrk(), def=curDefs()[i]; if(!def) return;
  S._lastParam=i; S._lastParamPage=page; S._lastParamT=performance.now();
  if(S.lockStep>=0){
    const st=tr.steps[S.lockStep]; const wasOn=!!st.on;
    if(wasOn&&st.locks[page+'.'+i]===raw) return;
    st.locks[page+'.'+i]=raw;
    if(!wasOn){ st.on=true; st.trigless=true; st.note=S.lastNote[S.selTrack]; }
    const n=performance.now(); if(n-_audThrottle>140){ _audThrottle=n; audition(S.selTrack,st.note,0.35,st.locks); }
    renderSteps();
  } else {
    if(tr.params[page][i]===raw) return;
    tr.params[page][i]=raw;
    if(AE.started){ AE.applyChain(S.selTrack,effParams(tr,null,S.selTrack),nowT()); const tk=AE.tracks[S.selTrack]; if(page==='SYN'&&tk.voice&&tk.voice.syn[i]) tk.voice.syn[i](raw); }
  }
  renderLCD(); renderKnobs(); saveSoon();
}

/* ---------- LCD: true 128x64, 1-bit, pixel font (as the hardware) ---------- */
const LC={W:128,H:64};
const F3={
' ':[0,0,0,0,0],'A':[2,5,7,5,5],'B':[6,5,6,5,6],'C':[3,4,4,4,3],'D':[6,5,5,5,6],'E':[7,4,6,4,7],'F':[7,4,6,4,4],
'G':[3,4,5,5,3],'H':[5,5,7,5,5],'I':[7,2,2,2,7],'J':[1,1,1,5,2],'K':[5,5,6,5,5],'L':[4,4,4,4,7],'O':[2,5,5,5,2],
'P':[6,5,6,4,4],'Q':[2,5,5,6,3],'R':[6,5,6,5,5],'S':[3,4,2,1,6],'T':[7,2,2,2,2],'U':[5,5,5,5,7],'V':[5,5,5,5,2],
'X':[5,5,2,5,5],'Y':[5,5,2,2,2],'Z':[7,1,2,4,7],
'0':[7,5,5,5,7],'1':[2,6,2,2,7],'2':[2,5,1,2,7],'3':[7,1,3,1,7],'4':[5,5,7,1,1],'5':[7,4,6,1,6],
'6':[3,4,6,5,2],'7':[7,1,2,2,2],'8':[2,5,2,5,2],'9':[2,5,3,1,6],
'-':[0,0,7,0,0],'+':[0,2,7,2,0],'/':[1,1,2,4,4],'.':[0,0,0,0,2],':':[0,2,0,2,0],';':[0,2,0,2,4],',':[0,0,0,2,4],
'[':[3,2,2,2,3],']':[6,2,2,2,6],'(':[1,2,2,2,1],')':[4,2,2,2,4],'<':[1,2,4,2,1],'>':[4,2,1,2,4],'=':[0,7,0,7,0],
'_':[0,0,0,0,7],'%':[5,1,2,4,5],'!':[2,2,2,0,2],'?':[6,1,2,0,2],"'":[2,2,4,0,0],'"':[5,5,0,0,0],'#':[5,7,5,7,5],
'*':[5,2,5,0,0],'&':[2,5,2,5,3],'@':[2,5,7,4,3],
'M':[17,27,21,17,17],'N':[9,13,11,9,9],'W':[17,17,21,21,10]};
const F3W={'M':5,'N':4,'W':5};
const CYR={'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'E','Ж':'ZH','З':'Z','И':'I','Й':'I','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F','Х':'H','Ц':'C','Ч':'CH','Ш':'SH','Щ':'SH','Ъ':'','Ы':'Y','Ь':'','Э':'E','Ю':'YU','Я':'YA'};
const _lcdNormCache=new Map();
function lcdNorm(t){
  const key=String(t);
  const hit=_lcdNormCache.get(key); if(hit!==undefined) return hit;
  const out=key.toUpperCase().split('').map(ch=>
    CYR[ch]!==undefined?CYR[ch] : ch==='▶'?'>' : ch==='■'?'#' : ch==='●'?'.' :
    (ch==='—'||ch==='–'||ch==='−')?'-' : ch==='·'?'.' : ch==='×'?'X' : ch==='…'?'.' : ch).join('');
  if(_lcdNormCache.size>180) _lcdNormCache.clear();
  _lcdNormCache.set(key,out); return out;
}
function lcdW(t,sc){ t=lcdNorm(t); let w=0; for(const ch of t) w+=(F3W[ch]||3)+1; return Math.max(0,(w-1)*(sc||1)); }
function lcdPrint(c,t,x,y,o){
  o=o||{}; const sc=o.scale||1; t=lcdNorm(t); const w=lcdW(t,sc);
  if(o.align==='center') x-=Math.floor(w/2); else if(o.align==='right') x-=w;
  c.fillStyle=o.color; c.beginPath(); let cx=x;
  for(const ch of t){
    const g=F3[ch]||F3['?'], gw=F3W[ch]||3;
    for(let r=0;r<5;r++){ const bits=g[r]; for(let col=0;col<gw;col++) if(bits&(1<<(gw-1-col))) c.rect(cx+col*sc,y+r*sc,sc,sc); }
    cx+=(gw+1)*sc;
  }
  c.fill(); return w;
}
function lcdFit(t,maxPx){ t=lcdNorm(t); while(t.length&&lcdW(t,1)>maxPx) t=t.slice(0,-1); return t; }
function lcdCtx(){
  if(_lcdCtx) return _lcdCtx;
  const cv=$('#lcdCanvas'); if(!cv) return null;
  try{ _lcdCtx=cv.getContext('2d',{alpha:false,desynchronized:true})||cv.getContext('2d'); }
  catch(e){ _lcdCtx=cv.getContext('2d'); }
  return _lcdCtx;
}
function renderLCDTop(){ _lcdDirty=true; }
function renderLCD(){ _lcdDirty=true; }
function pxKnob(c,cx,cy,raw,col){
  c.fillStyle=col; c.beginPath(); const seen=new Set();
  const plot=(x,y)=>{ const k=x*1000+y; if(!seen.has(k)){ seen.add(k); c.rect(x,y,1,1); } };
  for(let a=0;a<6.29;a+=0.2) plot(cx+Math.round(Math.cos(a)*4),cy+Math.round(Math.sin(a)*4));
  const a=Math.PI*0.75+(raw/127)*Math.PI*1.5;
  const ex=cx+Math.round(Math.cos(a)*4), ey=cy+Math.round(Math.sin(a)*4);
  for(let i=0;i<=4;i++) plot(cx+Math.round((ex-cx)*i/4),cy+Math.round((ey-cy)*i/4));
  c.fill();
}
function drawMLogoPx(c,x,y,u,color){
  const pts=[[0,0],[0,1],[0,2],[0,3],[0,4],[1,1],[2,2],[3,1],[4,0],[4,1],[4,2],[4,3],[4,4],[5,1],[6,2],[7,1],[8,0],[8,1],[8,2],[8,3],[8,4]];
  c.fillStyle=color; pts.forEach(q=>c.fillRect(x+q[0]*u,y+q[1]*u,u-1,u-1));
}
function wrapLcd(t,maxPx){
  const words=lcdNorm(t).split(' '), lines=[]; let cur='';
  for(const w of words){ const cand=cur?cur+' '+w:w; if(lcdW(cand,1)<=maxPx) cur=cand; else { if(cur)lines.push(cur); cur=w; if(lines.length===2)break; } }
  if(cur&&lines.length<3) lines.push(cur);
  return lines.slice(0,3).map(l=>lcdFit(l,maxPx));
}
function lcdWindow(c,lines,ink,bg,age=999){
  const fullH=lines.length*7+7;
  let h=fullH,w=106,showText=true;
  if(age<45){ h=3; w=64; showText=false; }
  else if(age<100){ h=Math.max(7,Math.round(fullH*0.55)); w=88; showText=false; }
  const x=Math.round((128-w)/2), y=Math.round((64-h)/2);
  c.fillStyle=ink; c.fillRect(x+2,y+2,w,h);
  c.fillStyle=bg; c.fillRect(x,y,w,h);
  c.strokeStyle=ink; c.lineWidth=1; c.strokeRect(x+0.5,y+0.5,w-1,h-1);
  if(showText) lines.forEach((ln,i)=>lcdPrint(c,ln,64,y+4+i*7,{color:ink,align:'center'}));
}
function drawBoot(c,ink,bg){
  const t=(performance.now()-bootT0)/1000;
  if(t<0.09){ c.fillStyle=ink; c.fillRect(0,0,128,64); return; } // LCD all-pixel test
  if(t<0.16) return; // blank frame
  if(t>=1.03){ finishBoot(); return; }
  drawMLogoPx(c,51,5,3,ink);
  lcdPrint(c,'MONOMACHINE',64,24,{scale:2,color:ink,align:'center'});
  lcdPrint(c,'SFX-60+ WEB OS V5.3.1',64,38,{color:ink,align:'center'});
  const blocks=clamp(Math.floor((t-0.16)/0.09),0,8);
  c.fillStyle=ink;
  for(let i=0;i<blocks;i++) c.fillRect(49+i*4,48,3,3);
  const p=curPat();
  lcdPrint(c,lcdFit(patLabel(S.curPat)+' '+p.name,60),1,56,{color:ink});
  lcdPrint(c,lcdFit(p.kit,60),127,56,{color:ink,align:'right'});
  const reveal=clamp((t-0.16)/0.34,0,1);
  if(reveal<1){
    const x=Math.floor(128*reveal);
    c.fillStyle=bg; c.fillRect(x,0,128-x,64);
    c.fillStyle=ink; c.fillRect(x,0,1,64);
  }
}
function paintLCD(){
  const c=lcdCtx(); if(!c) return;
  const ink='#11150e', bg='#a9b89c';
  if(!powered||lcdMode==='off'){ c.fillStyle='#1e221b'; c.fillRect(0,0,128,64); return; }
  c.fillStyle=bg; c.fillRect(0,0,128,64);
  if(lcdMode==='boot'){ drawBoot(c,ink,bg); return; }
  const p=curPat(), tr=curTrk();
  lcdPrint(c,lcdFit(patLabel(S.curPat)+' '+p.name,44),1,1,{color:ink});
  lcdPrint(c,lcdFit(MACH[tr.machine].name,40),65,1,{color:ink,align:'center'});
  lcdPrint(c,Number(p.bpm).toFixed(1)+' T'+(S.selTrack+1),127,1,{color:ink,align:'right'});
  c.fillStyle=ink; c.fillRect(0,8,128,1);
  const defs=curDefs(), nowP=performance.now();
  for(let i=0;i<8;i++){
    const col=i%4, row=Math.floor(i/4), x=col*32, y=10+row*22, def=defs[i];
    const locked=!!def&&isLocked(S.page,i);
    if(locked){ c.fillStyle=ink; c.fillRect(x,y,32,22); }
    const fg=locked?bg:ink;
    if(!def){ lcdPrint(c,'---',x+16,y+3,{color:fg,align:'center'}); continue; }
    lcdPrint(c,def.n,x+16,y+2,{color:fg,align:'center'});
    const raw=getRaw(S.page,i);
    pxKnob(c,x+8,y+15,raw,fg);
    lcdPrint(c,formatVal(def,raw),x+30,y+13,{color:fg,align:'right'});
    if(i===S._lastParam&&S._lastParamPage===S.page&&nowP-(S._lastParamT||0)<1400){
      const age=nowP-(S._lastParamT||0); c.fillStyle=fg; c.fillRect(x+3,y+20,26,1);
      if(Math.floor(age/180)%2===0){ c.fillRect(x+2,y+1,1,5); c.fillRect(x+29,y+1,1,5); }
    }
  }
  if(S.playing&&S.playStep>=0){ c.fillStyle=bg; c.fillRect((S.playStep%16)*8+2,8,4,1); }
  c.fillStyle=ink; c.fillRect(0,55,128,1);
  lcdPrint(c,lcdFit(S.page+' '+p.kit,70),1,57,{color:ink});
  const mutes=p.tracks.map((tt,i)=>tt.muted?'X':(i+1)).join('');
  lcdPrint(c,(S.lockStep>=0?'LK'+(S.lockStep+1)+' ':'')+(S.seqPage+1)+':4 '+mutes,127,57,{color:ink,align:'right'});
  const wipeAge=nowP-(S._lcdWipeT0||0);
  if(wipeAge>=0&&wipeAge<130){
    const x=Math.floor(128*wipeAge/130);
    c.fillStyle=bg; c.fillRect(x,9,128-x,46);
    c.fillStyle=ink; c.fillRect(x,9,1,46);
  }
  const popupAge=nowP-(S._popupT0||0);
  if(S._popupUntil>nowP&&S._popupTxt) lcdWindow(c,[S._popupTxt,tempoEditActive()?'LEVEL = TEMPO':''],ink,bg,popupAge);
  else if(S.msg) lcdWindow(c,wrapLcd(S.msg,98),ink,bg,popupAge);
}
// Compatibility wrapper: all old call sites now coalesce into the RAF painter.
function drawLCD(){ _lcdDirty=true; }
let _lcdPopupWas=false;
function lcdAnimActive(now){
  if(lcdMode==='boot') return true;
  const wipeAge=now-(S._lcdWipeT0||0);
  if(wipeAge>=0&&wipeAge<170) return true;
  const popupAge=now-(S._popupT0||0);
  if(((S._popupUntil>now&&S._popupTxt)||S.msg)&&popupAge<140) return true; // opening window only
  if(S._lastParamPage&&now-(S._lastParamT||0)<1450) return true; // blinking last-edited cell
  return false;
}
function maybePaintLCD(now){
  const popupVisible=!!((S._popupUntil>now&&S._popupTxt)||S.msg);
  if(_lcdPopupWas&&!popupVisible) _lcdDirty=true; // tempo popup has no expiry timer
  _lcdPopupWas=popupVisible;
  if(_lcdDirty){ _lcdDirty=false; paintLCD(); _lcdLast=now; return; }
  if(powered&&lcdMode!=='off'&&lcdAnimActive(now)&&now-_lcdLast>=33){ paintLCD(); _lcdLast=now; }
}
/* ---------- knobs ---------- */
function buildKnobs(){
  S._knobParts=[]; S._mknobParts=[];
  const wrap=$('#knobs'); if(!wrap) return;
  const existingWraps=Array.from(wrap.querySelectorAll('.knob-wrap'));
  const adoptKnobs=existingWraps.length===8;
  if(!adoptKnobs) wrap.innerHTML='';
  for(let i=0;i<8;i++){
    let w=adoptKnobs?existingWraps[i]:el('div','knob-wrap');
    let k=w.querySelector('.knob'); if(!k){ k=el('div','knob'); w.append(k); }
    k.dataset.idx=i;
    let ind=k.querySelector('.knob-ind'); if(!ind){ ind=el('div','knob-ind'); k.append(ind); }
    let lab=w.querySelector('.knob-lab'); if(!lab){ lab=el('div','knob-lab','-'); w.append(lab); }
    let letter=w.querySelector('.knob-letter'); if(!letter){ letter=el('div','knob-letter','ABCDEFGH'[i]); w.append(letter); }
    if(!adoptKnobs) wrap.append(w);
    S._knobParts.push({k,ind,lab,lastRaw:null,lastLabel:null,lastDisabled:null,lastLocked:null});
    attachKnobDrag(w,{
      get:()=>getRaw(S.page,i),
      set:v=>setParam(i,v),
      def:()=>{const d=curDefs()[i]; return d?d.d:64;},
      label:()=>{const d=curDefs()[i]; return d? d.n+' '+formatVal(d,getRaw(S.page,i)):'---';}
    });
  }
  // header knobs
  document.querySelectorAll('.mknob').forEach(k=>{
    const kind=k.dataset.k;
    const tempoRaw=()=>(curPat().bpm-30)/(300-30)*127;
    const currentRaw=()=> kind==='master'? S.masterVol*127 : kind==='level'? (tempoEditActive()?tempoRaw():curTrk().level) : tempoRaw();
    let lastHeadMsg=0;
    const headMsg=txt=>{ const n=performance.now(); if(n-lastHeadMsg>180){ lastHeadMsg=n; showMsg(txt,650); } };
    S._mknobParts.push({k,ind:k.querySelector('.knob-ind'),kind,lastV:null});
    attachKnobDrag(k,{
      get:currentRaw,
      set:v=>{ v=R127(v); if(v===R127(currentRaw())) return;
        if(kind==='master'){ S.masterVol=v/127; if(AE.master)AE.master.gain.setTargetAtTime(S.masterVol,nowT(),0.02); headMsg('MASTER VOL '+v); }
        else if(kind==='level'&&tempoEditActive()){ setTempo(30+v/127*270); }
        else if(kind==='level'){ curTrk().level=v; if(AE.started)AE.applyChain(S.selTrack,effParams(curTrk(),null,S.selTrack),nowT()); headMsg('T'+(S.selTrack+1)+' LEVEL '+v); }
        else setTempo(30+v/127*270);
        renderLCDTop(); saveSoon();
      },
      def:()=> kind==='master'?108: kind==='level'? (tempoEditActive()?(120-30)/270*127:100): (120-30)/270*127,
      scale:()=> kind==='level'&&tempoEditActive()?0.22:1,
      label:()=> kind==='master'?'MASTER VOL': kind==='level'? (tempoEditActive()?'TEMPO '+Number(curPat().bpm).toFixed(1):'LEVEL'):'TEMPO '+curPat().bpm
    },true);
  });
}
function renderKnobs(){ _knobsDirty=true; }
function paintKnobs(){
  _knobsDirty=false;
  const defs=curDefs();
  if(!S._knobParts||!S._knobParts.length){
    S._knobParts=Array.from(document.querySelectorAll('#knobs .knob-wrap')).map(w=>({k:w.querySelector('.knob'),ind:w.querySelector('.knob-ind'),lab:w.querySelector('.knob-lab'),lastRaw:null,lastLabel:null,lastDisabled:null,lastLocked:null}));
  }
  S._knobParts.forEach((part,i)=>{
    const def=defs[i], raw=def?getRaw(S.page,i):0;
    if(part.lastRaw!==raw){ part.lastRaw=raw; if(part.ind) part.ind.style.transform='rotate('+(-135+raw/127*270)+'deg)'; }
    const dis=!def, lok=isLocked(S.page,i), lab=def?def.n:'---';
    if(part.lastDisabled!==dis){ part.lastDisabled=dis; part.k.classList.toggle('disabled',dis); }
    if(part.lastLocked!==lok){ part.lastLocked=lok; part.k.classList.toggle('locked',lok); }
    if(part.lastLabel!==lab){ part.lastLabel=lab; part.lab.textContent=lab; }
  });
  if(!S._mknobParts||!S._mknobParts.length){
    S._mknobParts=Array.from(document.querySelectorAll('.mknob')).map(k=>({k,ind:k.querySelector('.knob-ind'),kind:k.dataset.k,lastV:null}));
  }
  S._mknobParts.forEach(part=>{
    const v= part.kind==='master'? S.masterVol*127 : part.kind==='level'? (tempoEditActive()?(curPat().bpm-30)/270*127:curTrk().level) : (curPat().bpm-30)/270*127;
    const q=Math.round(clamp(v,0,127)*2)/2;
    if(part.lastV!==q){ part.lastV=q; if(part.ind) part.ind.style.transform='rotate('+(-135+q/127*270)+'deg)'; }
  });
}
function attachKnobDrag(elm,io,isHeader){
  let startY=0,startV=0,moved=false,pid=null,lastTap=0;
  elm.style.touchAction='none';
  const knobEl=()=> (elm.classList.contains('knob')||elm.classList.contains('mknob')) ? elm : elm.querySelector('.knob,.mknob');
  const cleanup=()=>{ document.body.classList.remove('knob-dragging'); elm.classList.remove('dragging'); const k=knobEl(); if(k) k.classList.remove('dragging'); };
  elm.addEventListener('pointerdown',e=>{
    pid=e.pointerId;
    try{ elm.setPointerCapture(pid); }catch(err){}
    startY=e.clientY; startV=io.get(); moved=false;
    document.body.classList.add('knob-dragging'); elm.classList.add('dragging'); const k=knobEl(); if(k) k.classList.add('dragging');
    e.preventDefault();
    const nT=performance.now(); if(nT-lastTap<320){ io.set(io.def()); startV=io.get(); showMsg((io.label?io.label():'')+' RESET',800); lastTap=0; } else lastTap=nT;
  });
  elm.addEventListener('pointermove',e=>{
    if(e.pointerId!==pid) return;
    e.preventDefault();
    const dy=startY-e.clientY;
    if(Math.abs(dy)>3) moved=true; if(!moved) return;
    const fine=((e.altKey||e.shiftKey)?0.12:0.58)*(io.scale?io.scale():1);
    io.set(startV+dy*fine);
  });
  const up=e=>{
    if(e.pointerId!==pid) return;
    const wasMoved=moved; pid=null; cleanup();
    try{ elm.releasePointerCapture(e.pointerId); }catch(err){}
    if(!wasMoved&&io.label) showMsg(io.label(),900);
  };
  elm.addEventListener('pointerup',up); elm.addEventListener('pointercancel',up);
  elm.addEventListener('lostpointercapture',()=>{ pid=null; cleanup(); });
  elm.addEventListener('contextmenu',e=>e.preventDefault());
  elm.addEventListener('wheel',e=>{ e.preventDefault(); const sc=io.scale?io.scale():1; io.set(io.get()-Math.sign(e.deltaY)*(e.shiftKey?1:4)*sc); },{passive:false});
}
/* ---------- tracks / pages / steps ---------- */
function toggleMute(i){
  const tr=curPat().tracks[i]; tr.muted=!tr.muted;
  if(AE.started){ if(tr.muted) AE.killTrack(i); else AE.restoreTrack(i); }
  showMsg('TRACK '+(i+1)+(tr.muted?' MUTED':' UNMUTED'));
}
function buildStatic(){
  const pl=$('#pageList'); if(!pl) return;
  const existingPages=Array.from(pl.querySelectorAll('.pagerow'));
  const adoptPages=existingPages.length===PAGE_PRINT.length;
  if(!adoptPages) pl.innerHTML='';
  PAGE_PRINT.forEach((q,rowIdx)=>{
    const pg=q[0], label=q[1];
    let b=adoptPages?existingPages[rowIdx]:el('button','pagerow');
    b.type='button'; b.dataset.page=pg;
    if(!adoptPages){
      const plabEl=el('span','plabel',label); plabEl.dataset.short=pg; b.append(el('span','pline'), plabEl, el('span','pdot'));
      pl.append(b);
    }
    b.onclick=()=>{ S.page=pg; lcdTransition(); skipBoot(); renderAll(); };
  });
  const tb=$('#trackBtns'); if(!tb) return;
  const existingTracks=Array.from(tb.querySelectorAll('.trow'));
  const adoptTracks=existingTracks.length===6&&existingTracks.every(r=>r.querySelector('.tbtn'));
  if(!adoptTracks) tb.innerHTML='';
  for(let i=0;i<6;i++){
    let row=adoptTracks?existingTracks[i]:el('div','trow'); row.dataset.trk=i;
    let b=row.querySelector('.tbtn');
    if(!adoptTracks||!b){
      const lab=el('span','tlab'); lab.append(document.createTextNode('TRACK'), el('b','',(i+1)+''));
      b=el('button','creamBtn tbtn'); b.type='button'; b.append(el('span','tnum','T'+(i+1))); b.setAttribute('aria-label','Track '+(i+1));
      row.append(el('span','led tled'), lab, b, el('span','muteLab','MUTE'));
    }
    b.onclick=()=>{
      skipBoot();
      if(consumeFunc()||muteMode) toggleMute(i);
      else { S.selTrack=i; S.lockStep=-1; lcdTransition(); }
      renderAll(); saveSoon();
    };
    let pressT=null;
    b.addEventListener('pointerdown',()=>{ pressT=setTimeout(()=>audition(i,null,0.6),420); });
    ['pointerup','pointerleave','pointercancel'].forEach(ev=>b.addEventListener(ev,()=>clearTimeout(pressT)));
    if(!adoptTracks) tb.append(row);
  }
  const pld=$('#pageLeds');
  if(pld&&pld.querySelectorAll('.pled').length!==4){ pld.innerHTML=''; for(let i=0;i<4;i++) pld.append(el('span','pled')); }
  S._pageRows=Array.from(pl.children); S._trackRows=Array.from(tb.children); S._pageLeds=Array.from(pld.children);
  S._bankSpans=Array.from(document.querySelectorAll('#bankLeds span[data-bank]'));
  document.querySelectorAll('#bankLeds span[data-bank]').forEach(sp=>{
    sp.onclick=()=>{ skipBoot(); selectPattern((+sp.dataset.bank)*16+(S.curPat%16),true); };
  });
  buildSteps(); buildKnobs();
}
function renderTracksPages(){
  (S._pageRows||document.querySelectorAll('#pageList .pagerow')).forEach(b=>b.classList.toggle('on',b.dataset.page===S.page));
  (S._trackRows||document.querySelectorAll('#trackBtns .trow')).forEach((r,i)=>{
    r.classList.toggle('on',i===S.selTrack);
    r.classList.toggle('muted',curPat().tracks[i].muted);
  });
  const tgl=(id,on)=>{ const e=cachedEl(id); if(e) e.classList.toggle('on',!!on); };
  tgl('#funcBtn',isFunc());
  tgl('#btnRec',false); { const rb=cachedEl('#btnRec'); if(rb) rb.classList.toggle('rec-on',recMode!==2); }
  tgl('#btnPlay',S.playing);
  tgl('#ledRec',recMode===0||(recMode===1&&S.playing));
  tgl('#ledPlay',S.playing);
  tgl('#ledPattern',!S.songMode); tgl('#ledSong',!!S.songMode);
  tgl('#slideBtn',slideEdit); tgl('#arpBtn',S.page==='ARP'); tgl('#bankBtn',muteMode);
  tgl('#startBtn',powered); tgl('#standbyLed',powered);
  const bp=(S.queuedPat!=null?S.queuedPat:S.curPat);
  (S._bankSpans||document.querySelectorAll('#bankLeds span[data-bank]')).forEach(sp=>sp.classList.toggle('on',+sp.dataset.bank===Math.floor(bp/16)));
  tgl('#tsAmp',S.page==='AMP'); tgl('#tsFilt',S.page==='FILT'); tgl('#tsLfo',S.page.indexOf('LFO')===0);
  const unit=cachedEl('#unit'); if(unit) unit.classList.toggle('off',!powered);
  updateTempoReadout();
}
function renderPageLeds(){
  if(S._shownSeqPage===S.seqPage&&S._pageLeds) return;
  S._shownSeqPage=S.seqPage;
  (S._pageLeds||document.querySelectorAll('#pageLeds .pled')).forEach((b,i)=>b.classList.toggle('on',i===S.seqPage));
}
function buildSteps(){
  const g=$('#trigGrid'); if(!g) return;
  const existingCells=Array.from(g.querySelectorAll('.trigcell'));
  const adoptSteps=existingCells.length===16&&existingCells.every(c=>c.querySelector('.trig'));
  if(!adoptSteps) g.innerHTML='';
  for(let i=0;i<16;i++){
    let cell=adoptSteps?existingCells[i]:el('div','trigcell');
    let b=cell.querySelector('.trig');
    if(!adoptSteps||!b){
      b=el('button','trig'); b.type='button'; b.dataset.i=i;
      b.append(el('span','t-note',''));
      cell.append(el('span','t-led'), b, el('span','t-num',(i+1)+''));
      g.append(cell);
    } else b.dataset.i=i;
    attachTrig(b,i);
  }
  S._trigCells=Array.from(g.children);
  S._stepParts=S._trigCells.map(cell=>({cell,num:cell.querySelector('.t-num'),note:cell.querySelector('.t-note'),cls:'',numTxt:'',noteTxt:null}));
  S._shownSeqPage=-1; _stepsDirty=true;
}
function renderSteps(){ _stepsDirty=true; }
function paintSteps(){
  _stepsDirty=false;
  const tr=curTrk(), base=S.seqPage*16, p=curPat();
  if(!S._stepParts){
    const cells=S._trigCells||Array.from(document.querySelectorAll('#trigGrid .trigcell'));
    S._stepParts=cells.map(cell=>({cell,num:cell.querySelector('.t-num'),note:cell.querySelector('.t-note'),cls:'',numTxt:'',noteTxt:null}));
  }
  S._stepParts.forEach((part,i)=>{
    const cell=part.cell, si=base+i, st=tr.steps[si];
    let hasLock=false; if(st.on&&st.locks) for(const _k in st.locks){ hasLock=true; break; }
    let cls='trigcell';
    if(st.on) cls+=' on';
    if(st.on&&st.trigless) cls+=' trigless';
    if(st.on&&st.slide) cls+=' slide';
    if(hasLock) cls+=' haslock';
    if(S.lockStep===si) cls+=' lockedit';
    if(S.playStep===si) cls+=' playing';
    if(si>=p.len) cls+=' beyond';
    if(i%4===0) cls+=' beat';
    if(part.cls!==cls){ part.cls=cls; cell.className=cls; }
    const numTxt=String(si+1);
    if(part.numTxt!==numTxt){ part.numTxt=numTxt; part.num.textContent=numTxt; }
    const noteTxt= recMode===2? noteName(S.octave*12+i) : (st.on? (st.trigless?'LOCK':(tr.machine==='BBOX'? BBOX_DRUMS[clamp(((st.note-36)%24+24)%24,0,23)].slice(0,4) : noteName(st.note))) : '');
    if(part.noteTxt!==noteTxt){ part.noteTxt=noteTxt; part.note.textContent=noteTxt; }
  });
  renderPageLeds();
}
function updatePlayhead(prev,cur){
  if(_stepsDirty||!S._stepParts){ paintSteps(); return; }
  const base=S.seqPage*16;
  const set=(step,on)=>{
    const i=step-base; if(i<0||i>15) return;
    const part=S._stepParts[i]; part.cell.classList.toggle('playing',on); part.cls=part.cell.className;
  };
  if(prev!==cur) set(prev,false);
  set(cur,true);
}
function attachTrig(b,i){
  let downT=0,longTimer=null,longed=false,lastTap=0,noteHeld=null;
  b.addEventListener('pointerdown',e=>{
    e.preventDefault(); b.setPointerCapture(e.pointerId); downT=performance.now(); longed=false;
    const si=S.seqPage*16+i;
    if(recMode===2||recMode===1){
      const note=S.octave*12+i; noteHeld=note; S.lastNote[S.selTrack]=note;
      if(AE.started) AE.noteOn(S.selTrack,note,nowT()+0.005,0.95,{len:8,poly:S.poly,live:true});
      if(recMode===1&&S.playing&&S.playStep>=0){ const st2=curTrk().steps[S.playStep]; st2.on=true; st2.trigless=false; st2.note=note; st2.len=2; st2.slide=false; renderSteps(); saveSoon(); }
      b.classList.add('held'); return;
    }
    longTimer=setTimeout(()=>{ longed=true; S.lockStep=si; S.selStep=si; const st=curTrk().steps[si];
      showMsg('LOCK STEP '+(si+1),1200);
      if(st.on) audition(S.selTrack,st.note,0.4,st.locks);
      renderSteps(); renderLCD(); renderKnobs(); },380);
  });
  const up=e=>{
    clearTimeout(longTimer); b.classList.remove('held');
    const si=S.seqPage*16+i;
    if(recMode===2||recMode===1){ if(noteHeld!=null&&AE.started) AE.noteOff(S.selTrack,noteHeld,nowT()); noteHeld=null; return; }
    if(longed) return;
    const now=performance.now();
    if(S.lockStep===si){ S.lockStep=-1; showMsg('P-LOCK OK'); renderSteps(); renderLCD(); renderKnobs(); return; }
    if(S.lockStep>=0){ S.lockStep=si; const st=curTrk().steps[si]; if(st.on) audition(S.selTrack,st.note,0.4,st.locks); renderSteps(); renderLCD(); renderKnobs(); return; }
    if(now-lastTap<300){ lastTap=0; S.selStep=si; openSheet('step'); return; }
    lastTap=now;
    const st=curTrk().steps[si];
    if(slideEdit){ st.on=true; st.trigless=false; st.slide=!st.slide; showMsg('STEP '+(si+1)+' SLIDE '+(st.slide?'ON':'OFF')); renderSteps(); saveSoon(); return; }
    st.on=!st.on;
    if(st.on){ st.trigless=false; if(curTrk().machine==='BBOX'){ if(st.note<36||st.note>59) st.note=36; } else if(!st._edited) st.note=S.lastNote[S.selTrack];
      S.lastNote[S.selTrack]=st.note; audition(S.selTrack,st.note,0.4,st.locks); }
    renderSteps(); saveSoon();
  };
  b.addEventListener('pointerup',up); b.addEventListener('pointercancel',up);
  b.addEventListener('contextmenu',e=>e.preventDefault());
}
function renderAll(){ renderTracksPages(); renderLCD(); renderKnobs(); renderSteps(); }

/* ---------- transport & misc buttons ---------- */
function selectPattern(i,queue){
  i=clamp(i,0,127);
  if(queue&&S.playing){ S.queuedPat=i; showMsg('QUEUED '+patLabel(i)+' '+pat(i).name); renderLCDTop(); return; }
  S.curPat=i; S.queuedPat=null; S.lockStep=-1; S.seqPage=0; S.followPage=true; lcdTransition();
  if(AE.started) AE.patternChanged();
  showMsg(patLabel(i)+' '+curPat().name+' · '+curPat().bpm+' BPM'); renderAll(); saveSoon();
}
function doCopy(){
  if(S.lockStep>=0){ S.clipSteps=JSON.parse(JSON.stringify(curTrk().steps[S.lockStep])); showMsg('STEP COPIED'); }
  else { S.clipPat=JSON.parse(JSON.stringify(curPat())); S.clipTrack=kitOfTrack(curTrk()); showMsg('PATTERN + TRACK COPIED'); }
}
function doPaste(){
  if(S.lockStep>=0&&S.clipSteps){ Object.assign(curTrk().steps[S.lockStep],JSON.parse(JSON.stringify(S.clipSteps))); showMsg('STEP PASTED'); }
  else if(S.clipPat){ S.patterns[S.curPat]=revivePattern(JSON.parse(JSON.stringify(S.clipPat))); if(AE.started)AE.patternChanged(); showMsg('PATTERN PASTED → '+patLabel(S.curPat)); }
  else showMsg('CLIPBOARD EMPTY');
  renderAll(); saveSoon();
}
function doClear(){
  if(S.lockStep>=0){ curTrk().steps[S.lockStep].locks={}; showMsg('LOCKS CLEARED · STEP '+(S.lockStep+1)); }
  else { curTrk().steps=Array.from({length:64},mkStep); showMsg('TRACK '+(S.selTrack+1)+' CLEARED'); }
  renderAll(); saveSoon();
}
function addLongPress(elm,fn,ms){
  if(!elm) return; let t=null, fired=false;
  elm.addEventListener('pointerdown',()=>{ fired=false; t=setTimeout(()=>{ fired=true; fn(); },ms||480); });
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>elm.addEventListener(ev,()=>clearTimeout(t)));
  elm.addEventListener('click',e=>{ if(fired){ e.stopImmediatePropagation(); e.preventDefault(); fired=false; } },true);
}
function bindTransport(){
  document.addEventListener('pointerdown',()=>skipBoot(),true);
  const Q=id=>$(id);
  Q('#startBtn').onclick=()=>togglePower();
  const wavBtn=Q('#wavRecBtn'); if(wavBtn) wavBtn.onclick=()=>toggleWavRecording();
  // FUNCTION: hold (second finger) or tap to latch for one key — brown labels
  const fb=Q('#funcBtn'); let funcDownT=0;
  fb.addEventListener('pointerdown',()=>{ funcHeld=true; funcUsedFlag=false; funcDownT=performance.now(); renderTracksPages(); });
  const fup=()=>{ if(!funcHeld) return; const dt=performance.now()-funcDownT; funcHeld=false; if(!funcUsedFlag&&dt<400) funcLatch=!funcLatch; funcUsedFlag=false; renderTracksPages(); };
  fb.addEventListener('pointerup',fup); fb.addEventListener('pointercancel',fup); fb.addEventListener('pointerleave',fup);
  // TEMPO: explicit - / TAP / + (hold ± repeats), LEVEL edits tempo while popup is open
  let taps=[]; const tb=Q('#tempoBtn');
  const pulseTempoLed=()=>{ const tl=Q('#tempoLed'); if(tl){ tl.classList.add('on'); setTimeout(()=>tl.classList.remove('on'),95); } };
  addLongPress(tb,()=>openSheet('scale'));
  tb.onclick=()=>{ skipBoot(); const n=performance.now(); taps=taps.filter(t=>n-t<2200); taps.push(n);
    if(taps.length>=2){
      const ivs=[]; for(let i=Math.max(1,taps.length-5);i<taps.length;i++) ivs.push(taps[i]-taps[i-1]);
      const iv=ivs.reduce((a,b)=>a+b,0)/ivs.length;
      setTempo(60000/iv);
    } else showTempoPopup();
    pulseTempoLed(); renderKnobs(); };
  const bindTempoStep=(btn,dir)=>{
    if(!btn) return;
    let delayT=null,repT=null,reps=0,pid=null;
    const stop=()=>{ clearTimeout(delayT); clearInterval(repT); delayT=null; repT=null; pid=null; };
    btn.addEventListener('pointerdown',e=>{
      e.preventDefault(); skipBoot(); pid=e.pointerId;
      try{ btn.setPointerCapture(pid); }catch(err){}
      setTempo(curPat().bpm+dir); pulseTempoLed(); reps=0;
      delayT=setTimeout(()=>{ repT=setInterval(()=>{ reps++; setTempo(curPat().bpm+dir*(reps>18?5:1)); if(reps%4===0)pulseTempoLed(); },65); },360);
    });
    ['pointerup','pointercancel','lostpointercapture'].forEach(ev=>btn.addEventListener(ev,stop));
    btn.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setTempo(curPat().bpm+dir); pulseTempoLed(); } });
    btn.addEventListener('contextmenu',e=>e.preventDefault());
  };
  bindTempoStep(Q('#tempoDown'),-1);
  bindTempoStep(Q('#tempoUp'),1);
  // data page up/down + EDIT (machine)
  const cycPage=d=>{ const list=PAGE_PRINT.map(q=>q[0]); let i=list.indexOf(S.page); if(i<0)i=0; S.page=list[(i+d+list.length)%list.length]; lcdTransition(); renderAll(); };
  Q('#pageUp').onclick=()=>cycPage(-1);
  Q('#pageDown').onclick=()=>cycPage(1);
  Q('#editBtn').onclick=()=>openSheet('machine');
  // kit/song setup & pattern/song (FUNC: GLOBAL / POLY)
  Q('#kitSongBtn').onclick=()=>{ consumeFunc()? openSheet('setup') : openSheet('kit'); };
  addLongPress(Q('#patSongBtn'),()=>{ S.songMode=!S.songMode; showMsg(S.songMode?'SONG MODE':'PATTERN MODE'); renderAll(); if(S.songMode) openSheet('song'); });
  Q('#patSongBtn').onclick=()=>{ if(consumeFunc()){ S.poly=!S.poly; showMsg(S.poly?'POLY ON':'MONO PER TRACK'); } else openSheet(S.songMode?'song':'pattern'); renderAll(); };
  // enter / exit / arrows
  Q('#enterBtn').onclick=()=>{ if(sheetType) closeSheet(); else { if(S.lockStep>=0) S.selStep=S.lockStep; openSheet('step'); } };
  Q('#exitBtn').onclick=()=>{ if(sheetType) closeSheet(); else if(S.lockStep>=0){ S.lockStep=-1; showMsg('P-LOCK OK'); renderAll(); } else if(muteMode){ muteMode=false; renderAll(); } };
  Q('#arrLeft').onclick=()=>selectPattern((S.curPat+127)%128,true);
  Q('#arrRight').onclick=()=>selectPattern((S.curPat+1)%128,true);
  Q('#arrUp').onclick=()=>{ if(recMode===2){ S.octave=clamp(S.octave+1,1,8); showMsg('OCTAVE '+(S.octave-1)); } else S.selTrack=(S.selTrack+5)%6; S.lockStep=-1; renderAll(); };
  Q('#arrDown').onclick=()=>{ if(recMode===2){ S.octave=clamp(S.octave-1,1,8); showMsg('OCTAVE '+(S.octave-1)); } else S.selTrack=(S.selTrack+1)%6; S.lockStep=-1; renderAll(); };
  // bank + function row (FUNC on BANK = MUTE MODE)
  Q('#bankBtn').onclick=()=>{ if(consumeFunc()){ muteMode=!muteMode; showMsg(muteMode?'MUTE MODE ON':'MUTE MODE OFF'); renderAll(); } else openSheet('pattern'); };
  Q('#arpBtn').onclick=()=>{ S.page='ARP'; lcdTransition(); renderAll(); };
  Q('#transpBtn').onclick=()=>openSheet('transp');
  Q('#swingBtn').onclick=()=>openSheet('scale');
  Q('#slideBtn').onclick=()=>{ slideEdit=!slideEdit; showMsg(slideEdit?'SLIDE EDIT ON':'SLIDE EDIT OFF'); renderAll(); };
  // transport: REC / PLAY / STOP — FUNCTION: COPY / CLEAR / PASTE
  Q('#btnRec').onclick=()=>{ if(consumeFunc()){ doCopy(); return; }
    recMode=(recMode+1)%3; S.gridRec=recMode===0; S.liveRec=recMode===1; if(recMode!==0) S.lockStep=-1;
    showMsg(recMode===0?'GRID REC':recMode===1?'LIVE REC':'KEYBOARD'); renderAll(); };
  Q('#btnPlay').onclick=async()=>{ if(consumeFunc()){ doClear(); return; }
    if(_playBusy) return;
    _playBusy=true;
    try{
      if(!powered) await togglePower();
      finishBoot();
      if(!AE.started){ try{ await startEngine(); }catch(e){ console.error(e); } }
      const audioRunning=AE.resume?await AE.resume():(AE.ctx&&AE.ctx.state==='running');
      if(S.playing) AE.stop();
      else {
        AE.play(S._pausedStep||0); S._pausedStep=0;
        if(!audioRunning) showMsg('AUDIO SUSPENDED — CLICK PLAY AGAIN',2200);
      }
      renderAll();
    }finally{ _playBusy=false; } };
  Q('#btnStop').onclick=()=>{ if(consumeFunc()){ doPaste(); return; }
    const stopCapture=isWavRecording(); AE.stop(); S._pausedStep=0;
    if(stopCapture) stopWavRecording();
    renderAll(); };
  // trig select (FUNC = MIDI SEQ out) & scale setup (tap = page, FUNC/hold = setup)
  Q('#trigSelBtn').onclick=()=>{ if(consumeFunc()){ S.midiOut=!S.midiOut; showMsg('MIDI SEQ OUT: '+(S.midiOut?'ON':'OFF')); } else { if(S.lockStep>=0) S.selStep=S.lockStep; openSheet('step'); } };
  addLongPress(Q('#btnScale'),()=>openSheet('scale'));
  Q('#btnScale').onclick=()=>{ if(consumeFunc()){ openSheet('scale'); return; } const pages=Math.max(1,Math.ceil(curPat().len/16)); S.seqPage=(S.seqPage+1)%pages; S.followPage=false; showMsg('PAGE '+(S.seqPage+1)+':4'); renderAll(); };
  const lc=Q('#lcdCanvas'); if(lc) lc.addEventListener('pointerdown',()=>skipBoot());
  document.querySelectorAll('[data-sheet]').forEach(b=>b.onclick=()=>openSheet(b.dataset.sheet));
  Q('#sheetClose').onclick=closeSheet;
  Q('#sheetOverlay').addEventListener('pointerdown',e=>{ if(e.target.id==='sheetOverlay') closeSheet(); });
}
/* ---------- sheets ---------- */
function openSheet(type){ sheetType=type; $('#sheetOverlay').classList.add('open'); SHEETS[type]&&SHEETS[type](); }
function closeSheet(){ $('#sheetOverlay').classList.remove('open'); sheetType=null; renderAll(); }
function sheetHead(t){ $('#sheetTitle').textContent=t; const b=$('#sheetBody'); b.innerHTML=''; return b; }
function actBtn(parent,label,fn,cls){ const b=el('button','sbtn '+(cls||''),label); b.onclick=fn; parent.append(b); return b; }
function slider(parent,label,min,max,val,step,fn,fmt){
  const row=el('div','srow'); const lab=el('span','slab',label); const inp=el('input'); inp.type='range'; inp.min=min;inp.max=max;inp.step=step||1;inp.value=val;
  const out=el('span','sval',fmt?fmt(val):val); inp.oninput=()=>{ const v=parseFloat(inp.value); out.textContent=fmt?fmt(v):v; fn(v); };
  row.append(lab,inp,out); parent.append(row); return inp;
}

/* ---------- kit apply / undo / musical randomizers ---------- */
initUiStateFields();
let _undoKit=null;
function sanitizedParams(machine,params){
  const out=defaultParams(machine);
  if(params) for(const pg of PAGES) if(Array.isArray(params[pg])) for(let i=0;i<8;i++)
    if(typeof params[pg][i]==='number') out[pg][i]=R127(params[pg][i]);
  return out;
}
function applyTrackSound(tr,src){
  if(!tr||!src) return;
  const machine=MACH[src.machine]?src.machine:'SAW';
  tr.machine=machine;
  tr.level=clamp(Math.round(src.level==null?100:src.level),0,127);
  tr.out=src.out==='NEIB'?'NEIB':'MAIN';
  tr.params=sanitizedParams(machine,src.params);
  if(Array.isArray(src._hwExtra)) tr._hwExtra=src._hwExtra.slice(0,16); else delete tr._hwExtra;
  if(typeof src._hwType==='number') tr._hwType=src._hwType; else delete tr._hwType;
}
function currentKitObject(name){
  const p=curPat();
  return {name:sanitizeKitName(name||p.kit||'KIT'),tracks:p.tracks.map(kitOfTrack),hw:p._hwKit?JSON.parse(JSON.stringify(p._hwKit)):null,
    source:p._hwKit?'sysex':undefined,sourcePosition:p._hwKit&&typeof p._hwKit.position==='number'?p._hwKit.position:undefined};
}
function snapshotUndoKit(){ _undoKit=currentKitObject(curPat().kit); }
function refreshTrackSound(i){ if(AE.started) AE.setMachine(i); }
function refreshAllSounds(){
  if(AE.started){ for(let i=0;i<6;i++) AE.setMachine(i); AE.patternChanged(); }
}
function applyKitObject(k,opts={}){
  if(!k||!Array.isArray(k.tracks)) { showMsg('BAD KIT'); return false; }
  if(opts.snapshot!==false) snapshotUndoKit();
  const p=curPat();
  for(let i=0;i<6;i++) applyTrackSound(p.tracks[i],k.tracks[i]);
  p.kit=sanitizeKitName(k.name||'KIT');
  if(k.hw) p._hwKit=JSON.parse(JSON.stringify(k.hw)); else delete p._hwKit;
  S.lockStep=-1; lcdTransition(); refreshAllSounds(); renderAll(); saveSoon();
  if(opts.msg!==false) showMsg('KIT LOADED: '+p.kit);
  return true;
}
function undoKitChange(){
  if(!_undoKit){ showMsg('NOTHING TO UNDO'); return; }
  const redo=currentKitObject(curPat().kit),old=_undoKit; _undoKit=redo;
  applyKitObject(old,{snapshot:false,msg:false}); showMsg('KIT UNDO: '+old.name);
}
function upsertKit(k){
  const clean={name:sanitizeKitName(k.name||'KIT'),tracks:JSON.parse(JSON.stringify(k.tracks||[]))};
  if(k.hw) clean.hw=JSON.parse(JSON.stringify(k.hw));
  if(k.source) clean.source=k.source;
  if(typeof k.sourcePosition==='number') clean.sourcePosition=k.sourcePosition;
  let idx=-1;
  if(clean.source==='sysex'&&typeof clean.sourcePosition==='number')
    idx=S.kits.findIndex(x=>x.source==='sysex'&&x.sourcePosition===clean.sourcePosition&&x.name===clean.name);
  if(idx<0) idx=S.kits.findIndex(x=>x.name===clean.name&&JSON.stringify(x.tracks)===JSON.stringify(clean.tracks));
  if(idx>=0) S.kits[idx]=clean; else { S.kits.push(clean); idx=S.kits.length-1; }
  return idx;
}
const _rnd=(a,b)=>a+Math.random()*(b-a);
const _rndi=(a,b)=>Math.floor(_rnd(a,b+1));
const _chance=p=>Math.random()<p;
const _pick=a=>a[Math.floor(Math.random()*a.length)];
function _centered(center,spread){ return R127(center+((Math.random()+Math.random()+Math.random())/3-0.5)*2*spread); }
function _enumRaw(def,idx){
  if(!def) return 64;
  if(def.t==='onoff') return idx?127:0;
  const n=def.e?def.e.length:(def.t==='w32'?32:def.t==='w64'?64:def.t==='cons'?CONS_LIST.length:2);
  return sxRawForEnum(clamp(idx,0,n-1),n);
}
function _randomDiscrete(def,current){
  if(def.t==='onoff') return _chance(0.55)?127:0;
  const n=def.e?def.e.length:(def.t==='w32'?32:def.t==='w64'?64:def.t==='cons'?CONS_LIST.length:2);
  return _enumRaw(def,_rndi(0,n-1));
}
function randomParamRaw(def,tr,page,idx,amount){
  if(!def) return 64;
  const cur=tr.params[page][idx]||0;
  const chaos=amount==='CHAOS', mutate=amount==='MUTATE';
  if(mutate&&_chance(0.42)) return cur;
  if(mutate && def.t!=='enum' && def.t!=='onoff' && def.t!=='w32' && def.t!=='w64' && def.t!=='cons')
    return R127(cur+_rnd(-34,34));
  const n=def.n;
  if(def.t==='enum'||def.t==='onoff'||def.t==='w32'||def.t==='w64'||def.t==='cons'){
    if(n==='INP') return cur; // routing is set deliberately by kit role/import
    return _randomDiscrete(def,cur);
  }
  if(def.t==='tune'||n==='TUNE') return _centered(64,chaos?28:13);
  if(def.t==='pch'||/^PCH/.test(n)){
    if(_chance(0.18)) return 64;
    const semis=_pick([-12,-7,-5,-4,-3,0,3,4,5,7,12]);
    return R127(64+semis*5.33+_rnd(-2,2));
  }
  if(page==='AMP'){
    if(idx===0) return _rndi(0,chaos?58:32);
    if(idx===1) return _rndi(0,58);
    if(idx===2) return _rndi(46,124);
    if(idx===3) return _rndi(8,92);
    if(idx===4) return _centered(72,chaos?34:22);
    if(idx===5) return _rndi(80,122);
    if(idx===6) return _centered(64,34);
    if(idx===7) return _chance(0.62)?0:_rndi(8,74);
  }
  if(page==='FILT'){
    if(idx===0) return _rndi(0,chaos?46:28);
    if(idx===1) return _rndi(58,127);
    if(idx===2||idx===3) return _rndi(0,chaos?94:72);
    if(idx===4) return _rndi(0,48);
    if(idx===5) return _rndi(28,112);
    return _centered(64,chaos?48:34);
  }
  if(page==='EFX'){
    if(idx===0) return _rndi(12,118);
    if(idx===1) return _centered(64,34);
    if(idx===2) return _chance(0.58)?_rndi(0,18):_rndi(18,chaos?92:58);
    if(idx===3) return _pick([8,16,24,32,40,48,64,80,96]);
    if(idx===4) return _chance(0.48)?0:_rndi(22,86);
    if(idx===5) return _rndi(12,chaos?92:78);
    if(idx===6) return _rndi(2,72);
    return _rndi(52,127);
  }
  if(/FB$/.test(n)||n==='1FB'||n==='2FB') return _rndi(0,chaos?92:68);
  if(/VOL$/.test(n)||n==='CVOL') return _rndi(54,122);
  if(n==='MIX') return MACH[tr.machine].fx?_rndi(58,127):_centered(64,44);
  if(/FRQ$/.test(n)||/FREQ/.test(n)) return _centered(58,chaos?54:38);
  if(/ENV$/.test(n)||/FEN$/.test(n)||/VEN$/.test(n)) return _rndi(18,124);
  if(/DEC$/.test(n)) return _rndi(30,124);
  if(/ATK$/.test(n)) return _rndi(0,56);
  if(/PW/.test(n)) return _centered(def.t==='bip'?64:58,42);
  if(/WAVE|WAV/.test(n)) return _rndi(0,127);
  if(def.t==='bip') return _centered(64,chaos?56:40);
  return chaos?_rndi(0,127):_centered(64,52);
}
function sanitizeTrackSound(tr,role='LEAD'){
  const A=tr.params.AMP,F=tr.params.FILT;
  A[5]=clamp(Math.max(A[5],MACH[tr.machine].fx?82:74),0,127);
  A[2]=clamp(Math.max(A[2],role==='DRUM'?32:44),0,127);
  A[3]=clamp(Math.min(A[3],MACH[tr.machine].fx?127:104),0,127);
  F[0]=clamp(Math.min(F[0],44),0,127);
  F[1]=clamp(Math.max(F[1],56),0,127);
  F[2]=clamp(Math.min(F[2],100),0,127); F[3]=clamp(Math.min(F[3],100),0,127);
  if(MACH[tr.machine].fx){ A[2]=Math.max(A[2],108); A[3]=Math.max(A[3],84); }
  if(tr.machine==='NOIS') tr.params.SYN[2]=127;
  if(tr.machine.indexOf('FM')===0){ const i=MACH[tr.machine].syn.findIndex(d=>d&&d.n==='TONE'); if(i>=0) tr.params.SYN[i]=Math.max(tr.params.SYN[i],64); }
  if(tr.machine==='GND'&&role!=='TEXTURE'){ /* silence only by explicit machine choice outside random kit */ }
}
function randomizeLFOPage(tr,page,amount){
  const P=tr.params[page],defs=PAGE_DEFS[page];
  if(amount!=='CHAOS'&&_chance(0.52)){ P[7]=0; return; }
  const targets=[['FILT',0],['FILT',1],['FILT',3],['AMP',5],['AMP',6],['EFX',4],['PTCH',1]];
  const synDefs=MACH[tr.machine].syn;
  synDefs.forEach((d,i)=>{ if(d&&d.n!=='TUNE'&&d.n!=='INP') targets.push(['SYN',i]); });
  const [pg,dst]=_pick(targets);
  P[0]=_enumRaw(defs[0],LFO_PAGES.indexOf(pg));
  P[1]=_enumRaw(defs[1],dst);
  P[2]=_enumRaw(defs[2],_pick([0,0,1,1,2,3]));
  P[3]=_enumRaw(defs[3],_rndi(0,9));
  P[4]=_enumRaw(defs[4],_rndi(0,amount==='CHAOS'?6:4));
  P[5]=_centered(64,44);
  P[6]=_chance(0.72)?0:_rndi(8,80);
  P[7]=amount==='CHAOS'?_rndi(20,112):_rndi(8,72);
}
function randomizeTrackSound(ti,opts={}){
  const tr=curPat().tracks[ti]; if(!tr) return;
  const scope=opts.scope||S._rndScope||'SOUND';
  const amount=opts.amount||S._rndAmount||'RANDOM';
  const role=opts.role||'LEAD';
  const pages=scope==='SYN'?['SYN']:scope==='SOUND'?['SYN','AMP','FILT','EFX']:['SYN','AMP','FILT','EFX','LFO1','LFO2','LFO3','ARP'];
  pages.forEach(pg=>{
    if(pg.indexOf('LFO')===0){ randomizeLFOPage(tr,pg,amount); return; }
    if(pg==='ARP'){
      const A=tr.params.ARP,D=PAGE_DEFS.ARP;
      if(role==='DRUM'||MACH[tr.machine].fx||_chance(0.58)) A[0]=0;
      else {
        A[0]=_enumRaw(D[0],_pick([1,1,2,3,4])); A[1]=_enumRaw(D[1],_pick([2,3,3,4]));
        A[2]=_enumRaw(D[2],_rndi(0,2)); A[3]=_pick([8,16,24,32]); A[6]=_enumRaw(D[6],_pick([0,1,2,3,4,7]));
      }
      A[7]=_rndi(76,118); return;
    }
    const defs=pageDef(tr,pg);
    for(let i=0;i<8;i++){ if(defs[i]) tr.params[pg][i]=randomParamRaw(defs[i],tr,pg,i,amount); }
  });
  sanitizeTrackSound(tr,role);
  refreshTrackSound(ti);
}
const RND_THEMES={
  ACID:{DRUM:['BBOX','NOIS'],BASS:['SAW','PULS','SID','SIN'],LEAD:['SID','SAW','DWAVE'],PAD:['ENS','PULS'],TEXTURE:['DWAVE','FMSTAT','NOIS'],FX:['REVERB','CHORUS','PHASER']},
  'FM LAB':{DRUM:['BBOX','FMDYN'],BASS:['FMDYN','FMSTAT','SIN'],LEAD:['FMPAR','FMDYN','FMSTAT'],PAD:['FMPAR','ENS'],TEXTURE:['FMSTAT','VO6','DWAVE'],FX:['RINGMOD','REVERB','FLANGER']},
  CHIP:{DRUM:['BBOX','NOIS'],BASS:['SID','PULS','SIN'],LEAD:['SID','PULS','SAW'],PAD:['ENS','SID'],TEXTURE:['DWAVE','SID','NOIS'],FX:['CHORUS','PHASER','DYNAMIX']},
  DIGI:{DRUM:['BBOX','DWAVE'],BASS:['DWAVE','DDRW','SIN'],LEAD:['DWAVE','DDRW','DENS'],PAD:['DENS','ENS','DDRW'],TEXTURE:['DDRW','DWAVE','NOIS'],FX:['REVERB','FLANGER','RINGMOD']},
  DUB:{DRUM:['BBOX','SIN'],BASS:['SIN','SAW','FMDYN'],LEAD:['DWAVE','VO6','PULS'],PAD:['ENS','DENS'],TEXTURE:['NOIS','DWAVE','VO6'],FX:['REVERB','DYNAMIX','CHORUS']},
  INDUSTRIAL:{DRUM:['BBOX','NOIS','FMDYN'],BASS:['FMDYN','SAW','SID'],LEAD:['FMPAR','DWAVE','SID'],PAD:['ENS','DENS'],TEXTURE:['NOIS','FMSTAT','DWAVE'],FX:['RINGMOD','DYNAMIX','FLANGER']},
  VOX:{DRUM:['BBOX','NOIS'],BASS:['SIN','PULS','FMSTAT'],LEAD:['VO6','FMPAR','DWAVE'],PAD:['ENS','VO6','DENS'],TEXTURE:['VO6','NOIS','DWAVE'],FX:['REVERB','CHORUS','PHASER']},
  MINIMAL:{DRUM:['BBOX','SIN'],BASS:['SIN','PULS','SAW'],LEAD:['DWAVE','SID','FMSTAT'],PAD:['ENS','PULS'],TEXTURE:['SIN','NOIS','DWAVE'],FX:['REVERB','CHORUS']}
};
function rndKitName(theme){
  const words={ACID:['ACID','RAVE','303'],'FM LAB':['FM','METAL','BELL'],CHIP:['CHIP','8BIT','PIXEL'],DIGI:['DIGI','WAVE','DATA'],DUB:['DUB','ECHO','DEEP'],INDUSTRIAL:['STEEL','RUST','NOISE'],VOX:['VOX','CHOIR','TALK'],MINIMAL:['MIN','PULSE','Mono']};
  return sanitizeKitName((_pick(words[theme]||['RND']))+' '+_pick(['KIT','LAB','SYS','MOD'])+' '+String(_rndi(10,99))).slice(0,11);
}
function inferKitRoles(p){
  const info=p.tracks.map((tr,i)=>{
    const on=tr.steps.filter(st=>st.on&&!st.trigless);
    const avg=on.length?on.reduce((a,st)=>a+st.note,0)/on.length:60;
    const len=on.length?on.reduce((a,st)=>a+(st.len||1),0)/on.length:1;
    return {i,count:on.length,avg,len,machine:tr.machine};
  });
  const roles=new Array(6).fill('LEAD');
  let drum=info.find(x=>x.machine==='BBOX');
  if(!drum) drum=info.slice().sort((a,b)=>(b.count*2-Math.abs(b.avg-42))-(a.count*2-Math.abs(a.avg-42)))[0];
  if(drum) roles[drum.i]='DRUM';
  const rest=()=>info.filter(x=>roles[x.i]==='LEAD');
  const bass=rest().sort((a,b)=>a.avg-b.avg)[0]; if(bass) roles[bass.i]='BASS';
  const pad=rest().sort((a,b)=>(b.len-b.count*0.04)-(a.len-a.count*0.04))[0]; if(pad) roles[pad.i]='PAD';
  const texture=rest().sort((a,b)=>a.count-b.count)[0]; if(texture) roles[texture.i]='TEXTURE';
  const fxIdx=[5,4,3,2,1,0].find(i=>roles[i]==='LEAD');
  if(fxIdx!=null&&_chance(0.55)) roles[fxIdx]='FX';
  return roles;
}
function randomizeKit(opts={}){
  snapshotUndoKit();
  const p=curPat();
  const themeName=(S._rndTheme&&S._rndTheme!=='AUTO'&&RND_THEMES[S._rndTheme])?S._rndTheme:_pick(Object.keys(RND_THEMES));
  const theme=RND_THEMES[themeName];
  const roles=inferKitRoles(p);
  const changeMachines=(opts.machines||S._rndMachines)!=='KEEP';
  p.tracks.forEach((tr,i)=>{
    const role=roles[i];
    if(changeMachines){
      const pool=theme[role]||theme.LEAD;
      const machine=_pick(pool);
      if(machine!==tr.machine){ tr.machine=machine; tr.params=defaultParams(machine); delete tr._hwExtra; delete tr._hwType; }
    }
    if(MACH[tr.machine].fx){ tr.params.SYN[7]=0; tr.out='MAIN'; }
    randomizeTrackSound(i,{scope:opts.scope||S._rndScope,amount:opts.amount||S._rndAmount,role});
    tr.level=role==='DRUM'?_rndi(92,116):role==='BASS'?_rndi(88,112):role==='FX'?_rndi(84,108):_rndi(76,106);
  });
  // Keep a readable stereo/delay picture instead of six simultaneous washes.
  const pans=[38,52,64,76,90,64].sort(()=>Math.random()-0.5);
  let delayCount=0;
  p.tracks.forEach((tr,i)=>{ tr.params.AMP[6]=pans[i]; if(tr.params.EFX[4]>0){ delayCount++; if(delayCount>2) tr.params.EFX[4]=0; } });
  p.kit=rndKitName(themeName); delete p._hwKit;
  const kit=currentKitObject(p.kit); kit.source='random'; upsertKit(kit);
  lcdTransition(); refreshAllSounds(); renderAll(); saveSoon();
  audition(S.selTrack,null,0.65);
  showMsg('RANDOM KIT '+themeName+': '+p.kit,2200);
  return kit;
}
const SHEETS={
 machine(){
  const b=sheetHead('KIT EDIT — MACHINE T'+(S.selTrack+1)+' (как на железке: SYN сбросится)');
  const groups={}; MACHINES.forEach(m=>{(groups[m.g]=groups[m.g]||[]).push(m);});
  for(const g in groups){ b.append(el('div','sgroup',g)); const row=el('div','sgrid'); b.append(row);
    groups[g].forEach(m=>{ const btn=el('button','scell'+(curTrk().machine===m.id?' on':''),m.name);
      btn.onclick=()=>{ const tr=curTrk(); tr.machine=m.id; tr.params.SYN=MACH[m.id].syn.map(d=>d?d.d:64);
        if(AE.started) AE.setMachine(S.selTrack);
        showMsg('T'+(S.selTrack+1)+' → '+m.name); saveSoon(); openSheet('machine'); renderAll(); audition(S.selTrack,null,0.5); };
      row.append(btn); }); }
  const fxNote=el('p','snote','FX-машины обрабатывают NEIB (предыдущий трек) / INP (вход) / BUS — вход выбирается ручкой H (INP) на странице SYN. Триги FX-трека открывают гейт огибающей AMP, как на оригинале. В MIXER можно увести трек в NEIB (без MAIN).'); b.append(fxNote);
 },
 pattern(){
  const b=sheetHead('PATTERN — банки A–H × 16 (128 паттернов)');
  const bankRow=el('div','sgrid'); b.append(bankRow);
  let bank=Math.floor(S.curPat/16);
  const draw=()=>{ bankRow.innerHTML=''; for(let i=0;i<8;i++){ const bb=el('button','scell'+(i===bank?' on':''),'BANK '+String.fromCharCode(65+i)); bb.onclick=()=>{bank=i;draw();}; bankRow.append(bb);} 
    let old=b.querySelector('.patgrid'); if(old)old.remove(); const g=el('div','sgrid patgrid'); b.insertBefore(g,b.querySelector('.patact'));
    for(let i=0;i<16;i++){ const idx=bank*16+i; const has=!!S.patterns[idx]||!!(S._factory&&S._factory[idx]);
      const btn=el('button','scell pat'+(idx===S.curPat?' on':'')+(idx===S.queuedPat?' queued':''),patLabel(idx)+' '+(has?pat(idx).name:'INIT'));
      btn.onclick=()=>{ selectPattern(idx,true); draw(); }; g.append(btn); } };
  const act=el('div','srow patact'); b.append(act); draw();
  actBtn(act,'COPY PATTERN',()=>{ S.clipPat=JSON.parse(JSON.stringify(curPat())); showMsg('PATTERN COPIED'); });
  actBtn(act,'PASTE',()=>{ if(S.clipPat){ S.patterns[S.curPat]=revivePattern(JSON.parse(JSON.stringify(S.clipPat))); if(AE.started)AE.patternChanged(); showMsg('PASTED → '+patLabel(S.curPat)); openSheet('pattern'); renderAll(); saveSoon(); } });
  actBtn(act,'CHAIN +CUR',()=>{ S.chain.push(S.curPat); showMsg('CHAIN: '+S.chain.map(patLabel).join('→')); });
  actBtn(act,'CLEAR CHAIN',()=>{ S.chain=[]; showMsg('CHAIN EMPTY'); });
  actBtn(act,'RENAME',()=>{ const n=prompt('Имя паттерна (до 10 симв.):',curPat().name); if(n){ curPat().name=n.toUpperCase().slice(0,10); openSheet('pattern'); renderAll(); saveSoon(); } });
  actBtn(act,'CLEAR STEPS',()=>{ curPat().tracks.forEach(t=>t.steps=Array.from({length:64},mkStep)); showMsg('STEPS CLEARED'); renderAll(); saveSoon(); },'danger');
  actBtn(act,'INIT PATTERN',()=>{ if(confirm('Сбросить паттерн полностью?')){ const nm=curPat().name; S.patterns[S.curPat]=mkPattern(nm); if(AE.started)AE.patternChanged(); openSheet('pattern'); renderAll(); saveSoon(); } },'danger');
  const act2=el('div','srow'); b.append(act2);
  actBtn(act2,'EUCLID GEN (трек)',()=>{ euclidGen(); });
  actBtn(act2,'TRANSPOSE +1',()=>transpose(1)); actBtn(act2,'TRANSPOSE −1',()=>transpose(-1));
 },
 kit(){
  const b=sheetHead('KITS — банк, SysEx import/export, randomize');
  const p=curPat();
  b.append(el('p','snote','Текущий кит: '+p.kit+(p._hwKit?' · Monomachine SysEx slot '+(((p._hwKit.position||0)+1)):'')+' · в банке '+S.kits.length+' китов. Импорт принимает настоящие KIT DUMP 0x52 из .syx/.mid; паттерны и DigiPRO-волны из того же файла можно открыть через FILE → SysEx.'));
  const io=el('div','srow'); b.append(io);
  actBtn(io,'⬆ IMPORT KIT .SYX',()=>pickSysExFile({context:'kit',body:b}));
  actBtn(io,'⬇ CURRENT KIT .SYX',()=>downloadCurrentKitSyx());
  actBtn(io,'⬇ ALL KITS .SYX',()=>downloadAllKitsSyx());
  actBtn(io,'SYSEX LIBRARY',()=>openSheet('sysexlib'));
  const importOut=el('pre','syxout','Выберите .syx с Monomachine: здесь появятся найденные киты и кнопки LOAD / ADD TO BANK.'); importOut.id='kitSyxOut'; b.append(importOut);
  const importActions=el('div','syx-actions'); importActions.id='kitSyxActions'; b.append(importActions);

  b.append(el('div','sgroup','RND · RANDOMIZE — музыкальный, не «всё на максимум»'));
  const optionRow=(label,values,get,set)=>{
    b.append(el('div','sgroup',label));
    const g=el('div','sgrid compact-grid'); b.append(g);
    values.forEach(v=>{ const btn=el('button','scell small'+(get()===v?' on':''),v); btn.onclick=()=>{ set(v); openSheet('kit'); }; g.append(btn); });
  };
  optionRow('SCOPE',['SYN','SOUND','ALL'],()=>S._rndScope,v=>S._rndScope=v);
  optionRow('AMOUNT',['MUTATE','RANDOM','CHAOS'],()=>S._rndAmount,v=>S._rndAmount=v);
  optionRow('MACHINES IN RANDOM KIT',['KEEP','THEME'],()=>S._rndMachines,v=>S._rndMachines=v);
  optionRow('THEME',['AUTO',...Object.keys(RND_THEMES)],()=>S._rndTheme,v=>S._rndTheme=v);
  const rndAct=el('div','srow'); b.append(rndAct);
  actBtn(rndAct,'RND · RANDOMIZE KIT — ВСЕ 6 ТРЕКОВ',()=>{ randomizeKit(); openSheet('kit'); });
  actBtn(rndAct,'RND · RANDOM TRK SOUND',()=>{ snapshotUndoKit(); randomizeTrackSound(S.selTrack); renderAll(); saveSoon(); audition(S.selTrack,null,0.65); showMsg('RANDOM SND T'+(S.selTrack+1)); openSheet('kit'); });
  actBtn(rndAct,'↩ UNDO KIT',()=>{ undoKitChange(); openSheet('kit'); });
  b.append(el('div','sgroup','ПО ТРЕКАМ: выбрать / слушать / рандомизировать звук'));
  const tg=el('div','track-rnd-grid'); b.append(tg);
  p.tracks.forEach((tr,i)=>{
    const cell=el('div','track-rnd'+(i===S.selTrack?' on':''));
    const main=el('button','scell small','T'+(i+1)+' '+MACH[tr.machine].name); main.onclick=()=>{ S.selTrack=i; renderAll(); audition(i,null,0.55); openSheet('kit'); };
    const row=el('div','srow tight');
    actBtn(row,'▶',()=>audition(i,null,0.6),'small');
    actBtn(row,'RND SND',()=>{ snapshotUndoKit(); S.selTrack=i; randomizeTrackSound(i); renderAll(); saveSoon(); audition(i,null,0.65); openSheet('kit'); },'small');
    actBtn(row,'INIT',()=>{ snapshotUndoKit(); tr.params=defaultParams(tr.machine); refreshTrackSound(i); renderAll(); saveSoon(); openSheet('kit'); },'small');
    cell.append(main,row); tg.append(cell);
  });

  b.append(el('div','sgroup','KIT BANK — тап загружает звуки, шаги паттерна не трогаются'));
  const g=el('div','sgrid'); b.append(g);
  S.kits.forEach((k,ki)=>{ const btn=el('button','scell',k.name+(k.source==='sysex'?' · SYX':k.source==='random'?' · RND':''));
    btn.onclick=()=>{ applyKitObject(k); closeSheet(); };
    g.append(btn); });
  const act=el('div','srow'); b.append(act);
  actBtn(act,'SAVE KIT AS…',()=>{ const n=prompt('Имя кита:',curPat().kit); if(n){ const nm=sanitizeKitName(n); const k=currentKitObject(nm); delete k.source; delete k.sourcePosition; upsertKit(k); curPat().kit=nm; showMsg('KIT SAVED '+nm); openSheet('kit'); saveSoon(); } });
  actBtn(act,'COPY TRACK SND',()=>{ S.clipTrack=kitOfTrack(curTrk()); showMsg('TRACK SOUND COPIED'); });
  actBtn(act,'PASTE SND',()=>{ if(S.clipTrack){ snapshotUndoKit(); applyTrackSound(curTrk(),S.clipTrack); refreshTrackSound(S.selTrack); renderAll(); saveSoon(); openSheet('kit'); } });
  actBtn(act,'INIT TRACK SND',()=>{ snapshotUndoKit(); const tr=curTrk(); tr.params=defaultParams(tr.machine); refreshTrackSound(S.selTrack); renderAll(); saveSoon(); openSheet('kit'); });
  actBtn(act,'УДАЛИТЬ ВЫБРАННЫЙ ИЗ БАНКА',()=>{ const nm=prompt('Точное имя кита для удаления:',curPat().kit); if(!nm)return; const i=S.kits.findIndex(k=>k.name===sanitizeKitName(nm)); if(i>=0){ S.kits.splice(i,1); showMsg('KIT DELETED'); openSheet('kit'); saveSoon(); } else showMsg('KIT NOT FOUND'); },'danger');
 },

 song(){
  const b=sheetHead('SONG — цепочка паттернов');
  const tog=el('div','srow'); b.append(tog);
  actBtn(tog, S.songMode?'SONG: ON (выкл)':'SONG: OFF (вкл)',()=>{ S.songMode=!S.songMode; S.songPos=0; S.songCount=0; if(S.songMode&&S.song.length) selectPattern(S.song[0].pat,false); openSheet('song'); });
  actBtn(tog,'+ ROW (текущий)',()=>{ S.song.push({pat:S.curPat,rep:1}); openSheet('song'); saveSoon(); });
  actBtn(tog,'CLEAR SONG',()=>{ S.song=[]; openSheet('song'); saveSoon(); },'danger');
  if(!S.song.length) b.append(el('p','snote','Песня пуста. Добавьте строки: паттерн будет играть REP раз и перейдёт дальше (зациклено).'));
  S.song.forEach((row,i)=>{ const r=el('div','srow'+(S.songMode&&i===S.songPos%Math.max(1,S.song.length)?' currow':''));
    const pb=el('button','sbtn',String(i+1).padStart(2,'0')+': '+patLabel(row.pat)+' '+pat(row.pat).name);
    pb.onclick=()=>{ row.pat=(row.pat+1)%128; openSheet('song'); saveSoon(); };
    const minus=el('button','sbtn small','REP −'); minus.onclick=()=>{ row.rep=clamp(row.rep-1,1,64); openSheet('song'); };
    const rv=el('span','sval','×'+row.rep);
    const plus=el('button','sbtn small','+'); plus.onclick=()=>{ row.rep=clamp(row.rep+1,1,64); openSheet('song'); };
    const del=el('button','sbtn small danger','✕'); del.onclick=()=>{ S.song.splice(i,1); openSheet('song'); saveSoon(); };
    r.append(pb,minus,rv,plus,del); b.append(r); });
 },
 mixer(){
  const b=sheetHead('MIXER / ROUTING');
  curPat().tracks.forEach((tr,i)=>{
    const head=el('div','sgroup','T'+(i+1)+' '+MACH[tr.machine].name); b.append(head);
    slider(b,'LEVEL',0,127,tr.level,1,v=>{ tr.level=v; if(AE.started)AE.applyChain(i,effParams(tr,null,i),nowT()); renderKnobs(); saveSoon(); });
    slider(b,'PAN',0,127,tr.params.AMP[6],1,v=>{ tr.params.AMP[6]=v; if(AE.started)AE.applyChain(i,effParams(tr,null,i),nowT()); saveSoon(); },v=>v-64);
    const r=el('div','srow'); b.append(r);
    actBtn(r,tr.muted?'UNMUTE':'MUTE',function(){ toggleMute(i); this.textContent=tr.muted?'UNMUTE':'MUTE'; renderTracksPages(); saveSoon(); });
    actBtn(r,'OUT: '+tr.out,function(){ tr.out=tr.out==='MAIN'?'NEIB':'MAIN'; this.textContent='OUT: '+tr.out; if(AE.started)AE.applyChain(i,effParams(tr,null,i),nowT()); saveSoon(); });
    actBtn(r,'▶ AUD',()=>{ S.selTrack=i; audition(i,null,0.6); renderAll(); });
  });
  b.append(el('p','snote','OUT=NEIB: трек не идёт в MAIN, а только в FX-машину следующего трека (как NEIGHBOR-роутинг на железке).'));
 },
 scale(){
  const b=sheetHead('SCALE SETUP — длина, скорость, свинг'); const p=curPat();
  const g=el('div','sgrid'); b.append(g);
  [16,32,48,64].forEach(L=>{ const btn=el('button','scell'+(p.len===L?' on':''),'LEN '+L); btn.onclick=()=>{ p.len=L; showMsg('PATTERN LENGTH '+L); openSheet('scale'); renderAll(); saveSoon(); }; g.append(btn); });
  const g2=el('div','sgrid'); b.append(g2);
  [[0.75,'3/4X'],[1,'1X'],[1.5,'3/2X'],[2,'2X']].forEach(([v,lab])=>{ const btn=el('button','scell'+(p.scale===v?' on':''),lab); btn.onclick=()=>{ p.scale=v; openSheet('scale'); saveSoon(); }; g2.append(btn); });
  slider(b,'SWING %',50,75,p.swing,1,v=>{ p.swing=v; renderLCDTop(); saveSoon(); });
  let tempoSlider=null;
  const tempoRow=el('div','srow'); b.append(tempoRow);
  const tempoStep=d=>{ setTempo(p.bpm+d); if(tempoSlider) tempoSlider.value=p.bpm; };
  actBtn(tempoRow,'TEMPO −5',()=>tempoStep(-5),'small');
  actBtn(tempoRow,'−1',()=>tempoStep(-1),'small');
  actBtn(tempoRow,'+1',()=>tempoStep(1),'small');
  actBtn(tempoRow,'TEMPO +5',()=>tempoStep(5),'small');
  tempoSlider=slider(b,'TEMPO BPM',30,300,p.bpm,0.1,v=>{ setTempo(v); },v=>v.toFixed(1));
  b.append(el('p','snote','На панели: − / TAP / + (удерживайте ±). Пока открыт TEMPO-popup, ручка LEVEL тоже меняет темп — как LEVEL-энкодер на железке.'));
 },
 step(){
  const si=S.selStep, st=curTrk().steps[si], tr=curTrk(); st._edited=true;
  const b=sheetHead('STEP '+(si+1)+' · T'+(S.selTrack+1)+' '+MACH[tr.machine].name);
  const redraw=()=>openSheet('step');
  const r0=el('div','srow'); b.append(r0);
  actBtn(r0, st.on?'TRIG: ON':'TRIG: OFF',()=>{ st.on=!st.on; if(st.on&&st.trigless==null)st.trigless=false; redraw(); renderSteps(); saveSoon(); });
  actBtn(r0, st.trigless?'TRIGLESS LOCK: ON':'TRIGLESS LOCK: OFF',()=>{ st.trigless=!st.trigless; if(st.trigless){ st.on=true; st.slide=false; } redraw(); renderSteps(); saveSoon(); });
  actBtn(r0, st.slide?'SLIDE: ON':'SLIDE: OFF',()=>{ st.slide=!st.slide; if(st.slide){ st.on=true; st.trigless=false; } redraw(); renderSteps(); saveSoon(); });
  actBtn(r0,'▶ ПРЕДПРОСЛУШКА',()=>audition(S.selTrack,st.note,0.5,st.locks));
  actBtn(r0,'P-LOCK EDIT',()=>{ S.lockStep=si; closeSheet(); showMsg('LOCK STEP '+(si+1)); });
  // note picker
  b.append(el('div','sgroup','NOTE: '+(tr.machine==='BBOX'? BBOX_DRUMS[clamp(((st.note-36)%24+24)%24,0,23)] : noteName(st.note))+' ('+st.note+')'));
  if(tr.machine==='BBOX'){
    const g=el('div','sgrid'); b.append(g);
    BBOX_DRUMS.forEach((dn,di)=>{ const btn=el('button','scell small'+(st.note===36+di?' on':''),dn); btn.onclick=()=>{ st.note=36+di; st.on=true; st.trigless=false; audition(S.selTrack,st.note,0.4,st.locks); redraw(); renderSteps(); saveSoon(); }; g.append(btn); });
  } else {
    const oct=Math.floor(st.note/12)-1, semi=((st.note%12)+12)%12;
    const g=el('div','sgrid'); b.append(g);
    NOTE_NAMES.forEach((nn,i)=>{ const btn=el('button','scell small'+(i===semi?' on':''),nn); btn.onclick=()=>{ st.note=(oct+1)*12+i; st.on=true; st.trigless=false; audition(S.selTrack,st.note,0.4,st.locks); redraw(); renderSteps(); saveSoon(); }; g.append(btn); });
    const r=el('div','srow'); b.append(r);
    actBtn(r,'OCT −',()=>{ st.note=clamp(st.note-12,0,127); redraw(); renderSteps(); saveSoon(); });
    actBtn(r,'OCT +',()=>{ st.note=clamp(st.note+12,0,127); redraw(); renderSteps(); saveSoon(); });
    actBtn(r,'−1 СТ',()=>{ st.note=clamp(st.note-1,0,127); redraw(); renderSteps(); saveSoon(); });
    actBtn(r,'+1 СТ',()=>{ st.note=clamp(st.note+1,0,127); redraw(); renderSteps(); saveSoon(); });
  }
  slider(b,'LEN (шаги)',0.25,64,st.len,0.25,v=>{ st.len=v; saveSoon(); });
  slider(b,'VELOCITY',1,127,st.vel,1,v=>{ st.vel=v; saveSoon(); });
  slider(b,'PROB %',1,100,st.prob,1,v=>{ st.prob=v; saveSoon(); });
  slider(b,'RATCHET ×',1,8,st.rat,1,v=>{ st.rat=v; saveSoon(); });
  slider(b,'MICRO ±',-32,31,st.mic,1,v=>{ st.mic=v; saveSoon(); });
  b.append(el('div','sgroup','ARP NOTES (интервалы от ноты)'));
  const ag=el('div','sgrid'); b.append(ag);
  [0,3,4,5,7,10,11,12].forEach(iv=>{ const on=st.arp&&st.arp.includes(iv); const btn=el('button','scell small'+(on?' on':''),(iv>0?'+':'')+iv);
    btn.onclick=()=>{ if(!st.arp) st.arp=[0]; const k=st.arp.indexOf(iv); if(k>=0)st.arp.splice(k,1); else st.arp.push(iv); st.arp.sort((a,b)=>a-b); if(!st.arp.length)st.arp=null; redraw(); saveSoon(); }; ag.append(btn); });
  b.append(el('div','sgroup','PARAMETER LOCKS ('+Object.keys(st.locks).length+')'));
  const lk=Object.keys(st.locks);
  if(!lk.length) b.append(el('p','snote','Нет локов. Удерживайте триг (или P-LOCK EDIT) и крутите ручки — как на железке.'));
  lk.forEach(k=>{ const [pg,idx]=k.split('.'); const defs=pageDef(tr,pg); const def=defs[+idx];
    const r=el('div','srow'); r.append(el('span','slab',pg+' '+(def?def.n:k)+' = '+(def?formatVal(def,st.locks[k]):st.locks[k])));
    actBtn(r,'✕',()=>{ delete st.locks[k]; redraw(); renderSteps(); saveSoon(); },'small danger'); b.append(r); });
  const act=el('div','srow'); b.append(act);
  actBtn(act,'COPY STEP',()=>{ S.clipSteps=JSON.parse(JSON.stringify(st)); showMsg('STEP COPIED'); });
  actBtn(act,'PASTE STEP',()=>{ if(S.clipSteps){ Object.assign(st,JSON.parse(JSON.stringify(S.clipSteps))); redraw(); renderSteps(); saveSoon(); } });
  actBtn(act,'CLEAR LOCKS',()=>{ st.locks={}; redraw(); renderSteps(); saveSoon(); },'danger');
 },
 wave(){
  const b=sheetHead('DIGIPRO WAVEFORMS — DDRW/DENS (D33–D64) + BBOX сэмплы');
  let slot=32;
  const selRow=el('div','srow'); b.append(selRow);
  const selLab=el('span','slab','SLOT D33'); selRow.append(selLab);
  actBtn(selRow,'◀',()=>{ slot=clamp(slot-1,32,63); selLab.textContent='SLOT D'+(slot+1); drawWave(); },'small');
  actBtn(selRow,'▶',()=>{ slot=clamp(slot+1,32,63); selLab.textContent='SLOT D'+(slot+1); drawWave(); },'small');
  actBtn(selRow,'▶ СЛУШАТЬ',()=>{ const tr=curTrk(); if(AE.started){ const tmp=tr.machine; /* audition via temporary DDRW on sel track if already DDRW/DENS else direct osc */ directWaveAudition(slot); } });
  const cv=el('canvas','wavecv'); cv.width=640; cv.height=220; b.append(cv);
  const ctx2=cv.getContext('2d');
  const getData=()=>{ if(!S.userWaves[slot]){ const d=new Float32Array(256); for(let i=0;i<256;i++)d[i]=Math.sin(i/256*2*Math.PI); S.userWaves[slot]={name:'USER D'+(slot+1),data:d}; } return S.userWaves[slot].data; };
  function drawWave(){ const d=getData(); ctx2.fillStyle='#14181b'; ctx2.fillRect(0,0,640,220); ctx2.strokeStyle='#3a4249'; ctx2.beginPath(); ctx2.moveTo(0,110); ctx2.lineTo(640,110); ctx2.stroke();
    ctx2.strokeStyle='#e8f0e9'; ctx2.lineWidth=2; ctx2.beginPath(); for(let i=0;i<256;i++){ const x=i/255*640,y=110-d[i]*100; i?ctx2.lineTo(x,y):ctx2.moveTo(x,y);} ctx2.stroke(); }
  drawWave();
  let drawing=false;
  const paint=e=>{ const r=cv.getBoundingClientRect(); const x=clamp((e.clientX-r.left)/r.width,0,1), y=clamp((e.clientY-r.top)/r.height,0,1);
    const d=getData(); const idx=Math.round(x*255); const val=clamp((0.5-y)*2,-1,1);
    for(let k=-2;k<=2;k++){ const j=idx+k; if(j>=0&&j<256) d[j]=val; } drawWave(); };
  cv.addEventListener('pointerdown',e=>{ drawing=true; cv.setPointerCapture(e.pointerId); paint(e); e.preventDefault(); });
  cv.addEventListener('pointermove',e=>{ if(drawing) paint(e); });
  cv.addEventListener('pointerup',()=>{ drawing=false; delete AE._w64cache['w'+slot]; delete AE._w64cache[slot]; saveSoon(); showMsg('WAVE D'+(slot+1)+' SAVED'); });
  const acts=el('div','srow'); b.append(acts);
  const preset=(name,fn)=>actBtn(acts,name,()=>{ const d=getData(); fn(d); drawWave(); delete AE._w64cache['w'+slot]; delete AE._w64cache[slot]; saveSoon(); });
  preset('SIN',d=>{for(let i=0;i<256;i++)d[i]=Math.sin(i/256*2*Math.PI);});
  preset('SAW',d=>{for(let i=0;i<256;i++)d[i]=i/128-1;});
  preset('SQR',d=>{for(let i=0;i<256;i++)d[i]=i<128?0.8:-0.8;});
  preset('RANDOM',d=>{let v=0;for(let i=0;i<256;i++){v=clamp(v+(Math.random()-0.5)*0.5,-1,1);d[i]=v;} d[255]=d[0];});
  preset('SMOOTH',d=>{for(let n=0;n<3;n++)for(let i=0;i<256;i++)d[i]=(d[(i+255)%256]+d[i]*2+d[(i+1)%256])/4;});
  preset('12-BIT',d=>{for(let i=0;i<256;i++)d[i]=Math.round(d[i]*2048)/2048;});
  const up=el('div','srow'); b.append(up);
  actBtn(up,'⬆ WAV → ТЕКУЩИЙ СЛОТ (single-cycle)',()=>pickFile('.wav,.aif,.aiff,.mp3,.m4a,audio/*',async f=>{ await importWaveFile(f,slot); drawWave(); }));
  b.append(el('div','sgroup','BBOX: свой сэмпл вместо синтезированного барабана'));
  const bg=el('div','sgrid'); b.append(bg);
  BBOX_DRUMS.forEach((dn,di)=>{ const btn=el('button','scell small',dn+((S.userSamplesBuf&&S.userSamplesBuf[di])?' ●':'')); btn.onclick=()=>pickFile('.wav,.mp3,.m4a,audio/*',async f=>{ await importSampleFile(f,di); openSheet('wave'); }); bg.append(btn); });
  b.append(el('p','snote','Рисуйте волну пальцем — она сразу доступна в DPRO-DDRW/DENS как D'+'33–D64 и сохраняется в снапшоте (как DigiBank в +Drive). WAV конвертируется в single-cycle 256 сэмплов с 12-битным характером.'));
 },
 file(){
  const b=sheetHead('FILE / +DRIVE — проекты, SysEx, прошивка, аудио');
  const r1=el('div','srow'); b.append(r1);
  actBtn(r1,'⬇ ПРОЕКТ .JSON',exportJSON); actBtn(r1,'⬆ ПРОЕКТ .JSON',()=>pickFile('.json,application/json',importJSON));
  actBtn(r1,'⬇ ПАТТЕРН .MID',exportMIDI);
  b.append(el('div','sgroup','ELEKTRON SYSEX — настоящий импорт Monomachine'));
  const r2=el('div','srow'); b.append(r2);
  actBtn(r2,'⬆ IMPORT .SYX / .MID',()=>pickSysExFile({context:'file'}));
  actBtn(r2,'⬆ IMPORT KIT В KITS',()=>openSheet('kit'));
  actBtn(r2,'SYSEX LIBRARY',()=>openSheet('sysexlib'));
  actBtn(r2,'FIRMWARE LAB',()=>openSheet('firmware'));
  const out=el('pre','syxout','Загрузите дамп с настоящей Monomachine. Поддерживаются: KIT DUMP 0x52 → звуки/банк, PATTERN DUMP 0x67 → шаги/ноты/p-locks, DigiPRO WAVE 0x5D → DigiBank, а также raw/global/song/custom SysEx в библиотеку и отправка через Web MIDI.'); out.id='syxOut'; b.append(out);
  const actions=el('div','syx-actions'); actions.id='syxActions'; b.append(actions);
  const kx=el('div','srow'); b.append(kx);
  actBtn(kx,'⬇ CURRENT KIT .SYX',downloadCurrentKitSyx);
  actBtn(kx,'⬇ ALL KITS .SYX',downloadAllKitsSyx);
  b.append(el('div','sgroup','ЗАПИСЬ ВЫХОДА'));
  const r3=el('div','srow'); b.append(r3);
  const recBtn=actBtn(r3,isWavRecording()?'■ STOP WAV':'● REC WAV',()=>toggleWavRecording()); recBtn.id='sheetWavRecBtn';
  b.append(el('p','snote','Записывается мастер-выход, пока играет секвенсор. Файл сохранится в «Файлы»/Загрузки.'));
  b.append(el('div','sgroup','ЧЕСТНО ПРО ПРОШИВКУ'));
  b.append(el('p','snote','Firmware Lab примет и сохранит ваш оригинальный OS-файл, но Safari не исполнит ColdFire + два DSP56300 без специального WASM-core и native JIT. Kit/pattern SysEx теперь импортируется по-настоящему в clean-room движок; оригинальная ОС внутри приложения не поставляется.'));
  const r4=el('div','srow'); b.append(r4);
  actBtn(r4,'FACTORY RESET',()=>{ if(confirm('Сбросить всё к заводским паттернам?')){ factoryReset(); if(AE.started)AE.patternChanged(); closeSheet(); renderAll(); showMsg('FACTORY RESET DONE'); } },'danger');
 },

 transp(){
  const b=sheetHead('TRANSPOSE — TRACK '+(S.selTrack+1));
  const r=el('div','srow'); b.append(r);
  const trkT=d=>{ const t2=curTrk(); if(t2.machine!=='BBOX') t2.steps.forEach(st=>{ if(st.on) st.note=clamp(st.note+d,0,127); }); showMsg('TRACK TRANSP '+(d>0?'+':'')+d); renderAll(); saveSoon(); };
  [-12,-7,-1,1,7,12].forEach(d=>actBtn(r,(d>0?'+':'')+d,()=>trkT(d),'small'));
  const r2=el('div','srow'); b.append(r2);
  actBtn(r2,'PATTERN +1',()=>transpose(1)); actBtn(r2,'PATTERN −1',()=>transpose(-1));
  b.append(el('p','snote','TRSP на странице ARP транспонирует трек на лету, не трогая шаги.'));
 },
 setup(){
  const b=sheetHead('SETUP / HELP — Monomachine Web');
  const nav=el('div','srow'); b.append(nav);
  actBtn(nav,'FILE / +DRIVE',()=>openSheet('file')); actBtn(nav,'WAVE / DIGIBANK',()=>openSheet('wave'));
  actBtn(nav,'MIXER',()=>openSheet('mixer')); actBtn(nav,'SONG',()=>openSheet('song'));
  actBtn(nav,'PATTERN',()=>openSheet('pattern')); actBtn(nav,'KIT',()=>openSheet('kit'));
  actBtn(nav,'SYSEX LIBRARY',()=>openSheet('sysexlib')); actBtn(nav,'FIRMWARE LAB',()=>openSheet('firmware'));
  const r=el('div','srow'); b.append(r);
  actBtn(r,'POLY MODE: '+(S.poly?'ON':'OFF'),function(){ S.poly=!S.poly; this.textContent='POLY MODE: '+(S.poly?'ON':'OFF'); showMsg(S.poly?'POLY ON':'MONO PER TRACK'); });
  actBtn(r,'FOLLOW PAGE: '+(S.followPage?'ON':'OFF'),function(){ S.followPage=!S.followPage; this.textContent='FOLLOW PAGE: '+(S.followPage?'ON':'OFF'); });
  actBtn(r,'MIDI OUT: '+(S.midiOut?'ON':'OFF'),function(){ S.midiOut=!S.midiOut; this.textContent='MIDI OUT: '+(S.midiOut?'ON':'OFF'); });
  const r2=el('div','srow'); b.append(r2);
  actBtn(r2,'🎤 INP AB: ВКЛ ВХОД',async()=>{ try{ await AE.enableInput(); showMsg('INPUT ON'); }catch(e){ showMsg('NO MIC ACCESS'); } });
  actBtn(r2,'⌚ WAKE LOCK',async()=>{ try{ await navigator.wakeLock.request('screen'); showMsg('WAKE LOCK ON'); }catch(e){ showMsg('NO WAKE LOCK'); } });
  actBtn(r2,'MIDI: ПОДКЛЮЧИТЬ',()=>initMIDI(true));
  const help=el('div','help'); help.innerHTML=HELP_HTML; b.append(help);
 },
 sysexlib(){ renderSysExLibrarySheet(); },
 firmware(){ renderFirmwareSheet(); }
};
function euclidGen(){
  const tr=curTrk(); const density=parseFloat(prompt('Плотность 0.1–0.9:','0.4')||'0.4');
  const scale=[0,2,3,5,7,8,10]; const root=S.lastNote[S.selTrack]||60;
  const pulses=Math.round(clamp(density,0.05,0.95)*64);
  for(let i=0;i<64;i++){ const on=(Math.floor(i*pulses/64)!==Math.floor((i+1)*pulses/64)); const st=tr.steps[i]; st.on=on; st.trigless=false; if(on){ st.note=root+scale[Math.floor(Math.random()*scale.length)]+[0,12,-12][Math.floor(Math.random()*3)]; st.len=2; } }
  showMsg('EUCLID '+pulses+'/64 → T'+(S.selTrack+1)); closeSheet(); renderAll(); saveSoon();
}
function transpose(d){ curPat().tracks.forEach(tr=>{ if(tr.machine==='BBOX')return; tr.steps.forEach(st=>{ if(st.on) st.note=clamp(st.note+d,0,127); }); }); showMsg('TRANSPOSE '+(d>0?'+':'')+d); renderAll(); saveSoon(); }
function directWaveAudition(slot){
  if(!AE.started) return; const ctx=AE.ctx; const o=mkWaveOsc(getWave64(slot),220); const g=mkGain(0.4); o.connect(g); g.connect(AE.busSum);
  o.start(); g.gain.setTargetAtTime(0,nowT()+0.5,0.1); setTimeout(()=>{try{o.stop();}catch(e){} try{g.disconnect();}catch(e){}},1000);
}
/* ---------- files ---------- */
function pickFile(accept,fn){ const inp=document.createElement('input'); inp.type='file'; inp.accept=accept; inp.style.display='none'; document.body.append(inp);
  inp.onchange=()=>{ const f=inp.files[0]; inp.remove(); if(f) fn(f); }; inp.click(); }
function dl(name,blob){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.append(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},4000); }
function exportJSON(){ const data={app:'monomachine-web',v:1,patterns:S.patterns,kits:S.kits,song:S.song,curPat:S.curPat,userWaves:S.userWaves.map(w=>w?{name:w.name,data:Array.from(w.data)}:null)};
  dl('monomachine-project.json',new Blob([JSON.stringify(data)],{type:'application/json'})); showMsg('PROJECT EXPORTED'); }
async function importJSON(f){ try{ const d=JSON.parse(await f.text()); if(d.app!=='monomachine-web') throw 0;
  S.patterns={}; for(const k in d.patterns) S.patterns[k]=revivePattern(d.patterns[k]);
  if(d.kits)S.kits=d.kits; if(d.song)S.song=d.song; if(typeof d.curPat==='number')S.curPat=d.curPat;
  if(d.userWaves)d.userWaves.forEach((w,i)=>{ if(w)S.userWaves[i]={name:w.name,data:Float32Array.from(w.data)}; });
  if(AE.started)AE.patternChanged(); closeSheet(); renderAll(); saveSoon(); showMsg('PROJECT IMPORTED'); }catch(e){ showMsg('BAD PROJECT FILE'); } }
async function importWaveFile(f,slot){
  if(!AE.started){ showMsg('POWER ON FIRST'); return; }
  const buf=await AE.ctx.decodeAudioData(await f.arrayBuffer());
  const ch=buf.getChannelData(0); const out=new Float32Array(256);
  // find a zero crossing to start the cycle
  let start=0; for(let i=1;i<Math.min(ch.length-1,4000);i++){ if(ch[i-1]<0&&ch[i]>=0){ start=i; break; } }
  const span=Math.min(ch.length-start, 8192);
  for(let i=0;i<256;i++){ const x=ch[start+Math.floor(i/256*span)]||0; out[i]=Math.round(clamp(x,-1,1)*2048)/2048; } // 12-bit
  S.userWaves[slot]={name:f.name.slice(0,18),data:out}; delete AE._w64cache['w'+slot]; delete AE._w64cache[slot];
  saveSoon(); showMsg('WAVE → D'+(slot+1)+' '+f.name);
}
async function importSampleFile(f,di){
  if(!AE.started){ showMsg('POWER ON FIRST'); return; }
  const buf=await AE.ctx.decodeAudioData(await f.arrayBuffer());
  if(!S.userSamplesBuf) S.userSamplesBuf={}; S.userSamplesBuf[di]=buf;
  audition(S.selTrack,36+di,0.5); showMsg('BBOX '+BBOX_DRUMS[di]+' ← '+f.name);
}
/* --- SysEx library, real Monomachine import/export, Firmware Lab --- */
const LAB_DB_NAME='monomachine-lab-v1';
let _labDbPromise=null,_lastParsedSysEx=null,_lastFirmware=null;
const waitMs=ms=>new Promise(r=>setTimeout(r,ms));
function idbRequest(req){ return new Promise((resolve,reject)=>{ req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error||new Error('IndexedDB error')); }); }
function labDb(){
  if(!window.indexedDB) return Promise.reject(new Error('IndexedDB unavailable'));
  if(_labDbPromise) return _labDbPromise;
  _labDbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(LAB_DB_NAME,1);
    req.onupgradeneeded=()=>{ const db=req.result; const st=db.createObjectStore('files',{keyPath:'id',autoIncrement:true}); st.createIndex('kind','kind',{unique:false}); st.createIndex('hash','hash',{unique:false}); };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
    req.onblocked=()=>reject(new Error('IndexedDB blocked'));
  });
  return _labDbPromise;
}
async function labAll(kind){
  const db=await labDb();
  const all=await idbRequest(db.transaction('files','readonly').objectStore('files').getAll());
  return all.filter(r=>!kind||r.kind===kind).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
async function labGet(id){ const db=await labDb(); return idbRequest(db.transaction('files','readonly').objectStore('files').get(id)); }
async function labDelete(id){ const db=await labDb(); await idbRequest(db.transaction('files','readwrite').objectStore('files').delete(id)); }
async function labPut(rec){ const db=await labDb(); return idbRequest(db.transaction('files','readwrite').objectStore('files').add(rec)); }
function crc32Hex(bytes){
  let table=crc32Hex._t;
  if(!table){ table=crc32Hex._t=[]; for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; table[n]=c>>>0; } }
  let c=0xFFFFFFFF; for(let i=0;i<bytes.length;i++) c=table[(c^bytes[i])&0xFF]^(c>>>8);
  return ((c^0xFFFFFFFF)>>>0).toString(16).padStart(8,'0');
}
async function sha256Hex(bytes){
  try{
    if(window.crypto&&crypto.subtle&&crypto.subtle.digest){
      const h=await crypto.subtle.digest('SHA-256',bytes);
      return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('');
    }
  }catch(e){}
  return '';
}
async function saveLabFile(kind,name,bytes,summary){
  try{
    const hash=await sha256Hex(bytes);
    const key=hash||('crc32:'+crc32Hex(bytes)+':'+bytes.length);
    const existing=await labAll(kind);
    const dup=existing.find(r=>r.hash===key);
    if(dup) return {id:dup.id,duplicate:true,hash:key};
    const id=await labPut({kind,name,size:bytes.length,createdAt:Date.now(),hash:key,summary:summary||'',data:bytes.slice().buffer});
    return {id,duplicate:false,hash:key};
  }catch(e){ console.warn('Lab storage failed',e); return null; }
}
function labRecordBytes(rec){ return rec&&rec.data?new Uint8Array(rec.data):new Uint8Array(); }
function fmtBytes(n){ return n>=1048576?(n/1048576).toFixed(2)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B'; }
function safeDownloadName(name,fallback='monomachine'){
  return String(name||fallback).replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'')||fallback;
}
function downloadBytes(name,bytes,type='application/octet-stream'){ dl(name,new Blob([bytes],{type})); }
function downloadKitSyx(kit,position){
  const pos=typeof position==='number'?position:(kit.hw&&typeof kit.hw.position==='number'?kit.hw.position:(typeof kit.sourcePosition==='number'?kit.sourcePosition:0));
  downloadBytes(safeDownloadName(kit.name||'kit')+'-kit-'+String(pos+1).padStart(2,'0')+'.syx',sxEncodeKit(kit,pos),'application/octet-stream');
  showMsg('KIT SYX EXPORTED');
}
function downloadCurrentKitSyx(){ downloadKitSyx(currentKitObject(curPat().kit)); }
function downloadAllKitsSyx(){
  if(!S.kits.length){ showMsg('NO KITS'); return; }
  downloadBytes('monomachine-web-kits.syx',sxEncodeKitBank(S.kits),'application/octet-stream');
  showMsg(S.kits.length+' KITS → SYX');
}
function importDecodedKit(dec,mode){
  const kit=sxKitToAppKit(dec);
  if(mode==='bank'||mode==='both') upsertKit(kit);
  if(mode==='load'||mode==='both'){ applyKitObject(kit); audition(S.selTrack,null,0.65); }
  else showMsg('KIT ADDED: '+kit.name);
  saveSoon();
  if(sheetType==='kit') openSheet('kit');
  return kit;
}
function importDecodedPattern(dec,targetPos,linkedKit){
  const target=clamp(typeof targetPos==='number'?targetPos:(dec.position||0),0,127);
  const base=pat(target);
  const conv=sxPatternToAppPattern(dec,base);
  const out=conv.pattern;
  if(linkedKit){
    const appKit=sxKitToAppKit(linkedKit);
    out.tracks.forEach((tr,i)=>applyTrackSound(tr,appKit.tracks[i]));
    out.kit=appKit.name; out._hwKit=appKit.hw;
  }
  S.patterns[target]=out;
  if(target===S.curPat){ S.lockStep=-1; lcdTransition(); if(AE.started)AE.patternChanged(); renderAll(); }
  saveSoon();
  showMsg('PATTERN '+patLabel(target)+' ← SYX · '+conv.stats.trigs+' TRIG / '+conv.stats.locks+' LOCK',2400);
  return conv;
}
function importDecodedWaves(parsed){
  let n=0;
  parsed.waves.forEach(w=>{
    S.userWaves[w.slot]={name:('SYX '+w.name).slice(0,18),data:Float32Array.from(w.data)};
    if(AE._w64cache){ delete AE._w64cache['w'+w.slot]; delete AE._w64cache[w.slot]; }
    n++;
  });
  saveSoon(); showMsg('DIGIPRO WAVES IMPORTED '+n);
  return n;
}
async function sendParsedSysEx(parsed,out){
  if(parsed.likelyOS&&!confirm('Похоже на OS upgrade SysEx. Отправлять на настоящую Monomachine только если она специально переведена в режим OS UPGRADE. Продолжить?')) return;
  if(!navigator.requestMIDIAccess){ showMsg('WEB MIDI NOT AVAILABLE HERE'); return; }
  if(!AE.midiOutPort) await initMIDI(true,true);
  const port=AE.midiOutPort;
  if(!port){ showMsg('NO MIDI OUTPUT'); return; }
  const msgs=parsed.messages.filter(m=>m.complete);
  showMsg('SENDING SYSEX '+msgs.length+' MSG…');
  for(let i=0;i<msgs.length;i++){
    const raw=msgs[i].raw;
    try{ port.send(Array.from(raw)); }catch(e){ showMsg('MIDI SEND ERROR'); return; }
    if(out&&(i%8===0||i===msgs.length-1)) out.textContent+='\nMIDI SEND '+(i+1)+'/'+msgs.length;
    await waitMs(clamp(35+raw.length/18,35,650));
  }
  showMsg('SYSEX SENT '+msgs.length+' MSG');
}
function sxItem(parent,title,detail){
  const box=el('div','syx-item');
  box.append(el('div','syx-title',title));
  if(detail) box.append(el('div','syx-detail',detail));
  const row=el('div','srow tight'); box.append(row); parent.append(box);
  return row;
}
function renderParsedSysEx(parsed,bytes,targets,opts={}){
  const out=targets.out,actions=targets.actions;
  if(!out||!actions) return;
  const c=parsed.counts;
  const lines=[
    'FILE: '+parsed.filename+' · '+fmtBytes(parsed.size)+(parsed.fromSMF?' · SysEx extracted from Standard MIDI File':''),
    'CRC32: '+crc32Hex(bytes)+(opts.hash?'\nSHA-256: '+opts.hash:''),
    'Сообщений: '+c.total+' · Elektron: '+c.elektron+' · Monomachine: '+c.mnm,
    'Kits 0x52: '+c.kits+' · Patterns 0x67: '+c.patterns+' · DigiPRO waves 0x5D: '+c.waves+' · Globals: '+c.globals+' · Songs: '+c.songs+' · поврежд.: '+c.damaged+' · неполн.: '+c.incomplete
  ];
  if(parsed.likelyOS) lines.push('Похоже на OS/FIRMWARE package, а не на kit/pattern dump. Откройте его во Firmware Lab.');
  parsed.messages.slice(0,28).forEach(m=>{
    let line='#'+String(m.index).padStart(2,'0')+' '+m.manufacturer+' len='+m.length;
    if(m.device!=null) line+=' dev='+sxHex(m.device);
    if(m.command!=null) line+=' cmd='+sxHex(m.command)+' '+m.commandName;
    if(m.position!=null&&(m.command===0x52||m.command===0x67||m.command===0x5D)) line+=' pos='+(m.position+1);
    if(m.info&&typeof m.info.checksumOk==='boolean') line+=' checksum='+(m.info.checksumOk?'OK':'BAD');
    if(m.info&&typeof m.info.lengthOk==='boolean') line+=' length='+(m.info.lengthOk?'OK':'BAD');
    if(!m.complete) line+=' INCOMPLETE';
    if(m.error) line+=' ERROR '+m.error;
    lines.push(line);
  });
  if(parsed.messages.length>28) lines.push('… ещё '+(parsed.messages.length-28)+' сообщений');
  if(opts.libraryText) lines.push(opts.libraryText);
  out.textContent=lines.join('\n');
  actions.innerHTML='';
  const top=el('div','srow'); actions.append(top);
  actBtn(top,'⬇ ОРИГИНАЛ .SYX',()=>downloadBytes(safeDownloadName(parsed.filename||'dump.syx'),bytes,'application/octet-stream'));
  actBtn(top,'➡ SEND VIA WEB MIDI',()=>sendParsedSysEx(parsed,out));
  if(c.damaged) actBtn(top,'⚠ FORCE DECODE (игнор. checksum)',async()=>{
    const forced=sxParseFile(bytes,parsed.filename,{ignoreChecksum:true});
    renderParsedSysEx(forced,bytes,targets,{...opts,hash:opts.hash,libraryText:'FORCE DECODE: checksum игнорировалась — проверяйте звук перед сохранением.'});
  },'danger');
  if(parsed.likelyOS) actBtn(top,'ОТКРЫТЬ ВО FIRMWARE LAB',()=>{ _lastFirmware={name:parsed.filename,bytes:bytes.slice()}; openSheet('firmware'); });

  if(parsed.kits.length>1){
    const row=sxItem(actions,'ВСЕ КИТЫ ИЗ ФАЙЛА','Найдено китов: '+parsed.kits.length);
    actBtn(row,'ADD ALL → BANK',()=>{ parsed.kits.forEach(d=>upsertKit(sxKitToAppKit(d))); saveSoon(); showMsg(parsed.kits.length+' KITS ADDED'); if(sheetType==='kit')openSheet('kit'); });
  }
  parsed.kits.forEach(dec=>{
    const app=sxKitToAppKit(dec);
    const machines=app.tracks.map((t,i)=>'T'+(i+1)+' '+MACH[t.machine].name).join(' · ');
    const row=sxItem(actions,'KIT #'+(dec.position+1)+' — '+dec.name,machines+(dec.unknownModels?' · unknown models '+dec.unknownModels:'')+(dec.outOfRangeParams?' · params>127 '+dec.outOfRangeParams:''));
    actBtn(row,'LOAD NOW',()=>importDecodedKit(dec,'load'));
    actBtn(row,'ADD TO BANK',()=>importDecodedKit(dec,'bank'));
    actBtn(row,'LOAD + SAVE',()=>importDecodedKit(dec,'both'));
    actBtn(row,'⬇ .SYX',()=>downloadBytes(safeDownloadName(dec.name)+'-kit.syx',parsed.messages[dec.messageIndex].raw,'application/octet-stream'),'small');
  });
  if(parsed.patterns.length){
    let withLinkedKit=parsed.kits.length>0;
    const head=sxItem(actions,'PATTERNS','Импорт переносит trigs, notes, slides, trigless/filter/LFO trigs, p-locks, swing и длину. Звук берётся из целевого слота или связанного кита этого файла.');
    if(parsed.kits.length) actBtn(head,'LINKED KIT: '+(withLinkedKit?'ON':'OFF'),function(){ withLinkedKit=!withLinkedKit; this.textContent='LINKED KIT: '+(withLinkedKit?'ON':'OFF'); });
    parsed.patterns.forEach(dec=>{
      const linked=parsed.kits.find(k=>k.position===dec.kit)||null;
      const row=sxItem(actions,'PATTERN '+patLabel(dec.position),'len '+dec.patternLength+' · swing '+(50+clamp(dec.swingAmount||0,0,30))+'% · linked kit #'+(dec.kit+1)+(linked?' ('+linked.name+')':' (нет в файле)'));
      actBtn(row,'IMPORT → '+patLabel(dec.position),()=>importDecodedPattern(dec,dec.position,withLinkedKit?linked:null));
      actBtn(row,'IMPORT → CURRENT '+patLabel(S.curPat),()=>importDecodedPattern(dec,S.curPat,withLinkedKit?linked:null));
    });
  }
  if(parsed.waves.length){
    const row=sxItem(actions,'DIGIPRO WAVEFORMS',parsed.waves.map(w=>'D'+(w.slot+1)+' '+w.name+(w.checksumOk?'':' [checksum BAD]')).join(' · '));
    actBtn(row,'IMPORT WAVES → DIGIBANK',()=>importDecodedWaves(parsed));
    actBtn(row,'ОТКРЫТЬ WAVE EDITOR',()=>openSheet('wave'));
  }
  if(!parsed.kits.length&&opts.context==='kit'){
    const row=sxItem(actions,'KIT DUMP НЕ НАЙДЕН','Нужен Monomachine KIT DUMP (команда 0x52). Файл сохранён как raw SysEx; паттерны/волны доступны через FILE → SysEx.');
    actBtn(row,'ОТКРЫТЬ FILE / SYSEX',()=>openSheet('file'));
  }
}
function ensureSysExTargets(context){
  if(context==='kit'){
    if(!$('#kitSyxOut')) openSheet('kit');
    return {out:$('#kitSyxOut'),actions:$('#kitSyxActions')};
  }
  if(!$('#syxOut')) openSheet('file');
  return {out:$('#syxOut'),actions:$('#syxActions')};
}
async function handleSysExBytes(bytes,name,opts={}){
  bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);
  const targets=ensureSysExTargets(opts.context||'file');
  if(targets.out) targets.out.textContent='Разбираю '+name+'…';
  if(targets.actions) targets.actions.innerHTML='';
  const parsed=sxParseFile(bytes,name,opts);
  _lastParsedSysEx={parsed,bytes:bytes.slice()};
  const isBinaryFirmware=parsed.counts.total===0;
  if(isBinaryFirmware){
    _lastFirmware={name,bytes:bytes.slice()};
    if(targets.out) targets.out.textContent='SysEx-сообщений нет. Похоже на raw .bin/.img — открываю анализ во Firmware Lab.';
    openSheet('firmware');
    return parsed;
  }
  const hash=await sha256Hex(bytes);
  let libraryText='';
  if(opts.skipSave!==true){
    const summary=parsed.counts.kits+' kits · '+parsed.counts.patterns+' patterns · '+parsed.counts.waves+' waves · '+parsed.counts.total+' msg';
    const saved=await saveLabFile('sysex',name,bytes,summary);
    libraryText=saved?(saved.duplicate?'SysEx Library: уже был сохранён (тот же hash).':'SysEx Library: сохранён локально в IndexedDB.'):'SysEx Library: IndexedDB недоступна, файл только в памяти.';
  }
  renderParsedSysEx(parsed,bytes,targets,{context:opts.context||'file',hash,libraryText});
  showMsg('SYSEX: '+parsed.counts.kits+' KITS · '+parsed.counts.patterns+' PAT · '+parsed.counts.waves+' WAV',2200);
  return parsed;
}
async function handleSysExFile(file,opts={}){
  try{ return await handleSysExBytes(new Uint8Array(await file.arrayBuffer()),file.name,opts); }
  catch(e){ console.error(e); showMsg('SYSEX READ ERROR'); }
}
function pickSysExFile(opts={}){ pickFile('.syx,.sysex,.mid,.midi,.bin,application/octet-stream',f=>handleSysExFile(f,opts)); }
async function analyzeElektronFile(f,sheetBody){ return handleSysExFile(f,{context:'file'}); }

/* ---------- Firmware Lab: store + inspect a user-supplied original OS ---------- */
function hexDump(bytes,offset=0,len=96){
  const lines=[];
  for(let o=offset;o<Math.min(bytes.length,offset+len);o+=16){
    const chunk=Array.from(bytes.slice(o,o+16));
    const hex=chunk.map(x=>x.toString(16).padStart(2,'0')).join(' ');
    const asc=chunk.map(x=>x>=32&&x<127?String.fromCharCode(x):'.').join('');
    lines.push(o.toString(16).padStart(8,'0')+'  '+hex.padEnd(47,' ')+'  '+asc);
  }
  return lines.join('\n');
}
function byteEntropy(bytes){
  if(!bytes.length) return 0;
  const counts=new Uint32Array(256); const step=bytes.length>4000000?7:1; let n=0;
  for(let i=0;i<bytes.length;i+=step){ counts[bytes[i]]++; n++; }
  let h=0; for(let i=0;i<256;i++) if(counts[i]){ const p=counts[i]/n; h-=p*Math.log2(p); }
  return h;
}
function findByteSeq(bytes,seq,max=12){
  const hits=[];
  outer:for(let i=0;i<=bytes.length-seq.length&&hits.length<max;i++){
    for(let j=0;j<seq.length;j++) if(bytes[i+j]!==seq[j]) continue outer;
    hits.push(i);
  }
  return hits;
}
async function analyzeFirmwareBytes(bytes,name,opts={}){
  bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);
  _lastFirmware={name,bytes:bytes.slice()};
  const out=opts.out||$('#fwOut'),actions=opts.actions||$('#fwActions');
  const parsed=sxParseFile(bytes,name);
  const strings=sxAsciiStrings(bytes,5,160);
  const interesting=strings.filter(s=>/MONOMACHINE|ELEKTRON|SFX|DSP563|COLDFIRE|MCF5|OS[ ._-]*\d|VERSION|COPYRIGHT/i.test(s)).slice(0,36);
  const versions=[];
  strings.forEach(s=>{ const m=s.match(/(?:OS|VERSION|VER)[ ._-]*([0-9]+\.[0-9]+[A-Z]?)/i); if(m&&!versions.includes(m[1])) versions.push(m[1]); });
  const headers=findByteSeq(bytes,SX_MNM_HEADER,24);
  const be32=o=>bytes.length>=o+4?(((bytes[o]<<24)|(bytes[o+1]<<16)|(bytes[o+2]<<8)|bytes[o+3])>>>0):0;
  const firstWords=[]; for(let i=0;i<4&&bytes.length>=i*4+4;i++) firstWords.push('0x'+be32(i*4).toString(16).padStart(8,'0'));
  let score=0; const evidence=[];
  if(interesting.some(s=>/MONOMACHINE/i.test(s))){ score+=5; evidence.push('строка MONOMACHINE'); }
  if(interesting.some(s=>/ELEKTRON/i.test(s))){ score+=2; evidence.push('строка ELEKTRON'); }
  if(interesting.some(s=>/DSP563/i.test(s))){ score+=3; evidence.push('упоминание DSP563xx'); }
  if(versions.length){ score+=2; evidence.push('версия '+versions.join(', ')); }
  if(bytes.length>300000&&bytes.length<16000000){ score+=1; evidence.push('размер похож на OS package'); }
  if(parsed.counts.total>50&&parsed.kits.length===0&&parsed.patterns.length===0){ score+=1; evidence.push('много SysEx-пакетов без kit/pattern dumps'); }
  const isDump=parsed.kits.length+parsed.patterns.length+parsed.waves.length>0;
  const kind=isDump?'SysEx dump (не OS)':score>=5?'Очень похож на Monomachine OS/firmware':score>=3?'Возможно firmware/upgrade package':'Неизвестный бинарный файл';
  const hash=await sha256Hex(bytes);
  const lines=[
    'FIRMWARE FILE: '+name,'Размер: '+bytes.length+' bytes ('+fmtBytes(bytes.length)+')',
    'SHA-256: '+(hash||'недоступен в этом контексте'),'CRC32: '+crc32Hex(bytes),
    'Энтропия: '+byteEntropy(bytes).toFixed(3)+' bit/byte',
    'Тип: '+kind+(evidence.length?'\nПризнаки: '+evidence.join(' · '):''),
    'Контейнер: '+(sxIsSMF(bytes)?'Standard MIDI File':parsed.counts.total?'SysEx stream':'raw binary'),
    'SysEx: '+parsed.counts.total+' msg · MNM headers found: '+headers.length+' · kits '+parsed.counts.kits+' · patterns '+parsed.counts.patterns+' · waves '+parsed.counts.waves,
    'Первые BE32 слова: '+(firstWords.join(' ')||'—'),
    '', 'СТРОКИ / МАРКЕРЫ:', ...(interesting.length?interesting:['(явных ASCII-маркеров не найдено — код может быть упакован)']),
    '', 'HEX 0x00:', hexDump(bytes,0,96)
  ];
  let saved=null;
  if(opts.skipSave!==true) saved=await saveLabFile('firmware',name,bytes,kind+(versions.length?' · OS '+versions.join(', '):''));
  lines.push('',saved?(saved.duplicate?'Firmware Vault: файл уже сохранён локально.':'Firmware Vault: сохранён локально в IndexedDB (ни куда не отправляется).'):'Firmware Vault: IndexedDB недоступна.');
  if(out) out.textContent=lines.join('\n');
  if(actions){
    actions.innerHTML='';
    const row=el('div','srow'); actions.append(row);
    actBtn(row,'BOOT TEST',async()=>{
      if(!out) return;
      const add=t=>{ out.textContent+='\n'+t; out.scrollTop=out.scrollHeight; };
      add('\nBOOT TEST:');
      add('1) Контейнер принят, файл не изменён.');
      await waitMs(160);
      add(isDump?'2) Внутри есть kit/pattern/wave dumps — это данные, не исполняемая ОС.':'2) Kit/pattern dumps не найдены; ищу CPU/DSP entry points…');
      await waitMs(220);
      add('3) Нужны одновременно: ColdFire/M68K control CPU + 2× DSP56300 + timers/DMA/codec/MIDI/display.');
      add('4) Совместимого Safari/WebAssembly Monomachine-core в приложении нет; iOS Safari также не даёт сторонний native JIT.');
      add('РЕЗУЛЬТАТ: BOOT BLOCKED — файл сохранён и готов для будущего WASM-core, но оригинальная ОС сейчас честно НЕ запущена.');
      showMsg('BOOT BLOCKED: NO WASM CORE',2600);
    });
    actBtn(row,'⬇ DOWNLOAD COPY',()=>downloadBytes(safeDownloadName(name),bytes,'application/octet-stream'));
    if(isDump) actBtn(row,'ОТКРЫТЬ КАК SYSEX IMPORT',()=>handleSysExBytes(bytes,name,{context:'file',skipSave:true}));
    actBtn(row,'FIRMWARE VAULT',()=>openSheet('firmware'));
  }
  return {parsed,strings:interesting,versions,kind,score,hash};
}
async function handleFirmwareFile(file){
  try{ return await analyzeFirmwareBytes(new Uint8Array(await file.arrayBuffer()),file.name); }
  catch(e){ console.error(e); showMsg('FIRMWARE READ ERROR'); }
}
function pickFirmwareFile(){ pickFile('.bin,.syx,.sysex,.img,.rom,.os,application/octet-stream',f=>handleFirmwareFile(f)); }
async function renderStoredLabList(container,kind){
  container.innerHTML='<p class="snote">Читаю локальное хранилище…</p>';
  let recs=[];
  try{ recs=await labAll(kind); }
  catch(e){ container.innerHTML='<p class="snote">IndexedDB недоступна в этом режиме браузера (например, file:// или приватный режим). Импорт в текущей сессии всё равно работает.</p>'; return; }
  container.innerHTML='';
  if(!recs.length){ container.append(el('p','snote',kind==='firmware'?'Firmware Vault пуст.':'SysEx Library пуста.')); return; }
  recs.forEach(rec=>{
    const d=new Date(rec.createdAt||Date.now());
    const row=sxItem(container,rec.name,fmtBytes(rec.size||0)+' · '+d.toLocaleString()+(rec.summary?' · '+rec.summary:'')+'\nHASH '+(rec.hash||'').slice(0,20)+'…');
    actBtn(row,kind==='firmware'?'ANALYZE':'OPEN / IMPORT',async()=>{
      const full=await labGet(rec.id); const bytes=labRecordBytes(full);
      if(kind==='firmware'){ _lastFirmware={name:rec.name,bytes}; openSheet('firmware'); }
      else handleSysExBytes(bytes,rec.name,{context:'file',skipSave:true});
    });
    actBtn(row,'⬇',async()=>{ const full=await labGet(rec.id); downloadBytes(safeDownloadName(rec.name),labRecordBytes(full),'application/octet-stream'); },'small');
    actBtn(row,'DELETE',async()=>{ await labDelete(rec.id); renderStoredLabList(container,kind); showMsg('DELETED FROM VAULT'); },'small danger');
  });
}
function renderSysExLibrarySheet(){
  const b=sheetHead('SYSEX LIBRARY — локально сохранённые .syx');
  const r=el('div','srow'); b.append(r);
  actBtn(r,'⬆ IMPORT NEW .SYX',()=>pickSysExFile({context:'file'}));
  actBtn(r,'FIRMWARE LAB',()=>openSheet('firmware'));
  actBtn(r,'KITS',()=>openSheet('kit'));
  b.append(el('p','snote','Файлы хранятся только в IndexedDB этого браузера/приложения. OPEN / IMPORT заново разбирает kits, patterns и DigiPRO waves; оригинал можно скачать без изменений или отправить через Web MIDI на десктопе.'));
  const list=el('div'); b.append(list); renderStoredLabList(list,'sysex');
}
function firmwareBrowserChecks(){
  const wa=typeof WebAssembly!=='undefined';
  const aw=!!(window.AudioContext&&AudioContext.prototype&&'audioWorklet' in AudioContext.prototype);
  return [
    'WebAssembly: '+(wa?'есть':'нет'),
    'AudioWorklet API: '+(aw?'есть':'не видна до запуска аудио'),
    'SharedArrayBuffer: '+(typeof SharedArrayBuffer!=='undefined'?'есть':'нет'),
    'crossOriginIsolated: '+(window.crossOriginIsolated?'true':'false'),
    'CPU threads (navigator): '+(navigator.hardwareConcurrency||'?'),
    'Web MIDI: '+(navigator.requestMIDIAccess?'есть':'нет (iPhone Safari)'),
    'Native JIT для DSP56300: недоступен веб-странице iOS'
  ].join('\n');
}
function renderFirmwareSheet(){
  const b=sheetHead('FIRMWARE LAB — оригинальная OS Monomachine');
  b.append(el('p','snote','Сюда можно вставить ваш собственный OS-файл Elektron (.syx upgrade или raw .bin/.img). Приложение сохранит его локально, посчитает SHA-256/CRC32, найдёт версию/маркеры и проверит контейнер. Внутри приложения нет прошивки Elektron и нет готового Safari/WASM ядра ColdFire+2×DSP56300, поэтому BOOT TEST честно остановится на отсутствующем core — это не фейковый «запуск».'));
  const r=el('div','srow'); b.append(r);
  actBtn(r,'⬆ LOAD ORIGINAL OS .SYX/.BIN',pickFirmwareFile);
  actBtn(r,'SYSEX LIBRARY',()=>openSheet('sysexlib'));
  actBtn(r,'⬆ KIT/PATTERN .SYX',()=>pickSysExFile({context:'file'}));
  b.append(el('div','sgroup','BROWSER CORE CHECK'));
  const checks=el('pre','syxout',firmwareBrowserChecks()); b.append(checks);
  b.append(el('div','sgroup','ANALYSIS'));
  const out=el('pre','syxout','Загрузите OS-файл или выберите сохранённый ниже.'); out.id='fwOut'; b.append(out);
  const actions=el('div','syx-actions'); actions.id='fwActions'; b.append(actions);
  b.append(el('div','sgroup','FIRMWARE VAULT (IndexedDB)'));
  const list=el('div'); b.append(list); renderStoredLabList(list,'firmware');
  b.append(el('p','snote','Для настоящего бит-в-бит запуска сегодня нужен десктопный путь: Monomodule или Gearmulator MD/MM берут пользовательский OS-файл и исполняют DSP-код нативно. Native iOS-сборки используют медленный DSP-интерпретатор вне Safari. Этот Lab — слот хранения/диагностики, к которому можно будет подключить будущий WASM-core без переписывания интерфейса.'));
  if(_lastFirmware&&_lastFirmware.bytes) analyzeFirmwareBytes(_lastFirmware.bytes,_lastFirmware.name,{out,actions,skipSave:false});
}
/* --- MIDI export (SMF type1, p-locks -> original CC map) --- */
function vlq(v){ const b=[v&0x7F]; v>>=7; while(v>0){ b.unshift((v&0x7F)|0x80); v>>=7; } return b; }
function exportMIDI(){
  const p=curPat(), PPQ=96, stepTicks=PPQ/4, CCBASE={SYN:48,AMP:56,FILT:72,EFX:80};
  const tracksBytes=[];
  const tempo=Math.round(60000000/p.bpm);
  tracksBytes.push([].concat(vlq(0),[0xFF,0x51,0x03,(tempo>>16)&255,(tempo>>8)&255,tempo&255],vlq(0),[0xFF,0x2F,0x00]));
  for(let ti=0;ti<6;ti++){
    const tr=p.tracks[ti], evs=[];
    const nameBytes=[...new TextEncoder().encode('T'+(ti+1)+' '+MACH[tr.machine].name)];
    evs.push({t:0,data:[0xFF,0x03,nameBytes.length,...nameBytes]});
    for(const pg in CCBASE) for(let i=0;i<8;i++) evs.push({t:0,data:[0xB0+ti,CCBASE[pg]+i,tr.params[pg][i]]});
    for(let s=0;s<p.len;s++){ const st=tr.steps[s]; if(!st.on) continue; const tt=s*stepTicks;
      for(const k in st.locks){ const [pg,i]=k.split('.'); if(CCBASE[pg]!=null) evs.push({t:tt,data:[0xB0+ti,CCBASE[pg]+(+i),st.locks[k]]}); }
      if(!st.trigless){ const dur=Math.max(10,Math.round(st.len*stepTicks*0.95));
        evs.push({t:tt,data:[0x90+ti,st.note,st.vel||100]}); evs.push({t:tt+dur,data:[0x80+ti,st.note,0]}); }
    }
    evs.sort((a,b)=>a.t-b.t);
    let bytes=[],last=0; evs.forEach(e=>{ bytes=bytes.concat(vlq(e.t-last),e.data); last=e.t; });
    bytes=bytes.concat(vlq(0),[0xFF,0x2F,0x00]); tracksBytes.push(bytes);
  }
  const out=[0x4D,0x54,0x68,0x64,0,0,0,6, 0,1, 0,tracksBytes.length, (PPQ>>8)&255,PPQ&255];
  tracksBytes.forEach(tb=>{ out.push(0x4D,0x54,0x72,0x6B,(tb.length>>>24)&255,(tb.length>>>16)&255,(tb.length>>>8)&255,tb.length&255,...tb); });
  dl(patLabel(S.curPat)+'-'+p.name+'.mid', new Blob([new Uint8Array(out)],{type:'audio/midi'}));
  showMsg('MIDI EXPORTED');
}
/* --- master WAV capture: REC WAV starts, REC WAV or STOP saves a real .wav --- */
let _wavRec=null,_wavTimer=null;
const WAV_MAX_SECONDS=600;
function isWavRecording(){ return !!(_wavRec&&_wavRec.active); }
function wavElapsed(){
  if(!_wavRec) return 0;
  return _wavRec.mode==='pcm' ? _wavRec.frames/(_wavRec.sampleRate||48000) : (performance.now()-_wavRec.t0)/1000;
}
function fmtRecTime(sec){
  sec=Math.max(0,Math.floor(sec||0));
  return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
}
function updateWavRecUI(){
  const active=isWavRecording(), time=active?fmtRecTime(wavElapsed()):'';
  const b=$('#wavRecBtn');
  if(b){
    b.classList.toggle('recording',active);
    b.setAttribute('aria-pressed',active?'true':'false');
    const l=$('#wavRecLabel'); if(l) l.textContent=active?'STOP WAV':'REC WAV';
    const t=$('#wavRecTime'); if(t) t.textContent=time;
  }
  const sh=$('#sheetWavRecBtn'); if(sh) sh.textContent=active?('■ STOP WAV '+time):'● REC WAV';
  if(document.body) document.body.classList.toggle('wav-recording',active);
}
function writeAscii(view,offset,str){ for(let i=0;i<str.length;i++) view.setUint8(offset+i,str.charCodeAt(i)); }
function makeWavBlob(chunks,sampleRate,channels){
  const dataLen=chunks.reduce((n,c)=>n+c.byteLength,0);
  const header=new ArrayBuffer(44), v=new DataView(header);
  const blockAlign=channels*2, byteRate=sampleRate*blockAlign;
  writeAscii(v,0,'RIFF'); v.setUint32(4,36+dataLen,true); writeAscii(v,8,'WAVE');
  writeAscii(v,12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,channels,true);
  v.setUint32(24,sampleRate,true); v.setUint32(28,byteRate,true); v.setUint16(32,blockAlign,true); v.setUint16(34,16,true);
  writeAscii(v,36,'data'); v.setUint32(40,dataLen,true);
  return new Blob([header,...chunks],{type:'audio/wav'});
}
function pcmChunkFromBuffer(buffer){
  const len=buffer.length, nch=Math.min(2,buffer.numberOfChannels||1);
  const L=buffer.getChannelData(0), R=nch>1?buffer.getChannelData(1):L;
  const bytes=new Uint8Array(len*4), v=new DataView(bytes.buffer);
  const s16=x=>{ x=Math.max(-1,Math.min(1,x||0)); return x<0?Math.round(x*32768):Math.round(x*32767); };
  for(let i=0;i<len;i++){ v.setInt16(i*4,s16(L[i]),true); v.setInt16(i*4+2,s16(R[i]),true); }
  return bytes;
}
function decodeAudioBuffer(ctx,arrayBuffer){
  return new Promise((resolve,reject)=>{
    let p=null;
    try{ p=ctx.decodeAudioData(arrayBuffer.slice(0),resolve,reject); }catch(e){ reject(e); return; }
    if(p&&typeof p.then==='function') p.then(resolve,reject);
  });
}
function wavFilename(){
  const d=new Date(), p=n=>String(n).padStart(2,'0');
  return 'monomachine-'+patLabel(S.curPat)+'-'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds())+'.wav';
}
async function startWavRecording(){
  if(isWavRecording()) return;
  if(!powered) await togglePower();
  finishBoot();
  if(!AE.started){ try{ await startEngine(); }catch(e){ console.error(e); } }
  if(!AE.started||!AE.ctx){ showMsg('POWER ON FIRST'); return; }
  if(AE.resume) await AE.resume();
  const ctx=AE.ctx, source=AE.analyser||AE.master;
  try{
    if(ctx.createScriptProcessor&&source){
      const proc=ctx.createScriptProcessor(4096,2,2);
      const mute=ctx.createGain(); mute.gain.value=0;
      const st={active:true,mode:'pcm',proc,mute,source,chunks:[],frames:0,sampleRate:ctx.sampleRate,ctx,autoStop:false};
      _wavRec=st;
      proc.onaudioprocess=e=>{
        if(!st.active) return;
        st.chunks.push(pcmChunkFromBuffer(e.inputBuffer));
        st.frames+=e.inputBuffer.length;
        if(!st.autoStop&&st.frames/st.sampleRate>=WAV_MAX_SECONDS){ st.autoStop=true; setTimeout(stopWavRecording,0); }
      };
      source.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    } else if(window.MediaRecorder&&AE.streamDest&&AE.streamDest.stream){
      const mime=['audio/mp4','audio/webm','audio/ogg',''].find(m=>!m||MediaRecorder.isTypeSupported(m));
      const mr=new MediaRecorder(AE.streamDest.stream,mime?{mimeType:mime}:undefined);
      const st={active:true,mode:'media',recorder:mr,chunks:[],t0:performance.now(),ctx};
      _wavRec=st;
      mr.ondataavailable=e=>{ if(e.data&&e.data.size) st.chunks.push(e.data); };
      mr.start(1000);
    } else {
      throw new Error('No capture node or MediaRecorder');
    }
    if(_wavTimer) clearInterval(_wavTimer);
    _wavTimer=setInterval(updateWavRecUI,250);
    updateWavRecUI(); showMsg('WAV REC');
  }catch(e){
    console.error(e); _wavRec=null; updateWavRecUI(); showMsg('NO WAV RECORDER');
  }
}
async function stopWavRecording(){
  const st=_wavRec; if(!st||!st.active) return;
  const dur=wavElapsed(); st.active=false;
  if(_wavTimer) clearInterval(_wavTimer); _wavTimer=null;
  if(st.mode==='pcm'){
    try{ st.proc.onaudioprocess=null; }catch(e){}
    try{ st.source.disconnect(st.proc); }catch(e){}
    try{ st.proc.disconnect(); st.mute.disconnect(); }catch(e){}
    const blob=makeWavBlob(st.chunks,st.sampleRate,2);
    _wavRec=null; updateWavRecUI();
    dl(wavFilename(),blob); showMsg('WAV SAVED '+fmtRecTime(dur),2300);
    return;
  }
  try{
    const stopped=new Promise(resolve=>{ st.recorder.onstop=resolve; });
    st.recorder.stop(); await stopped;
  }catch(e){}
  const raw=new Blob(st.chunks,{type:(st.recorder&&st.recorder.mimeType)||'audio/webm'});
  _wavRec=null; updateWavRecUI();
  try{
    const decoded=await decodeAudioBuffer(st.ctx,await raw.arrayBuffer());
    dl(wavFilename(),makeWavBlob([pcmChunkFromBuffer(decoded)],decoded.sampleRate,2));
    showMsg('WAV SAVED '+fmtRecTime(dur),2300);
  }catch(e){
    const mt=(st.recorder&&st.recorder.mimeType)||'';
    dl('monomachine-'+patLabel(S.curPat)+'.'+(mt.includes('mp4')?'m4a':'webm'),raw);
    showMsg('AUDIO SAVED');
  }
}
function toggleWavRecording(){ return isWavRecording()?stopWavRecording():startWavRecording(); }
function toggleRecAudio(){ return toggleWavRecording(); }
/* ---------- MIDI ---------- */
const CC2PAGE={}; [ ['SYN',48],['AMP',56],['FILT',72],['EFX',80],['LFO1',88],['LFO2',104],['LFO3',112] ].forEach(([pg,base])=>{ for(let i=0;i<8;i++) CC2PAGE[base+i]=[pg,i]; });
async function initMIDI(manual,useSysEx=false){
  if(!navigator.requestMIDIAccess){ if(manual)showMsg('NO WEB MIDI HERE'); return; }
  try{
    const acc=await navigator.requestMIDIAccess({sysex:!!useSysEx});
    const bind=()=>{ acc.inputs.forEach(inp=>{ inp.onmidimessage=e=>{
      if(e.data&&e.data[0]===0xF0){
        const bytes=new Uint8Array(e.data);
        handleSysExBytes(bytes,'midi-capture-'+new Date().toISOString().replace(/[:.]/g,'-')+'.syx',{context:'file'});
        return;
      }
      const [stt,d1,d2]=e.data, cmd=stt&0xF0, ch=stt&0x0F; if(ch>5)return;
      if(cmd===0x90&&d2>0){ S.lastNote[ch]=d1; if(AE.started)AE.noteOn(ch,d1,nowT(),d2/127,{len:4,poly:S.poly&&ch===S.selTrack,live:true}); }
      else if(cmd===0x80||(cmd===0x90&&d2===0)){ if(AE.started)AE.noteOff(ch,d1,nowT()); }
      else if(cmd===0xB0){ const tr=curPat().tracks[ch];
        if(d1===7){ tr.level=d2; if(AE.started)AE.applyChain(ch,effParams(tr,null,ch),nowT()); }
        else if(CC2PAGE[d1]){ const [pg,i]=CC2PAGE[d1]; tr.params[pg][i]=d2; if(AE.started)AE.applyChain(ch,effParams(tr,null,ch),nowT()); if(ch===S.selTrack){ renderLCD(); renderKnobs(); } } }
      else if(stt===0xFA){ AE.play(); } else if(stt===0xFC){ AE.stop(); renderAll(); }
    }; });
    const outs=[...acc.outputs.values()]; if(outs.length) AE.midiOutPort=outs[0]; };
    bind(); acc.onstatechange=bind;
    if(manual) showMsg('MIDI OK: in '+acc.inputs.size+' / out '+acc.outputs.size+' CH1-6=TRK');
  }catch(e){ if(manual)showMsg('MIDI NO ACCESS'); }
}
/* ---------- playhead / scope loop ---------- */
let _lcdLast=0;
function rafLoop(){
  requestAnimationFrame(rafLoop);
  const now=performance.now();
  if(_knobsDirty) paintKnobs();
  if(_stepsDirty) paintSteps();
  const _ta=tempoEditActive(); if(_ta!==S._tempoWasActive){ S._tempoWasActive=_ta; renderKnobs(); }
  if(AE.started&&powered){
    const ct=AE.ctx.currentTime;
    const prevStep=S.playStep;
    let changed=false;
    while(AE.uiQueue.length&&AE.uiQueue[0].time<=ct+0.004){ const u=AE.uiQueue.shift(); S.playStep=u.step; changed=true; AE._uiPat=u.pat; }
    if(changed){
      _lcdDirty=true;
      const tl=cachedEl('#tempoLed'); if(tl&&S.playStep>=0) tl.classList.toggle('on',S.playStep%4===0);
      if(AE._uiPat!==undefined&&AE._uiPat!==S._shownPat){ S._shownPat=AE._uiPat; renderAll(); }
      else {
        let pageChanged=false;
        if(S.followPage&&S.lockStep<0){ const pg=Math.floor(S.playStep/16); if(pg!==S.seqPage){ S.seqPage=pg; pageChanged=true; } }
        if(pageChanged) paintSteps(); else updatePlayhead(prevStep,S.playStep);
        renderTracksPagesLight();
      }
    }
  }
  maybePaintLCD(now);
}
function renderTracksPagesLight(){ const bp=cachedEl('#btnPlay'); if(bp) bp.classList.toggle('on',S.playing); const lp=cachedEl('#ledPlay'); if(lp) lp.classList.toggle('on',S.playing); }
/* ---------- keyboard (desktop) ---------- */
const KEYMAP={z:0,s:1,x:2,d:3,c:4,v:5,g:6,b:7,h:8,n:9,j:10,m:11,',':12};
const _heldKeys={};
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if(e.code==='Space'){ e.preventDefault(); $('#btnPlay').click(); return; }
  if(e.key>='1'&&e.key<='6'){ S.selTrack=+e.key-1; renderAll(); return; }
  if(e.key==='-'||e.key==='_'){ setTempo(curPat().bpm-(e.shiftKey?5:1)); return; }
  if(e.key==='='||e.key==='+'){ setTempo(curPat().bpm+(e.shiftKey?5:1)); return; }
  const k=e.key.toLowerCase(); if(k in KEYMAP&&!_heldKeys[k]){ _heldKeys[k]=1; const note=S.octave*12+KEYMAP[k]; S.lastNote[S.selTrack]=note; if(AE.started)AE.noteOn(S.selTrack,note,nowT(),0.95,{len:8,poly:S.poly,live:true});
    if(recMode===1&&S.playing&&S.playStep>=0){ const st=curTrk().steps[S.playStep]; st.on=true; st.note=note; st.len=2; renderSteps(); saveSoon(); } }
});
document.addEventListener('keyup',e=>{ const k=e.key.toLowerCase(); if(k in KEYMAP){ delete _heldKeys[k]; if(AE.started)AE.noteOff(S.selTrack,S.octave*12+KEYMAP[k],nowT()); } });
/* ---------- help ---------- */
const HELP_HTML=`
<h3>Что это</h3><p>Clean-room воссоздание <b>Elektron Monomachine SFX-60+ MKII</b> для браузера iPhone: все 22 машины (GND, SID-6581, SuperWave, DigiPRO, FM+, VO-6 и 7 FX), страницы SYN/AMP/FILT/EFX + 3 LFO на трек, 6 моно-треков, 64-шаговый секвенсор с parameter locks — как на железке OS 1.32. Движки и калибровка огибающих/фильтра — по мотивам открытого проекта <b>MONO2K</b> (Sequencist). Ни кода, ни сэмплов Elektron внутри нет.</p>
<h3>Как играть</h3><p><b>PLAY</b> — старт. <b>REC</b> переключает: GRID REC (тап по тригу = нота, двойной тап = редактор шага, <b>удержание трига = P-LOCK</b>: крутите ручки A–H, значения залочатся на этот шаг, как на оригинале), LIVE REC (запись с клавиш-тригов в реальном времени), KEYS (триги — хроматическая клавиатура, OCT −/+).</p>
<p><b>Ручки A–H</b>: тянуть вверх/вниз пальцем; двойной тап — сброс; тап — значение на LCD. Страницы выбираются списком справа от ЖК (SYNTHESIS…LFO 3), ARP — клавишей ARP. <b>TRACK 1–6</b> — выбор трека (удержание — прослушка), <b>FUNCTION + TRACK</b> — мьют. FUNCTION + любая клавиша = её коричневая подпись (COPY/CLEAR/PASTE, GLOBAL, POLY, MUTE MODE, MIDI SEQ). Клавиша MACHINE (EDIT) — смена машины, BANK — паттерны, GLOBAL (FUNC+KIT/SONG) — файлы и настройки.</p>
<h3>Секвенсор</h3><p>128 паттернов (A01–H16), длина 16/32/48/64 и скорость 3/4–2X (SCALE), свинг, слайды, арпеджиатор на трек (страница ARP + ноты аккорда в редакторе шага), вероятность, ратчеты и микротайминг (бонус из MONO2K), SONG и CHAIN, очереди паттернов при игре. Всё автосохраняется в «+Drive» (localStorage).</p>
<h3>FX-треки</h3><p>Поставьте FX-REVERB на T6 — она обработает NEIB (T5). Триги FX-трека гейтят сигнал огибающими; длинный триг на шаге 1 + AMP DEC=127 = постоянно открытый эффект (так сделаны демо). Вход: ручка INP; INP=INP — микрофон/линия (SETUP → INP AB, нужны наушники).</p>
<h3>TEMPO и рандом</h3><p><b>− / TAP / +</b> слева меняют BPM сразу (удерживайте ± для быстрой прокрутки); пока открыт TEMPO-popup, ручка <b>LEVEL</b> тоже крутит темп. В <b>KITS</b>: <b>RANDOMIZE KIT</b> собирает все 6 звуков по теме и сохраняет результат в банк, <b>RANDOM TRK SOUND</b> и RND · по трекам — отдельные звуки; MUTATE мягко мутирует, CHAOS даёт широкий, но не «тихий/самоосциллирующий» диапазон. Есть UNDO KIT.</p>
<h3>Файлы и настоящий SysEx</h3><p>FILE/KITS: импорт настоящих Monomachine <b>KIT DUMP 0x52</b> (машины, уровни, SYN/AMP/FILT/EFX/LFO и FX-routing), <b>PATTERN DUMP 0x67</b> (триги, ноты, слайды, trigless/filter/LFO-триги, p-locks), <b>DigiPRO WAVE 0x5D</b> в DigiBank, экспорт текущего/всех китов обратно в .syx, локальная SysEx Library в IndexedDB и отправка через Web MIDI (десктоп). Также проект JSON, паттерн MIDI (CC как у железки) и REC WAV.</p>
<h3>Firmware Lab</h3><p>Во Firmware Lab можно вставить собственный оригинальный OS .syx/.bin: файл останется локально в IndexedDB, приложение посчитает hash и проверит маркеры/версию. Честно: Safari не запустит ColdFire + 2× DSP56300 без специального WASM-core/JIT, поэтому BOOT TEST пока останавливается на «нет core». На десктопе настоящий OS-файл исполняют Monomodule и Gearmulator MD/MM.</p>
<h3>iPhone</h3><p>Интерфейс сам перестраивается под портрет и ландшафт, без уменьшения всей панели в микроскоп. Красная <b>REC WAV</b> сверху записывает мастер до повторного нажатия или STOP и сохраняет настоящий WAV. «Поделиться → На экран Домой» поставит как приложение. Звук стартует по клавише POWER вверху справа (политика iOS) — ЖК на секунду покажет логотип, как железка при включении. Web MIDI в Safari iOS недоступен — работает в Chrome на десктопе (каналы 1–6 = треки, та же CC-карта).</p>`;
/* ---------- boot ---------- */
async function startEngine(){
  await AE.init(); if(AE.resume) await AE.resume(); AE.patternChanged(); renderAll();
  initMIDI(false);
}
async function togglePower(){
  if(_powerBusy) return;
  _powerBusy=true;
  try{
    if(powered){
      if(isWavRecording()) await stopWavRecording();
      if(bootTimer) clearTimeout(bootTimer);
      bootTimer=null; powered=false; lcdMode='off';
      if(AE.started){ AE.stop(); if(AE.suspend) AE.suspend(); }
      renderAll(); drawLCD(); return;
    }
    powered=true; lcdMode='boot'; startBoot();
    renderAll(); drawLCD();
    try{
      if(!AE.started) await startEngine();
      else if(AE.resume) await AE.resume();
    }catch(e){ console.error(e); bootReport('audio init',e); showMsg('AUDIO INIT ERROR — UI OK'); }
    if(powered&&AE.started&&AE.ctx&&AE.ctx.state!=='running') showMsg('AUDIO SUSPENDED — CLICK PLAY',2200);
    renderAll();
  }finally{ _powerBusy=false; }
}
let _fitKey='';
function fitToScreen(){
  const u=$('#unit'), w=$('#scaleWrap'); if(!u||!w) return;
  // Never scale the whole hardware down: the responsive layout owns the size.
  // This also stops Safari viewport changes from moving the panel while a knob is dragged.
  u.style.transform=''; w.style.height='';
  if(document.body&&document.body.classList.contains('knob-dragging')) return;
  const vv=window.visualViewport;
  const vw=Math.round(vv?vv.width:window.innerWidth);
  const vh=Math.round(vv?vv.height:window.innerHeight);
  const key=vw+'x'+(vw>vh?'landscape':'portrait');
  if(vh>0&&key!==_fitKey){ _fitKey=key; document.documentElement.style.setProperty('--appH',vh+'px'); }
}
function bootReport(stage,e){
  const b=window.__monoBoot; if(b) b.stage=stage;
  if(e){ if(window.__monoBootError) window.__monoBootError(stage,e); console.error('[MONO BOOT]',stage,e); }
}
function bootStage(stage,fn){
  try{ bootReport(stage); return fn(); }
  catch(e){ bootReport(stage,e); return undefined; }
}
function installAudioStub(){
  if(typeof AE!=='undefined') return;
  window.AE={ctx:null,started:false,tracks:[],uiQueue:[],lfoOff:[],workletOK:false,_stopMuted:true,
    init:async()=>{ throw new Error('audio.js не загрузился'); },resume:async()=>false,suspend:async()=>false,patternChanged(){},noteOn(){},noteOff(){},play(){},stop(){},
    setMachine(){},applyChain(){},killTrack(){},restoreTrack(){},allNotesOff(){},enableInput:async()=>{ throw new Error('audio.js не загрузился'); }};
}
let _bootStarted=false,_bootDone=false,_bootLoadRetried=false;
function markBootOk(){
  _bootDone=true;
  if(document.body) document.body.classList.add('boot-ok');
  if(window.__monoHideBootGuard) window.__monoHideBootGuard();
  else if(window.__monoBoot) window.__monoBoot.ok=true;
}
function bootApp(){
  if(_bootStarted||_bootDone) return;
  _bootStarted=true;
  const missingCore=!hasState()||typeof loadSaved!=='function';
  if((missingCore||typeof AE==='undefined')&&!_bootLoadRetried&&window.__monoLoadMissing){
    _bootLoadRetried=true; bootReport('retry missing modules');
    window.__monoLoadMissing(()=>{ _bootStarted=false; initUiStateFields(); bootApp(); });
    return;
  }
  if(missingCore){
    bootReport('state module missing',new Error('js/state.js не загрузился'));
    if(window.__monoShowBootGuard) window.__monoShowBootGuard();
    return;
  }
  initUiStateFields();
  if(typeof AE==='undefined'){ bootReport('audio module missing',new Error('js/audio.js не загрузился; показываю панель без звука')); installAudioStub(); }
  bootStage('pointer fallback',installPointerFallback);
  bootStage('loadSaved',loadSaved);
  bootStage('validate current pattern',()=>{ curPat(); });
  bootStage('buildStatic',buildStatic);
  bootStage('bindTransport',bindTransport);
  const rendered=bootStage('renderAll',()=>{ renderAll(); return true; });
  if(!rendered){
    bootStage('render tracks/pages',renderTracksPages);
    bootStage('paint knobs',paintKnobs);
    bootStage('paint steps',paintSteps);
    bootStage('draw LCD',drawLCD);
  }
  const counts=[document.querySelectorAll('#knobs .knob-wrap').length,document.querySelectorAll('#pageList .pagerow').length,document.querySelectorAll('#trackBtns .trow').length,document.querySelectorAll('#trigGrid .trigcell').length];
  if(counts.join('/')==='8/7/6/16') markBootOk();
  else {
    bootReport('verify controls',new Error('knobs/pages/tracks/trigs = '+counts.join('/')));
    if(window.__monoShowBootGuard) window.__monoShowBootGuard();
  }
  if(typeof sxParseFile==='undefined'&&window.__monoLoadMissing) bootStage('optional sysex retry',()=>window.__monoLoadMissing(()=>{}));
  bootStage('fit/listeners',()=>{
    fitToScreen(); setTimeout(fitToScreen,350);
    window.addEventListener('resize',fitToScreen);
    window.addEventListener('orientationchange',()=>setTimeout(fitToScreen,150));
    if(window.visualViewport) visualViewport.addEventListener('resize',fitToScreen);
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&powered&&typeof AE!=='undefined'&&AE.ctx&&AE.ctx.state!=='running'&&AE.resume) AE.resume(); });
    const unlockAudio=()=>{ if(powered&&typeof AE!=='undefined'&&AE.started&&AE.ctx&&AE.ctx.state!=='running'&&AE.resume) AE.resume(); };
    window.addEventListener('pointerdown',unlockAudio,{capture:true});
    window.addEventListener('keydown',unlockAudio,{capture:true});
    window.addEventListener('touchend',unlockAudio,{capture:true,passive:true});
    document.addEventListener('touchmove',e=>{ const t=e.target; if((t&&t.closest&&t.closest('.knob,.knob-wrap,.mknob,.trig,.wavecv'))||document.body.classList.contains('knob-dragging')) e.preventDefault(); },{passive:false});
  });
  if(typeof AE!=='undefined') AE.onPattern=()=>{ /* UI follows via uiQueue pat marker */ };
  bootStage('raf',()=>rafLoop());
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bootApp);
else bootApp();
