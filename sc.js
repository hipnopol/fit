/* ================== TŁO DŹWIĘKOWE (soundscape'y) ==================
   Każdy preset to:
   - bed(e): ciągłe warstwy tła (zwraca listę węzłów do zatrzymania),
   - ev: losowe odgłosy {nazwa: [waga, fn(e, at, pan)]}, dens: [na min w odpoczynku, na min w wysiłku],
   - głosy rytmu: metro (krok w biegu), tdown/tup/tsec (tempo serii).
   Wszystko generowane w Web Audio, bez plików. Poziom 0..1 (odpoczynek → wysiłek)
   rozjaśnia i pogłaśnia tło oraz zagęszcza odgłosy. */
const SC = (() => {
  const rr = (a, b) => a + Math.random() * (b - a);
  const reg = n => { try { if (typeof COLLECT !== 'undefined' && COLLECT) (COLLECT === true ? SCHED : COLLECT).push(n); } catch (e) {} };

  // ---------- pomocnicze: środowisko dla konkretnego AudioContext ----------
  function makeEnv(ctx, bed, vox, live, shared) {
    const sr = ctx.sampleRate, B = shared || {};
    const mk = (kind) => {
      const n = sr * 4, b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w * 0.5;
        else if (kind === 'pink') {
          b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852;
          b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926;
        } else { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
      }
      return b;
    };
    if (!B.white) { B.white = mk('white'); B.pink = mk('pink'); B.brown = mk('brown'); }
    const e = { ctx, bed, vox, B, rr };
    const panTo = (node, pan, dest) => {
      if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(p); p.connect(dest); }
      else node.connect(dest);
    };
    // ton: oscylator z obwiednią; opcje: f2 (glissando), lp (filtr), vib (vibrato Hz), pan
    e.T = (dest, at, type, f, f2, dur, vol, att = .005, o = {}) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(f, at);
      if (f2) osc.frequency.exponentialRampToValueAtTime(f2, at + dur);
      if (o.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = o.vib; lg.gain.value = f * .012; l.connect(lg); lg.connect(osc.frequency); l.start(at); l.stop(at + dur + .05); if (live) reg(l); }
      g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(vol, at + att); g.gain.exponentialRampToValueAtTime(.0001, at + dur);
      let node = g;
      if (o.lp) { const f1 = ctx.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.value = o.lp; g.connect(f1); node = f1; }
      osc.connect(g); panTo(node, o.pan, dest); osc.start(at); osc.stop(at + dur + .05); if (live) reg(osc);
    };
    // szum: wycinek bufora przez filtr; f2 = przejazd filtra, lin = liniowe wygaszanie
    e.N = (dest, at, dur, vol, ft, f, Q = 1, f2 = null, att = .003, o = {}) => {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = B[o.buf || 'white']; s.loop = true; fl.type = ft; fl.frequency.setValueAtTime(f, at); fl.Q.value = Q;
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2, at + dur);
      g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(vol, at + att);
      if (o.lin) g.gain.linearRampToValueAtTime(0.0001, at + dur); else g.gain.exponentialRampToValueAtTime(.0001, at + dur);
      s.connect(fl); fl.connect(g); panTo(g, o.pan, dest); s.start(at, Math.random() * 3); s.stop(at + dur + .05); if (live) reg(s);
    };
    // ciągła warstwa szumu przez filtr
    e.loop = (buf, ft, f, Q, vol, nodes) => {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = B[buf]; s.loop = true; s.playbackRate.value = rr(.95, 1.05); fl.type = ft; fl.frequency.value = f; fl.Q.value = Q; g.gain.value = vol;
      s.connect(fl); fl.connect(g); g.connect(bed); s.start(ctx.currentTime, Math.random() * 3); nodes.push(s);
      return { s, fl, g };
    };
    // ciągły ton
    e.drone = (type, f, vol, nodes, lp) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f; g.gain.value = vol;
      if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; fl.Q.value = 1.5; o.connect(fl); fl.connect(g); g.connect(bed); o.start(); nodes.push(o); return { o, g, fl }; }
      o.connect(g); g.connect(bed); o.start(); nodes.push(o); return { o, g };
    };
    // powolna modulacja parametru
    e.lfo = (param, rate, depth, nodes) => {
      const l = ctx.createOscillator(), g = ctx.createGain(); l.frequency.value = rate; g.gain.value = depth; l.connect(g); g.connect(param); l.start(); nodes.push(l);
    };
    return e;
  }

  // ---------- presety ----------
  const P = {
    las: { name: 'Las', dens: [5, 16],
      bed(e, n) {
        const w = e.loop('pink', 'bandpass', 700, .6, .75, n); e.lfo(w.g.gain, .07, .3, n); e.lfo(w.fl.frequency, .045, 280, n);
        const s = e.loop('white', 'bandpass', 2600, .8, .13, n); e.lfo(s.g.gain, 7.3, .025, n);
      },
      ev: {
        bird: [4, (e, t, p) => { const n = 3 + Math.floor(Math.random() * 5), f = e.rr(2600, 4400); for (let i = 0; i < n; i++) e.T(e.bed, t + i * e.rr(.07, .12), 'sine', f * e.rr(.95, 1.05), f * e.rr(1.2, 1.5), .06, .07, .004, { pan: p }); }],
        rustle: [3, (e, t, p) => e.N(e.bed, t, e.rr(.4, .9), .12, 'bandpass', e.rr(2500, 4200), 1.2, null, .08, { buf: 'pink', pan: p })],
        cuckoo: [1, (e, t, p) => { e.T(e.bed, t, 'sine', 660, 650, .22, .05, .02, { pan: p, lp: 1500 }); e.T(e.bed, t + .3, 'sine', 550, 540, .35, .05, .02, { pan: p, lp: 1500 }); }],
        crack: [1, (e, t, p) => e.N(e.bed, t, .05, .2, 'bandpass', 1500, 2, null, .002, { pan: p })],
      },
      metro(e, t) { e.N(e.vox, t, .028, .55, 'bandpass', 1800, 4); e.T(e.vox, t, 'triangle', 950, 600, .035, .35, .002); },
      tdown(e, t, d) { e.N(e.vox, t, d, .4, 'bandpass', 1700, .8, 350, d * .2, { buf: 'pink', lin: true }); },
      tup(e, t) { e.N(e.vox, t, .45, .45, 'bandpass', 400, .8, 1900, .05, { buf: 'pink' }); },
      tsec(e, t) { e.N(e.vox, t, .03, .14, 'bandpass', 3500, 3); },
    },
    hala: { name: 'Hala', dens: [3, 12],
      bed(e, n) {
        const r = e.loop('brown', 'lowpass', 180, .7, .55, n); e.lfo(r.g.gain, .04, .12, n);
        const h = e.drone('sawtooth', 50, .05, n, 260); e.lfo(h.g.gain, .03, .02, n);
        e.drone('sine', 100.4, .025, n);
      },
      ev: {
        clank: [3, (e, t, p) => { const f = e.rr(280, 650); [[1, .08], [2.76, .04], [5.4, .02]].forEach(([m, v]) => e.T(e.bed, t, 'sine', f * m, null, 1.2, v, .002, { pan: p })); e.N(e.bed, t, .03, .15, 'bandpass', 2000, 2, null, .002, { pan: p }); }],
        steam: [2, (e, t, p) => e.N(e.bed, t, e.rr(1, 2.5), .07, 'highpass', 3000, .7, null, .25, { pan: p })],
        chain: [2, (e, t, p) => { const n = 6 + Math.floor(Math.random() * 6); let x = 0; for (let i = 0; i < n; i++) { x += e.rr(.04, .1); e.N(e.bed, t + x, .012, .1, 'bandpass', e.rr(3000, 4200), 6, null, .001, { pan: p }); } }],
        boom: [1, (e, t, p) => { e.T(e.bed, t, 'sine', 55, 38, 1.6, .2, .01, { pan: p }); e.N(e.bed, t, 1.2, .25, 'lowpass', 140, 1, null, .01, { buf: 'brown', pan: p }); }],
      },
      metro(e, t) { e.T(e.vox, t, 'sine', 72, 42, .13, .75, .002); e.N(e.vox, t, .06, .4, 'lowpass', 450, 1, null, .002, { buf: 'brown' }); e.N(e.vox, t, .015, .2, 'bandpass', 2500, 3); },
      tdown(e, t, d) { e.N(e.vox, t, d, .26, 'highpass', 2600, .7, 1200, .04, { lin: true }); },
      tup(e, t) { const f = 900; [[1, .25], [2.76, .12], [5.4, .06]].forEach(([m, v]) => e.T(e.vox, t, 'sine', f * m, null, .35, v, .002)); e.T(e.vox, t, 'sine', 90, 50, .12, .4, .002); },
      tsec(e, t) { e.T(e.vox, t, 'triangle', 1400, null, .02, .14, .001); },
    },
    orbita: { name: 'Orbita', dens: [3, 10],
      bed(e, n) {
        const a = e.drone('sawtooth', 55, .06, n, 380), b = e.drone('sawtooth', 55.35, .06, n, 380);
        e.lfo(a.fl.frequency, .04, 180, n); e.lfo(b.fl.frequency, .033, 180, n);
        e.drone('sine', 27.5, .12, n);
        e.loop('white', 'bandpass', 2200, 1.5, .02, n);
      },
      ev: {
        telemetry: [3, (e, t, p) => { const n = 3 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) e.T(e.bed, t + i * .12, 'square', [1500, 1800, 2400, 3000][Math.floor(Math.random() * 4)], null, .04, .04, .002, { pan: p, lp: 4000 }); }],
        chatter: [2, (e, t, p) => { for (let i = 0; i < 9; i++) e.N(e.bed, t + i * e.rr(.08, .15), e.rr(.05, .12), .06, 'bandpass', e.rr(900, 1600), 2.5, null, .01, { pan: p }); }],
        swell: [1, (e, t, p) => e.T(e.bed, t, 'sine', 110, 220, 4, .06, 1.6, { pan: p })],
        ping: [1, (e, t, p) => e.T(e.bed, t, 'sine', 2600, null, .7, .03, .002, { pan: p })],
      },
      metro(e, t) { e.T(e.vox, t, 'sine', 1320, null, .09, .45, .002); e.T(e.vox, t, 'sine', 2640, null, .05, .1, .002); },
      tdown(e, t, d) { e.T(e.vox, t, 'sine', 900, 280, d, .3, .02); },
      tup(e, t) { e.T(e.vox, t, 'sine', 280, 900, .3, .38, .01); },
      tsec(e, t) { e.T(e.vox, t, 'sine', 600, null, .03, .15, .002); },
    },
    ognisko: { name: 'Ognisko', dens: [22, 48],
      bed(e, n) {
        const r = e.loop('brown', 'lowpass', 450, .6, .42, n); e.lfo(r.g.gain, .7, .12, n); e.lfo(r.g.gain, 3.1, .05, n);
        e.drone('sine', 110, .035, n); e.drone('sine', 165, .02, n); e.drone('sine', 220.5, .012, n);
      },
      ev: {
        crackle: [8, (e, t, p) => { const n = 2 + Math.floor(Math.random() * 5); let x = 0; for (let i = 0; i < n; i++) { x += e.rr(.02, .14); e.N(e.bed, t + x, e.rr(.008, .02), e.rr(.12, .32), 'bandpass', e.rr(1500, 5000), 2, null, .001, { pan: p }); } }],
        pop: [2, (e, t, p) => { e.N(e.bed, t, .04, .3, 'bandpass', 900, 2, null, .001, { pan: p }); e.T(e.bed, t, 'sine', 300, 120, .05, .1, .002, { pan: p }); }],
        crickets: [1, (e, t, p) => { const g = 2 + Math.floor(Math.random() * 3); for (let k = 0; k < g; k++) for (let i = 0; i < 6; i++) e.T(e.bed, t + k * .5 + i * .045, 'sine', 4400, null, .025, .025, .003, { pan: p * 1.5 }); }],
        settle: [1, (e, t, p) => e.N(e.bed, t, .6, .2, 'lowpass', 300, 1, null, .02, { buf: 'brown', pan: p })],
      },
      metro(e, t) { e.T(e.vox, t, 'triangle', 820, null, .045, .45, .001); e.N(e.vox, t, .015, .2, 'bandpass', 1200, 3); },
      tdown(e, t, d) { e.N(e.vox, t, d, .38, 'lowpass', 520, .7, 170, d * .15, { buf: 'pink', lin: true }); },
      tup(e, t) { for (let i = 0; i < 4; i++) e.N(e.vox, t + i * .03, .012, .35, 'bandpass', e.rr(2500, 5000), 2); e.T(e.vox, t, 'sine', 1600, null, .06, .14, .002); },
      tsec(e, t) { e.T(e.vox, t, 'triangle', 600, null, .025, .14, .001); },
    },
    pociag: { name: 'Nocny pociąg', dens: [2, 6],
      bed(e, n) {
        const r = e.loop('brown', 'lowpass', 220, .7, .55, n); e.lfo(r.g.gain, .3, .1, n);
        const k = e.loop('pink', 'bandpass', 1100, 1.2, .06, n); e.lfo(k.g.gain, 2.3, .02, n);
      },
      ev: {
        whistle: [1, (e, t, p) => { e.T(e.bed, t, 'sawtooth', 523, 518, 1.8, .025, .15, { pan: p, lp: 1400 }); e.T(e.bed, t, 'sawtooth', 659, 653, 1.8, .02, .15, { pan: p, lp: 1400 }); }],
        squeal: [1, (e, t, p) => e.T(e.bed, t, 'sine', 2900, 3150, 1.4, .015, .3, { pan: p, vib: 6 })],
        rattle: [2, (e, t, p) => e.N(e.bed, t, e.rr(.6, 1.4), .07, 'bandpass', e.rr(1500, 2600), 3, null, .05, { pan: p })],
      },
      metro(e, t) {   // „ta-tak” koła na złączu szyn
        [[0, .55], [.11, .7]].forEach(([dt, v]) => { e.N(e.vox, t + dt, .05, v, 'lowpass', 900, 1, null, .002, { buf: 'brown' }); e.T(e.vox, t + dt, 'sine', 120, 80, .06, v * .55, .002); });
      },
      tdown(e, t, d) { e.T(e.vox, t, 'sine', 2400, 1700, d, .05, .1); e.N(e.vox, t, d, .1, 'highpass', 3000, .7, null, .1, { lin: true }); },
      tup(e, t) { e.N(e.vox, t, .35, .28, 'bandpass', 600, 1, null, .01); e.T(e.vox, t, 'sine', 90, 60, .2, .38, .003); },
      tsec(e, t) { e.N(e.vox, t, .04, .25, 'lowpass', 900, 1, null, .002, { buf: 'brown' }); },
    },
    deszcz: { name: 'Deszcz', dens: [10, 26],
      bed(e, n) {
        e.loop('white', 'bandpass', 3500, .4, .3, n);
        const l = e.loop('pink', 'lowpass', 900, .7, .22, n); e.lfo(l.g.gain, .05, .04, n);
      },
      ev: {
        drop: [6, (e, t, p) => { const f = e.rr(1800, 3600); e.T(e.bed, t, 'sine', f, f * .6, .06, .06, .002, { pan: p }); }],
        splash: [2, (e, t, p) => e.N(e.bed, t, .2, .1, 'bandpass', 1200, 1, null, .005, { pan: p })],
        thunder: [.5, (e, t, p) => { e.N(e.bed, t, 4.5, .4, 'lowpass', 130, .8, null, .5, { buf: 'brown', pan: p }); e.N(e.bed, t + .2, .5, .2, 'lowpass', 320, 1, null, .02, { buf: 'brown', pan: p }); }],
      },
      metro(e, t) { e.T(e.vox, t, 'sine', 1700, 900, .055, .5, .002); e.T(e.vox, t, 'sine', 3400, null, .02, .1, .001); },
      tdown(e, t, d) { e.N(e.vox, t, d, .28, 'lowpass', 6000, .7, 900, .05, { lin: true }); },
      tup(e, t) { e.T(e.vox, t, 'sine', 700, 1800, .12, .42, .003); },
      tsec(e, t) { e.T(e.vox, t, 'sine', 2200, 1500, .04, .16, .002); },
    },
    glebina: { name: 'Głębina', dens: [3, 9],
      bed(e, n) {
        const d = e.loop('brown', 'lowpass', 160, .7, .55, n); e.lfo(d.g.gain, .07, .2, n);
        const o = e.loop('pink', 'lowpass', 500, .8, .13, n); e.lfo(o.fl.frequency, .1, 240, n);
      },
      ev: {
        bubbles: [3, (e, t, p) => { const n = 3 + Math.floor(Math.random() * 6); for (let i = 0; i < n; i++) e.T(e.bed, t + i * e.rr(.04, .09), 'sine', e.rr(280, 420), e.rr(700, 1000), .05, .08, .003, { pan: p }); }],
        whale: [1, (e, t, p) => { const f = e.rr(180, 320); e.T(e.bed, t, 'sine', f, f * e.rr(1.3, 1.8), 3.2, .06, 1, { pan: p, vib: 4.5 }); }],
        hull: [1, (e, t, p) => e.N(e.bed, t, 1.6, .12, 'bandpass', 400, 8, 330, .3, { buf: 'brown', pan: p })],
      },
      metro(e, t) { e.T(e.vox, t, 'sine', 620, null, .12, .5, .002); e.T(e.vox, t, 'sine', 1240, null, .06, .1, .002); },
      tdown(e, t, d) { e.N(e.vox, t, d, .38, 'lowpass', 900, .8, 200, d * .2, { buf: 'pink', lin: true }); },
      tup(e, t) { e.N(e.vox, t, .5, .38, 'lowpass', 200, .8, 900, .05, { buf: 'pink' }); for (let i = 0; i < 3; i++) e.T(e.vox, t + .1 + i * .06, 'sine', 350, 900, .05, .1, .003); },
      tsec(e, t) { e.T(e.vox, t, 'sine', 400, null, .04, .16, .002); },
    },
  };
  const IDS = Object.keys(P);

  // ---------- silnik na żywo ----------
  let L = null;            // { ctx, master, lp, duck, bed, vox, env, nodes, id }
  let level = .5, lastT = 0, previewT = null;
  const vol = () => (db.settings.scVol ?? .5);
  function ensure() {
    const ctx = ac(); if (!ctx) return null;
    if (L && L.ctx === ctx) return L;
    const master = ctx.createGain(), lp = ctx.createBiquadFilter(), duck = ctx.createGain(), bed = ctx.createGain(), vox = ctx.createGain();
    master.gain.value = 0; lp.type = 'lowpass'; lp.frequency.value = 4000; lp.Q.value = .5; bed.gain.value = .8; vox.gain.value = 1;
    bed.connect(lp); lp.connect(duck); duck.connect(master); master.connect(ctx.destination); vox.connect(ctx.destination);
    L = { ctx, master, lp, duck, bed, vox, B: {}, env: null, sub: null, nodes: [], id: null };
    makeEnv(ctx, bed, vox, false, L.B);   // przygotuj bufory szumów raz
    return L;
  }
  function stopNodes(nodes, at) { nodes.forEach(n => { try { n.stop(at); } catch (e) {} }); }
  function start(id) {
    if (!id || id === 'off' || !P[id] || !db.settings.sound) { stop(); return; }
    const l = ensure(); if (!l) return;
    if (l.id === id) { setVol(); return; }
    const t = l.ctx.currentTime;
    if (l.sub) { l.sub.gain.setTargetAtTime(0, t, .4); stopNodes(l.nodes, t + 2); }   // płynne przejście między presetami
    const sub = l.ctx.createGain(); sub.gain.value = 0; sub.connect(l.bed); sub.gain.setTargetAtTime(1, t, .6);
    l.env = makeEnv(l.ctx, sub, l.vox, true, l.B); l.sub = sub;
    cancelPlan();
    const nodes = []; P[id].bed(l.env, nodes); l.nodes = nodes; l.id = id; lastT = 0;
    l.master.gain.cancelScheduledValues(t); l.master.gain.setTargetAtTime(Math.pow(vol(), 1.3), t, .5);
    setLevel(level, true);
  }
  function stop(fade = 1.5) {
    if (!L || !L.id) return;
    const t = L.ctx.currentTime; L.master.gain.cancelScheduledValues(t); L.master.gain.setTargetAtTime(0, t, fade / 3);
    cancelPlan(); stopNodes(L.nodes, t + fade + .5); L.nodes = []; L.id = null; L.sub = null;
  }
  function setVol() { if (L && L.id) L.master.gain.setTargetAtTime(Math.pow(vol(), 1.3), L.ctx.currentTime, .3); }
  function setLevel(l, now) {
    level = l; if (!L || !L.id) return;
    const t = L.ctx.currentTime, tc = now ? .05 : 1.2;
    L.lp.frequency.setTargetAtTime(700 + 9000 * Math.pow(l, 1.6), t, tc);
    L.bed.gain.setTargetAtTime(.5 + .5 * l, t, tc);
  }
  // przyciszenie tła na czas sygnałów (okno w czasie AudioContext)
  function duckWin(t0, t1) { if (!L || !L.id) return; const t = L.ctx.currentTime; if (t1 < t) return; L.duck.gain.setTargetAtTime(.3, Math.max(t, t0), .08); L.duck.gain.setTargetAtTime(1, t1, .4); }
  function duckHold(on) { if (!L || !L.id) return; const t = L.ctx.currentTime; L.duck.gain.cancelScheduledValues(t); L.duck.gain.setTargetAtTime(on ? .5 : 1, t, .2); }
  function duckReset() { if (!L) return; const t = L.ctx.currentTime; L.duck.gain.cancelScheduledValues(t); L.duck.gain.setTargetAtTime(1, t, .2); }
  // ---------- planowanie z wyprzedzeniem ----------
  // Aplikacja podaje oś czasu treningu jako punkty zmian {at (czas AudioContext), level, metro, spm}.
  // Odgłosy i zmiany nastroju planujemy na kilka minut naprzód w czasie AudioContext,
  // więc grają także przy zgaszonym ekranie, gdy przeglądarka usypia skrypty.
  const same = (a, b) => a.level === b.level && !!a.metro === !!b.metro && (a.spm || 0) === (b.spm || 0);
  function norm(pts) { const o = []; pts.forEach(p => { if (!o.length || !same(o[o.length - 1], p)) o.push(p); }); return o; }
  function at(pts, t) { let v = null; for (const p of pts) { if (p.at <= t + 1e-3) v = p; else break; } return v; }
  // czy nowa oś czasu zgadza się z tym, co już zaplanowano (do chwili `until`)
  function consistent(planned, pts, now, until) {
    const a = at(planned, now), b = at(pts, now); if (!a || !b || !same(a, b)) return false;
    const fa = planned.filter(p => p.at > now + .3 && p.at < until), fb = pts.filter(p => p.at > now + .3 && p.at < until);
    if (fa.length !== fb.length) return false;
    for (let i = 0; i < fa.length; i++) if (Math.abs(fa[i].at - fb[i].at) > .3 || !same(fa[i], fb[i])) return false;
    return true;
  }
  const PL = { pts: [], until: 0, ev: [] };
  function levelAt(l, t) {
    level = l; if (!L || !L.id) return;
    L.lp.frequency.setTargetAtTime(700 + 9000 * Math.pow(l, 1.6), t, 1.2);
    L.bed.gain.setTargetAtTime(.5 + .5 * l, t, 1.2);
  }
  function cancelPlan() {
    if (!L) return; const now = L.ctx.currentTime;
    PL.ev.forEach(x => { if (x.at > now) try { x.n.stop(); } catch (e) {} });
    PL.ev = PL.ev.filter(x => x.at <= now); PL.pts = []; PL.until = 0;
    try { L.lp.frequency.cancelScheduledValues(now); L.bed.gain.cancelScheduledValues(now); } catch (e) {}
  }
  function fireAt(p, t) {
    const ev = p.ev, keys = Object.keys(ev); let s = 0; keys.forEach(k => s += ev[k][0]); let r = Math.random() * s;
    const k = keys.find(k => (r -= ev[k][0]) <= 0) || keys[0];
    const tmp = [], prev = COLLECT; COLLECT = tmp;
    try { ev[k][1](L.env, t, rr(-.8, .8)); } finally { COLLECT = prev; }
    tmp.forEach(n => PL.ev.push({ n, at: t }));
  }
  function plan(raw, H = 180) {
    if (!L || !L.id || !raw || !raw.length) return;
    const now = L.ctx.currentTime, pts = norm(raw);
    if (!PL.pts.length || !consistent(PL.pts, pts, now, PL.until)) { cancelPlan(); PL.until = now; }
    if (PL.until > now + H - 30) { PL.pts = pts; return; }        // zapas jeszcze wystarcza
    const end = now + H, from = Math.max(PL.until, now), p = P[L.id];
    for (let i = 0; i < pts.length; i++) {
      const a = Math.max(pts[i].at, from), b = Math.min(i + 1 < pts.length ? pts[i + 1].at : end, end);
      if (b <= a) continue;
      if (pts[i].at >= from - 1e-3 || a === from && PL.until === now) levelAt(pts[i].level, Math.max(pts[i].at, now));
      const rate = p.dens[0] + (p.dens[1] - p.dens[0]) * pts[i].level;
      let t = a + .05; for (;;) { t += -Math.log(1 - Math.random()) * 60 / rate; if (t >= b) break; fireAt(p, t); }
    }
    PL.pts = pts; PL.until = end;
    PL.ev = PL.ev.filter(x => x.at > now - 10);
  }
  function update() {}   // zgodność wstecz: odgłosy są teraz planowane przez plan()

  // głos rytmu z aktywnego presetu; false = brak presetu (używa się dźwięków domyślnych)
  function voice(name, at, arg) {
    if (!L || !L.id || !db.settings.sound) return false;
    const p = P[L.id]; if (!p[name]) return false;
    p[name](L.env, at || L.ctx.currentTime + .01, arg); return true;
  }
  function preview(id) {
    clearTimeout(previewT); start(id);
    if (!db.current) previewT = setTimeout(() => { if (!db.current) stop(2); }, 9000);
    if (id && id !== 'off') { const t = (L ? L.ctx.currentTime : 0) + .8; voice('metro', t); voice('metro', t + .72); voice('tdown', t + 2, 1.5); voice('tup', t + 3.6); }
  }

  // ---------- nagranie próbki (do odsłuchu poza aplikacją) ----------
  async function render(id, secs = 20, lvl = .8) {
    const ctx = new OfflineAudioContext(2, 44100 * secs, 44100), bed = ctx.createGain(), lp = ctx.createBiquadFilter(), vox = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 700 + 9000 * Math.pow(lvl, 1.6); bed.gain.value = (.5 + .5 * lvl) * Math.pow(.6, 1.3);
    bed.connect(lp); lp.connect(ctx.destination); vox.connect(ctx.destination);
    const env = makeEnv(ctx, bed, vox, false), p = P[id], nodes = []; p.bed(env, nodes);
    const rate = p.dens[0] + (p.dens[1] - p.dens[0]) * lvl; let t = .5;
    while (t < secs - 2) { t += -Math.log(1 - Math.random()) * 60 / rate; if (t > secs - 2) break; const ks = Object.keys(p.ev); let s = 0; ks.forEach(k => s += p.ev[k][0]); let r = Math.random() * s; const k = ks.find(k => (r -= p.ev[k][0]) <= 0) || ks[0]; p.ev[k][1](env, t, rr(-.8, .8)); }
    for (let x = 2; x < 8; x += 120 / 166) p.metro(env, x);                      // metronom ~166 kr/min
    [[10, 3], [14.2, 3]].forEach(([s0, d]) => { p.tdown(env, s0, d); for (let k = 1; k < d; k++) p.tsec(env, s0 + k); p.tup(env, s0 + d); });   // dwa powtórzenia 3-0-1-0
    const buf = await ctx.startRendering();
    return buf;
  }

  return { P, IDS, start, stop, setVol, setLevel, update, plan, consistent, norm, get _pl() { return PL; }, voice, duckWin, duckHold, duckReset, preview, render, get id() { return L && L.id; } };
})();
