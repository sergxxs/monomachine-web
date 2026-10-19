/* MONOMACHINE WEB — SysEx tools
   Clean-room implementation of the published Monomachine dump framing:
   F0 00 20 3C 03 00 <command> <version> <revision> <position> <packed data>
   <checksum:2> <length:2> F7.  Dump data uses Elektron 7-bit MSB packing
   and, for kit/pattern dumps, a run-length layer underneath it.
   No Elektron code or data is included. */
'use strict';

const SX_MNM_HEADER=[0xF0,0x00,0x20,0x3C,0x03,0x00];
const SX_COMMAND_NAMES={
  0x50:'GLOBAL DUMP',0x52:'KIT DUMP',0x53:'KIT REQUEST',0x55:'SET KIT NAME',
  0x57:'LOAD PATTERN',0x58:'LOAD KIT',0x59:'SAVE KIT',0x5B:'LOAD MACHINE',
  0x5C:'SET TRACK ROUTING',0x5D:'DIGIPRO WAVE DUMP',0x5E:'DIGIPRO WAVE REQUEST',
  0x67:'PATTERN DUMP',0x69:'SONG DUMP'
};
const SX_KIT_DECODED_LEN=698;
const SX_PATTERN_DECODED_LEN=6520;

function sxHex(v,pad=2){ return '0x'+(v&0xFF).toString(16).toUpperCase().padStart(pad,'0'); }
function sxConcat(parts){
  let n=0; parts.forEach(p=>n+=p.length);
  const out=new Uint8Array(n); let o=0;
  parts.forEach(p=>{ out.set(p,o); o+=p.length; });
  return out;
}
function sxAscii(bytes,start,len,stopAtBad=true){
  let s='';
  for(let i=0;i<len;i++){
    const b=bytes[start+i];
    if(b===0) break;
    if(b<32||b>126){ if(stopAtBad) break; s+=' '; }
    else s+=String.fromCharCode(b);
  }
  return s.trim();
}
function sxAsciiStrings(u8,min=5,max=40){
  const res=[]; let cur='';
  for(let i=0;i<u8.length&&res.length<max;i++){
    const c=u8[i];
    if(c>=32&&c<127) cur+=String.fromCharCode(c);
    else { if(cur.length>=min) res.push(cur); cur=''; }
  }
  if(cur.length>=min&&res.length<max) res.push(cur);
  return res;
}
function sxIsElektron(msg){ return msg&&msg.length>=5&&msg[0]===0xF0&&msg[1]===0x00&&msg[2]===0x20&&msg[3]===0x3C; }
function sxIsMNM(msg){ return sxIsElektron(msg)&&msg.length>=7&&msg[4]===0x03; }
function sxManufacturer(msg){
  if(!msg||msg.length<2) return 'UNKNOWN';
  if(sxIsElektron(msg)) return 'ELEKTRON';
  if(msg[1]===0x7E) return 'UNIVERSAL NON-REALTIME';
  if(msg[1]===0x7F) return 'UNIVERSAL REALTIME';
  if(msg[1]===0x7D) return 'NON-COMMERCIAL / SDS';
  if(msg[1]===0x43) return 'YAMAHA';
  if(msg[1]===0x41) return 'Roland';
  if(msg[1]===0x42) return 'KORG';
  return 'MFR '+sxHex(msg[1]);
}

