/* MONOMACHINE WEB — state, machine definitions, factory content
   Clean-room recreation after Elektron Monomachine SFX-60+ MKII (OS 1.32)
   and MONO2K by Sequencist (github.com/InigoHernandez/mono2k).
   No Elektron code, samples or firmware included. */
'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const R127=v=>clamp(Math.round(v),0,127);
const NOTE_NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const noteName=m=>NOTE_NAMES[((m%12)+12)%12]+(Math.floor(m/12)-1);
function N2M(s){ // "C#3" / "Bb2" -> midi
  const m=/^([A-G])([#b]?)(-?\d)$/.exec(s); if(!m) return 60;
  const base={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]]+(m[2]==='#'?1:m[2]==='b'?-1:0);
  return base+(parseInt(m[3])+1)*12;
}
const mtof=m=>440*Math.pow(2,(m-69)/12);

/* ---------- parameter definitions ----------
   slot: [name, defaultRaw0..127, type, enumLabels?]
   types: uni(0..127) bip(-64..+63) enum onoff pch(-12..+12/OFF) w32 w64 cons tune */
const P=(n,d,t='uni',e)=>({n,d,t,e});
const TUNE=P('TUNE',64,'tune');
const CONS_LIST=['-','B','D','F','G','H','J','K','L','M','N','P','R','S','T','V','W','Z','CH','SH','TH'];
const INP_LIST=['NEIB','INP','BUS','MIX'];

const MACHINES=[
 // id, group, display, sysex-ish id, SYN page slots (8), isFX
 {id:'GND',   g:'GND',   name:'GND-GND',   sx:0x00, syn:[null,null,null,null,null,null,null,null]},
 {id:'SIN',   g:'GND',   name:'GND-SIN',   sx:0x01, syn:[null,null,null,null,null,null,null,TUNE]},
 {id:'NOIS',  g:'GND',   name:'GND-NOIS',  sx:0x02, syn:[P('ST',64),P('RED',0),P('STON',127,'onoff'),null,null,null,null,TUNE]},
 {id:'SID',   g:'SID',   name:'SID-6581',  sx:0x03, syn:[P('PW',64,'bip'),P('PWAD',0),P('PWRS',127,'onoff'),P('WAVE',80,'enum',['TRI','SAW','PULS','MIX','NOIS']),P('MOD',0,'enum',['OFF','RING','SYNC']),P('MSRC',0,'enum',['MFRQ','PRCH']),P('MFRQ',64),TUNE]},
 {id:'SAW',   g:'SWAVE', name:'SWAVE-SAW', sx:0x04, syn:[P('UNIL',64),P('UNIW',18),P('UNIX',0),null,P('SUBX',0),P('SUB1',0),P('SUB2',0),TUNE]},
 {id:'PULS',  g:'SWAVE', name:'SWAVE-PULS',sx:0x05, syn:[P('UNIL',40),P('UNIW',14),P('SUB1',0),P('SUB2',0),P('PW',64,'bip'),P('PWAD',0),P('PWRS',127,'onoff'),TUNE]},
 {id:'ENS',   g:'SWAVE', name:'SWAVE-ENS', sx:0x0E, syn:[P('PCH2',64,'pch'),P('PCH3',64,'pch'),P('PCH4',64,'pch'),P('WAVE',40),P('PW',64),P('CHRL',70),P('CHRW',80),TUNE]},
 {id:'DWAVE', g:'DPRO',  name:'DPRO-WAVE', sx:0x06, syn:[P('WAVE',0,'w32'),P('WP',0),P('WPM',0),P('WPRS',127,'onoff'),P('SYNC',0,'enum',['OFF','PRCH','INT']),P('SFRQ',64),null,TUNE]},
 {id:'BBOX',  g:'DPRO',  name:'DPRO-BBOX', sx:0x07, syn:[P('PTCH',64,'bip'),P('STRT',0),null,null,P('RTRG',0),P('RTIM',32),null,null]},
 {id:'DDRW',  g:'DPRO',  name:'DPRO-DDRW', sx:0x20, syn:[P('WAV1',0,'w64'),P('MIX',64,'bip'),P('WAV2',40,'w64'),P('TIME',20),P('BR1',0),P('WID',64,'bip'),P('BR2',0),TUNE]},
 {id:'DENS',  g:'DPRO',  name:'DPRO-DENS', sx:0x21, syn:[P('PCH2',64,'pch'),P('PCH3',64,'pch'),P('PCH4',64,'pch'),P('WAVE',8,'w64'),null,P('CHRL',70),P('CHRW',80),TUNE]},
 {id:'FMSTAT',g:'FM+',   name:'FM+STAT',   sx:0x08, syn:[P('1FRQ',32),P('1FIN',64,'bip'),P('1ENV',80),P('1FB',0),P('2FRQ',64),P('2VOL',40),P('TONE',100),TUNE]},
 {id:'FMPAR', g:'FM+',   name:'FM+PAR',    sx:0x09, syn:[P('1FRQ',32),P('1ENV',70),P('2FRQ',64),P('2ENV',50),P('3FRQ',96),P('3ENV',30),P('TONE',100),TUNE]},
 {id:'FMDYN', g:'FM+',   name:'FM+DYN',    sx:0x0A, syn:[P('1FRQ',40),P('1FEN',64,'bip'),P('1VOL',90),P('1VEN',70),P('2FRQ',80),P('2ENV',60),P('2FB',20),TUNE]},
 {id:'VO6',   g:'VO',    name:'VO-6',      sx:0x0B, syn:[P('VOC1',90),P('VOC2',40),P('V-SW',127,'onoff'),P('VOIC',20),P('CONS',0,'cons'),P('CLEN',40),P('CVOL',90),TUNE]},
 {id:'THRU',  g:'FX',    name:'FX-THRU',   sx:0x0C, fx:true, syn:[null,null,null,null,null,null,null,P('INP',0,'enum',INP_LIST)]},
 {id:'REVERB',g:'FX',    name:'FX-REVERB', sx:0x0D, fx:true, syn:[P('DEC',80),P('DAMP',60),P('GATE',0),P('MIX',70),P('HP',20),P('LP',100),null,P('INP',0,'enum',INP_LIST)]},
 {id:'CHORUS',g:'FX',    name:'FX-CHORUS', sx:0x0F, fx:true, syn:[P('DEL',40),P('DEP',60),P('SPD',30),P('MIX',64),P('FB',64,'bip'),P('WID',90),P('LP',110),P('INP',0,'enum',INP_LIST)]},
 {id:'DYNAMIX',g:'FX',   name:'FX-DYNAMIX',sx:0x10, fx:true, syn:[P('ATK',30),P('REL',60),P('THRS',60),P('MIX',127),P('RAT',60),P('GAIN',64),P('RMS',64),P('INP',0,'enum',INP_LIST)]},
 {id:'RINGMOD',g:'FX',   name:'FX-RINGMOD',sx:0x11, fx:true, syn:[P('WAVE',0,'enum',['SIN','TRI','SAW','SQR']),P('EXT',0,'onoff'),null,P('MIX',100),null,null,null,P('INP',0,'enum',INP_LIST)]},
 {id:'PHASER',g:'FX',    name:'FX-PHASER', sx:0x12, fx:true, syn:[P('CNTR',64),P('DEP',80),P('SPD',30),P('MIX',70),P('FB',40),P('WID',80),null,P('INP',0,'enum',INP_LIST)]},
 {id:'FLANGER',g:'FX',   name:'FX-FLANGER',sx:0x13, fx:true, syn:[P('DEL',30),P('DEP',70),P('SPD',25),P('MIX',70),P('FB',70),P('WID',80),null,P('INP',0,'enum',INP_LIST)]},
];
const MACH={}; MACHINES.forEach(m=>MACH[m.id]=m);
const MACH_BY_SX={}; MACHINES.forEach(m=>MACH_BY_SX[m.sx]=m.id);

const PAGES=['SYN','AMP','FILT','EFX','LFO1','LFO2','LFO3','ARP'];
const PAGE_DEFS={
 AMP:[P('ATK',0),P('HOLD',10),P('DEC',90),P('REL',24),P('DIST',64,'bip'),P('VOL',100),P('PAN',64,'bip'),P('PORT',0)],
 FILT:[P('BASE',0),P('WDTH',127),P('HPQ',0),P('LPQ',0),P('ATK',0),P('DEC',60),P('BOFS',64,'bip'),P('WOFS',64,'bip')],
 EFX:[P('EQF',64),P('EQG',64,'bip'),P('SRR',0),P('DTIM',24),P('DSND',0),P('DFB',40),P('DBAS',10),P('DWID',90)],
 ARP:[P('MODE',0,'enum',['OFF','UP','DOWN','U/D','RND','CHRD']),P('SPD',64,'enum',['4','3','2','1','1/2','1/3','1/4']),P('RNGE',24,'enum',['1OCT','2OCT','3OCT','4OCT']),P('LEN',16),P('TRSP',64,'bip'),P('LEG',0,'onoff'),P('CHRD',0,'enum',['---','MIN','MAJ','MIN7','MAJ7','SUS4','DIM','POW']),P('VEL',100)],
};
const LFO_PAGES=['SYN','AMP','FILT','EFX','LFO1','LFO2','LFO3','PTCH'];
const LFO_WAVES=['TRI','ITRI','SIN','ISIN','SAW','ISAW','SQR','ISQR','EXP','IEXP','RND'];
const LFO_TRIGS=['FREE','TRIG','HOLD','ONE','HALF'];
const LFO_MULTS=['1X','2X','4X','8X','16X','32X','64X','128X'];
function lfoDef(){return [P('PAGE',40,'enum',LFO_PAGES),P('DEST',0,'enum',['A','B','C','D','E','F','G','H']),P('TRIG',0,'enum',LFO_TRIGS),P('WAVE',0,'enum',LFO_WAVES),P('MULT',18,'enum',LFO_MULTS),P('SPD',64),P('INTL',0),P('DPTH',0)];}
PAGE_DEFS.LFO1=lfoDef(); PAGE_DEFS.LFO2=lfoDef(); PAGE_DEFS.LFO3=lfoDef();

function pageDef(track,page){ return page==='SYN'? MACH[track.machine].syn : PAGE_DEFS[page]; }
function enumIdx(def,raw){ const n=def.e?def.e.length:(def.t==='w32'?32:def.t==='w64'?64:def.t==='cons'?CONS_LIST.length:2); return clamp(Math.floor(raw/128*n),0,n-1); }
function formatVal(def,raw){
  if(!def) return '---';
  switch(def.t){
    case 'bip': {const v=raw-64; return (v>0?'+':'')+v;}
    case 'tune': {const v=raw-64; return (v>0?'+':'')+v;}
    case 'onoff': return raw<64?'OFF':'ON';
    case 'enum': return def.e[enumIdx(def,raw)];
    case 'cons': return CONS_LIST[enumIdx(def,raw)];
    case 'w32': return 'S'+String(enumIdx(def,raw)+1).padStart(2,'0');
    case 'w64': return 'D'+String(enumIdx(def,raw)+1).padStart(2,'0');
    case 'pch': { if(raw>=60&&raw<=68) return 'OFF'; const s=Math.round((raw-64)/5.33); return (s>0?'+':'')+s; }
    default: return String(raw);
  }
}
function pchSemis(raw){ if(raw>=60&&raw<=68) return null; return clamp(Math.round((raw-64)/5.33),-12,12); }
function tuneSemis(raw){ return (raw-64)/63*2; } // TUNE = ±2 semitones (per MONO2K calibration)

/* ---------- data model ---------- */
let _uid=1;
function mkStep(){return {on:false,trigless:false,note:60,len:2,vel:100,slide:false,prob:100,rat:1,mic:0,arp:null,locks:{}};}
function defaultParams(machineId){
  const o={};
  o.SYN=MACH[machineId].syn.map(d=>d?d.d:64);
  for(const pg of ['AMP','FILT','EFX','LFO1','LFO2','LFO3','ARP']) o[pg]=PAGE_DEFS[pg].map(d=>d.d);
  return o;
}
function mkTrack(machineId='SAW'){
  return {machine:machineId, level:100, muted:false, out:'MAIN', params:defaultParams(machineId), steps:Array.from({length:64},mkStep)};
}
function mkPattern(name='INIT'){
  return {name, bpm:120, swing:50, len:64, scale:1, kit:'INIT KIT',
          tracks:[mkTrack('SAW'),mkTrack('PULS'),mkTrack('SID'),mkTrack('DWAVE'),mkTrack('FMSTAT'),mkTrack('BBOX')]};
}
function setP(tr,page,name,val){ const defs=pageDef(tr,page); const i=defs.findIndex(d=>d&&d.n===name); if(i>=0) tr.params[page][i]=R127(val); }
function setLocks(step,obj){ for(const k in obj) step.locks[k]=R127(obj[k]); }
/* steps builder: str 64 chars (x trig, s slide-trig, . off); notes consumed per trig (names or midi, cycled) */
function seq(tr,str,notes,opt={}){
  let ni=0; const nn=(notes&&notes.length)?notes:[60];
  for(let i=0;i<64;i++){
    const c=str[i]||'.'; if(c==='x'||c==='s'){
      const st=tr.steps[i]; st.on=true; st.slide=(c==='s');
      const n=nn[ni%nn.length]; st.note=(typeof n==='string')?N2M(n):n; ni++;
      st.len=opt.len||2; if(opt.vel)st.vel=opt.vel;
      if(opt.locks&&opt.locks[i]) setLocks(st,opt.locks[i]);
      if(opt.lockAll) setLocks(st, typeof opt.lockAll==='function'?opt.lockAll(i,st):opt.lockAll);
      if(opt.arp) st.arp=opt.arp.slice();
    }
  }
}
const BBOX_DRUMS=['KICK','KICK2','SNARE','SNAR2','CLAP','RIM','HATC','HATO','CYMB','TOMH','TOMM','TOML','PERC1','PERC2','SHAKE','COWB','METAL','ZAP','BLIP','NOISE','SUB','CLICK','STICK','CRASH'];
const DR=n=>36+BBOX_DRUMS.indexOf(n); // BBOX note->drum

/* ---------- factory patterns (original compositions in the spirit of MONO2K bank A) ---------- */
function factoryPatterns(){
  const P128={};
  const add=(idx,p)=>{P128[idx]=p;};

  { // A01 SIGNAL — IDM groove, D minor
    const p=mkPattern('SIGNAL'); p.bpm=122; p.swing=56;
    const [t1,t2,t3,t4,t5,t6]=p.tracks;
    t1.machine='BBOX'; t1.params=defaultParams('BBOX'); setP(t1,'EFX','DSND',18);
    seq(t1,'x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...',
        [DR('KICK'),DR('KICK'),DR('KICK'),DR('KICK2')],{len:1});
    seq(t1,'....x.......x.......x.......x.......x.......x.......x.......x...',[DR('SNARE')],{len:1});
    seq(t1,'..x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x.',[DR('HATC'),DR('HATC'),DR('HATO'),DR('HATC')],{len:1,lockAll:i=>({'SYN.0':64+((i*7)%20-10)})});
    t2.machine='SAW'; t2.params=defaultParams('SAW'); setP(t2,'SYN','SUB1',80); setP(t2,'SYN','UNIL',30); setP(t2,'FILT','WDTH',60); setP(t2,'AMP','DEC',70);
    seq(t2,'x..x..x...x..x..x..x..x...x..x..x..x..x...x..x..x..x..x...x..x..',
        ['D2','D2','F2','D2','G2','D2','A2','C3','D2','D2','F2','D2','Bb2','A2','G2','F2'],{len:2,lockAll:i=>({'FILT.1':40+((i*13)%60)})});
    t3.machine='DWAVE'; t3.params=defaultParams('DWAVE'); setP(t3,'EFX','DSND',60); setP(t3,'EFX','DTIM',36); setP(t3,'EFX','DFB',70); setP(t3,'AMP','DEC',60);
    seq(t3,'......x.......x...x.......x.......x...x.......x......x.......x..',['D4','F4','A4','G4','F4','E4','D4','C4'],{len:3,lockAll:i=>({'SYN.0':(i*17)%128,'SYN.1':(i*29)%128})});
    t4.machine='ENS'; t4.params=defaultParams('ENS'); setP(t4,'AMP','ATK',40); setP(t4,'AMP','DEC',127); setP(t4,'AMP','VOL',70); setP(t4,'SYN','CHRL',90);
    seq(t4,'x...............x...............x...............x...............',['D3','Bb2','F3','C3'],{len:15});
    setLocks(t4.steps[0],{'SYN.0':64+16,'SYN.1':64+37}); setLocks(t4.steps[16],{'SYN.0':64+21,'SYN.1':64+37});
    setLocks(t4.steps[32],{'SYN.0':64+21,'SYN.1':64+37}); setLocks(t4.steps[48],{'SYN.0':64+21,'SYN.1':64+48});
    t5.machine='FMSTAT'; t5.params=defaultParams('FMSTAT'); setP(t5,'ARP','MODE',30); setP(t5,'AMP','DEC',55); setP(t5,'AMP','VOL',66);
    seq(t5,'x.......x.......x.......x.......x.......x.......x.......x.......',['D4','F4','A4','C5','Bb3','F4','A4','E4'],{len:6,arp:[0,3,7,12]});
    t6.machine='REVERB'; t6.params=defaultParams('REVERB'); t5.out='MAIN'; setP(t6,'AMP','DEC',127); setP(t6,'AMP','VOL',60);
    seq(t6,'x...............................................................',[60],{len:64});
    p.kit='SIGNAL KIT'; add(0,p);
  }
  { // A02 SIDRAIN — chip tune
    const p=mkPattern('SIDRAIN'); p.bpm=140; p.swing=50;
    const [t1,t2,t3,t4,t5,t6]=p.tracks;
    t1.machine='SID'; t1.params=defaultParams('SID'); setP(t1,'SYN','WAVE',64); setP(t1,'ARP','MODE',30); setP(t1,'ARP','SPD',110); setP(t1,'AMP','DEC',127);
    seq(t1,'x...............x...............x...............x...............',['C4','A3','F3','G3'],{len:15,arp:[0,4,7,12,16]});
    t2.machine='SIN'; t2.params=defaultParams('SIN'); setP(t2,'AMP','DIST',90);
    seq(t2,'x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...',['C2','C2','A1','A1','F1','F1','G1','G1'],{len:2});
    t3.machine='NOIS'; t3.params=defaultParams('NOIS'); setP(t3,'AMP','DEC',30); setP(t3,'FILT','BASE',90); setP(t3,'AMP','VOL',60);
    seq(t3,'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.',[72],{len:1});
    t4.machine='SID'; t4.params=defaultParams('SID'); setP(t4,'SYN','PWAD',70); setP(t4,'SYN','WAVE',64); setP(t4,'AMP','DEC',80);
    seq(t4,'....x...x.......x...x.......x.......x...x.......x...x...x.......',['E5','G5','C6','G5','A5','F5','E5','D5','B4','G4'],{len:3});
    t5.machine='BBOX'; t5.params=defaultParams('BBOX');
    seq(t5,'x.....x.x.......x.....x.x.......x.....x.x.......x.....x...x.....',[DR('KICK')],{len:1});
    seq(t5,'....x.......x.......x.......x.......x.......x.......x.......x...',[DR('SNARE')],{len:1});
    t6.machine='PULS'; t6.params=defaultParams('PULS'); setP(t6,'AMP','VOL',55); setP(t6,'ARP','MODE',55);
    seq(t6,'x...............x...............x...............x...............',['C3','A2','F2','G2'],{len:15,arp:[0,7,12]});
    p.kit='CHIP KIT'; add(1,p);
  }
  { // A03 VOXMACH — talking VO-6
    const p=mkPattern('VOXMACH'); p.bpm=102; p.swing=58;
    const [t1,t2,t3,t4,t5,t6]=p.tracks;
    t1.machine='VO6'; t1.params=defaultParams('VO6'); setP(t1,'AMP','ATK',0); setP(t1,'AMP','DEC',127); setP(t1,'AMP','REL',4); setP(t1,'EFX','DSND',40);
    const cons=s=>Math.round(CONS_LIST.indexOf(s)/(CONS_LIST.length-1)*127);
    const syll=[[0,'M',127,60],[4,'-',40,110],[8,'N',90,50],[12,'-',40,110],[16,'M',127,60],[20,'SH',70,90],[24,'-',60,80],[28,'N',127,60],[32,'-',80,70],[36,'L',90,60],[40,'K',110,40],[44,'T',100,50],[48,'R',90,60],[52,'-',40,110],[56,'N',127,60],[60,'-',127,60]];
    seq(t1,'x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...',['C3','C3','D3','D3','E3','E3','G3','E3','C3','D3','E3','G3','A3','G3','E3','C3'],{len:4});
    syll.forEach(([i,c,v1,v2])=>setLocks(t1.steps[i],{'SYN.4':cons(c),'SYN.0':v1,'SYN.1':v2,'SYN.5':30,'SYN.6':110}));
    t2.machine='FMDYN'; t2.params=defaultParams('FMDYN'); setP(t2,'AMP','DEC',75);
    seq(t2,'x......x..x.....x......x..x.....x......x..x.....x......x...x....',['C2','C2','Eb2','C2','F2','G2'],{len:3,lockAll:i=>({'SYN.2':60+((i*11)%60)})});
    t3.machine='BBOX'; t3.params=defaultParams('BBOX');
    seq(t3,'x.....x...x.....x.....x...x.....x.....x...x.....x.....x...x.....',[DR('KICK')],{len:1});
    seq(t3,'....x.......x.......x.......x.x.....x.......x.......x.......x...',[DR('CLAP')],{len:1});
    seq(t3,'..x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x.',[DR('SHAKE')],{len:1});
    t4.machine='DENS'; t4.params=defaultParams('DENS'); setP(t4,'AMP','ATK',30); setP(t4,'AMP','DEC',127); setP(t4,'AMP','VOL',55);
    seq(t4,'x...............x...............x...............x...............',['C3','Ab2','Eb3','G2'],{len:15});
    setLocks(t4.steps[0],{'SYN.0':64+16,'SYN.1':64+37}); setLocks(t4.steps[16],{'SYN.0':64+21,'SYN.1':64+37});
    setLocks(t4.steps[32],{'SYN.0':64+21,'SYN.1':64+37}); setLocks(t4.steps[48],{'SYN.0':64+21,'SYN.1':64+37});
    t5.machine='NOIS'; t5.params=defaultParams('NOIS'); setP(t5,'AMP','VOL',35); setP(t5,'EFX','SRR',50);
    seq(t5,'......x.......x.......x.......x......x.......x.......x.......x..',[48],{len:1,lockAll:i=>({'SYN.1':(i*23)%127})});
    t6.machine='CHORUS'; t6.params=defaultParams('CHORUS'); t5.out='MAIN'; setP(t6,'AMP','DEC',127); setP(t6,'AMP','VOL',50);
    seq(t6,'x...............................................................',[60],{len:64});
    p.kit='VOX KIT'; add(2,p);
  }
  { // A04 DUBPLATE — slow dub
    const p=mkPattern('DUBPLATE'); p.bpm=74; p.swing=62;
    const [t1,t2,t3,t4,t5,t6]=p.tracks;
    t1.machine='SIN'; t1.params=defaultParams('SIN'); setP(t1,'AMP','DIST',84); setP(t1,'AMP','DEC',100);
    seq(t1,'x.........x.......x.........x...x.........x.......x.........x...',['A1','A1','C2','E2','A1','A1','G1','E2'],{len:6});
    t2.machine='ENS'; t2.params=defaultParams('ENS'); setP(t2,'EFX','DSND',80); setP(t2,'EFX','DTIM',36); setP(t2,'EFX','DFB',85); setP(t2,'AMP','DEC',70);
    seq(t2,'......x...............x...............x...............x.........',['A2','F2','C3','G2'],{len:4});
    setLocks(t2.steps[6],{'SYN.0':64+16,'SYN.1':64+37,'SYN.2':64+53}); setLocks(t2.steps[22],{'SYN.0':64+21,'SYN.1':64+37});
    setLocks(t2.steps[38],{'SYN.0':64+21,'SYN.1':64+37}); setLocks(t2.steps[54],{'SYN.0':64+21,'SYN.1':64+37});
    t3.machine='BBOX'; t3.params=defaultParams('BBOX'); setP(t3,'EFX','DSND',30);
    seq(t3,'x...........x.......x.......x.......x...........x.......x.......',[DR('KICK2')],{len:1});
    seq(t3,'............x...............x...............x...............x...',[DR('SNARE')],{len:1});
    seq(t3,'..x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x.',[DR('HATC')],{len:1});
    t4.machine='DWAVE'; t4.params=defaultParams('DWAVE'); setP(t4,'SYN','WPM',18); setP(t4,'AMP','VOL',60); setP(t4,'EFX','DSND',55);
    seq(t4,'......................x...............x...............x.........',['A4','C5','E5'],{len:8});
    t5.machine='VO6'; t5.params=defaultParams('VO6'); setP(t5,'SYN','VOIC',60); setP(t5,'AMP','ATK',50); setP(t5,'AMP','DEC',127); setP(t5,'AMP','VOL',45);
    seq(t5,'x...............................................................',['A2'],{len:64,lockAll:{'SYN.0':100,'SYN.1':50}});
    t5.steps[0].locks['SYN.0']=100;
    t6.machine='REVERB'; t6.params=defaultParams('REVERB'); setP(t6,'SYN','DEC',110); setP(t6,'AMP','DEC',127); setP(t6,'AMP','VOL',65);
    seq(t6,'x...............................................................',[60],{len:64});
    p.kit='DUB KIT'; add(3,p);
  }
  { // A05 FMFOUNDRY
    const p=mkPattern('FMFOUNDRY'); p.bpm=118; p.swing=54;
    const [t1,t2,t3,t4,t5,t6]=p.tracks;
    t1.machine='FMDYN'; t1.params=defaultParams('FMDYN'); setP(t1,'AMP','DIST',88);
    seq(t1,'x..x....x.x.....x..x....x.x.....x..x....x.x.....x..x....x...x...',['F1','F1','G#1','F1','C2','F1','D#1','F1'],{len:3,lockAll:i=>({'SYN.6':(i*19)%110})});
    t2.machine='FMPAR'; t2.params=defaultParams('FMPAR'); setP(t2,'EFX','DSND',65); setP(t2,'EFX','DTIM',27); setP(t2,'EFX','DFB',66);
    seq(t2,'..x.....x...x.......x.....x.......x...x.....x.......x.....x...x.',['F4','G#4','C5','D#5','C5','G#4','F4','D#4'],{len:4});
    t3.machine='BBOX'; t3.params=defaultParams('BBOX');
    seq(t3,'x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...',[DR('KICK')],{len:1});
    seq(t3,'....x.......x.......x.......x.......x.......x.......x.......x...',[DR('SNAR2')],{len:1});
    seq(t3,'..x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x.',[DR('METAL'),DR('HATC')],{len:1});
    t4.machine='DDRW'; t4.params=defaultParams('DDRW'); setP(t4,'AMP','DEC',65);
    seq(t4,'......x...x.........x...x.........x...x.........x...x.......x...',['F3','G#3','C4','F3','D#3','C3'],{len:4,lockAll:i=>({'SYN.1':(i*31)%128,'SYN.4':(i*7)%50})});
    t5.machine='SID'; t5.params=defaultParams('SID'); setP(t5,'SYN','MOD',90); setP(t5,'AMP','VOL',50); setP(t5,'EFX','SRR',24);
    seq(t5,'x.x...x...x.x...x.x...x...x.x...x.x...x...x.x...x.x...x...x.x...',[60],{len:1,lockAll:i=>({'SYN.6':(i*13)%128})});
    t6.machine='FLANGER'; t6.params=defaultParams('FLANGER'); setP(t6,'AMP','DEC',127); setP(t6,'AMP','VOL',55);
    seq(t6,'x...............................................................',[60],{len:64});
    p.kit='FM KIT'; add(4,p);
  }
  { // A06 WAVESEQ — DPRO-WAVE wave-sequencing via locks
    const p=mkPattern('WAVESEQ'); p.bpm=126; p.swing=52;
    const [t1,t2,t3,t4,t5,t6]=p.tracks;
    t1.machine='DWAVE'; t1.params=defaultParams('DWAVE'); setP(t1,'AMP','DEC',55);
    seq(t1,'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.',['E3','E3','G3','E3','A3','G3','E3','D3'],{len:2,lockAll:i=>({'SYN.0':(i*8)%128,'SYN.1':(i*5)%128})});
    t2.machine='SAW'; t2.params=defaultParams('SAW'); setP(t2,'SYN','SUB1',70); setP(t2,'FILT','WDTH',70);
    seq(t2,'x.......x.......x.......x.......x.......x.......x.......x.......',['E2','E2','G2','A2','E2','E2','D2','B1'],{len:6});
    t3.machine='BBOX'; t3.params=defaultParams('BBOX');
    seq(t3,'x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...',[DR('KICK')],{len:1});
    seq(t3,'....x.......x.......x.......x.......x.......x.......x.......x...',[DR('SNARE')],{len:1});
    seq(t3,'..x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x.',[DR('HATC'),DR('HATO')],{len:1});
    t4.machine='DENS'; t4.params=defaultParams('DENS'); setP(t4,'AMP','ATK',20); setP(t4,'AMP','DEC',127); setP(t4,'AMP','VOL',60);
    seq(t4,'x...............x...............x...............x...............',['E3','C3','G3','D3'],{len:15});
    setLocks(t4.steps[0],{'SYN.0':64+16,'SYN.1':64+37,'SYN.2':64+53}); setLocks(t4.steps[16],{'SYN.0':64+21,'SYN.1':64+37});
    setLocks(t4.steps[32],{'SYN.0':64+21,'SYN.1':64+37}); setLocks(t4.steps[48],{'SYN.0':64+21,'SYN.1':64+37});
    t5.machine='FMSTAT'; t5.params=defaultParams('FMSTAT'); setP(t5,'AMP','VOL',58); setP(t5,'ARP','MODE',75);
    seq(t5,'........x...............x...............x...............x.......',['E4','G4','B4','D5'],{len:8,arp:[0,3,7]});
    t6.machine='PHASER'; t6.params=defaultParams('PHASER'); setP(t6,'AMP','DEC',127); setP(t6,'AMP','VOL',50);
    seq(t6,'x...............................................................',[60],{len:64});
    p.kit='WAVE KIT'; add(5,p);
  }
  { // A07 MINIMAL
    const p=mkPattern('MINIMAL'); p.bpm=124; p.swing=55;
    const [t1,t2,t3,t4,t5,t6]=p.tracks;
    t1.machine='BBOX'; t1.params=defaultParams('BBOX');
    seq(t1,'x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...',[DR('KICK')],{len:1});
    seq(t1,'..x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x.',[DR('HATO')],{len:1});
    seq(t1,'....x.......x.......x.......x.......x.......x.......x.......x...',[DR('RIM')],{len:1});
    t2.machine='PULS'; t2.params=defaultParams('PULS'); setP(t2,'SYN','SUB1',60); setP(t2,'FILT','WDTH',55); setP(t2,'AMP','DEC',60);
    seq(t2,'..x...x...x...x...x...x...x...x...x...x...x...x...x...x...x...x.',['G1','G1','G1','Bb1','G1','G1','F1','G1'],{len:2,lockAll:i=>({'FILT.1':45+((i*17)%55)})});
    t3.machine='SIN'; t3.params=defaultParams('SIN'); setP(t3,'EFX','DSND',70); setP(t3,'EFX','DTIM',36); setP(t3,'EFX','DFB',80); setP(t3,'AMP','DEC',50);
    seq(t3,'.......x...............x...............x...............x........',['G4','Bb4','D5','F5'],{len:2});
    t4.machine='NOIS'; t4.params=defaultParams('NOIS'); setP(t4,'AMP','DEC',22); setP(t4,'AMP','VOL',50); setP(t4,'FILT','BASE',70);
    seq(t4,'x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.x.',[84],{len:1,lockAll:i=>({'AMP.5':30+((i*9)%60)})});
    t5.machine='DWAVE'; t5.params=defaultParams('DWAVE'); setP(t5,'AMP','VOL',48);
    seq(t5,'............x...............x...............x...............x...',['G3','Bb3','D4','C4'],{len:6});
    t6.machine='DYNAMIX'; t6.params=defaultParams('DYNAMIX'); setP(t6,'SYN','INP',80); setP(t6,'AMP','DEC',127); setP(t6,'AMP','VOL',40);
    seq(t6,'x...............................................................',[60],{len:64});
    p.kit='MIN KIT'; add(6,p);
  }
  { // A08 AMBIENT — slow pads & choir-ish VO-6, 32 steps
    const p=mkPattern('AMBIENT'); p.bpm=84; p.swing=50; p.len=32;
    const [t1,t2,t3,t4,t5,t6]=p.tracks;
    t1.machine='ENS'; t1.params=defaultParams('ENS'); setP(t1,'AMP','ATK',70); setP(t1,'AMP','DEC',127); setP(t1,'AMP','REL',80); setP(t1,'AMP','VOL',66);
    seq(t1,'x...............x...............',['E3','B2'],{len:16});
    setLocks(t1.steps[0],{'SYN.0':64+16,'SYN.1':64+37,'SYN.2':64+53}); setLocks(t1.steps[16],{'SYN.0':64+21,'SYN.1':64+37,'SYN.2':64+53});
    t2.machine='VO6'; t2.params=defaultParams('VO6'); setP(t2,'AMP','ATK',55); setP(t2,'AMP','DEC',127); setP(t2,'AMP','VOL',52); setP(t2,'EFX','DSND',60); setP(t2,'EFX','DFB',70);
    seq(t2,'........x...............x.......',['E4','G4'],{len:14});
    setLocks(t2.steps[8],{'SYN.0':127,'SYN.1':60,'SYN.4':0}); setLocks(t2.steps[24],{'SYN.0':60,'SYN.1':100,'SYN.4':0});
    t3.machine='SIN'; t3.params=defaultParams('SIN'); setP(t3,'AMP','ATK',20); setP(t3,'AMP','DEC',127);
    seq(t3,'x...............x...............',['E1','B0'],{len:16});
    t4.machine='FMSTAT'; t4.params=defaultParams('FMSTAT'); setP(t4,'AMP','DEC',110); setP(t4,'AMP','VOL',45); setP(t4,'EFX','DSND',55);
    seq(t4,'....x.......x.......x.......x...',['E5','B4','G4','E4'],{len:6});
    t5.machine='DWAVE'; t5.params=defaultParams('DWAVE'); setP(t5,'SYN','WPM',10); setP(t5,'AMP','ATK',40); setP(t5,'AMP','DEC',127); setP(t5,'AMP','VOL',38);
    seq(t5,'................x...............',['E3'],{len:16});
    t6.machine='REVERB'; t6.params=defaultParams('REVERB'); setP(t6,'SYN','DEC',120); setP(t6,'AMP','DEC',127); setP(t6,'AMP','VOL',70);
    seq(t6,'x...............................',[60],{len:32});
    p.kit='AMB KIT'; add(7,p);
  }
  return P128;
}
function factoryKits(){
  const fp=factoryPatterns(); const kits=[{name:'INIT KIT', tracks:mkPattern().tracks.map(kitOfTrack)}];
  for(const k in fp){ const p=fp[k]; kits.push({name:p.kit, tracks:p.tracks.map(kitOfTrack)}); }
  return kits;
}
function kitOfTrack(tr){
  const o={machine:tr.machine, level:tr.level, out:tr.out, params:JSON.parse(JSON.stringify(tr.params))};
  if(Array.isArray(tr._hwExtra)) o._hwExtra=tr._hwExtra.slice(0,16);
  if(typeof tr._hwType==='number') o._hwType=tr._hwType;
  return o;
}
function cloneKit(k){ return k?JSON.parse(JSON.stringify(k)):null; }
function sanitizeKitName(n,fallback='KIT'){
  const s=String(n||fallback).toUpperCase().replace(/[^A-Z0-9 +#._!\/-]/g,' ').replace(/\s+/g,' ').trim();
  return (s||fallback).slice(0,14);
}

/* ---------- global state ---------- */
const S={
  patterns:{},            // idx 0..127 -> pattern (sparse, lazy)
  kits:[],
  curPat:0, queuedPat:null, selTrack:0, page:'SYN', seqPage:0,
  octave:4, gridRec:true, liveRec:false, playing:false, playStep:-1,
  lockStep:-1,            // step being p-lock edited (latched), -1 none
  selStep:0,
  masterVol:0.85, poly:false, midiOut:false, followPage:true,
  song:[], songMode:false, songPos:0, songCount:0,
  userWaves:new Array(64).fill(null), // {data:Float32Array(256), name} for DDRW/DENS slots 33-64 etc
  userSamples:{},         // BBOX idx -> AudioBuffer (not persisted raw; persisted as wav dataURL small)
  clipPat:null, clipTrack:null, clipSteps:null,
  msg:'', msgT:0,
  chain:[],
};
function pat(idx){
  idx=clamp(Math.round(+idx||0),0,127);
  if(!S.patterns[idx]){ const fp=S._factory||{}; S.patterns[idx]=fp[idx]?JSON.parse(JSON.stringify(fp[idx])):mkPattern('INIT'); }
  if(S.patterns[idx]&&!S.patterns[idx]._sanitized) S.patterns[idx]=revivePattern(S.patterns[idx]);
  return S.patterns[idx];
}
const curPat=()=>pat(S.curPat);
const curTrk=()=>curPat().tracks[S.selTrack];
const patLabel=i=>String.fromCharCode(65+Math.floor(i/16))+String((i%16)+1).padStart(2,'0');

/* ---------- persistence (+Drive-style snapshot in localStorage) ---------- */
const LS_KEY='monomachine_web_v1';
let saveTimer=null;
function saveSoon(){ clearTimeout(saveTimer); saveTimer=setTimeout(saveNow,600); }
function saveNow(){
  try{
    const pats={}; for(const k in S.patterns){ const p=S.patterns[k];
      const blank=p.name==='INIT'&&p.tracks.every(t=>t.steps.every(s=>!s.on)); if(blank) continue; // don't waste quota on untouched slots
      pats[k]=p; }
    const waves=S.userWaves.map(w=>w?{name:w.name,data:Array.from(w.data)}:null);
    localStorage.setItem(LS_KEY, JSON.stringify({patterns:pats,kits:S.kits,userWaves:waves,curPat:S.curPat,masterVol:S.masterVol,song:S.song}));
  }catch(e){/* quota */}
}
function _finiteNum(v,fallback){ const n=+v; return isFinite(n)?n:fallback; }
function _plainObj(v){ return v&&typeof v==='object'&&!Array.isArray(v)?v:{}; }
function sanitizeParams(machineId,src){
  const machine=MACH[machineId]?machineId:'SAW';
  const out=defaultParams(machine), inp=_plainObj(src);
  for(const pg of ['SYN','AMP','FILT','EFX','LFO1','LFO2','LFO3','ARP']){
    const arr=Array.isArray(inp[pg])?inp[pg]:[];
    out[pg]=out[pg].map((d,i)=>R127(_finiteNum(arr[i],d)));
  }
  return out;
}
function sanitizeStep(src){
  const st=mkStep(), inp=_plainObj(src);
  st.on=!!inp.on; st.trigless=!!inp.trigless; st.slide=!!inp.slide;
  st.note=clamp(Math.round(_finiteNum(inp.note,60)),0,127);
  st.len=clamp(_finiteNum(inp.len,2),0.25,64);
  st.vel=clamp(Math.round(_finiteNum(inp.vel,100)),1,127);
  st.prob=clamp(Math.round(_finiteNum(inp.prob,100)),1,100);
  st.rat=clamp(Math.round(_finiteNum(inp.rat,1)),1,8);
  st.mic=clamp(Math.round(_finiteNum(inp.mic,0)),-32,31);
  if(inp._edited) st._edited=true;
  if(typeof inp._ftrig==='boolean') st._ftrig=inp._ftrig;
  if(typeof inp._ltrig==='boolean') st._ltrig=inp._ltrig;
  if(Array.isArray(inp.arp)){
    const arp=inp.arp.slice(0,16).map(v=>clamp(Math.round(_finiteNum(v,0)),-24,24));
    st.arp=arp.length?arp:null;
  }
  const locks=_plainObj(inp.locks);
  for(const k in locks){
    if(/^(SYN|AMP|FILT|EFX|LFO1|LFO2|LFO3|ARP)\.[0-7]$/.test(k)) st.locks[k]=R127(_finiteNum(locks[k],64));
  }
  return st;
}
function reviveTrack(src,withSteps=true){
  const inp=_plainObj(src);
  const machine=MACH[inp.machine]?inp.machine:'SAW';
  const tr=mkTrack(machine);
  if(Array.isArray(inp._hwExtra)) tr._hwExtra=inp._hwExtra.slice(0,16).map(v=>clamp(Math.round(_finiteNum(v,0)),0,255));
  if(typeof inp._hwType==='number'&&isFinite(inp._hwType)) tr._hwType=Math.round(inp._hwType)&255;
  tr.level=R127(_finiteNum(inp.level,100));
  tr.muted=!!inp.muted;
  tr.out=inp.out==='NEIB'?'NEIB':'MAIN';
  tr.params=sanitizeParams(machine,inp.params);
  if(withSteps){
    const steps=Array.isArray(inp.steps)?inp.steps:[];
    tr.steps=Array.from({length:64},(_,i)=>sanitizeStep(steps[i]));
  }
  return tr;
}
function reviveKit(src){
  const inp=_plainObj(src);
  const srcTracks=Array.isArray(inp.tracks)?inp.tracks:[];
  const fallback=mkPattern().tracks;
  const kit={name:sanitizeKitName(inp.name,'KIT'),tracks:Array.from({length:6},(_,i)=>kitOfTrack(reviveTrack(srcTracks[i]||fallback[i],false)))};
  if(typeof inp.position==='number'&&isFinite(inp.position)) kit.position=clamp(Math.round(inp.position),0,127);
  if(inp.source) kit.source=String(inp.source).slice(0,80);
  if(inp._source) kit._source=String(inp._source).slice(0,80);
  if(typeof inp.sourcePosition==='number'&&isFinite(inp.sourcePosition)) kit.sourcePosition=clamp(Math.round(inp.sourcePosition),0,255);
  if(inp.hw&&typeof inp.hw==='object'){ try{ const hwJson=JSON.stringify(inp.hw); if(hwJson.length<65536) kit.hw=JSON.parse(hwJson); }catch(e){} }
  return kit;
}
function revivePattern(src){ // tolerate older/partial/corrupt data without taking the whole panel down
  const inp=_plainObj(src);
  if(inp._sanitized&&Array.isArray(inp.tracks)&&inp.tracks.length===6&&inp.tracks.every(t=>t&&MACH[t.machine]&&Array.isArray(t.steps)&&t.steps.length===64)) return inp;
  const base=mkPattern(typeof inp.name==='string'&&inp.name?inp.name.slice(0,24):'INIT');
  // Preserve forward-compatible/import metadata, then overwrite every core field with a validated value.
  for(const k in inp){ if(k!=='tracks'&&k!=='name'&&k!=='bpm'&&k!=='swing'&&k!=='len'&&k!=='scale'&&k!=='kit') base[k]=inp[k]; }
  base.bpm=clamp(Math.round(_finiteNum(inp.bpm,120)*10)/10,30,300);
  base.swing=clamp(Math.round(_finiteNum(inp.swing,50)),50,75);
  base.len=[16,32,48,64].includes(+inp.len)?+inp.len:64;
  base.scale=[0.75,1,1.5,2].includes(+inp.scale)?+inp.scale:1;
  base.kit=sanitizeKitName(inp.kit,'INIT KIT');
  const srcTracks=Array.isArray(inp.tracks)?inp.tracks:[];
  base.tracks=Array.from({length:6},(_,i)=>reviveTrack(srcTracks[i]||base.tracks[i],true));
  base._sanitized=true;
  return base;
}
function loadSaved(){
  S._factory=factoryPatterns();
  S.kits=factoryKits();
  S.patterns={};
  try{
    const raw=localStorage.getItem(LS_KEY); if(!raw) return;
    const d=_plainObj(JSON.parse(raw));
    if(d.patterns&&typeof d.patterns==='object'){
      for(const k in d.patterns){
        const idx=+k; if(!(idx>=0&&idx<128)) continue;
        try{ S.patterns[idx]=revivePattern(d.patterns[k]); }catch(e){/* one bad slot must not kill boot */}
      }
    }
    if(Array.isArray(d.kits)&&d.kits.length){
      const kits=[];
      for(const k of d.kits.slice(0,256)){ try{ kits.push(reviveKit(k)); }catch(e){} }
      if(kits.length) S.kits=kits;
    }
    if(Array.isArray(d.userWaves)){
      d.userWaves.slice(0,64).forEach((w,i)=>{
        if(!w||!Array.isArray(w.data)||!w.data.length) return;
        const data=Float32Array.from(w.data.slice(0,4096),v=>clamp(_finiteNum(v,0),-1,1));
        if(data.length) S.userWaves[i]={name:String(w.name||('USER '+(i+1))).slice(0,40),data};
      });
    }
    if(typeof d.curPat==='number') S.curPat=clamp(Math.round(_finiteNum(d.curPat,0)),0,127);
    if(typeof d.masterVol==='number') S.masterVol=clamp(_finiteNum(d.masterVol,0.85),0,1);
    if(Array.isArray(d.song)) S.song=d.song.slice(0,256).map(r=>({pat:clamp(Math.round(_finiteNum(r&&r.pat,0)),0,127),rep:clamp(Math.round(_finiteNum(r&&r.rep,1)),1,64)}));
  }catch(e){
    // Corrupt storage is recoverable: factory content is already installed above.
    if(window.__monoBootError) window.__monoBootError('loadSaved',e);
  }
}
function factoryReset(){ try{ localStorage.removeItem(LS_KEY); }catch(e){} S.patterns={}; S._factory=factoryPatterns(); S.kits=factoryKits(); S.curPat=0; }
