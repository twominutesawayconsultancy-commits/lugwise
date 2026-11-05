// Lugwise 3D drum: a procedural drum built in Three.js (no model file needed).
// Shell, coated heads with hit ripples, triple-flange hoops, tension rods, tube lugs, snare wires.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const FINISHES = {
  wine:     { label: 'Wine red',      swatch: '#7A1A2A', color: 0x6E1423, metal: 0,   rough: 0.28 },
  midnight: { label: 'Midnight blue', swatch: '#1C2D63', color: 0x14224A, metal: 0,   rough: 0.28 },
  maple:    { label: 'Natural maple', swatch: '#C99556', color: 0xC08A4E, metal: 0,   rough: 0.38 },
  black:    { label: 'Piano black',   swatch: '#14151A', color: 0x0D0E12, metal: 0,   rough: 0.22 },
  chrome:   { label: 'Chrome',        swatch: '#D7DCE4', color: 0xE8ECF2, metal: 0.85, rough: 0.26 },
};
const STATE_COLORS = { next: 0xE4A944, active: 0xE4A944, done: 0x3DD1A0, ok: 0x3DD1A0, warn: 0xF2C14E, lo: 0x6AAEFF, hi: 0xFF6F59 };
const R = 0.7;           // normalised drum radius
const HEAD_R = R * 1.005;
const TEX = 1024;