/* ---------- splitting .syx and SMF SysEx ---------- */
function sxSplitMessages(bytes){
  const src=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);
  const out=[]; let cur=null;
  for(let i=0;i<src.length;i++){
    const b=src[i];
    if(b===0xF0){
      if(cur&&cur.length) out.push(new Uint8Array(cur));
      cur=[0xF0];
    } else if(cur){
      if(b>=0xF8&&b<=0xFE) continue; // realtime bytes may be interleaved in captures
      cur.push(b);
      if(b===0xF7){ out.push(new Uint8Array(cur)); cur=null; }
    }
  }
  if(cur&&cur.length>1) out.push(new Uint8Array(cur));
  return out;
}
function sxReadU32(b,o){ return ((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0; }
function sxIsSMF(b){ return b&&b.length>=14&&b[0]===0x4D&&b[1]===0x54&&b[2]===0x68&&b[3]===0x64; }
function sxExtractFromSMF(bytes){
  const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);
  if(!sxIsSMF(b)) return null;
  const out=[]; let pos=8+sxReadU32(b,4);
  const readVar=(end)=>{
    let v=0;
    while(pos<end){ const x=b[pos++]; v=(v<<7)|(x&0x7F); if(!(x&0x80)) break; }
    return v;
  };
  while(pos+8<=b.length){
    const type=String.fromCharCode(b[pos],b[pos+1],b[pos+2],b[pos+3]);
    const len=sxReadU32(b,pos+4); pos+=8;
    const end=Math.min(b.length,pos+len);
    if(type==='MTrk'){
      let running=0,pending=[];
      while(pos<end){
        readVar(end); if(pos>=end) break;
        let st=b[pos], firstData=null;
        if(st<0x80){ firstData=st; st=running; pos++; }
        else { pos++; if(st<0xF0) running=st; }
        if(st===0xFF){ if(pos<end)pos++; const n=readVar(end); pos=Math.min(end,pos+n); }
        else if(st===0xF0||st===0xF7){
          const n=readVar(end), data=b.slice(pos,Math.min(end,pos+n)); pos=Math.min(end,pos+n);
          if(st===0xF0) pending=[0xF0,...data]; else if(pending.length) pending.push(...data);
          if(pending.length&&pending[pending.length-1]===0xF7){ out.push(new Uint8Array(pending)); pending=[]; }
        } else if(st>=0x80&&st<0xF0){
          const need=(st&0xF0)===0xC0||(st&0xF0)===0xD0?1:2;
          pos=Math.min(end,pos+Math.max(0,need-(firstData==null?0:1)));
        } else break;
      }
      if(pending.length>1) out.push(new Uint8Array(pending));
    }
    pos=end;
  }
  return out;
}
function sxMessagesFromFileBytes(bytes){
  const smf=sxExtractFromSMF(bytes);
  return smf&&smf.length?smf:sxSplitMessages(bytes);
}

/* ---------- Elektron dump framing / packed payload ---------- */
function sxDumpInfo(msg){
  if(!sxIsMNM(msg)||msg.length<15) return null;
  const n=msg.length;
  let sum=0; for(let i=9;i<=n-6;i++) sum=(sum+msg[i])&0x3FFF;
  const stored=((msg[n-5]&0x7F)<<7)|(msg[n-4]&0x7F);
  const lenStored=((msg[n-3]&0x7F)<<7)|(msg[n-2]&0x7F);
  return {sum,stored,checksumOk:sum===stored,lenStored,lenExpected:n-10,lengthOk:lenStored===n-10};
}
function sxMakeDecoder(bytes){
  const src=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);
  let p=0,bits=0,cnt=0,repeat=0,repeatByte=0,fail=false;
  function read(){
    if(p>=src.length){ fail=true; return 0; }
    return src[p++];
  }
  function raw8(){
    if(cnt%8===0){ bits=read(); cnt++; }
    bits=(bits<<1)&0xFF; cnt++;
    return (read()&0x7F)|(bits&0x80);
  }
  function get8(){
    while(true){
      if(repeat>0){ repeat--; return repeatByte; }
      const b=raw8(); if(fail) return 0;
      if(b&0x80){ repeat=b&0x7F; repeatByte=raw8(); if(fail)return 0; }
      else return b;
    }
  }
  function atEnd(){ return repeat===0&&(p>=src.length||((cnt%8)===0&&src.length-p===1)); }
  function get(n){ const out=new Uint8Array(n); for(let i=0;i<n;i++) out[i]=get8(); return out; }
  function get16(){ return ((get8()<<8)|get8())&0xFFFF; }
  function get32(){ return (((get16()<<16)>>>0)|get16())>>>0; }
  function rest(max=16384){
    const out=[];
    while(!atEnd()&&!fail&&out.length<max){ const b=get8(); if(!fail) out.push(b); }
    return new Uint8Array(out);
  }
  return {get8,get,get16,get32,rest,atEnd,ok:()=>!fail};
}
function sxUnpack7(bytes){
  const src=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);
  const out=[];
  for(let i=0;i<src.length;){
    const msb=src[i++];
    for(let j=0;j<7&&i<src.length;j++,i++) out.push((src[i]&0x7F)|(((msb>>(6-j))&1)<<7));
  }
  return new Uint8Array(out);
}
function sxPack7(bytes,emptyGroupAtBoundary=false){
  const src=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);
  const out=[];
  for(let i=0;i<src.length;i+=7){
    let msb=0; const group=[];
    for(let j=0;j<7&&i+j<src.length;j++){
      const b=src[i+j]&0xFF;
      if(b&0x80) msb|=1<<(6-j);
      group.push(b&0x7F);
    }
    out.push(msb,...group);
  }
  if(emptyGroupAtBoundary&&src.length%7===0) out.push(0);
  return new Uint8Array(out);
}
function sxEncodeDumpPayload(decoded){
  const src=decoded instanceof Uint8Array?decoded:new Uint8Array(decoded||[]);
  const rle=[];
  for(let i=0;i<src.length;){
    const b=src[i]; let n=1;
    while(i+n<src.length&&src[i+n]===b&&n<0x7F) n++;
    if(b<0x80&&n===1) rle.push(b);
    else rle.push(0x80|n,b);
    i+=n;
  }
  return sxPack7(new Uint8Array(rle),true);
}
function sxFrameDump(command,version,revision,positionBytes,payload){
  const msg=[...SX_MNM_HEADER,command&0x7F,version&0x7F,revision&0x7F,...positionBytes,...payload];
  let sum=0; for(let i=9;i<msg.length;i++) sum=(sum+msg[i])&0x3FFF;
  const len=msg.length-9+4;
  msg.push((sum>>7)&0x7F,sum&0x7F,(len>>7)&0x7F,len&0x7F,0xF7);
  return new Uint8Array(msg);
}
function sxBit64BE(bytes,bit){
  if(!bytes||bytes.length<8||bit<0||bit>63) return false;
  return !!((bytes[7-Math.floor(bit/8)]>>(bit%8))&1);
}
const sxS8=v=>v>127?v-256:v;

