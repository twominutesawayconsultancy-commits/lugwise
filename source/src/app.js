import { createDrum3D, FINISHES } from "./drum3d.js";

/*DSP-START*/
function fft(re, im){
  const n = re.length;
  for (let i=1,j=0;i<n;i++){ let bit=n>>1; for(;j&bit;bit>>=1) j^=bit; j^=bit; if(i<j){ let t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t; } }
  for (let len=2; len<=n; len<<=1){
    const ang = -2*Math.PI/len, wr=Math.cos(ang), wi=Math.sin(ang);
    for (let i=0;i<n;i+=len){
      let cr=1, ci=0;
      for (let k=0;k<len/2;k++){
        const a=i+k, b=a+len/2;
        const xr=re[b]*cr-im[b]*ci, xi=re[b]*ci+im[b]*cr;
        re[b]=re[a]-xr; im[b]=im[a]-xi; re[a]+=xr; im[a]+=xi;
        const t=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=t;
      }
    }
  }
}
// Finds the dominant resonance of a drum hit between lo and hi Hz.
// mode "center": prefer the lowest strong peak (the drum's fundamental).
// mode "lug": take the strongest peak (edge taps excite higher modes; consistency matters most).
function detectPitch(samples, sr, lo, hi, mode){
  const N = samples.length, P = 32768;
  const re = new Float64Array(P), im = new Float64Array(P);
  let mean=0; for (let i=0;i<N;i++) mean+=samples[i]; mean/=N;
  for (let i=0;i<N;i++){ const w=0.5-0.5*Math.cos(2*Math.PI*i/(N-1)); re[i]=(samples[i]-mean)*w; }
  fft(re, im);
  const kLo=Math.max(2,Math.ceil(lo*P/sr)), kHi=Math.min(P/2-2,Math.floor(hi*P/sr));
  const pw = new Float64Array(kHi+2);
  for (let k=kLo-1;k<=kHi+1;k++) pw[k]=re[k]*re[k]+im[k]*im[k];
  let kMax=kLo; for (let k=kLo;k<=kHi;k++) if (pw[k]>pw[kMax]) kMax=k;
  const band=[]; for (let k=kLo;k<=kHi;k++) band.push(pw[k]); band.sort((a,b)=>a-b);
  const med = band[Math.floor(band.length/2)] || 1e-12;
  if (pw[kMax] < med*30 || pw[kMax] < 1e-9) return null;
  let k = kMax;
  if (mode==='center'){
    for (let j=kLo+1;j<kMax;j++){
      if (pw[j]>=pw[kMax]*0.4 && pw[j]>=pw[j-1] && pw[j]>=pw[j+1]){ k=j; break; }
    }
  }
  const a=Math.log(pw[k-1]+1e-30), b=Math.log(pw[k]+1e-30), c=Math.log(pw[k+1]+1e-30);
  const d = (a-2*b+c)!==0 ? 0.5*(a-c)/(a-2*b+c) : 0;
  return { hz:(k+Math.max(-0.5,Math.min(0.5,d)))*sr/P, snr:pw[k]/med };
}
function synthHit(hz, sr, n, extra){
  const out=new Float32Array(n); let seed=7;
  const rnd=()=>{ seed=(seed*16807)%2147483647; return seed/2147483647-0.5; };
  const parts=[[hz,1,7]].concat(extra||[]);
  for (let i=0;i<n;i++){
    const t=i/sr; let s=0;
    for (const [f,amp,dec] of parts) s+=amp*Math.exp(-dec*t)*Math.sin(2*Math.PI*f*t);
    out[i]=0.4*s+0.02*rnd();
  }
  return out;
}
function noteOf(hz){
  const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const x=12*Math.log2(hz/440)+69, n=Math.round(x);
  return { name:names[((n%12)+12)%12]+(Math.floor(n/12)-1), cents:Math.round((x-n)*100) };
}
function median(arr){ const a=arr.filter(v=>v!=null).sort((x,y)=>x-y); if(!a.length) return null; const m=a.length>>1; return a.length%2?a[m]:(a[m-1]+a[m])/2; }
function starOrder(n){
  const half=n/2, firsts=[];
  for (let i=1;i<=half;i+=2) firsts.push(i);
  for (let i=2;i<=half;i+=2) firsts.push(i);
  const out=[]; for (const i of firsts){ out.push(i-1, i-1+half); }
  return out;
}
/*DSP-END*/

/* ---------- data ---------- */
const DRUMS = [
  {id:'snare14', type:'snare', name:'Snare', size:14, lugs:10, zones:{low:[160,190],mid:[190,230],high:[230,280]}},
  {id:'tom10', type:'tom', name:'Rack tom', size:10, lugs:6, zones:{low:[120,145],mid:[145,175],high:[175,210]}},
  {id:'tom12', type:'tom', name:'Rack tom', size:12, lugs:6, zones:{low:[100,120],mid:[120,145],high:[145,175]}},
  {id:'tom13', type:'tom', name:'Rack tom', size:13, lugs:6, zones:{low:[90,110],mid:[110,130],high:[130,155]}},
  {id:'floor14', type:'floor', name:'Floor tom', size:14, lugs:8, zones:{low:[75,90],mid:[90,110],high:[110,135]}},
  {id:'floor16', type:'floor', name:'Floor tom', size:16, lugs:8, zones:{low:[60,75],mid:[75,95],high:[95,115]}},
  {id:'kick22', type:'kick', name:'Bass drum', size:22, lugs:10, zones:{low:[45,55],mid:[55,65],high:[65,80]}},
];
const GOALS = {
  low:{label:'Low & fat', sub:'Big, punchy rock sound'},
  mid:{label:'Balanced', sub:'Round tone, works for most music'},
  high:{label:'High & open', sub:'Singing, musical jazz sound'},
};
const LEVELS = {
  touchup:{label:'Quick touch-up', sub:'It was tuned and has drifted. Before a gig, jam or session.', time:'About 2 min'},
  off:{label:'Sounds off', sub:'Heads are on and played, but it sounds dead, uneven or wobbly.', time:'About 5 min'},
  newheads:{label:'New heads on', sub:'You just fitted new heads. Rods are loose or only finger-tight.', time:'About 10 min'},
  scratch:{label:'From scratch', sub:'No heads on yet, or you want the full lesson.', time:'About 15 min'},
};
const SPACINGS = { 5:'Fourths', 4:'Major thirds', 3:'Minor thirds', 0:'Off' };
const SPACING_WORD = { 5:'a fourth', 4:'a major third', 3:'a minor third' };
const NOTE_NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const PHASES = ['Prep','Top head','Bottom head','Final check'];
const RELATIONS = {
  same:{label:'Same as the top', sub:'Even, simple, lots of sustain', r:[0.98,1.02]},
  lower:{label:'Slightly lower', sub:'Rounder tone that drops a little as it rings', r:[0.90,0.98]},
  higher:{label:'Slightly higher', sub:'Pitch bends up a little as it rings', r:[1.02,1.10]},
  tight:{label:'Tight, tighter than the top', sub:'Crisp snare wires, quick response', r:[1.10,1.60]},
};
const KICK_CHECKS = {
  top:['Press the head near each rod. It feels equally firm all the way round.',
       'No wrinkles when you press the middle of the head.',
       'Hit it with the beater: a short, punchy note, not a flappy boom. If it flaps, give every rod a quarter turn.'],
  bottom:['Set it to the same firmness as the batter by feel, or a touch looser for more boom.',
          'Port hole? A hole lets air out: punchier, shorter, easier to mic. No hole: more boom and sustain.',
          'No wrinkles near the rim.'],
};

/* ---------- state ---------- */
const S = {
  view:'home', drumId:'tom12', lugs:6, goal:'mid', finish:'wine',
  targetMode:'zone', noteMidi:null, target:null, zone:null,
  level:'off', detect:null,
  steps:[], idx:0, heads:{}, relation:'lower', skipBottom:false, refLug:null, checks:{top:[],bottom:[]},
  reading:null, history:[], mic:{on:false, err:null}, sens:'normal',
  sim:{center:null, lug:{top:[],bottom:[]}}, final:null, saved:false,
  kit:null, kitDraft:{name:'My kit', ids:['snare14','tom10','tom12','floor16','kick22'], spacing:5, keyRoot:null, minor:false},
};
const drum = () => DRUMS.find(d=>d.id===S.drumId);
const byId = id => DRUMS.find(d=>d.id===id);
const isKick = () => drum().type==='kick';
const dname = d => `${d.size}″ ${d.name.toLowerCase()}`;
function newHead(n){ return {finger:Array(n).fill(false), order:starOrder(n), pos:0, round:1, roundDone:false, lugs:Array(n).fill(null), active:0, center:null}; }
function buildSteps(level, type){
  const kick = type==='kick', full = level==='scratch', build = level==='scratch'||level==='newheads', s=[];
  if (full) s.push({id:'prep',phase:0,head:'top'});
  if (build) s.push({id:'finger',phase:1,head:'top'},{id:'tension',phase:1,head:'top'});
  if (kick) s.push({id:'kickcheck',phase:1,head:'top'}); else s.push({id:'pitch',phase:1,head:'top'},{id:'even',phase:1,head:'top'});
  s.push({id:'flip',phase:2,head:'bottom'});
  if (build) s.push({id:'finger',phase:2,head:'bottom'},{id:'tension',phase:2,head:'bottom'});
  if (kick) s.push({id:'kickcheck',phase:2,head:'bottom'}); else s.push({id:'even',phase:2,head:'bottom'},{id:'match',phase:2,head:'bottom'});
  s.push({id:'final',phase:3,head:'top'});
  return s;
}
const step = () => S.steps[S.idx];
const head = () => S.heads[step().head];

