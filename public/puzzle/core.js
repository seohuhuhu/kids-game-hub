// 관리자/플레이어 화면이 함께 쓰는 퍼즐 도구
window.PZ = (() => {
  const CLIP = {
    'sq': 'none',
    'tri-ur': 'polygon(0 0, 100% 0, 100% 100%)',
    'tri-ll': 'polygon(0 0, 100% 100%, 0 100%)',
    'tri-ul': 'polygon(0 0, 100% 0, 0 100%)',
    'tri-lr': 'polygon(100% 0, 100% 100%, 0 100%)',
  };
  const POLY = {
    'sq': [[0, 0], [1, 0], [1, 1], [0, 1]],
    'tri-ur': [[0, 0], [1, 0], [1, 1]],
    'tri-ll': [[0, 0], [1, 1], [0, 1]],
    'tri-ul': [[0, 0], [1, 0], [0, 1]],
    'tri-lr': [[1, 0], [1, 1], [0, 1]],
  };
  const SHAPE_NAME = { square: '네모', triangle: '세모', mixed: '네모+세모' };

  const $ = id => document.getElementById(id);
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function toast(msg) {
    let t = $('toast');
    if (!t) { t = el('div', 'toast'); t.id = 'toast'; document.body.append(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // 사진을 blob URL + 원본 크기로 준비
  function loadImage(dataUrl) {
    return new Promise(resolve => {
      fetch(dataUrl).then(r => r.blob()).then(blob => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => resolve({ url, w: img.naturalWidth, h: img.naturalHeight, dataUrl });
        img.src = url;
      });
    });
  }

  // 판(W×H)을 사진으로 꽉 채울 때(cover) 배경 크기와 잘리는 양
  function cover(img, W, H) {
    const s = Math.max(W / img.w, H / img.h);
    const bw = img.w * s, bh = img.h * s;
    return { bw, bh, ox: (bw - W) / 2, oy: (bh - H) / 2 };
  }

  function makePiece(p, onDown) {
    const wrap = el('div', 'piece');
    const img = el('div', 'img');
    wrap.dataset.id = p.id;
    img.style.clipPath = CLIP[p.kind];
    wrap.style.setProperty('--clip', CLIP[p.kind]);
    if (onDown) img.addEventListener('pointerdown', onDown);
    wrap.append(img);
    return wrap;
  }

  // size: 화면에 보일 조각 크기, cell: 판에서의 실제 칸 크기, board: {W,H}
  function stylePiece(wrap, p, { img, cell, size = cell, W, H, rot = 0 }) {
    const k = size / cell, m = cover(img, W, H), inner = wrap.firstChild;
    wrap.style.width = wrap.style.height = size + 'px';
    inner.style.backgroundImage = `url(${img.url})`;
    inner.style.backgroundSize = `${m.bw * k}px ${m.bh * k}px`;
    inner.style.backgroundPosition = `${-(p.col * cell + m.ox) * k}px ${-(p.row * cell + m.oy) * k}px`;
    inner.style.transform = rot ? `rotate(${rot * 90}deg)` : '';
  }

  function drawGuides(svg, pieces, rows, cols) {
    svg.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.innerHTML = '';
    pieces.forEach(p => {
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', POLY[p.kind].map(([x, y]) => `${p.col + x},${p.row + y}`).join(' '));
      svg.append(poly);
    });
  }

  // 사진 파일 → 최대 max px JPEG data URL
  function fileToDataUrl(file, max = 1200, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  // ---- 소리 (첫 터치/클릭 이후에만 재생 가능) ----
  let ctx;
  function audio() {
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); }
    catch { ctx = null; }
    return ctx;
  }
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, audio, { once: true, capture: true }));
  function tone(freqs, step = 0.12, type = 'sine', vol = 0.2) {
    const a = audio();
    if (!a) return;
    freqs.forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = type;
      o.frequency.value = f;
      const t = a.currentTime + i * step;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 3);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + step * 3.2);
    });
  }
  const sound = {
    ding: () => tone([1318.5, 1760], 0.09, 'sine', 0.25),       // 띠링
    good: () => tone([660, 880], 0.1, 'triangle', 0.15),
    wrong: () => tone([220], 0.15, 'square', 0.06),
    turn: () => tone([520], 0.05, 'triangle', 0.08),
    fanfare: () => tone([523, 659, 784, 1046], 0.14, 'triangle', 0.2),
  };

  function confetti(n = 90) {
    const colors = ['#22D3EE', '#6EE75A', '#FFCA3A', '#FF595E', '#8B5CF6', '#FF8FAB'];
    for (let i = 0; i < n; i++) {
      const c = el('div', 'confetti');
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 2 + Math.random() * 2 + 's';
      c.style.animationDelay = Math.random() * 0.8 + 's';
      document.body.append(c);
      setTimeout(() => c.remove(), 5000);
    }
  }

  const fmtTime = ms => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };

  return { CLIP, SHAPE_NAME, $, el, toast, loadImage, cover, makePiece, stylePiece, drawGuides, fileToDataUrl, sound, confetti, fmtTime, store };
})();