/* ---------- kit dump 0x52 ---------- */
function sxDecodeKitMessage(msg,opts={}){
  if(!sxIsMNM(msg)||msg[6]!==0x52) return {ok:false,error:'not a Monomachine kit dump'};
  if(msg.length<15) return {ok:false,error:'message too short'};
  const info=sxDumpInfo(msg);
  if(!info) return {ok:false,error:'bad dump framing'};
  if(!opts.ignoreChecksum&&!info.checksumOk) return {ok:false,error:'checksum mismatch',info};
  const version=msg[7],revision=msg[8];
  let position=msg[9],payload=10;
  const extendedPosition=version===0x40;
  if(extendedPosition){ if(msg[10]) position+=128; payload=11; }
  const d=sxMakeDecoder(msg.slice(payload,msg.length-5));
  const nameRaw=Array.from(d.get(11));
  const name=sxAscii(nameRaw,0,11)||('KIT '+String(position+1).padStart(2,'0'));
  const levels=Array.from(d.get(6));
  const allParams=Array.from(d.get(6*72));
  const models=Array.from(d.get(6));
  const types=Array.from(d.get(6));
  const unused461=d.get8();
  const patchBusIn=d.get16();
  const mirrorLR=d.get8(),mirrorUD=d.get8();
  const destPages=Array.from(d.get(72));
  const destParams=Array.from(d.get(72));
  const destRanges=Array.from(d.get(72));
  const lpKeyTrack=d.get8(),hpKeyTrack=d.get8(),trigPortamento=d.get8();
  const trigTracks=Array.from(d.get(6));
  const trigLegatoAmp=d.get8(),trigLegatoFilter=d.get8(),trigLegatoLFO=d.get8();
  const commonMultimode=d.get8(),commonTiming=d.get8(),splitKey=d.get8(),splitRange=d.get8();
  if(!d.ok()) return {ok:false,error:'packed payload ended early',info};
  const tail=Array.from(d.rest());
  if(!d.ok()) return {ok:false,error:'packed payload decode failed',info};
  let unknownModels=0,outOfRangeParams=0;
  const tracks=[];
  for(let t=0;t<6;t++){
    const params72=allParams.slice(t*72,t*72+72);
    params72.forEach(v=>{ if(v>127) outOfRangeParams++; });
    if(!MACH_BY_SX[models[t]]) unknownModels++;
    tracks.push({model:models[t],type:types[t],level:levels[t],params72});
  }
  return {
    ok:true,kind:'kit',position,version,revision,extendedPosition,name,nameRaw,tracks,
    info,unknownModels,outOfRangeParams,
    hw:{position,version,revision,extendedPosition,nameRaw,unused461,patchBusIn,mirrorLR,mirrorUD,
      destPages,destParams,destRanges,lpKeyTrack,hpKeyTrack,trigPortamento,trigTracks,
      trigLegatoAmp,trigLegatoFilter,trigLegatoLFO,commonMultimode,commonTiming,splitKey,splitRange,tail}
  };
}
function sxFxInputSource(kit,track){
  const kt=kit.tracks[track],type=kt?kt.type:0;
  const patch=kit.hw?kit.hw.patchBusIn||0:0;
  if(type&0x08){ const bus=(patch>>(2*track))&3; return bus===0?0:3+bus; }
  if(type&0x10) return (type>>6)&3;
  return 0;
}
function sxFxInputRaw(kit,track){
  const s=sxFxInputSource(kit,track);
  return s===0?0:s<=3?40:80; // app enum bins: NEIB / INP / BUS
}
function sxKitToAppKit(dec){
  const pages=['SYN','AMP','FILT','EFX','LFO1','LFO2','LFO3'];
  const tracks=dec.tracks.map((kt,t)=>{
    const machine=MACH_BY_SX[kt.model]||'GND';
    const params=defaultParams(machine);
    for(let pi=0;pi<pages.length;pi++)
      for(let i=0;i<8;i++) params[pages[pi]][i]=clamp(kt.params72[pi*8+i]||0,0,127);
    if(MACH[machine].fx) params.SYN[7]=sxFxInputRaw(dec,t);
    return {
      machine,level:clamp(kt.level||0,0,127),out:(kt.type&1)?'MAIN':'NEIB',params,
      _hwExtra:kt.params72.slice(56,72),_hwType:kt.type
    };
  });
  return {name:sanitizeKitName(dec.name,'SYX KIT').slice(0,14),tracks,hw:JSON.parse(JSON.stringify(dec.hw)),source:'sysex',sourcePosition:dec.position};
}
function sxAppKitDecodedBytes(kit){
  const hw=kit.hw||{};
  const out=[];
  const push=(...vals)=>vals.forEach(v=>out.push(v&0xFF));
  const pushArr=(a,n,fill=0)=>{ for(let i=0;i<n;i++) out.push(((a&&a[i]!=null)?a[i]:fill)&0xFF); };
  const nm=String(kit.name||'KIT').toUpperCase().slice(0,11);
  const nameRaw=new Array(11).fill(0x20);
  for(let i=0;i<nm.length;i++) nameRaw[i]=nm.charCodeAt(i)&0x7F;
  pushArr(nameRaw,11,0x20);
  const tracks=[];
  for(let t=0;t<6;t++){
    const src=(kit.tracks&&kit.tracks[t])||mkTrack('GND');
    const machine=MACH[src.machine]?src.machine:'GND';
    const params=src.params||defaultParams(machine);
    const p72=new Array(72).fill(0);
    ['SYN','AMP','FILT','EFX','LFO1','LFO2','LFO3'].forEach((pg,pi)=>{
      for(let i=0;i<8;i++) p72[pi*8+i]=clamp(Math.round((params[pg]&&params[pg][i])||0),0,127);
    });
    if(Array.isArray(src._hwExtra)) for(let i=0;i<16;i++) p72[56+i]=src._hwExtra[i]&0xFF;
    let type=typeof src._hwType==='number'?src._hwType:1;
    type&=~(0x01|0x08|0x10|0x40|0x80);
    if(src.out!=='NEIB') type|=0x01;
    if(MACH[machine].fx){
      p72[7]=64; // routing lives in the type/patch bytes on hardware
      const inpDef=MACH[machine].syn[7];
      const inp=inpDef?enumIdx(inpDef,(params.SYN&&params.SYN[7])||0):0;
      if(inp===2) type|=0x08;
      else if(inp===1||inp===3) type|=0x10|0x40|0x80;
      else type|=0x10;
    }
    tracks.push({src,machine,p72,type,level:clamp(Math.round(src.level==null?100:src.level),0,127)});
  }
  tracks.forEach(t=>push(t.level));
  tracks.forEach(t=>pushArr(t.p72,72));
  tracks.forEach(t=>push(MACH[t.machine].sx));
  tracks.forEach(t=>push(t.type));
  push(hw.unused461||0);
  let patchBusIn=hw.patchBusIn||0;
  tracks.forEach((t,i)=>{ if(MACH[t.machine].fx&&(t.type&0x08)) patchBusIn=(patchBusIn&~(3<<(2*i)))|(1<<(2*i)); });
  push((patchBusIn>>8)&0xFF,patchBusIn&0xFF,hw.mirrorLR||0,hw.mirrorUD||0);
  pushArr(hw.destPages,72); pushArr(hw.destParams,72); pushArr(hw.destRanges,72);
  push(hw.lpKeyTrack==null?0x3F:hw.lpKeyTrack,hw.hpKeyTrack==null?0x3F:hw.hpKeyTrack,hw.trigPortamento||0);
  pushArr(hw.trigTracks,6,255);
  push(hw.trigLegatoAmp||0,hw.trigLegatoFilter||0,hw.trigLegatoLFO||0,
       hw.commonMultimode||0,hw.commonTiming||0,hw.splitKey||0,hw.splitRange||0);
  if(Array.isArray(hw.tail)) pushArr(hw.tail,hw.tail.length);
  return new Uint8Array(out);
}
function sxEncodeKit(kit,position=0){
  const hw=kit.hw||{};
  const extended=!!hw.extendedPosition||position>=128;
  const version=extended?0x40:(hw.version==null?2:hw.version);
  const revision=hw.revision==null?1:hw.revision;
  const pos=extended?[position&0x7F,position>=128?1:0]:[position&0x7F];
  return sxFrameDump(0x52,version,revision,pos,sxEncodeDumpPayload(sxAppKitDecodedBytes(kit)));
}
function sxEncodeKitBank(kits){
  // Sequential slots prevent two imported files that both used slot 1 from
  // overwriting each other when the combined bank is sent back to hardware.
  return sxConcat((kits||[]).slice(0,128).map((k,i)=>sxEncodeKit(k,i)));
}

