// Optional integration test. Requires Playwright + a Chromium installation.
// Start a static server first; MONO_URL defaults to http://127.0.0.1:8723.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
(async () => {
  const browser = await chromium.launch({headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']});
  try {
    const context = await browser.newContext({hasTouch:true,isMobile:true,deviceScaleFactor:1,viewport:{width:768,height:1024}});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.MONO_URL || 'http://127.0.0.1:8723');
    for (const [width,height] of [[768,1024],[1024,900],[1024,725],[1024,650],[1024,600],
      [834,1194],[1194,834],[1366,1024],[1568,725],[390,844],[844,390],[390,844],
      [844,390],[667,375],[932,430],[320,568],[375,667],[430,932]]) {
      await page.setViewportSize({width,height});
      await page.waitForTimeout(80); // allow coalesced viewport/style work
      const layout = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('#unit button')].filter(e => {
          const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';
        });
        const overlaps=[];
        for(let i=0;i<buttons.length;i++) for(let j=i+1;j<buttons.length;j++){
          const a=buttons[i].getBoundingClientRect(), b=buttons[j].getBoundingClientRect();
          if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1.5)
            overlaps.push([buttons[i].id||buttons[i].className,buttons[j].id||buttons[j].className]);
        }
        return {overlaps,appH:parseFloat(document.documentElement.style.getPropertyValue('--appH')),
          overflow:document.documentElement.scrollWidth-innerWidth};
      });
      assert.equal(layout.appH,height,`height at ${width}x${height}`);
      assert.ok(layout.overflow<=1,`horizontal overflow at ${width}x${height}: ${layout.overflow}`);
      assert.deepEqual(layout.overlaps,[],`button collisions at ${width}x${height}`);
      const last=page.locator('#trigGrid .trig').last();
      await last.scrollIntoViewIfNeeded();
      assert.ok(await last.evaluate(e=>{
        const r=e.getBoundingClientRect(), x=r.x+r.width/2,y=r.y+r.height/2;
        return e.contains(document.elementFromPoint(x,y));
      }),`last trig unreachable at ${width}x${height}`);
      console.log(`PASS layout ${width}x${height}`);
    }
    // Layout checks above exercise automatic LITE on this emulated device;
    // also run the interactive audio path with all rendering effects enabled.
    await page.evaluate(()=>applyPerfMode('full',{silent:true,reopen:false,noSave:true}));
    await page.setViewportSize({width:1024,height:725});
    await page.locator('#startBtn').click();
    await page.waitForFunction(()=>window.__monoBoot.ok);
    await page.evaluate(()=>openSheet('setup'));
    for(const name of ['RUBBER SNAP','BUBBLE POP','CHROME GLASS','HARD PLASTIC','PRESSURE HISS','LATEX FORMANT']){
      await page.getByRole('button',{name,exact:true}).click();
      await page.waitForTimeout(50);
      assert.ok(await page.evaluate(()=>AE.started&&AE.ctx.state==='running'&&AE.tracks[S.selTrack].voice),`audition ${name}`);
    }
    await page.locator('#sheetClose').click();
    await page.locator('#btnPlay').click();
    await page.waitForTimeout(150);
    await page.setViewportSize({width:768,height:1024});
    assert.ok(await page.evaluate(()=>S.playing&&AE.ctx.state==='running'),'rotation stopped playback');
    await page.locator('#btnStop').click();
    assert.equal(await page.evaluate(()=>S.playing),false);
    console.log('PASS material UI auditions, playback across rotation, STOP');
    assert.deepEqual(errors,[],'browser script errors');

    const desktop=await browser.newPage({viewport:{width:1440,height:900}});
    await desktop.goto(process.env.MONO_URL || 'http://127.0.0.1:8723');
    assert.ok(await desktop.evaluate(()=>{
      const nav=document.querySelector('.navArrows').getBoundingClientRect();
      const bank=document.querySelector('.mbGroup:nth-child(3)').getBoundingClientRect();
      return nav.right<=bank.left&&document.documentElement.style.getPropertyValue('--appH')==='';
    }),'desktop navigation or CSS height regression');
    await desktop.close();
    console.log('PASS fine-pointer desktop navigation and CSS viewport ownership');

    // Render the real synth builders offline: catch silence, NaNs, and pitch
    // sources that were scheduled but never started. No artist audio is used.
    const rendered=await page.evaluate(async()=>{
      AE.stop(); clearInterval(AE._lfoTimer); AE.started=false;
      if(AE.ctx) await AE.ctx.close();
      const result=[];
      for(const patch of MATERIAL_PATCHES){
        const sr=44100,ctx=new OfflineAudioContext(2,sr,sr); AE.ctx=ctx;
        AE.noiseBuf=ctx.createBuffer(1,sr,sr); AE.noiseBufR=ctx.createBuffer(1,sr,sr);
        const random=seededRand(187);
        for(let i=0;i<sr;i++){
          AE.noiseBuf.getChannelData(0)[i]=random()*2-1; AE.noiseBufR.getChannelData(0)[i]=random()*2-1;
        }
        AE.waves32=makeWaves32(ctx); AE.wavesClassic=makeClassicWaves(ctx); AE._w64cache={};
        const tr=mkTrack(); applyMaterialPatch(tr,patch.id);
        const v=newVoice(ctx.destination),f=mtof(patch.note),t=.01;
        BUILDERS[tr.machine](v,f,tr.params,0,patch.note,t,.8);
        if(v._fmEnv) for(const e of v._fmEnv){
          if(e.custom){e.g.gain.setValueAtTime(e.peak*e.scale*e.modHz,t);e.g.gain.setTargetAtTime(e.rest*e.scale*e.modHz,t,Math.max(.003,e.sec/3));}
          else scheduleFmEnv(e.g.gain,e.raw,e.modHz,t,e.scale||1,e.mode||'stat');
        }
        scheduleAudioPitch(v,audioPitchSpecs(tr.params,120),t);
        scheduleAmpEnv(v.out.gain,tr.params,t,.4,.8); v.startAll(t);
        const buffer=await ctx.startRendering(),data=buffer.getChannelData(0);
        let sum=0,bad=0;
        for(const x of data){if(!Number.isFinite(x))bad++;sum+=x*x;}
        result.push({id:patch.id,rms:Math.sqrt(sum/data.length),bad,nativePitch:!!v._audioPitch});
      }
      return result;
    });
    for(const sound of rendered){
      assert.equal(sound.bad,0,`${sound.id} non-finite audio`);
      assert.ok(sound.rms>.001&&sound.rms<1,`${sound.id} unexpected level: ${sound.rms}`);
      assert.equal(sound.nativePitch,['rubber','bubble','plastic','latex'].includes(sound.id));
      console.log(`PASS rendered ${sound.id}: RMS ${sound.rms.toFixed(4)}`);
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