/* ---------- notes & keys ---------- */
const midiHz = m => 440*Math.pow(2,(m-69)/12);
const hzMidi = f => 12*Math.log2(f/440)+69;
const midiName = m => NOTE_NAMES[((m%12)+12)%12]+(Math.floor(m/12)-1);
function snapToKey(f, root, minor){
  const scale = minor?[0,2,3,5,7,8,10]:[0,2,4,5,7,9,11], x=hzMidi(f);
  let best=null;
  for (let m=Math.floor(x)-3;m<=Math.ceil(x)+3;m++){ if (scale.includes(((m-root)%12+12)%12) && (best==null || Math.abs(m-x)<Math.abs(best-x))) best=m; }
  return best;
}
const keyLabel = k => k.keyRoot==null ? '' : `${NOTE_NAMES[k.keyRoot]} ${k.minor?'minor':'major'}`;

/* ---------- storage ---------- */
function lsGet(k){ try{ return JSON.parse(localStorage.getItem(k)||'[]'); }catch(e){ return []; } }
function lsSet(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
const loadKit = () => lsGet('lugwise.kit'), saveKit = v => lsSet('lugwise.kit', v);
const loadKits = () => lsGet('lugwise.kits'), saveKits = v => lsSet('lugwise.kits', v);
const today = () => new Date().toLocaleDateString(undefined,{day:'numeric',month:'short'});
function savedFor(id){
  const single=loadKit().find(k=>k.drumId===id && k.center);
  if (single) return {center:single.center, date:single.date, from:'your saved drums'};
  for (const kit of loadKits()){ const d=kit.drums.find(x=>x.drumId===id && x.center); if (d) return {center:d.center, date:kit.date, from:kit.name}; }
  return null;
}

/* ---------- targets ---------- */
function kitTarget(d){
  const K=S.kit; if (!K || d.type==='kick') return null;
  if (K.saved && K.saved[d.id]){ const c=K.saved[d.id]; return {hz:c, zone:[c*0.98,c*1.02], label:`Saved ${f1(c)} Hz`, why:`Your saved tuning from ${K.name}.`}; }
  const toms=K.ids.filter(id=>['tom','floor'].includes(byId(id).type)), pos=toms.indexOf(d.id);
  let base=(d.zones[S.goal][0]+d.zones[S.goal][1])/2, why='';
  if (pos>0 && K.spacing){
    const prev=byId(toms[pos-1]), prevHz=(K.results[prev.id]&&K.results[prev.id].center) || predicted(prev);
    base=prevHz*Math.pow(2,-K.spacing/12); why=`${SPACING_WORD[K.spacing][0].toUpperCase()+SPACING_WORD[K.spacing].slice(1)} below your ${dname(prev)} (${f1(prevHz)} Hz)`;
  }
  if (K.keyRoot!=null && pos>0 && K.spacing){
    // keep the gap musical: try the chosen interval first, then the nearest neighbours, never a tritone
    const prev=byId(toms[pos-1]), prevHz=(K.results[prev.id]&&K.results[prev.id].center) || predicted(prev), pm=Math.round(hzMidi(prevHz));
    const scale=K.minor?[0,2,3,5,7,8,10]:[0,2,4,5,7,9,11], names={2:'a whole step',3:'a minor third',4:'a major third',5:'a fourth',7:'a fifth'};
    const tries=[K.spacing,K.spacing-1,K.spacing+1,K.spacing-2,K.spacing+2].filter(x=>x>=2&&x!==6&&x<=7);
    const semis=tries.find(x=>scale.includes(((pm-x-K.keyRoot)%12+12)%12)) ?? K.spacing;
    base=midiHz(pm-semis); why=`${names[semis]?names[semis][0].toUpperCase()+names[semis].slice(1):semis+' semitones'} below your ${dname(prev)} (${f1(prevHz)} Hz)${semis!==K.spacing?`, the closest gap that stays in ${keyLabel(K)}`:`, in ${keyLabel(K)}`}`;
  }
  else if (K.keyRoot!=null){ const m=snapToKey(base, K.keyRoot, K.minor); base=midiHz(m); why=(why?why+', nearest':'Nearest')+` note in ${keyLabel(K)}`; }
  else if (!(pos>0 && K.spacing)) return null;
  const unusual = base<d.zones.low[0]*0.85 || base>d.zones.high[1]*1.15;
  return {hz:base, zone:[base*0.985,base*1.015], label:midiName(Math.round(hzMidi(base))), why:why+'.'+(unusual?' That is unusual for this drum size, so trust your ears if it sounds wrong.':'')};
}
function predicted(d){ const t=kitTarget(d); return t?t.hz:(d.zones[S.goal][0]+d.zones[S.goal][1])/2; }
function computeTarget(){
  const d=drum();
  if (d.type==='kick') return {hz:null, zone:d.zones[S.goal].slice(), label:'By feel', why:''};
  const kt=kitTarget(d); if (kt) return kt;
  if (!S.kit && S.targetMode==='note' && S.noteMidi!=null){ const f=midiHz(S.noteMidi); return {hz:f, zone:[f*0.985,f*1.015], label:midiName(S.noteMidi), why:'The exact note you picked.'}; }
  if (!S.kit && S.targetMode==='saved'){ const sv=savedFor(d.id); if (sv) return {hz:sv.center, zone:[sv.center*0.98,sv.center*1.02], label:`Saved ${f1(sv.center)} Hz`, why:`Your saved tuning from ${sv.date}.`}; }
  const z=d.zones[S.goal]; return {hz:(z[0]+z[1])/2, zone:z.slice(), label:GOALS[S.goal].label, why:'', isZone:true};
}

/* ---------- audio ---------- */
const A = { ctx:null, stream:null, node:null, ring:null, w:0, total:0, floor:0.002, state:'idle', captureFrom:0, until:0, muteUntil:0, out:null };
const CAP = 8192;
const SENS = { quiet:[3.5,0.004], normal:[5,0.01], noisy:[8,0.03] };
async function startMic(){
  try{
    A.stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  }catch(e){
    S.mic.err = 'Microphone is blocked. Allow mic access for this page in your browser (the icon in the address bar), then press Start listening again.';
    render(); return;
  }
  A.ctx = new (window.AudioContext||window.webkitAudioContext)();
  const src = A.ctx.createMediaStreamSource(A.stream);
  A.node = A.ctx.createScriptProcessor(2048,1,1);
  const mute = A.ctx.createGain(); mute.gain.value=0;
  src.connect(A.node); A.node.connect(mute); mute.connect(A.ctx.destination);
  A.ring = new Float32Array(A.ctx.sampleRate*2); A.w=0; A.total=0; A.state='idle';
  A.node.onaudioprocess = onAudio;
  S.mic.on=true; S.mic.err=null; render();
}
function stopMic(){
  if (A.stream) A.stream.getTracks().forEach(t=>t.stop());
  if (A.ctx) A.ctx.close();
  A.ctx=null; A.stream=null; S.mic.on=false; render();
}
function onAudio(ev){
  const x = ev.inputBuffer.getChannelData(0), sr=A.ctx.sampleRate, L=A.ring.length;
  let sum=0, firstLoud=-1;
  const [mult,minAbs]=SENS[S.sens]; const thr=Math.max(A.floor*mult, minAbs);
  for (let i=0;i<x.length;i++){ const v=x[i]; A.ring[(A.w+i)%L]=v; sum+=v*v; if(firstLoud<0 && Math.abs(v)>thr*2.2) firstLoud=i; }
  const startAbs=A.total; A.w=(A.w+x.length)%L; A.total+=x.length;
  const rms=Math.sqrt(sum/x.length);
  const m=document.getElementById('meterfill'); if(m) m.style.width=Math.min(100,rms*600)+'%';
  if (performance.now()<A.muteUntil){ A.state='idle'; return; }   // our own reference tone is playing
  if (A.state==='idle'){
    if (A.total>A.until && rms>thr && firstLoud>=0){
      A.state='cap'; A.captureFrom = startAbs+firstLoud+Math.round(0.02*sr);
    } else A.floor = A.floor*0.95 + rms*0.05;
  }
  if (A.state==='cap' && A.total>=A.captureFrom+CAP){
    const buf=new Float32Array(CAP), off=A.total-A.captureFrom;
    for (let i=0;i<CAP;i++) buf[i]=A.ring[((A.w-off+i)%L+L)%L];
    A.state='idle'; A.until=A.captureFrom+CAP+Math.round(0.12*sr);
    handleHit(buf, sr);
  }
}
// Reference tone: the note plus its harmonics, so small phone speakers still carry the pitch.
function playTone(hz){
  if (!hz) return;
  const ctx = A.ctx || A.out || (A.out = new (window.AudioContext||window.webkitAudioContext)());
  if (ctx.state==='suspended') ctx.resume();
  const t=ctx.currentTime, dur=1.8, master=ctx.createGain();
  master.gain.setValueAtTime(0.0001,t); master.gain.exponentialRampToValueAtTime(0.5,t+0.02); master.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  master.connect(ctx.destination);
  for (let h=1;h<=6;h++){ const o=ctx.createOscillator(), g=ctx.createGain(); o.frequency.value=hz*h; g.gain.value=0.35/Math.pow(h,1.1); o.connect(g); g.connect(master); o.start(t); o.stop(t+dur); }
  A.muteUntil = performance.now()+dur*1000+250;
}

/* ---------- hits ---------- */
function listenMode(){
  if (S.view==='quick' || S.view==='level') return 'center';
  if (S.view!=='guide') return null;
  const st=step(); if(!st) return null;
  if (st.id==='pitch'||st.id==='final'||st.id==='kickcheck') return 'center';
  if (st.id==='even' && head().active>=0) return 'lug';
  return null;
}
function handleHit(buf, sr){
  const mode=listenMode();
  if (!mode) return;
  let lo, hi;
  if (mode==='center'){
    if (S.view==='quick'){ lo=45; hi=600; }
    else if (isKick()){ lo=32; hi=180; }
    else { const z=S.zone||drum().zones.mid; lo=Math.max(40,z[0]*0.5); hi=Math.min(700,z[1]*1.8); }
  } else {
    const ref=median(head().lugs);
    if (ref){ lo=ref*0.8; hi=ref*1.25; } else { lo=50; hi=900; }
  }
  const r=detectPitch(buf, sr, lo, hi, mode);
  if (S.view==='level'){ detectLevel(r); return; }
  if (!r){ toast("Didn't catch a clear note. Hit once more, a little firmer."); return; }
  ripple(mode);
  if (S.view==='quick'){ S.reading=r.hz; S.history.unshift(r.hz); S.history=S.history.slice(0,10); render(); return; }
  const st=step();
  if (st.id==='pitch' || st.id==='kickcheck'){ S.reading=r.hz; head().center=r.hz; }
  else if (st.id==='final'){ S.reading=r.hz; S.final=r.hz; }
  else if (st.id==='even'){
    const h=head(); h.lugs[h.active]=r.hz;
    const nxt=h.lugs.findIndex((v,i)=>v==null && i!==h.active);
    h.active = h.lugs.some(v=>v==null) ? (nxt>=0?nxt:-1) : -1;
  }
  render();
}
// "Not sure? Hit the drum": a guess, which the player can override.
function detectLevel(r){
  if (DRUM) DRUM.hit('center');
  const t=S.target;
  if (!r){ S.detect={hz:null, level:'newheads', why:'No clear note came through. That usually means the head is slack, so start by bringing it up to tension.'}; }
  else {
    const z=t.zone, near = r.hz>=z[0]*0.92 && r.hz<=z[1]*1.08;
    S.detect = near ? {hz:r.hz, level:'touchup', why:`It already has a clear note (${f1(r.hz)} Hz) close to your target. A touch-up should do.`}
                    : {hz:r.hz, level:'off', why:`It has a clear note (${f1(r.hz)} Hz) but it's away from your target. Start by setting the note.`};
    if (isKick()) S.detect = {hz:r.hz, level:'off', why:`The kick has a clear note (${f1(r.hz)} Hz), so the heads are up to tension. Start with the feel check.`};
  }
  S.level=S.detect.level; render();
}
function simulateHit(){
  const mode=listenMode(); if(!mode) return;
  const sr=48000, z=S.zone||drum().zones.mid, mid=(z[0]+z[1])/2;
  let hz, extra;
  if (mode==='center'){
    if (S.view==='quick') hz = 80+Math.random()*140;
    else if (S.view==='level') hz = mid*(0.9+Math.random()*0.2);
    else if (step().id==='final') hz = mid*(1+(Math.random()-0.5)*0.02);
    else { S.sim.center = S.sim.center==null ? mid*(0.82+Math.random()*0.08) : S.sim.center+(mid-S.sim.center)*0.6+(Math.random()-0.5)*0.6; hz=S.sim.center; }
    extra=[[hz*1.59,0.45,11],[hz*2.14,0.25,14]];
  } else {
    const h=head(), which=step().head, arr=S.sim.lug[which];
    const base = which==='top' ? (S.sim.center||mid)*1.55 : (S.sim.center||mid)*1.55*({same:1,lower:0.94,higher:1.06,tight:1.25}[S.relation]||1)*0.97;
    if (arr[h.active]==null) arr[h.active]=(Math.random()-0.5)*10; else arr[h.active]*=0.25;
    hz = base+arr[h.active]; extra=[[hz/1.59,0.25,9],[hz*1.35,0.3,13]];
  }
  handleHit(synthHit(hz, sr, CAP, extra), sr);
}
function ripple(mode){
  if (DRUM){ DRUM.hit(mode==='lug'&&S.view==='guide' ? head().active : 'center'); return; }
  const svg=document.querySelector('svg.ring'); if(!svg) return;
  let x=190,y=190;
  if (mode==='lug' && S.view==='guide'){ const h=head(), n=S.lugs, a=(90+h.active*360/n)*Math.PI/180; x=190+100*Math.cos(a); y=190+100*Math.sin(a); }
  const c=document.createElementNS('http://www.w3.org/2000/svg','circle');
  c.setAttribute('cx',x); c.setAttribute('cy',y); c.setAttribute('r',16); c.setAttribute('class','ripple');
  svg.appendChild(c); setTimeout(()=>c.remove(),800);
}

/* ---------- ui helpers ---------- */
let toastT;
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); }
const esc = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f1 = v => v.toFixed(1);
const sgn = v => (v>0?'+':v<0?'−':'±')+Math.abs(v).toFixed(1);
const logo = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="#F1EFE9" stroke="#8E97A6" stroke-width="2"/>${[0,1,2,3,4,5].map(i=>{const a=(-90+i*60)*Math.PI/180;return `<circle cx="${16+14*Math.cos(a)}" cy="${16+14*Math.sin(a)}" r="2.6" fill="${i===0?'#E4A944':'#C9CFD9'}"/>`}).join('')}<circle cx="16" cy="16" r="3" fill="#E4A944"/></svg>`;
const playIcon = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';
const toneBtn = (hz, label) => hz?`<button class="tone" data-tone="${hz.toFixed(2)}">${playIcon}${label}</button>`:'';

function ringSVG(opts){
  const n=opts.n, cx=190, cy=190;
  let s=`<svg class="ring" viewBox="-24 -8 428 396" role="img" aria-label="${esc(opts.label||'Drum, seen from above')}">
  <defs>
    <radialGradient id="headg" cx="45%" cy="40%" r="70%"><stop offset="0" stop-color="var(--head-1)"/><stop offset="1" stop-color="var(--head-2)"/></radialGradient>
    <radialGradient id="chrome" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="var(--chrome-1)"/><stop offset="1" stop-color="var(--chrome-2)"/></radialGradient>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="131" fill="none" stroke="#3A4356" stroke-width="10"/>
  <circle cx="${cx}" cy="${cy}" r="124" fill="url(#headg)" stroke="#B9BFCA" stroke-width="5"/>
  <circle cx="${cx}" cy="${cy}" r="112" fill="none" stroke="#C8C3B7" stroke-width="1"/>`;
  if (opts.star && opts.star.length>1){
    const pts=opts.star.map(i=>{const a=(90+i*360/n)*Math.PI/180;return `${cx+100*Math.cos(a)},${cy+100*Math.sin(a)}`;}).join(' ');
    s+=`<polyline class="star" points="${pts}"/>`;
  }
  if (opts.center) s+=`<circle class="target p" cx="${cx}" cy="${cy}" r="18"/><circle class="target" cx="${cx}" cy="${cy}" r="6" fill="var(--brass)"/>`;
  if (opts.tapAt!=null && opts.tapAt>=0){
    const a=(90+opts.tapAt*360/n)*Math.PI/180, x=cx+100*Math.cos(a), y=cy+100*Math.sin(a);
    s+=`<circle class="target p" cx="${x}" cy="${y}" r="14"/><circle class="target" cx="${x}" cy="${y}" r="5" fill="var(--brass)"/>`;
  }
  for (let i=0;i<n;i++){
    const a=(90+i*360/n)*Math.PI/180, x=cx+150*Math.cos(a), y=cy+150*Math.sin(a);
    const cls=(opts.cls&&opts.cls[i])||'';
    s+=`<g class="lug ${cls}" data-lug="${i}" tabindex="${opts.tappable?0:-1}" role="${opts.tappable?'button':'img'}" aria-label="Lug ${i+1}">
      <circle class="halo" cx="${x}" cy="${y}" r="17"/><circle class="body" cx="${x}" cy="${y}" r="17"/>
      <text x="${x}" y="${y+5}" text-anchor="middle">${i+1}</text></g>`;
    if (opts.diff && opts.diff[i]){
      const rr=180+16*Math.abs(Math.cos(a)), lx=cx+rr*Math.cos(a), ly=cy+rr*Math.sin(a)+4;
      s+=`<text class="difftxt" x="${lx}" y="${ly}" text-anchor="middle" fill="${opts.diff[i].c}">${opts.diff[i].t}</text>`;
    }
  }
  return s+'</svg>';
}

let DRUM=null, PENDING=null;
function stage(o){
  const side = o.side || (S.view==='guide' ? step().head : 'top');
  if (!DRUM) return ringSVG(o);
  PENDING = {view:o.view||'top', side, states:o.cls||[], diffs:o.diff||[], star:o.star||null,
    target: o.center?'center':(o.tapAt!=null&&o.tapAt>=0?o.tapAt:null), key:o.key||null};
  return `<div id="drumslot" class="slot v-${PENDING.view}"></div>`;
}
function dialSVG(hz, z){
  const lo=z[0]*0.7, hi=z[1]*1.3, X=v=>20+260*Math.max(0,Math.min(1,(v-lo)/(hi-lo)));
  let s=`<svg class="dial" viewBox="0 0 300 54" aria-hidden="true">
    <rect x="20" y="16" width="260" height="10" rx="5" fill="var(--line)"/>
    <rect x="${X(z[0])}" y="16" width="${Math.max(4,X(z[1])-X(z[0]))}" height="10" rx="5" fill="color-mix(in srgb, var(--ok) 55%, transparent)"/>
    <text x="${X(z[0])-(z[1]/z[0]<1.05?12:0)}" y="44" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" fill="var(--muted)">${Math.round(z[0])}</text>
    <text x="${X(z[1])+(z[1]/z[0]<1.05?12:0)}" y="44" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" fill="var(--muted)">${Math.round(z[1])}</text>`;
  if (hz) s+=`<line x1="${X(hz)}" x2="${X(hz)}" y1="6" y2="36" stroke="var(--fg)" stroke-width="3" stroke-linecap="round"/><circle cx="${X(hz)}" cy="6" r="4" fill="var(--fg)"/>`;
  return s+'</svg>';
}
function turnAmount(pct){ pct=Math.abs(pct); return pct>0.15?'about half a turn':pct>0.06?'about a quarter turn':'a small nudge (an eighth of a turn)'; }
function zoneVerdict(hz, t){
  const z=t.zone;
  if (hz<z[0]) return {cls:'low', label:'Too low', advice:`Tighten every rod ${turnAmount((z[0]-hz)/hz)}, in the star pattern. Then hit the centre again.`};
  if (hz>z[1]) return {cls:'high', label:'Too high', advice:`Loosen every rod ${turnAmount((hz-z[1])/hz)}, in the star pattern. Then hit the centre again.`};
  return {cls:'ok', label:t.isZone?'In your zone':'On target', advice:t.isZone?'That\'s in your zone. Small moves inside the green band are taste, so use your ears.':'Spot on. That\'s your target note.'};
}
function listenBlock(){
  if (!S.mic.on) return `<div class="readout">
      <p>The app needs to hear the drum. Hold your phone or laptop near the drum, then:</p>
      <button class="btn" data-act="mic">Start listening</button>
      ${S.mic.err?`<p class="pill high" style="white-space:normal">${esc(S.mic.err)}</p>`:''}
      <p class="sim">No drum handy? <button class="link" data-act="sim">Simulate a hit</button> to try the app.</p></div>`;
  return '';
}
function simLine(){ return S.mic.on?`<p class="sim">Testing without a drum? <button class="link" data-act="sim">Simulate a hit</button></p>`:''; }
function targetLine(t){
  if (!t || isKick()) return '';
  return `<div class="targetline"><span class="eyebrow">Target</span><b>${esc(t.label)}</b><span class="mono muted">${t.isZone?`${Math.round(t.zone[0])}–${Math.round(t.zone[1])} Hz`:`${f1(t.hz)} Hz`}</span>${toneBtn(t.hz, t.isZone?'Hear the middle':'Hear it')}</div>${t.why?`<p class="why">${esc(t.why)}</p>`:''}`;
}