/* ---------- pattern dump 0x67 ---------- */
const SX_PATTERN_GROUPS=['amp','filter','lfo','off','midiOn','midiOff','trigless','chord','midiTrigless','slide','swing','midiSlide','midiSwing'];
function sxDecodePatternMessage(msg,opts={}){
  if(!sxIsMNM(msg)||msg[6]!==0x67) return {ok:false,error:'not a Monomachine pattern dump'};
  if(msg.length<15) return {ok:false,error:'message too short'};
  const info=sxDumpInfo(msg);
  if(!info) return {ok:false,error:'bad dump framing'};
  if(!opts.ignoreChecksum&&!info.checksumOk) return {ok:false,error:'checksum mismatch',info};
  const d=sxMakeDecoder(msg.slice(10,msg.length-5));
  const groups={};
  SX_PATTERN_GROUPS.forEach(name=>{ groups[name]=[]; for(let t=0;t<6;t++) groups[name].push(Array.from(d.get(8))); });
  const swingAmount=d.get32();
  const lockPatterns=[]; for(let t=0;t<6;t++) lockPatterns.push(Array.from(d.get(8)));
  const noteNBR=[]; for(let t=0;t<6;t++) noteNBR.push(Array.from(d.get(64)));
  const patternLength=d.get8(),doubleTempo=d.get8(),kit=d.get8(),patternTranspose=sxS8(d.get8());
  const arr6=signed=>{ const a=Array.from(d.get(6)); return signed?a.map(sxS8):a; };
  const transpose=arr6(true),scale=arr6(false),key=arr6(false),midiTranspose=arr6(true),midiScale=arr6(false),midiKey=arr6(false);
  const arpPlay=arr6(false),arpMode=arr6(false),arpOctaveRange=arr6(false),arpMultiplier=arr6(false),arpDestination=arr6(false),arpLength=arr6(false);
  const arpPattern=Array.from(d.get(96));
  const midiArpPlay=arr6(false),midiArpMode=arr6(false),midiArpOctaveRange=arr6(false),midiArpMultiplier=arr6(false),midiArpLength=arr6(false);
  const midiArpPattern=Array.from(d.get(96));
  const unused=Array.from(d.get(4));
  const midiNotesUsed=d.get16(),chordNotesUsed=d.get8(),unused2=d.get8(),locksUsed=d.get8();
  const locksRaw=[]; for(let r=0;r<62;r++) locksRaw.push(Array.from(d.get(64)));
  const midiNotes=[]; for(let i=0;i<400;i++) midiNotes.push(d.get16());
  const chordNotes=[]; for(let i=0;i<192;i++) chordNotes.push(d.get16());
  const trailing=d.get8();
  if(!d.ok()) return {ok:false,error:'packed payload ended early',info};
  const tail=Array.from(d.rest());
  if(!d.ok()) return {ok:false,error:'packed payload decode failed',info};
  return {ok:true,kind:'pattern',position:msg[9],version:msg[7],revision:msg[8],info,groups,swingAmount,
    lockPatterns,noteNBR,patternLength,doubleTempo,kit,patternTranspose,transpose,scale,key,midiTranspose,midiScale,midiKey,
    arpPlay,arpMode,arpOctaveRange,arpMultiplier,arpDestination,arpLength,arpPattern,
    midiArpPlay,midiArpMode,midiArpOctaveRange,midiArpMultiplier,midiArpLength,midiArpPattern,
    unused,midiNotesUsed,chordNotesUsed,unused2,locksUsed,locksRaw,midiNotes,chordNotes,trailing,tail};
}
function sxRawForEnum(index,count){ return clamp(Math.floor((clamp(index,0,count-1)+0.5)*128/count),0,127); }
function sxPatternToAppPattern(dec,basePattern){
  const p=mkPattern('SYX '+patLabel(clamp(dec.position||0,0,127)));
  if(basePattern){
    p.bpm=basePattern.bpm||120; p.kit=basePattern.kit||p.kit;
    if(basePattern._hwKit) p._hwKit=JSON.parse(JSON.stringify(basePattern._hwKit));
    p.tracks.forEach((tr,i)=>{
      const src=basePattern.tracks[i]; if(!src)return;
      tr.machine=src.machine; tr.level=src.level; tr.out=src.out; tr.params=JSON.parse(JSON.stringify(src.params));
      if(Array.isArray(src._hwExtra)) tr._hwExtra=src._hwExtra.slice();
      if(typeof src._hwType==='number') tr._hwType=src._hwType;
    });
  }
  const len=clamp(dec.patternLength||16,1,64);
  p.len=len; p.swing=50+clamp(dec.swingAmount||0,0,30); p.scale=dec.doubleTempo?2:1;
  p._hwKitPos=dec.kit;
  p._hwPatternMeta={position:dec.position,version:dec.version,revision:dec.revision,kit:dec.kit,doubleTempo:dec.doubleTempo,
    patternTranspose:dec.patternTranspose,transpose:dec.transpose,scale:dec.scale,key:dec.key};
  const chordMap={};
  const usedChords=clamp(dec.chordNotesUsed||0,0,dec.chordNotes.length);
  for(let i=0;i<usedChords;i++){
    const v=dec.chordNotes[i],note=(v>>9)&0x7F,t=(v>>6)&7,pos=v&0x3F;
    if(t<6) (chordMap[t+'.'+pos]=chordMap[t+'.'+pos]||[]).push(note);
  }
  const lockRow={}; let row=0;
  for(let t=0;t<6;t++) for(let param=0;param<64;param++) if(sxBit64BE(dec.lockPatterns[t],param)){
    if(row<62) lockRow[t+'.'+param]=row;
    row++;
  }
  const pages=['SYN','AMP','FILT','EFX','LFO1','LFO2','LFO3'];
  const stats={trigs:0,trigless:0,locks:0,chords:0,unsupportedLocks:0,midiNotes:clamp(dec.midiNotesUsed||0,0,400)};
  for(let t=0;t<6;t++){
    const tr=p.tracks[t];
    const trsp=(dec.patternTranspose||0)+(dec.transpose[t]||0);
    tr.params.ARP[4]=clamp(Math.round(64+trsp*2.66),0,127);
    if(dec.arpPlay[t]){
      tr.params.ARP[0]=sxRawForEnum(clamp((dec.arpMode[t]||0)+1,1,5),6);
      tr.params.ARP[2]=sxRawForEnum(clamp((dec.arpOctaveRange[t]||1)-1,0,3),4);
      tr.params.ARP[3]=clamp((dec.arpLength[t]||2)*8,0,127);
    } else tr.params.ARP[0]=0;
    for(let s=0;s<64;s++){
      const st=tr.steps[s];
      const amp=sxBit64BE(dec.groups.amp[t],s);
      const trigless=sxBit64BE(dec.groups.trigless[t],s);
      const ftrig=sxBit64BE(dec.groups.filter[t],s);
      const ltrig=sxBit64BE(dec.groups.lfo[t],s);
      if(!(amp||trigless||ftrig||ltrig)) continue;
      st.on=true; st.trigless=!amp; st._ftrig=ftrig; st._ltrig=ltrig;
      st.slide=!!(amp&&sxBit64BE(dec.groups.slide[t],s));
      const chords=chordMap[t+'.'+s];
      if(chords&&chords.length){
        const notes=[...new Set(chords)].sort((a,b)=>a-b);
        st.note=notes[0]; st.arp=notes.map(n=>n-notes[0]); st._chordNotes=notes; stats.chords++;
      } else {
        const n=dec.noteNBR[t][s];
        st.note=n<=127?n:60;
      }
      if(amp){
        stats.trigs++;
        let found=len-s;
        for(let dd=1;dd<=len;dd++){
          const idx=(s+dd)%len;
          if(sxBit64BE(dec.groups.off[t],idx)||sxBit64BE(dec.groups.amp[t],idx)){ found=dd; break; }
        }
        st.len=clamp(found,0.25,64);
      } else stats.trigless++;
      for(let param=0;param<64;param++){
        const r=lockRow[t+'.'+param]; if(r==null) continue;
        const v=dec.locksRaw[r][s];
        if(v===255) continue;
        if(param>=56||v>127){ stats.unsupportedLocks++; continue; }
        const pg=pages[Math.floor(param/8)],idx=param%8;
        if(pg==='SYN'&&!pageDef(tr,pg)[idx]){ stats.unsupportedLocks++; continue; }
        st.locks[pg+'.'+idx]=v; stats.locks++;
      }
    }
  }
  p._hwPatternStats=stats;
  return {pattern:p,stats};
}