export function createDrum3D() {
  let renderer;
  try {
    const test = document.createElement('canvas');
    if (!(test.getContext('webgl2') || test.getContext('webgl'))) return null;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { return null; }

  const el = document.createElement('div');
  el.className = 'drumstage';
  el.appendChild(renderer.domElement);
  const labelLayer = document.createElement('div');
  labelLayer.className = 'labels';
  el.appendChild(labelLayer);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223044, 0.55));
  const keyL = new THREE.DirectionalLight(0xfff1de, 1.5); keyL.position.set(-2.2, 4, 3); scene.add(keyL);
  const rimL = new THREE.DirectionalLight(0x9cc0ff, 0.7); rimL.position.set(3, 1.2, -3); scene.add(rimL);

  const root = new THREE.Group(); scene.add(root);      // yaw (hero spin)
  const flipG = new THREE.Group(); root.add(flipG);     // flip about Z for bottom head

  // soft contact shadow
  const shCan = document.createElement('canvas'); shCan.width = shCan.height = 256;
  { const g = shCan.getContext('2d'); const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shCan), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; root.add(shadow);

  // shared materials
  const chrome = new THREE.MeshStandardMaterial({ color: 0xE7EBF1, metalness: 1, roughness: 0.15 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2A2F3A, metalness: 0.8, roughness: 0.35 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xD9A441, metalness: 1, roughness: 0.3 });

  // drum key (lives in world space so "clockwise from above" stays true after a flip)
  const keyG = new THREE.Group();
  { const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.12, 16), brass); shaft.position.y = 0.06;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.036), brass); wing.position.y = 0.13;
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 16), darkMetal); sock.position.y = 0.006;
    keyG.add(shaft, wing, sock); }
  keyG.scale.setScalar(1.7); keyG.visible = false; scene.add(keyG);

  // target markers (world space, on whichever head faces up)
  const tgtMat = new THREE.MeshBasicMaterial({ color: 0xE4A944, transparent: true, toneMapped: false, side: THREE.DoubleSide });
  const tgtRing = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.09, 48), tgtMat.clone());
  const tgtDot = new THREE.Mesh(new THREE.CircleGeometry(0.025, 32), tgtMat.clone());
  [tgtRing, tgtDot].forEach(m => { m.rotation.x = -Math.PI / 2; m.visible = false; scene.add(m); });

  let D = null;           // current built drum
  let built = '';
  let cur = { view: 'hero', side: 'top' };
  let onLug = null;
  const anim = { explode: 0, explodeT: 0, flip: 0, flipT: 0, cam: new THREE.Vector3(0, 1.05, 3.4), camT: new THREE.Vector3(0, 1.05, 3.4), look: new THREE.Vector3(), lookT: new THREE.Vector3(), yawV: 0.004, yawTarget: null, dragging: false };
  const ripples = [];
  let keyAnim = null;
  let dirty = true, last = 0, t0 = performance.now();

  /* ---------- head texture ---------- */
  function headCanvas(kind) {
    const c = document.createElement('canvas'); c.width = c.height = TEX;
    return { c, ctx: c.getContext('2d'), kind, tex: null };
  }
  function paintHead(h, star, lugPx) {
    const g = h.ctx, m = TEX / 2;
    g.clearRect(0, 0, TEX, TEX);
    const base = h.kind === 'top' ? '#EEEBE3' : '#E4DFD3';
    const gr = g.createRadialGradient(m * 0.85, m * 0.8, 20, m, m, m);
    gr.addColorStop(0, h.kind === 'top' ? '#F6F4EE' : '#ECE8DE'); gr.addColorStop(1, base);
    g.fillStyle = gr; g.fillRect(0, 0, TEX, TEX);
    // coating texture
    let s = h.kind === 'top' ? 11 : 23; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(90,80,60,${0.025 + rnd() * 0.04})`; g.fillRect(rnd() * TEX, rnd() * TEX, 1.6, 1.6); }
    // collar near the edge
    g.strokeStyle = 'rgba(120,110,90,0.18)'; g.lineWidth = 10; g.beginPath(); g.arc(m, m, m * 0.955, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(120,110,90,0.10)'; g.lineWidth = 3; g.beginPath(); g.arc(m, m, m * 0.9, 0, Math.PI * 2); g.stroke();
    // star pattern line
    if (star && star.length > 1 && lugPx) {
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = 'rgba(228,169,68,0.35)'; g.lineWidth = 22; drawPoly(g, star, lugPx);
      g.strokeStyle = '#D9952A'; g.lineWidth = 7; drawPoly(g, star, lugPx);
      const [lx, ly] = lugPx[star[star.length - 1]];
      g.fillStyle = '#D9952A'; g.beginPath(); g.arc(lx, ly, 13, 0, Math.PI * 2); g.fill();
    }
    if (h.tex) h.tex.needsUpdate = true;
  }
  function drawPoly(g, star, px) { g.beginPath(); star.forEach((i, k) => { const [x, y] = px[i]; k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }

  /* ---------- build ---------- */
  function lugAngle(i, n) { return (i / n) * Math.PI * 2; }
  // Top rods: lug 1 nearest the player (+z), numbers run clockwise seen from above.
  // Bottom rods use the mirrored mapping so they read clockwise once the drum is flipped about Z.
  function lugXZ(i, n, rad, side) { const a = lugAngle(i, n); return side === 'top' ? [-rad * Math.sin(a), rad * Math.cos(a)] : [rad * Math.sin(a), rad * Math.cos(a)]; }

  function disposeTree(o) { o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material && c.material !== chrome && c.material !== darkMetal && c.material !== brass) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } }); }

  function build(p) {
    if (D) { flipG.remove(D.group); disposeTree(D.group); }
    const n = p.lugs, type = p.type;
    const H = 2 * R * (type === 'snare' ? 0.4 : type === 'floor' ? 0.98 : type === 'kick' ? 0.8 : 0.66);
    const fin = FINISHES[p.finish] || FINISHES.wine;
    const group = new THREE.Group();
    const parts = [];   // {obj, base, off}
    const add = (obj, off) => { group.add(obj); parts.push({ obj, base: obj.position.clone(), off: off || new THREE.Vector3() }); return obj; };

    // shell
    const shellMat = new THREE.MeshPhysicalMaterial({ color: fin.color, metalness: fin.metal, roughness: fin.rough, clearcoat: fin.metal ? 0 : 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide });
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 80, 1, true), shellMat);
    add(shell);
    // bearing edges (thin inner rings)
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xBFA27A, roughness: 0.6 });
    [H / 2, -H / 2].forEach(y => { const e = new THREE.Mesh(new THREE.TorusGeometry(R - 0.004, 0.006, 6, 96), edgeMat); e.rotation.x = Math.PI / 2; e.position.y = y; add(e); });

    // heads
    const heads = {};
    ['top', 'bottom'].forEach(side => {
      const hc = headCanvas(side);
      const tex = new THREE.CanvasTexture(hc.c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; hc.tex = tex;
      const geo = new THREE.RingGeometry(0.0001, HEAD_R, 96, 26);
      // planar UVs
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) / HEAD_R + 1) / 2, (pos.getY(i) / HEAD_R + 1) / 2);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = side === 'top' ? -Math.PI / 2 : Math.PI / 2;
      mesh.position.y = side === 'top' ? H / 2 + 0.004 : -H / 2 - 0.004;
      add(mesh, new THREE.Vector3(0, side === 'top' ? 0.34 : -0.34, 0));
      heads[side] = { mesh, hc, rest: Float32Array.from(pos.array) };
      paintHead(hc, null, null);
    });

    // hoops + rods
    const rods = { top: [], bottom: [] };
    ['top', 'bottom'].forEach(side => {
      const dir = side === 'top' ? 1 : -1, yEdge = dir * H / 2;
      const hoop = new THREE.Group();
      const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.024, R + 0.024, 0.07, 80, 1, true), chrome);
      band.position.y = yEdge + dir * 0.014; hoop.add(band);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(R + 0.027, 0.011, 8, 96), chrome);
      lip.rotation.x = Math.PI / 2; lip.position.y = yEdge + dir * 0.05; hoop.add(lip);
      const flange = new THREE.Mesh(new THREE.TorusGeometry(R + 0.03, 0.007, 6, 96), chrome);
      flange.rotation.x = Math.PI / 2; flange.position.y = yEdge - dir * 0.018; hoop.add(flange);
      for (let i = 0; i < n; i++) {
        const [x, z] = lugXZ(i, n, R + 0.052, side);
        const a = Math.atan2(x, z);
        const ear = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.016, 0.055), chrome);
        ear.position.set(x, yEdge - dir * 0.012, z); ear.rotation.y = a; hoop.add(ear);
        // tension rod: square head + washer + threaded rod
        const headMat = new THREE.MeshStandardMaterial({ color: 0xDDE2E9, metalness: 1, roughness: 0.2, emissive: 0x000000 });
        const rodHead = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.024, 0.03), headMat);
        rodHead.position.set(x, yEdge + dir * 0.008, z); rodHead.rotation.y = a; hoop.add(rodHead);
        const washer = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.005, 20), chrome);
        washer.position.set(x, yEdge - dir * 0.003, z); hoop.add(washer);
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.09, 10), chrome);
        rod.position.set(x, yEdge - dir * 0.06, z); hoop.add(rod);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xE4A944, toneMapped: false, transparent: true });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.0075, 8, 40), ringMat);
        ring.rotation.x = Math.PI / 2; ring.position.set(x, yEdge + dir * 0.022, z); ring.visible = false; hoop.add(ring);
        rods[side].push({ head: rodHead, mat: headMat, ring, ringMat, local: new THREE.Vector3(x, yEdge + dir * 0.02, z), state: '' });
      }
      add(hoop, new THREE.Vector3(0, dir * 0.62, 0));
      if (side === 'top') heads.top.hoop = hoop; else heads.bottom.hoop = hoop;
    });

    // tube lugs on the shell
    const casingMat = new THREE.MeshStandardMaterial({ color: 0xE1E5EC, metalness: 1, roughness: 0.18 });
    const span = Math.max(0.12, H - 0.2);
    for (let i = 0; i < n; i++) {
      const [x, z] = lugXZ(i, n, R + 0.04, 'top');
      const cas = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, span - 0.038, 6, 14), casingMat);
      cas.position.set(x, 0, z);
      const out = new THREE.Vector3(x, 0, z).normalize().multiplyScalar(0.2);
      add(cas, out);
    }
    // snare: strainer + wires on the bottom head
    if (type === 'snare') {
      const [sx, sz] = lugXZ(n / 4 + 0.5, n, R + 0.05, 'top');
      const strainer = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.05), chrome);
      strainer.position.set(sx, 0, sz); strainer.rotation.y = Math.atan2(sx, sz); add(strainer, new THREE.Vector3(sx, 0, sz).normalize().multiplyScalar(0.2));
      const wires = new THREE.Group();
      for (let k = 0; k < 18; k++) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, R * 1.55, 6), chrome);
        w.rotation.x = Math.PI / 2; w.position.set(-0.21 + k * 0.025, -H / 2 - 0.012, 0); wires.add(w);
      }
      add(wires, new THREE.Vector3(0, -0.4, 0));
    }

    flipG.add(group);
    shadow.position.y = -H / 2 - 0.09;
    D = { group, parts, heads, rods, n, H, type };
    labelsBuilt = '';
    dirty = true;
  }

  /* ---------- labels (HTML, so they stay crisp and tappable) ---------- */
  let labelsBuilt = '', labelEls = [], partEls = [], keyLabel = null;
  function buildLabels() {
    const sig = `${D.n}|${cur.side}|${cur.view}`;
    if (sig === labelsBuilt) return;
    labelsBuilt = sig; labelLayer.innerHTML = ''; labelEls = []; partEls = [];
    if (cur.view === 'top') {
      for (let i = 0; i < D.n; i++) {
        const b = document.createElement('button');
        b.className = 'lug3d'; b.dataset.lug = i; b.setAttribute('aria-label', `Lug ${i + 1}`);
        b.innerHTML = `<span class="num">${i + 1}</span><span class="dif"></span>`;
        labelLayer.appendChild(b); labelEls.push(b);
      }
    }
    if (cur.view === 'explode') {
      ['Hoop', 'Batter head (top)', 'Tension rods', 'Shell', 'Lugs', 'Resonant head (bottom)'].forEach(t => {
        const s = document.createElement('span'); s.className = 'part3d'; s.textContent = t; labelLayer.appendChild(s); partEls.push(s);
      });
    }
    keyLabel = document.createElement('span'); keyLabel.className = 'key3d'; keyLabel.hidden = true; labelLayer.appendChild(keyLabel);
  }
  const v = new THREE.Vector3();
  function toScreen(p, w, h) { v.copy(p).project(camera); return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h, v.z]; }
  function placeLabels() {
    const w = el.clientWidth, h = el.clientHeight;
    if (cur.view === 'top' && labelEls.length) {
      const rods = D.rods[cur.side];
      const c = toScreen(new THREE.Vector3(0, D.H / 2, 0), w, h);
      rods.forEach((r, i) => {
        const wp = r.head.getWorldPosition(new THREE.Vector3());
        const [x, y] = toScreen(wp, w, h);
        const dx = x - c[0], dy = y - c[1], L = Math.hypot(dx, dy) || 1;
        const off = 24;
        labelEls[i].style.transform = `translate(${x + dx / L * off}px, ${y + dy / L * off}px) translate(-50%,-50%)`;
      });
    }
    if (cur.view === 'explode' && partEls.length) {
      const P = D.parts, gp = o => o.getWorldPosition(new THREE.Vector3());
      const anchors = [
        gp(D.heads.top.hoop).add(new THREE.Vector3(0, D.H / 2 + 0.06, 0)).add(new THREE.Vector3(R + 0.03, 0, 0).applyQuaternion(root.quaternion)),
        gp(D.heads.top.mesh).add(new THREE.Vector3(-0.15, 0, 0.2)),
        D.rods.top[0].head.getWorldPosition(new THREE.Vector3()),
        new THREE.Vector3(-R, 0, 0).applyMatrix4(D.group.matrixWorld),
        P.find(p => p.obj.geometry && p.obj.geometry.type === 'CapsuleGeometry').obj.getWorldPosition(new THREE.Vector3()),
        gp(D.heads.bottom.mesh).add(new THREE.Vector3(0.15, 0, 0.2)),
      ];
      anchors.forEach((a, i) => { const [x, y] = toScreen(a, w, h); partEls[i].style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%)`; partEls[i].style.opacity = anim.explode > 0.6 ? 1 : 0; });
    }
    if (keyLabel) {
      if (keyG.visible && keyAnim) { const [x, y] = toScreen(keyG.position.clone().add(new THREE.Vector3(0, 0.36, 0)), w, h); keyLabel.hidden = false; keyLabel.style.transform = `translate(${x}px, ${y}px) translate(-50%,-100%)`; }
      else keyLabel.hidden = true;
    }
  }

  /* ---------- update (declarative) ---------- */
  let lastStar = '';
  function update(s) {
    const sig = `${s.lugs}|${s.type}|${s.finish}`;
    if (sig !== built) { build(s); built = sig; lastStar = ''; }
    const viewChanged = s.view !== cur.view, sideChanged = (s.side || 'top') !== cur.side;
    cur = { ...cur, ...s, side: s.side || 'top' };
    if (viewChanged || sideChanged) labelsBuilt = '';
    buildLabels();
    // camera per view
    if (cur.view === 'hero') { anim.camT.set(0, 1.0, 3.9); anim.lookT.set(0, -0.06, 0); anim.explodeT = 0; anim.yawTarget = null; }
    if (cur.view === 'explode') { anim.camT.set(0, 1.5, 5.9); anim.lookT.set(0, -0.02, 0); anim.explodeT = 1; anim.yawTarget = null; }
    if (cur.view === 'top') { anim.camT.set(0, 3.85, 1.7); anim.lookT.set(0, 0, 0.05); anim.explodeT = 0; anim.yawTarget = 0; }
    anim.flipT = cur.side === 'bottom' ? Math.PI : 0;
    shadow.visible = cur.view !== 'top';
    // rod states
    const rods = D.rods[cur.side], other = D.rods[cur.side === 'top' ? 'bottom' : 'top'];
    other.forEach(r => setRod(r, ''));
    rods.forEach((r, i) => setRod(r, (s.states && s.states[i]) || ''));
    // label text
    labelEls.forEach((b, i) => {
      const st = (s.states && s.states[i]) || '';
      b.className = 'lug3d ' + st;
      const d = s.diffs && s.diffs[i];
      const dif = b.querySelector('.dif'); dif.textContent = d ? d.t : ''; dif.style.color = d ? d.c : '';
    });
    // star on the head that faces up
    const starSig = cur.side + ':' + (s.star || []).join(',');
    if (starSig !== lastStar) {
      lastStar = starSig;
      ['top', 'bottom'].forEach(side => paintHead(D.heads[side].hc, side === cur.side ? s.star : null, side === cur.side ? lugPixels(side) : null));
    }
    // targets
    tgtRing.visible = tgtDot.visible = s.target != null;
    // drum key
    if (s.key) { keyAnim = { lug: s.key.lug, turns: s.key.turns, start: performance.now() }; keyLabel && (keyLabel.textContent = s.key.label || ''); }
    else keyAnim = null;
    dirty = true; kick();
  }
  function setRod(r, st) {
    r.state = st;
    const col = STATE_COLORS[st.split(' ').pop()];
    if (col) { r.mat.emissive.setHex(col); r.mat.emissiveIntensity = 0.55; r.mat.color.setHex(col); r.ring.visible = true; r.ringMat.color.setHex(col); }
    else { r.mat.emissive.setHex(0); r.mat.color.setHex(0xDDE2E9); r.ring.visible = false; }
  }
  function lugPixels(side) {
    const head = D.heads[side].mesh; head.updateMatrix();
    const inv = head.matrix.clone().invert();
    return D.rods[side].map(r => {
      const p = r.local;
      const dir = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(R * 0.74);
      const q = new THREE.Vector3(dir.x, head.position.y, dir.z).applyMatrix4(inv);
      return [(q.x / HEAD_R + 1) / 2 * TEX, (1 - (q.y / HEAD_R + 1) / 2) * TEX];
    });
  }

  /* ---------- hits ---------- */
  function hit(where) {
    if (!D) return;
    const head = D.heads[cur.side];
    let wp;
    if (where === 'center' || where == null) wp = new THREE.Vector3(0, D.H / 2, 0);
    else { const r = D.rods[cur.side][where]; const p = r.head.getWorldPosition(new THREE.Vector3()); wp = new THREE.Vector3(p.x, 0, p.z).normalize().multiplyScalar(R * 0.78); wp.y = D.H / 2; }
    const lp = head.mesh.worldToLocal(wp.clone());
    ripples.push({ head, x: lp.x, y: lp.y, start: performance.now() });
    kick();
  }

  /* ---------- interaction: drag to spin (hero) ---------- */
  let dragX = null, lastMoveT = 0;
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', e => { if (cur.view !== 'hero' && cur.view !== 'explode') return; dragX = e.clientX; anim.dragging = true; lastMoveT = performance.now(); cv.setPointerCapture(e.pointerId); el.classList.add('grabbing'); });
  cv.addEventListener('pointermove', e => { if (dragX == null) return; const dx = e.clientX - dragX; dragX = e.clientX; root.rotation.y += dx * 0.01; anim.yawV = dx * 0.01; lastMoveT = performance.now(); dirty = true; kick(); });
  const end = () => { if (dragX == null) return; dragX = null; anim.dragging = false; el.classList.remove('grabbing'); if (performance.now() - lastMoveT > 80) anim.yawV = 0.004; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  labelLayer.addEventListener('click', e => { const b = e.target.closest('.lug3d'); if (b && onLug) onLug(+b.dataset.lug); });

  /* ---------- loop ---------- */
  let raf = 0;
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    const k = 1 - Math.exp(-dt * 5);
    let busy = false;
    // camera
    anim.cam.lerp(anim.camT, k); anim.look.lerp(anim.lookT, k);
    if (anim.cam.distanceTo(anim.camT) > 0.002) busy = true;
    camera.position.copy(anim.cam); camera.lookAt(anim.look);
    // explode
    anim.explode += (anim.explodeT - anim.explode) * k;
    if (Math.abs(anim.explode - anim.explodeT) > 0.001) busy = true;
    D.parts.forEach(p => p.obj.position.copy(p.base).addScaledVector(p.off, ease(Math.max(0, Math.min(1, anim.explode)))));
    // flip
    anim.flip += (anim.flipT - anim.flip) * (1 - Math.exp(-dt * 3.2));
    if (Math.abs(anim.flip - anim.flipT) > 0.002) busy = true; else anim.flip = anim.flipT;
    flipG.rotation.z = anim.flip;
    flipG.position.y = Math.sin(anim.flip) * 0.25;
    // yaw
    if (anim.yawTarget != null) {
      let y = root.rotation.y % (Math.PI * 2); if (y > Math.PI) y -= Math.PI * 2; if (y < -Math.PI) y += Math.PI * 2;
      root.rotation.y = y + (0 - y) * k; if (Math.abs(root.rotation.y) > 0.002) busy = true; else root.rotation.y = 0;
    } else if (!anim.dragging) {
      anim.yawV += (0.004 - anim.yawV) * 0.03; root.rotation.y += anim.yawV; busy = true;
    }
    // ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i], t = (now - rp.start) / 1000;
      const geo = rp.head.mesh.geometry, pos = geo.attributes.position, rest = rp.head.rest;
      if (t > 1.6) { for (let j = 0; j < pos.count; j++) pos.setZ(j, 0); pos.needsUpdate = true; geo.computeVertexNormals(); ripples.splice(i, 1); continue; }
      for (let j = 0; j < pos.count; j++) {
        const x = rest[j * 3], y = rest[j * 3 + 1];
        const d = Math.hypot(x - rp.x, y - rp.y), rr = Math.hypot(x, y) / HEAD_R;
        pos.setZ(j, 0.022 * Math.exp(-2.6 * t) * Math.sin(30 * d - 26 * t) * Math.exp(-1.2 * d) * (1 - Math.pow(rr, 6)) * Math.min(1, t * 12));
      }
      pos.needsUpdate = true; geo.computeVertexNormals(); busy = true;
    }
    // pulsing states + targets
    const tt = (now - t0) / 1000, pulse = 0.5 + 0.5 * Math.sin(tt * 5);
    if (cur.view === 'top') {
      D.rods[cur.side].forEach(r => {
        if (r.state.includes('next') || r.state.includes('active')) { r.mat.emissiveIntensity = 0.4 + 0.6 * pulse; r.ring.scale.setScalar(1 + 0.35 * pulse); r.ringMat.opacity = 0.5 + 0.5 * pulse; busy = true; }
        else { r.ring.scale.setScalar(1); r.ringMat.opacity = 1; }
      });
    }
    if (tgtRing.visible) {
      let p;
      if (cur.target === 'center') p = new THREE.Vector3(0, D.H / 2 + 0.012, 0);
      else { const r = D.rods[cur.side][cur.target]; const w = r.head.getWorldPosition(new THREE.Vector3()); p = new THREE.Vector3(w.x, 0, w.z).normalize().multiplyScalar(R * 0.78); p.y = D.H / 2 + 0.012; }
      p.y += flipG.position.y;
      tgtRing.position.copy(p); tgtDot.position.copy(p);
      const ph = (tt % 1.5) / 1.5; tgtRing.scale.setScalar(0.7 + ph * 1.4); tgtRing.material.opacity = 1 - ph; tgtDot.material.opacity = 1;
      busy = true;
    }
    // drum key
    if (keyAnim && cur.view === 'top' && Math.abs(anim.flip - anim.flipT) < 0.05) {
      const r = D.rods[cur.side][keyAnim.lug]; const w = r.head.getWorldPosition(new THREE.Vector3());
      keyG.visible = true; keyG.position.set(w.x, w.y + 0.004, w.z);
      const cyc = ((now - keyAnim.start) / 1000) % 2.2;
      const a = cyc < 1.4 ? ease(cyc / 1.4) : 1;
      keyG.rotation.y = Math.atan2(w.x, w.z) - a * keyAnim.turns * Math.PI * 2;   // negative = clockwise from above
      keyG.scale.setScalar(1.7 * (cyc > 2.0 ? Math.max(0.01, 1 - (cyc - 2.0) * 5) : Math.min(1, cyc * 8 + 0.01)));
      busy = true;
    } else keyG.visible = false;

    renderer.render(scene, camera);
    placeLabels();
    dirty = false;
    if (busy) raf = requestAnimationFrame(frame);
  }

  function resize() {
    const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 38 : 30; camera.updateProjectionMatrix(); dirty = true; kick();
  }
  new ResizeObserver(resize).observe(el);

  return {
    el, update, hit, resize,
    set onLug(fn) { onLug = fn; },
    mount(slot) { if (el.parentNode !== slot) slot.appendChild(el); requestAnimationFrame(resize); },
  };
}