/* ---------- views ---------- */
function topbar(inner){
  return `<div class="bar"><button class="brand" data-act="home" aria-label="Lugwise home">${logo}<span>Lugwise</span></button>${inner||''}<span class="spacer"></span>
  <button class="mic ${S.mic.on?'on':''}" data-act="${S.mic.on?'micoff':'mic'}" aria-label="${S.mic.on?'Stop listening':'Start listening'}"><span class="dot"></span>${S.mic.on?'Listening':'Mic off'}<span class="meter"><i id="meterfill"></i></span></button></div>`;
}
function kitChip(){ if (!S.kit) return ''; return `<span class="chip">${esc(S.kit.name)} · drum ${S.kit.idx+1} of ${S.kit.ids.length}</span>`; }
function noteChoices(d){
  const lo=Math.ceil(hzMidi(d.zones.low[0]*0.92)), hi=Math.floor(hzMidi(d.zones.high[1]*1.08)), out=[];
  for (let m=lo;m<=hi;m++) out.push(m);
  return out;
}
function targetSection(d){
  if (d.type==='kick') return `<section class="section"><h2>What sound are you after?</h2>
    <p class="muted">Bass drums are tuned mostly by feel, for punch rather than a note. Lugwise walks you through the feel checks and shows the note just for reference.</p></section>`;
  const sv=savedFor(d.id);
  const tabs=[['zone','A sound I like'],['note','An exact note'],['saved','My saved tuning']];
  let body='';
  if (S.targetMode==='zone') body=`<div class="goals">${Object.entries(GOALS).map(([k,g])=>`<button class="pick" data-goal="${k}" aria-pressed="${k===S.goal}"><b style="font-size:17px">${g.label}</b><span>${g.sub}</span><span class="mono">${d.zones[k][0]}–${d.zones[k][1]} Hz centre note</span></button>`).join('')}</div>
    <p class="muted" style="font-size:13px;margin-top:10px">These ranges are starting points for a ${dname(d)}. Your ears have the final say.</p>`;
  if (S.targetMode==='note'){
    const notes=noteChoices(d); if (S.noteMidi==null || !notes.includes(S.noteMidi)) S.noteMidi=Math.round(hzMidi((d.zones.mid[0]+d.zones.mid[1])/2));
    body=`<div class="notes">${notes.map(m=>`<button class="notechip" data-note="${m}" aria-pressed="${m===S.noteMidi}"><b>${midiName(m)}</b><span>${f1(midiHz(m))}</span></button>`).join('')}</div>
    <div class="row" style="margin-top:12px;align-items:center">${toneBtn(midiHz(S.noteMidi), `Hear ${midiName(S.noteMidi)}`)}<span class="muted" style="font-size:13px">Notes that suit a ${dname(d)}. Pick one that fits your song.</span></div>`;
  }
  if (S.targetMode==='saved') body = sv ? `<div class="readout"><div class="hzline"><span class="hzbig">${f1(sv.center)}</span><span class="hzunit">Hz</span><span class="note">${noteOf(sv.center).name}</span></div><p class="muted">Saved ${esc(sv.date)}${sv.from!=='your saved drums'?` in ${esc(sv.from)}`:''}. Lugwise will tune back to this.</p>${toneBtn(sv.center,'Hear it')}</div>`
    : `<p class="muted">Nothing saved for a ${dname(d)} yet. Finish a tuning and press Save, and it will show up here.</p>`;
  return `<section class="section"><h2>What sound are you after?</h2>
    <div class="seg tabs" role="group" aria-label="How to set the target">${tabs.map(([k,l])=>`<button data-tmode="${k}" aria-pressed="${S.targetMode===k}">${l}</button>`).join('')}</div>
    <div style="margin-top:14px">${body}</div></section>`;
}
function renderHome(){
  const d=drum(), kit=loadKit(), kits=loadKits();
  return topbar() + `
  <section class="hero">
    <div><p class="eyebrow">Drum tuner · snare, toms & kick</p>
      <h1>Tune your drums one step at a time.</h1>
      <p>Pick a drum and the sound you want. Lugwise starts where your drum is, listens to each hit and tells you which rod to turn. Tune one drum, or the whole kit so the toms sit together.</p>
      <div class="row" style="margin-top:20px"><button class="btn big" data-act="start">Tune one drum</button><button class="btn ghost big" data-act="kitsetup">Tune my whole kit</button></div></div>
    <div class="art"><span class="bgword" aria-hidden="true">TUNE</span>${stage({n:S.lugs, view:'hero'})}${DRUM?'<p class="hint">Drag to spin</p>':''}</div>
  </section>
  ${kits.length?`<section class="section"><h2>My kits</h2><div class="kit">${kits.map((k,i)=>`<div class="kititem"><span class="name">${esc(k.name)}<br><span class="muted" style="font-size:13px">${k.drums.map(x=>`${x.size}″ ${x.center?f1(x.center):'feel'}`).join(' · ')} · saved ${esc(k.date)}</span></span><button class="btn ghost" data-kitretune="${i}">Re-tune this kit</button><button class="link" data-kitdel="${i}">Remove</button></div>`).join('')}</div></section>`:''}
  <section class="section"><h2>What are you tuning?</h2>
    <div class="grid">${DRUMS.map(x=>`<button class="pick" data-drum="${x.id}" aria-pressed="${x.id===S.drumId}"><b>${x.size}″</b><span>${x.name} · ${x.lugs} lugs</span></button>`).join('')}</div>
  </section>
  <section class="section"><h2>How many tension rods on the top head?</h2>
    <div class="seg" role="group" aria-label="Number of lugs">${[6,8,10,12].map(n=>`<button data-lugs="${n}" aria-pressed="${n===S.lugs}">${n}</button>`).join('')}</div>
  </section>
  ${targetSection(d)}
  <section class="section"><h2>Shell finish</h2>
    <div class="swatches" role="group" aria-label="Shell finish">${Object.entries(FINISHES).map(([k,f])=>`<button class="swatch" data-finish="${k}" aria-pressed="${k===S.finish}"><i style="background:${f.swatch}"></i>${f.label}</button>`).join('')}</div>
    <p class="muted" style="font-size:13px;margin-top:10px">Just for looks, so the drum on screen matches yours.</p>
  </section>
  <div class="startbar"><button class="btn big" data-act="start">Tune the ${dname(d)}</button><button class="btn ghost big" data-act="quick">Quick tuner</button></div>
  ${kit.length?`<section class="section"><h2>Saved drums</h2><div class="kit">${kit.map((k,i)=>`<div class="kititem"><span class="name">${k.size}″ ${esc(k.name.toLowerCase())}<br><span class="muted" style="font-size:13px">saved ${esc(k.date)}</span></span><span class="hz">${k.center?f1(k.center)+' Hz':'By feel'}</span><button class="btn ghost" data-retune="${i}">Re-tune to this</button><button class="link" data-del="${i}">Remove</button></div>`).join('')}</div></section>`:''}`;
}
function renderLevel(){
  const d=drum(), t=S.target, dt=S.detect;
  return topbar(`${kitChip()}<span class="chip">${dname(d)} · ${S.lugs} lugs</span>`) + `
  <div class="stage"><div class="ringbox">${stage({n:S.lugs, center:true, side:'top'})}<p class="ringcap">Not sure? Hit the centre once and Lugwise will suggest where to start.</p></div>
  <div class="card"><p class="eyebrow">${S.kit?`${esc(S.kit.name)} · ${dname(d)}`:'Before we start'}</p><h2>Where are you starting?</h2>
    <div class="levels">${Object.entries(LEVELS).map(([k,l])=>`<button class="choice lvl" data-level="${k}" aria-pressed="${S.level===k}"><b>${l.label}${dt&&dt.level===k?' <span class="pill ok">Suggested</span>':''}</b><span>${l.sub}</span><span class="mono time">${l.time}</span></button>`).join('')}</div>
    <div class="readout"><p class="eyebrow">Not sure? Hit the drum</p>
      ${dt?`<p class="advice">${esc(dt.why)}</p>`:`<p class="muted">Hit the centre of the top head once, softly. Lugwise listens and suggests a starting point. You can still pick any of them.</p>`}
      ${S.mic.on?(dt?'':`<div class="waiting"><span class="pulse"></span>Listening…</div>`):`<div class="row"><button class="btn ghost" data-act="mic">Start listening</button></div>`}
      ${S.mic.err?`<p class="pill high" style="white-space:normal">${esc(S.mic.err)}</p>`:''}
      <p class="sim">No drum handy? <button class="link" data-act="sim">Simulate a hit</button></p></div>
    ${targetLine(t)}
    <div class="navrow"><button class="btn ghost" data-act="${S.kit?'kitsetup':'home'}">Back</button><button class="btn" data-act="golevel">Start: ${LEVELS[S.level].label.toLowerCase()}</button></div>
  </div></div>`;
}
function renderKitSetup(){
  const K=S.kitDraft, ids=DRUMS.filter(d=>K.ids.includes(d.id)).map(d=>d.id);
  const prevKit={...K, ids, results:{}, idx:0, name:K.name}; const keep=S.kit; S.kit=prevKit;
  const rows=ids.map(id=>{ const d=byId(id); const t=d.type==='kick'?null:(kitTarget(d)); const z=d.zones[S.goal];
    return `<li><span class="n">${d.size}″</span><span style="flex:1">${d.name}</span><span class="mono">${d.type==='kick'?'By feel':t?`${t.label} · ${f1(t.hz)} Hz`:`${z[0]}–${z[1]} Hz`}</span></li>`; }).join('');
  S.kit=keep;
  return topbar(`<span class="chip">Whole kit</span>`) + `
  <div class="kitsetup">
  <div class="card"><p class="eyebrow">Tune my whole kit</p><h2>Set up your kit</h2>
    <label class="field"><span>Kit name</span><input id="kitname" value="${esc(K.name)}" maxlength="40"></label>
    <div><p class="eyebrow" style="margin-bottom:8px">Drums in your kit</p>
      <div class="grid">${DRUMS.map(x=>`<button class="pick" data-kitdrum="${x.id}" aria-pressed="${K.ids.includes(x.id)}"><b>${x.size}″</b><span>${x.name}</span></button>`).join('')}</div></div>
    <div><p class="eyebrow" style="margin-bottom:8px">Overall sound</p>
      <div class="seg" role="group">${Object.entries(GOALS).map(([k,g])=>`<button data-goal="${k}" aria-pressed="${S.goal===k}">${g.label}</button>`).join('')}</div></div>
    <div><p class="eyebrow" style="margin-bottom:8px">Space the toms by</p>
      <div class="seg" role="group">${[5,4,3,0].map(k=>`<button data-spacing="${k}" aria-pressed="${K.spacing===k}">${SPACINGS[k]}</button>`).join('')}</div>
      <p class="muted" style="font-size:13px;margin-top:8px">After the highest tom, each lower tom is tuned this far below the one above it. Fourths sound open and classic; thirds sit closer together. Many players tune by ear instead, so Off is fine too.</p></div>
    <div><p class="eyebrow" style="margin-bottom:8px">Fit a song key (optional)</p>
      <div class="row" style="align-items:center"><select id="keyroot" aria-label="Song key"><option value="">No key</option>${NOTE_NAMES.map((n,i)=>`<option value="${i}" ${K.keyRoot===i?'selected':''}>${n}</option>`).join('')}</select>
      <div class="seg" role="group">${[[false,'Major'],[true,'Minor']].map(([v,l])=>`<button data-minor="${v}" aria-pressed="${K.minor===v}" ${K.keyRoot==null?'disabled':''}>${l}</button>`).join('')}</div></div>
      <p class="muted" style="font-size:13px;margin-top:8px">The snare and toms snap to the nearest note in the key, so they don't clash with the song.</p></div>
  </div>
  <div class="card"><p class="eyebrow">Order and targets</p><h2>Your plan</h2>
    <ul class="list plan">${rows||'<li>Pick at least one drum.</li>'}</ul>
    <p class="muted" style="font-size:13px">Lower toms are worked out from what you actually tune the higher ones to, so these numbers update as you go.</p>
    <div class="navrow"><button class="btn ghost" data-act="home">Back</button><button class="btn" data-act="kitstart" ${ids.length?'':'disabled'}>Start with the ${ids.length?dname(byId(ids[0])):'kit'}</button></div>
  </div></div>`;
}
function renderKitDone(){
  const K=S.kit; const toms=K.ids.filter(id=>['tom','floor'].includes(byId(id).type));
  const rows=K.ids.map(id=>{ const d=byId(id), r=K.results[id]||{}; let gap='';
    const p=toms.indexOf(id); if (p>0 && r.center && K.results[toms[p-1]]?.center){ const st=Math.round(12*Math.log2(K.results[toms[p-1]].center/r.center)); gap=` · ${st} semitones below`; }
    return `<li><span class="n">${d.size}″</span><span style="flex:1">${d.name}${gap}</span><span class="mono">${r.center?`${noteOf(r.center).name} · ${f1(r.center)} Hz`:'By feel'}</span></li>`; }).join('');
  return topbar(`<span class="chip">${esc(K.name)}</span>`) + `
  <div class="kitsetup"><div class="card"><p class="eyebrow">Kit done</p><h2>${esc(K.name)} is tuned</h2>
    <ul class="list plan">${rows}</ul>
    <p class="muted">Saved. Next time, open it under My kits and pick Quick touch-up to get back here in a couple of minutes.</p>
    <div class="navrow"><span></span><button class="btn" data-act="home">Done</button></div></div></div>`;
}
function renderQuick(){
  const r=S.reading, nt=r?noteOf(r):null;
  return topbar(`<span class="chip">Quick tuner</span>`) + `
  <div class="stage"><div class="ringbox">${stage({n:S.lugs, center:true, side:'top'})}<p class="ringcap">Hit the centre for the drum's note, or near a lug to check that lug.</p></div>
  <div class="card"><p class="eyebrow">Quick tuner</p><h2>Hit the drum</h2>
    ${listenBlock()}
    ${S.mic.on||r?`<div class="readout">${r?`<div class="hzline"><span class="hzbig">${f1(r)}</span><span class="hzunit">Hz</span><span class="note">${nt.name} ${nt.cents>=0?'+':''}${nt.cents}¢</span>${toneBtn(midiHz(Math.round(hzMidi(r))), `Hear ${nt.name}`)}</div>`:`<div class="waiting"><span class="pulse"></span>Waiting for a hit…</div>`}
    ${S.history.length>1?`<div><p class="eyebrow" style="margin-bottom:6px">Last hits</p><div class="hist">${S.history.slice(1).map(h=>`<span>${f1(h)}</span>`).join('')}</div></div>`:''}</div>`:''}
    ${simLine()}
    <div class="row"><div><p class="eyebrow" style="margin-bottom:6px">Room</p><div class="seg">${[['quiet','Quiet'],['normal','Normal'],['noisy','Noisy']].map(([k,l])=>`<button data-sens="${k}" aria-pressed="${S.sens===k}">${l}</button>`).join('')}</div></div></div>
  </div></div>`;
}
function renderGuide(){
  const st=step(), d=drum(), n=S.lugs, h=head(), t=S.target;
  const rail=PHASES.map((p,i)=>{ const has=S.steps.some(x=>x.phase===i); return `<button data-phase="${i}" class="${!has?'skip':i<st.phase?'done':i===st.phase?'now':''}">${p}${has?'':' · skipped'}</button>`; }).join('');
  const headName = st.head==='top'?'top (batter) head':'bottom (resonant) head';
  let ring='', cap='', body='', next='';

  if (st.id==='prep'){
    ring=stage({n, view:'explode'}); cap=DRUM?'The parts of your drum. Drag to turn it.':'Lug 1 is the one nearest you. Numbers go clockwise.';
    body=`<p class="lead">Loosen every tension rod until the head is completely slack. Centre the head on the drum and line the hoop up with the lugs.</p>
      <p class="tip"><b>New head?</b> Press firmly on the centre with your palm a few times to stretch it, then re-seat it.</p>
      ${d.type==='snare'?`<p class="tip"><b>Snare:</b> switch the snare wires off while you tune.</p>`:''}
      <p class="tip"><b>Using a drill?</b> Loosen in a criss-cross order. Never fully loosen one rod on a tight drum.</p>`;
    next=`<button class="btn" data-act="next">Done, next</button>`;
  }
  if (st.id==='finger'){
    const cls=h.finger.map(v=>v?'done':''); const left=h.finger.filter(v=>!v).length;
    ring=stage({n, cls, tappable:true}); cap='Tap each lug number once it\'s finger-tight. Lug 1 is the one nearest you.';
    body=`<p class="lead">Screw each rod in with your <b>fingers only</b>, as far as it will go. Every lug starts at the same tension, so the head comes up evenly.</p>
      <p class="muted">${left?`${left} of ${n} lugs to go.`:'All lugs finger-tight.'}</p>
      ${left?`<button class="link" data-act="allfinger">Mark all as finger-tight</button>`:''}`;
    next=`<button class="btn" data-act="next" ${left?'disabled':''}>Next: bring it up to tension</button>`;
  }
  if (st.id==='tension'){
    const amt=h.round===1?'half a turn':'a quarter turn';
    const doneSet=h.order.slice(0,h.pos); const cur=h.roundDone?-1:h.order[h.pos];
    const cls=Array(n).fill('').map((_,i)=>doneSet.includes(i)?'done':i===cur?'next':'');
    ring=stage({n, cls, tappable:true, star:h.order.slice(0,Math.min(n,h.pos+1)), key:h.roundDone?null:{lug:cur, turns:h.round===1?0.5:0.25, label:h.round===1?'↻ ½ turn':'↻ ¼ turn'}}); cap=DRUM?'The key shows the turn. Clockwise tightens.':'Follow the line: across the drum, then round.';
    if (!h.roundDone){
      body=`<p class="eyebrow">Round ${h.round} · ${h.pos+1} of ${n}</p>
        <p class="lead">With the drum key, turn <b>lug ${cur+1}</b> <b>${amt}</b> clockwise.</p>
        <button class="btn big wide" data-act="turned">Turned lug ${cur+1}</button>
        <p class="tip">Going across the drum in a star pattern keeps the hoop level. Tightening one rod slightly loosens its neighbours, which is why we go round more than once.</p>`;
    } else {
      body=`<p class="eyebrow">Round ${h.round} done</p>
        <p class="lead">Hit the centre of the ${st.head==='top'?'head':'bottom head'}. Does it sound like a drum, with no wrinkles near the rim?</p>
        <div class="row"><button class="btn" data-act="next">Yes, it sounds like a drum</button><button class="btn ghost" data-act="round">Still flappy: another round</button></div>`;
    }
  }
  if (st.id==='kickcheck'){
    const list=KICK_CHECKS[st.head], ck=S.checks[st.head];
    ring=stage({n, center:true}); cap=st.head==='top'?'Batter head: the side the beater hits.':'Front head: the side facing the audience.';
    body=`<p class="lead">${st.head==='top'?'Bass drums are tuned for punch, not a note. Go through these by feel.':'Now the front head. It controls how much boom the kick has.'}</p>
      <div class="checks">${list.map((c,i)=>`<button class="check" data-check="${i}" aria-pressed="${!!ck[i]}"><i></i><span>${c}</span></button>`).join('')}</div>
      <div class="readout"><p class="eyebrow">Optional: hear the note</p>
      ${h.center?`<div class="hzline"><span class="hzbig">${f1(h.center)}</span><span class="hzunit">Hz</span><span class="note">${noteOf(h.center).name}</span></div><p class="muted">For reference only. Write it down if you want the kick to sit with a song.</p>`
        :(S.mic.on?`<div class="waiting"><span class="pulse"></span>Hit the head once with the beater…</div>`:`<div class="row"><button class="btn ghost" data-act="mic">Start listening</button></div>`)}
      <p class="sim">No drum handy? <button class="link" data-act="sim">Simulate a hit</button></p></div>`;
    next=`<button class="btn" data-act="next">${st.head==='top'?'Next: front head':'Next: final check'}</button>`;
  }
  if (st.id==='pitch' || st.id==='final'){
    const z=S.zone, r = st.id==='pitch'?h.center:S.final;
    ring=stage({n, center:true}); cap='Hit here, softly, once.';
    const kick=isKick(), v=r&&!kick?zoneVerdict(r,t):null, nt=r?noteOf(r):null;
    body = st.id==='pitch'
      ? `<p class="lead">Hold the phone near the drum. Hit the centre softly, once, and let it ring.</p>`
      : `<p class="lead">${S.steps.some(x=>x.head==='bottom'&&x.id!=='flip')&&!S.skipBottom?'Flip the drum back, top head up. ':''}Hit the centre once more to check the final note.</p>`;
    body += targetLine(t);
    body += listenBlock();
    if (S.mic.on || r) body += `<div class="readout">${r?`
        <div class="hzline"><span class="hzbig">${f1(r)}</span><span class="hzunit">Hz</span><span class="note">${nt.name}</span>${v?`<span class="pill ${v.cls}">${v.label}</span>`:''}</div>
        ${kick?'':dialSVG(r,z)}${v?`<p class="advice">${v.advice}</p>`:''}${!kick?`<div class="row">${toneBtn(r,'Hear your drum')}${toneBtn(t.hz,'Hear the target')}</div>`:''}`
        :`<div class="waiting"><span class="pulse"></span>Waiting for a hit on the centre…</div>${kick?'':dialSVG(null,z)}`}</div>`;
    body += simLine();
    if (st.id==='pitch'){
      body += `<p class="tip">Move <b>every</b> rod by the same amount so the head stays even. Play the target and your drum one after the other to train your ear.</p>`;
      next=`<button class="btn" data-act="next" ${r?'':'disabled'}>${v&&v.cls!=='ok'?'Continue anyway':'Next: even out the lugs'}</button>`;
    } else {
      const top=S.heads.top, bot=S.heads.bottom;
      if (r && !kick) body += `<div class="summary"><div><b>${f1(r)}</b><span>Centre note (Hz)</span></div><div><b>${median(top.lugs)?f1(median(top.lugs)):'–'}</b><span>Top lugs (Hz)</span></div><div><b>${!S.skipBottom&&median(bot.lugs)?f1(median(bot.lugs)):'–'}</b><span>Bottom lugs (Hz)</span></div></div>`;
      const canSave = r || kick;
      if (S.kit){
        const last=S.kit.idx>=S.kit.ids.length-1, nx=last?null:byId(S.kit.ids[S.kit.idx+1]);
        next = canSave?`<button class="btn" data-act="kitnext">${last?'Save the kit':`Next drum: ${dname(nx)}`}</button>`:'';
      } else next = canSave ? `<button class="btn" data-act="save" ${S.saved?'disabled':''}>${S.saved?'Saved':'Save this tuning'}</button><button class="btn ghost" data-act="home">Tune another drum</button>` : '';
    }
  }
  if (st.id==='even'){
    const all=h.lugs.every(v=>v!=null), med=median(h.lugs);
    const useLug = S.refLug!=null && S.refLug<n && h.lugs[S.refLug]!=null;
    const ref = useLug ? h.lugs[S.refLug] : med;
    const cls=[], diff=[];
    h.lugs.forEach((v,i)=>{
      if (v==null){ cls[i]= i===h.active?'active':''; return; }
      const dd=v-ref, a=Math.abs(dd);
      cls[i]=(i===h.active?'active ':'')+(a<=1?'ok':a<=3?'warn':dd<0?'lo':'hi');
      diff[i]={t:useLug&&i===S.refLug?'ref':a<=1?'✓':sgn(dd), c:a<=1?'var(--ok)':a<=3?'var(--warn)':dd<0?'var(--flat)':'var(--bad)'};
    });
    ring=stage({n, cls, diff, tappable:true, tapAt:h.active}); cap='Tap a lug number to measure it again.';
    const done=h.lugs.filter(v=>v!=null).length;
    body=`<p class="lead">Tap the ${headName} softly, about <b>3 cm in from the glowing lug</b>. The app moves round the drum on its own. Keep the phone in the same spot each time.</p>`;
    body += listenBlock();
    if (S.mic.on || done) {
      if (h.active>=0) body+=`<div class="readout"><div class="waiting"><span class="pulse"></span>Tap near lug ${h.active+1} · ${done} of ${n} measured</div></div>`;
      if (all){
        const worst=Math.max(...h.lugs.map(v=>Math.abs(v-ref)));
        const items=h.lugs.map((v,i)=>({i,dd:v-ref})).filter(o=>Math.abs(o.dd)>1).sort((a,b)=>Math.abs(b.dd)-Math.abs(a.dd));
        body+=`<div class="readout"><div class="hzline"><span class="pill ${worst<=1.5?'ok':'warn'}">${worst<=1.5?'Even':'Not even yet'}</span><span class="note">${useLug?`Lug ${S.refLug+1}`:'Middle pitch'} ${f1(ref)} Hz · biggest gap ${f1(worst)} Hz</span></div>
          ${items.length?`<ul class="list">${items.map(o=>`<li><span class="n" style="color:${o.dd<0?'var(--flat)':'var(--bad)'}">${sgn(o.dd)}</span>Lug ${o.i+1}: ${o.dd<0?'tighten':'loosen'} ${Math.abs(o.dd)>3?'about an eighth of a turn':'a tiny touch'}${useLug?` to match lug ${S.refLug+1}`:''}</li>`).join('')}</ul>
          <p class="tip">${useLug?'Matching one lug moves the drum\'s overall note, so check the centre note again afterwards.':'Raising the low lugs <b>and</b> lowering the high ones keeps the drum\'s overall note where it is.'}</p>`
          :`<p class="advice">Every lug is within about 1 Hz of ${useLug?`lug ${S.refLug+1}`:'the others'}. That's as even as ears can tell.</p>`}</div>
          <button class="btn ghost" data-act="remeasure">Measure all lugs again</button>`;
      }
    }
    body += `<details class="expert"${S.refLug!=null?' open':''}><summary>Expert: compare to one lug</summary>
      <label class="field"><span>Compare every lug to</span><select id="refsel"><option value="">The middle of all lugs (keeps the note steady)</option>${Array.from({length:n},(_,i)=>`<option value="${i}" ${S.refLug===i?'selected':''}>Lug ${i+1}</option>`).join('')}</select></label></details>`;
    body += simLine();
    next=`<button class="btn" data-act="next" ${all?'':'disabled'}>${st.head==='top'?'Next: bottom head':'Next: compare the heads'}</button>`;
  }
  if (st.id==='flip'){
    ring=stage({n}); cap=d.type==='kick'?'Front head facing you.':'Bottom head facing up.';
    const touch=S.level==='touchup';
    if (d.type==='kick'){
      body=`<p class="lead">Now the front (resonant) head. It sets how much boom and sustain the kick has.</p>`;
      next=`<button class="btn" data-act="next">Check the front head</button><button class="btn ghost" data-act="skipbottom">Skip, it's fine</button>`;
    } else {
      const opts = d.type==='snare' ? ['tight','higher','same'] : ['lower','same','higher'];
      body=`<p class="lead">${touch?'On a touch-up the bottom head usually holds its tuning, because you don\'t hit it. Check it only if the drum still sounds off.':'Turn the drum over. The bottom head shapes how long the drum rings and whether the note bends. How do you want it compared to the top?'}</p>
        <div class="choices">${opts.map(k=>`<button class="choice" data-rel="${k}" aria-pressed="${S.relation===k}"><b>${RELATIONS[k].label}</b><span>${RELATIONS[k].sub}</span></button>`).join('')}</div>
        <p class="tip">Many players tune rack-tom bottom heads the same or a touch lower than the top. On a snare the bottom head is usually tight.</p>`;
      next = touch ? `<button class="btn" data-act="skipbottom">Skip the bottom head</button><button class="btn ghost" data-act="next">Check it too</button>`
                   : `<button class="btn" data-act="next">Tune the bottom head</button><button class="btn ghost" data-act="skipbottom">Skip, it's already fine</button>`;
    }
  }
  if (st.id==='match'){
    ring=stage({n}); cap='';
    const tl=median(S.heads.top.lugs), b=median(S.heads.bottom.lugs), rel=RELATIONS[S.relation];
    if (!tl || !b){ body=`<p class="lead">To compare the heads, Lugwise needs lug readings from both. You skipped the top head's lug check on this run.</p>`; next=`<button class="btn" data-act="next">Next: final check</button>`; }
    else {
      const ratio=b/tl, ok=ratio>=rel.r[0]&&ratio<=rel.r[1], pct=Math.round((ratio-1)*100);
      body=`<p class="lead">Comparing the lug pitch of both heads against your choice: <b>${rel.label.toLowerCase()}</b>.</p>
        <div class="summary"><div><b>${f1(tl)}</b><span>Top head (Hz)</span></div><div><b>${f1(b)}</b><span>Bottom head (Hz)</span></div><div><b>${pct>0?'+':''}${pct}%</b><span>Bottom vs top</span></div></div>
        <div class="readout"><span class="pill ${ok?'ok':'warn'}">${ok?'Matches your choice':'Not there yet'}</span>
        <p class="advice">${ok?'The heads are set the way you wanted.':ratio<rel.r[0]?'The bottom head is too low. Tighten every bottom rod a small, equal amount, then measure the lugs again.':'The bottom head is too high. Loosen every bottom rod a small, equal amount, then measure the lugs again.'}</p></div>
        ${ok?'':`<button class="btn ghost" data-act="rebottom">Measure the bottom lugs again</button>`}`;
      next=`<button class="btn" data-act="next">${ok?'Next: final check':'Continue anyway'}</button>`;
    }
  }

  const stepsInPhase=S.steps.filter(x=>x.phase===st.phase), pos=stepsInPhase.indexOf(st)+1;
  const titles={prep:'Loosen and seat the head',finger:'Finger-tighten every rod',tension:'Bring it up to tension',pitch:'Set the drum\'s note',even:'Even out the lugs',flip:d.type==='kick'?'Now the front head':'Now the bottom head',match:'Match the two heads',final:'Final check',kickcheck:st.head==='top'?'Set the batter head by feel':'Set the front head by feel'};
  const full = S.level==='scratch' ? '' : `<button class="link small" data-act="fullmethod">Show every step</button>`;
  return topbar(`${kitChip()}<span class="chip">${dname(d)} · ${n} lugs · ${esc(t.label)}</span>`) + `
  <div class="rail">${rail}</div>
  <div class="stage"><div class="ringbox">${ring}${cap?`<p class="ringcap">${cap}</p>`:''}</div>
  <div class="card"><div class="cardtop"><p class="eyebrow">${PHASES[st.phase]} · step ${pos} of ${stepsInPhase.length} · ${LEVELS[S.level].label}</p>${full}</div><h2>${titles[st.id]}</h2>${body}
  <div class="navrow"><button class="btn ghost" data-act="back">Back</button><div class="row" style="justify-content:flex-end">${next}</div></div></div></div>`;
}
function render(){
  const app=document.getElementById('app');
  PENDING=null;
  const v=S.view;
  app.innerHTML = v==='home'?renderHome():v==='quick'?renderQuick():v==='level'?renderLevel():v==='kitsetup'?renderKitSetup():v==='kitdone'?renderKitDone():renderGuide();
  if (DRUM && PENDING){ const slot=document.getElementById('drumslot'); if (slot){ DRUM.mount(slot); DRUM.update({lugs:S.lugs, type:drum().type, finish:S.finish, ...PENDING}); } }
}

/* ---------- actions ---------- */
function openLevel(){
  S.target=computeTarget(); S.zone=S.target.zone; S.detect=null;
  S.view='level'; render(); window.scrollTo(0,0);
}
function startGuide(){
  const d=drum();
  S.target=computeTarget(); S.zone=S.target.zone;
  S.steps=buildSteps(S.level, d.type); S.idx=0; S.heads={top:newHead(S.lugs), bottom:newHead(S.lugs)};
  S.relation = d.type==='snare'?'tight':'lower'; S.skipBottom=false; S.refLug=null; S.checks={top:[],bottom:[]};
  S.sim={center:null,lug:{top:[],bottom:[]}}; S.final=null; S.saved=false; S.reading=null;
  S.view='guide'; render(); window.scrollTo(0,0);
}
function setDrum(id){ S.drumId=id; S.lugs=drum().lugs; if (drum().type==='snare') S.finish='chrome'; else if (S.finish==='chrome') S.finish='wine'; }
function go(i){ S.idx=Math.max(0,Math.min(S.steps.length-1,i)); render(); window.scrollTo({top:0,behavior:'smooth'}); }
function resultNow(){ const top=S.heads.top, bot=S.heads.bottom; return {center:S.final||top.center||null, topLug:median(top.lugs), botLug:S.skipBottom?null:median(bot.lugs)}; }
function startKit(ids, saved){
  const K=S.kitDraft;
  S.kit={name:K.name||'My kit', ids, idx:0, spacing:K.spacing, keyRoot:K.keyRoot, minor:K.minor, results:{}, saved:saved||null};
  setDrum(ids[0]); openLevel();
}
document.addEventListener('click', e=>{
  const t=e.target.closest('[data-act],[data-drum],[data-goal],[data-lugs],[data-sens],[data-rel],[data-retune],[data-del],[data-finish],[data-tmode],[data-note],[data-tone],[data-level],[data-phase],[data-kitdrum],[data-spacing],[data-minor],[data-check],[data-kitretune],[data-kitdel],.lug'); if(!t) return;
  const ds=t.dataset;
  if (ds.tone){ playTone(+ds.tone); return; }
  if (ds.drum){ setDrum(ds.drum); render(); return; }
  if (ds.goal){ S.goal=ds.goal; render(); return; }
  if (ds.lugs){ S.lugs=+ds.lugs; render(); return; }
  if (ds.sens){ S.sens=ds.sens; render(); return; }
  if (ds.rel){ S.relation=ds.rel; render(); return; }
  if (ds.tmode){ S.targetMode=ds.tmode; render(); return; }
  if (ds.note){ S.noteMidi=+ds.note; playTone(midiHz(S.noteMidi)); render(); return; }
  if (ds.level){ S.level=ds.level; render(); return; }
  if (ds.check){ const c=S.checks[step().head]; c[+ds.check]=!c[+ds.check]; render(); return; }
  if (ds.kitdrum){ const ids=S.kitDraft.ids, i=ids.indexOf(ds.kitdrum); i>=0?ids.splice(i,1):ids.push(ds.kitdrum); render(); return; }
  if (ds.spacing){ S.kitDraft.spacing=+ds.spacing; render(); return; }
  if (ds.minor){ S.kitDraft.minor = ds.minor==='true'; render(); return; }
  if (ds.phase!=null){ const i=S.steps.findIndex(x=>x.phase===+ds.phase); if (i<0) fullMethod(+ds.phase); else go(i); return; }
  if (ds.retune!=null){ const k=loadKit()[+ds.retune]; S.kit=null; setDrum(k.drumId); S.lugs=k.lugs; S.targetMode=k.center?'saved':'zone'; S.level='touchup'; openLevel(); return; }
  if (ds.del!=null){ const k=loadKit(); k.splice(+ds.del,1); saveKit(k); render(); return; }
  if (ds.kitretune!=null){ const kit=loadKits()[+ds.kitretune]; S.kitDraft={...S.kitDraft, name:kit.name, ids:kit.drums.map(x=>x.drumId), spacing:0, keyRoot:null};
    const saved={}; kit.drums.forEach(x=>{ if (x.center) saved[x.drumId]=x.center; }); S.level='touchup'; startKit(S.kitDraft.ids, saved); return; }
  if (ds.kitdel!=null){ const k=loadKits(); k.splice(+ds.kitdel,1); saveKits(k); render(); return; }
  if (ds.finish){ S.finish=ds.finish; render(); return; }
  if (t.classList.contains('lug')){ lugTap(+ds.lug); return; }
  const act=ds.act, st=S.view==='guide'?step():null, h=st?head():null;
  switch(act){
    case 'home': S.view='home'; S.kit=null; render(); window.scrollTo(0,0); break;
    case 'quick': S.view='quick'; S.reading=null; S.history=[]; render(); break;
    case 'start': S.kit=null; openLevel(); break;
    case 'golevel': startGuide(); break;
    case 'kitsetup': S.kit=null; S.view='kitsetup'; render(); window.scrollTo(0,0); break;
    case 'kitstart': { const ids=DRUMS.filter(d=>S.kitDraft.ids.includes(d.id)).map(d=>d.id); if (ids.length) startKit(ids); break; }
    case 'mic': startMic(); break;
    case 'micoff': stopMic(); break;
    case 'sim': simulateHit(); break;
    case 'fullmethod': fullMethod(); break;
    case 'next': if (st.id==='flip') S.skipBottom=false; go(S.idx+1); break;
    case 'back':
      if (S.idx===0){ S.view='level'; render(); break; }
      if (st.id==='final' && S.skipBottom){ go(S.steps.findIndex(x=>x.id==='flip')); break; }
      go(S.idx-1); break;
    case 'allfinger': h.finger.fill(true); render(); break;
    case 'turned': advanceTension(); break;
    case 'round': h.round++; h.pos=0; h.roundDone=false; render(); break;
    case 'remeasure': h.lugs.fill(null); h.active=0; render(); break;
    case 'rebottom': { const i=S.steps.findIndex(x=>x.id==='even'&&x.head==='bottom'); const b=S.heads.bottom; b.lugs.fill(null); b.active=0; go(i); break; }
    case 'skipbottom': S.skipBottom=true; go(S.steps.findIndex(x=>x.id==='final')); break;
    case 'save': {
      const d=drum(), k=loadKit(), r=resultNow();
      k.unshift({drumId:d.id, name:d.name, size:d.size, lugs:S.lugs, goal:S.goal, ...r, date:today()});
      S.saved = saveKit(k.slice(0,20));
      toast(S.saved?'Saved. Find it under Saved drums, or pick "My saved tuning" next time.':'Couldn\'t save here. Your browser is blocking storage.'); render(); break;
    }
    case 'kitnext': {
      const K=S.kit; K.results[S.drumId]=resultNow();
      if (K.idx>=K.ids.length-1){
        const kits=loadKits().filter(x=>x.name!==K.name);
        kits.unshift({name:K.name, date:today(), drums:K.ids.map(id=>{ const d=byId(id); return {drumId:id, name:d.name, size:d.size, ...(K.results[id]||{})}; })});
        saveKits(kits.slice(0,10)); S.view='kitdone'; render(); window.scrollTo(0,0);
      } else { K.idx++; setDrum(K.ids[K.idx]); openLevel(); }
      break;
    }
  }
});
document.addEventListener('change', e=>{
  if (e.target.id==='refsel'){ S.refLug = e.target.value===''?null:+e.target.value; render(); }
  if (e.target.id==='keyroot'){ S.kitDraft.keyRoot = e.target.value===''?null:+e.target.value; render(); }
});
document.addEventListener('input', e=>{ if (e.target.id==='kitname') S.kitDraft.name=e.target.value; });
document.addEventListener('keydown', e=>{ if((e.key==='Enter'||e.key===' ') && e.target.classList && e.target.classList.contains('lug')){ e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click',{bubbles:true})); }});
function fullMethod(phase){
  const cur=step(); S.level='scratch'; S.steps=buildSteps('scratch', drum().type);
  let i = phase!=null ? S.steps.findIndex(x=>x.phase===phase) : S.steps.findIndex(x=>x.id===cur.id && x.head===cur.head);
  go(i<0?0:i);
}
function lugTap(i){
  if (S.view!=='guide') return;
  const st=step(), h=head();
  if (st.id==='finger'){ h.finger[i]=!h.finger[i]; render(); }
  else if (st.id==='tension' && !h.roundDone && h.order[h.pos]===i){ advanceTension(); }
  else if (st.id==='even'){ h.active=i; render(); }
}
function advanceTension(){ const h=head(); h.pos++; if (h.pos>=h.order.length){ h.roundDone=true; } render(); }

DRUM=createDrum3D(); if (DRUM) DRUM.onLug=lugTap;
S.lugs=drum().lugs; render();
if ('serviceWorker' in navigator && location.protocol==='https:') { navigator.serviceWorker.register('sw.js').catch(()=>{}); }
if ('wakeLock' in navigator) { const wl=()=>navigator.wakeLock.request('screen').catch(()=>{}); document.addEventListener('click', wl, {once:true}); document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') wl(); }); }