/* ---------- DigiPRO waveform dump 0x5D ---------- */
function sxI16(hi,lo){ const u=((hi&0xFF)<<8)|(lo&0xFF); return u&0x8000?u-0x10000:u; }
function sxDecodeWaveMessage(msg){
  if(!sxIsMNM(msg)||msg[6]!==0x5D) return {ok:false,error:'not a DigiPRO waveform dump'};
  if(msg.length<7027) return {ok:false,error:'waveform dump too short ('+msg.length+'/7027)'};
  const slot=msg[9]&0x3F;
  const name=sxAscii(msg,10,4,false)||('W'+slot);
  const enc=msg.slice(14,14+7008);
  const raw=sxUnpack7(enc);
  if(raw.length<6132) return {ok:false,error:'bad 7-bit waveform payload'};
  let sum=0;
  for(let i=10;i<14;i++) sum=(sum+msg[i])&0x3FFF;
  for(let i=0;i<enc.length;i++) sum=(sum+enc[i])&0x3FFF;
  const stored=((msg[7022]&0x7F)<<7)|(msg[7023]&0x7F);
  const base=new Float32Array(1024);
  let mean=0;
  for(let i=0;i<512;i++){
    const o=i*6;
    base[i*2]=sxI16(raw[o],raw[o+1])/32768;
    base[i*2+1]=sxI16(raw[o+3],raw[o+4])/32768;
    mean+=base[i*2]+base[i*2+1];
  }
  mean/=1024;
  let peak=0;
  for(let i=0;i<1024;i++){ base[i]-=mean; peak=Math.max(peak,Math.abs(base[i])); }
  const gain=peak>0.015?Math.min(4,0.92/peak):1;
  const data=new Float32Array(256);
  for(let i=0;i<256;i++){
    let v=0; for(let j=0;j<4;j++) v+=base[i*4+j];
    data[i]=clamp(v/4*gain,-1,1);
  }
  return {ok:true,kind:'wave',slot,name,data,checksumOk:sum===stored,sum,stored,
    lenStored:((msg[7024]&0x7F)<<7)|(msg[7025]&0x7F)};
}

/* ---------- whole-file parser ---------- */
function sxParseFile(bytes,filename='file.syx',opts={}){
  const src=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);
  const fromSMF=sxIsSMF(src);
  const raws=sxMessagesFromFileBytes(src);
  const result={filename,size:src.length,fromSMF,messages:[],kits:[],patterns:[],waves:[],
    counts:{total:raws.length,elektron:0,mnm:0,kits:0,patterns:0,waves:0,globals:0,songs:0,damaged:0,unknown:0,incomplete:0},
    strings:sxAsciiStrings(src,5,24)};
  raws.forEach((raw,index)=>{
    const elektron=sxIsElektron(raw),mnm=sxIsMNM(raw);
    const complete=raw.length>1&&raw[raw.length-1]===0xF7;
    const m={index,raw,length:raw.length,complete,manufacturer:sxManufacturer(raw),elektron,mnm,
      device:elektron?raw[4]:null,command:mnm?raw[6]:null,
      commandName:mnm?(SX_COMMAND_NAMES[raw[6]]||'COMMAND '+sxHex(raw[6])):'—',
      version:mnm&&raw.length>7?raw[7]:null,revision:mnm&&raw.length>8?raw[8]:null,
      position:mnm&&raw.length>9?raw[9]:null,kitIndex:-1,patternIndex:-1,waveIndex:-1,error:null};
    if(elektron) result.counts.elektron++;
    if(mnm) result.counts.mnm++;
    if(!complete) result.counts.incomplete++;
    if(mnm&&(raw[6]===0x52||raw[6]===0x67)) m.info=sxDumpInfo(raw);
    if(mnm&&raw[6]===0x52){
      const dec=sxDecodeKitMessage(raw,opts);
      if(dec.ok){ dec.messageIndex=index; m.kitIndex=result.kits.length; result.kits.push(dec); result.counts.kits++; m.position=dec.position; }
      else { m.error=dec.error; result.counts.damaged++; }
    } else if(mnm&&raw[6]===0x67){
      const dec=sxDecodePatternMessage(raw,opts);
      if(dec.ok){ dec.messageIndex=index; m.patternIndex=result.patterns.length; result.patterns.push(dec); result.counts.patterns++; }
      else { m.error=dec.error; result.counts.damaged++; }
    } else if(mnm&&raw[6]===0x5D){
      const dec=sxDecodeWaveMessage(raw);
      if(dec.ok){ dec.messageIndex=index; m.waveIndex=result.waves.length; result.waves.push(dec); result.counts.waves++; m.info={checksumOk:dec.checksumOk}; }
      else { m.error=dec.error; result.counts.damaged++; }
    } else if(mnm&&raw[6]===0x50) result.counts.globals++;
    else if(mnm&&raw[6]===0x69) result.counts.songs++;
    else if(!mnm||!SX_COMMAND_NAMES[raw[6]]) result.counts.unknown++;
    result.messages.push(m);
  });
  result.likelyOS=(result.kits.length===0&&result.patterns.length===0&&result.waves.length===0&&
    (raws.length>100||src.length>400000)&&result.strings.some(s=>/MONOMACHINE|SFX-?60|ELEKTRON/i.test(s)));
  return result;
}
