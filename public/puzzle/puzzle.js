// 함께 맞추는 퍼즐 - 클라이언트
(() => {
  const socket = io('/puzzle');
  const $ = id => document.getElementById(id);

  const CLIP = {
    'sq': 'none',
    'tri-ur': 'polygon(0 0, 100% 0, 100% 100%)',
    'tri-ll': 'polygon(0 0, 100% 100%, 0 100%)',
    'tri-ul': 'polygon(0 0, 100% 0, 0 100%)',
    'tri-lr': 'polygon(100% 0, 100% 100%, 0 100%)',
  };
  const POLY = { // 안내선용 꼭짓점 (칸 기준 0~1)
    'sq': [[0, 0], [1, 0], [1, 1], [0, 1]],
    'tri-ur': [[0, 0], [1, 0], [1, 1]],
    'tri-ll': [[0, 0], [1, 1], [0, 1]],
    'tri-ul': [[0, 0], [1, 0], [0, 1]],
    'tri-lr': [[1, 0], [1, 1], [0, 1]],
  };
  const SHAPE_NAME = { square: '네모', triangle: '세모', mixed: '네모+세모' };

  let me = null;          // 내 소켓 id
  let room = null;        // 서버에서 받은 방 상태
  let imageUrl = null;    // 퍼즐 사진 (blob URL)
  let imageData = null;   // 퍼즐 사진 (data URL, 결과 화면용)
  let clockOffset = 0;
  let boardSize = 0;
  let guidesKey = null;
  let selectedPreset = null;
  let dragging = null;
  let resultShownFor = null;
  const pieceEls = new Map();
  const placedSeen = new Set();

  // ---------- 공통 ----------
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  let audio;
  function beep(freqs, dur = 0.12) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      freqs.forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        const t = audio.currentTime + i * dur;
        g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.5);
        o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur * 1.6);
      });
    } catch { /* 소리는 없어도 괜찮아요 */ }
  }

  function show(name) {
    ['home', 'lobby', 'game'].forEach(s => $('screen-' + s).classList.toggle('hidden', s !== name));
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const isHost = () => room && room.hostId === me;
  const myName = () => localStorage.getItem('puzzle-name') || '';

  // ---------- 처음 화면 ----------
  $('name').value = myName();
  const urlCode = new URLSearchParams(location.search).get('code');
  function inviteMode(on) {
    $('invite').classList.toggle('hidden', !on);
    ['btn-create', 'join-code'].forEach(id => $(id).classList.toggle('hidden', on));
    document.querySelector('.or').classList.toggle('hidden', on);
    $('btn-join').textContent = on ? '이 방에 들어가기' : '들어가기';
    $('btn-join').style.width = on ? '100%' : '';
    otherBtn.classList.toggle('hidden', !on);
  }
  const otherBtn = el('button', 'link hidden', '다른 방에 들어가거나 새 방 만들기');
  otherBtn.onclick = () => { history.replaceState(null, '', location.pathname); inviteMode(false); };
  document.querySelector('.home-actions').append(otherBtn);
  if (/^\d{4}$/.test(urlCode || '')) {
    $('join-code').value = urlCode;
    $('invite-code').textContent = urlCode;
    inviteMode(true);
    setTimeout(() => $('name').focus(), 50);
  }
  $('name').addEventListener('keydown', e => e.key === 'Enter' && urlCode && $('btn-join').click());

  function getName() {
    const n = $('name').value.trim();
    if (!n) { toast('이름을 먼저 적어 주세요!'); $('name').focus(); return null; }
    try { localStorage.setItem('puzzle-name', n); } catch {}
    return n;
  }

  function entered(res) {
    if (!res.ok) return toast(res.error || '들어갈 수 없어요.');
    me = res.me;
    history.replaceState(null, '', '?code=' + res.code);
  }

  $('btn-create').onclick = () => { const name = getName(); if (name) socket.emit('create', { name }, entered); };
  $('btn-join').onclick = () => {
    const name = getName(); if (!name) return;
    const code = $('join-code').value.trim();
    if (!/^\d{4}$/.test(code)) return toast('방 코드 4자리를 입력해 주세요.');
    socket.emit('join', { code, name }, entered);
  };
  $('join-code').addEventListener('keydown', e => e.key === 'Enter' && $('btn-join').click());

  function leaveRoom() {
    socket.emit('leave');
    room = null; imageUrl = null; imageData = null; selectedPreset = null;
    clearPieces();
    history.replaceState(null, '', location.pathname);
    $('result').classList.add('hidden');
    inviteMode(false);
    show('home');
  }
  $('btn-leave').onclick = leaveRoom;
  $('btn-exit').onclick = leaveRoom;

  // ---------- 대기실 ----------
  PRESETS.forEach(p => {
    const b = el('button', 'host-ctl');
    b.title = p.name;
    b.dataset.id = p.id;
    b.style.backgroundImage = `url(${p.url})`;
    b.onclick = () => { selectedPreset = p.id; sendImage(p.url); };
    $('presets').appendChild(b);
  });

  for (let g = 2; g <= 8; g++) {
    const b = el('button', 'host-ctl', `${g}×${g}`);
    b.dataset.v = g;
    $('grid-seg').appendChild(b);
  }
  $('grid-seg').onclick = e => { const v = e.target.dataset.v; if (v && isHost()) socket.emit('settings', { grid: +v }); };
  $('shape-seg').onclick = e => { const v = e.target.dataset.v; if (v && isHost()) socket.emit('settings', { shape: v }); };

  function sendImage(dataUrl) {
    socket.emit('setImage', dataUrl, res => { if (!res.ok) toast(res.error || '사진을 올리지 못했어요.'); });
  }

  // 올린 사진은 가운데를 정사각형으로 잘라서 800px로 줄인 뒤 보냄
  $('upload').onchange = e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = c.height = 800;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 800, 800);
      URL.revokeObjectURL(img.src);
      selectedPreset = null;
      sendImage(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => toast('이 파일은 사진으로 열 수 없어요.');
    img.src = URL.createObjectURL(file);
  };

  let qrFor = null, joinUrl = '';
  function loadQr() {
    if (qrFor === room.code) return;
    qrFor = room.code;
    fetch(`/api/qr?game=puzzle&code=${room.code}`).then(r => r.json()).then(({ url, svg }) => {
      joinUrl = url;
      $('qr').innerHTML = svg;
      $('qr-big').innerHTML = svg;
      $('join-url').textContent = url.replace(/^https?:\/\//, '');
    }).catch(() => { qrFor = null; });
  }
  $('btn-qr-big').onclick = () => { $('qr-big-code').textContent = room.code; $('qr-overlay').classList.remove('hidden'); };
  $('btn-qr-close').onclick = () => $('qr-overlay').classList.add('hidden');

  $('btn-copy').onclick = async () => {
    const link = joinUrl || `${location.origin}/puzzle/?code=${room.code}`;
    try { await navigator.clipboard.writeText(link); toast('링크를 복사했어요!'); }
    catch { toast(link); }
  };

  $('btn-start').onclick = () => socket.emit('start', null, res => { if (!res.ok && res.error) toast(res.error); });

  function totalPieces() {
    const n = room.settings.grid, s = room.settings.shape;
    if (s === 'square') return { text: `${n * n}`, max: n * n };
    if (s === 'triangle') return { text: `${n * n * 2}`, max: n * n * 2 };
    return { text: `약 ${Math.round(n * n * 1.5)}`, max: n * n * 2 };
  }

  function renderPlayers(list, opts = {}) {
    list.innerHTML = '';
    room.players.forEach(p => {
      const li = el('li');
      const dot = el('span', 'dot'); dot.style.background = p.color;
      li.append(dot, el('span', null, p.name));
      if (p.id === room.hostId) li.append(el('span', null, '👑'));
      if (p.id === me) li.append(el('span', 'me', '나'));
      if (opts.progress) {
        const bar = el('span', 'mini-bar'), fill = el('i');
        fill.style.background = p.color;
        fill.style.width = p.assigned ? `${(p.assigned - p.left) / p.assigned * 100}%` : '100%';
        bar.append(fill);
        li.append(bar, el('span', 'right', p.left ? `${p.left}개 남음` : '완료 ✔'));
      }
      if (opts.placed) li.append(el('span', 'right', `${p.placed}조각 맞춤`));
      list.append(li);
    });
  }

  function renderLobby() {
    $('lobby-code').textContent = room.code;
    loadQr();
    $('player-count').textContent = `(${room.players.length}명)`;
    renderPlayers($('player-list'));

    const host = isHost();
    document.querySelectorAll('.host-ctl').forEach(b => {
      if (b.tagName === 'LABEL') b.classList.toggle('hidden', !host);
      else b.disabled = !host;
    });
    $('host-only').classList.toggle('hidden', host);
    [...$('shape-seg').children].forEach(b => b.classList.toggle('sel', b.dataset.v === room.settings.shape));
    [...$('grid-seg').children].forEach(b => b.classList.toggle('sel', +b.dataset.v === room.settings.grid));
    [...$('presets').children].forEach(b => b.classList.toggle('sel', b.dataset.id === selectedPreset));

    const pv = $('preview');
    pv.classList.toggle('has', !!(room.hasImage && imageUrl));
    pv.style.backgroundImage = room.hasImage && imageUrl ? `url(${imageUrl})` : '';

    const t = totalPieces(), np = room.players.length;
    const per = Math.ceil(t.max / np);
    $('piece-info').innerHTML = '';
    $('piece-info').append(
      `${SHAPE_NAME[room.settings.shape]} 조각 `, el('b', null, `${t.text}개`), ` · 친구 ${np}명`, el('br'),
      `한 사람당 `, el('b', null, room.settings.shape === 'mixed' ? `약 ${Math.round(t.max * 0.75 / np)}개` : `${Math.floor(t.max / np)}${t.max % np ? `~${per}` : ''}개`),
      `씩 나눠 가져요`,
    );

    $('btn-start').classList.toggle('hidden', !host);
    $('btn-start').disabled = !room.hasImage;
    $('btn-start').textContent = room.hasImage ? '게임 시작!' : '사진을 먼저 골라 주세요';
    $('wait-msg').classList.toggle('hidden', host);
  }

  // ---------- 게임 화면 ----------
  function cell() { return boardSize / room.settings.grid; }

  function layoutBoard() {
    const n = room.settings.grid;
    let size;
    if (window.innerWidth <= 860) {
      size = Math.min(window.innerWidth - 48, window.innerHeight * 0.62);
    } else {
      const r = document.querySelector('.board-wrap').getBoundingClientRect();
      size = Math.min(r.width, r.height) - 24;
    }
    size = Math.max(n * 30, Math.floor(size / n) * n);
    if (size === boardSize) return false;
    boardSize = size;
    $('board').style.width = $('board').style.height = size + 'px';
    return true;
  }

  function drawGuides() {
    const key = room.startedAt + ':' + room.pieces.length;
    if (key === guidesKey) return;
    guidesKey = key;
    const n = room.settings.grid, svg = $('guides');
    svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
    svg.innerHTML = '';
    room.pieces.forEach(p => {
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', POLY[p.kind].map(([x, y]) => `${p.col + x},${p.row + y}`).join(' '));
      svg.append(poly);
    });
  }

  function makePiece(p) {
    const wrap = el('div', 'piece');
    const img = el('div', 'img');
    wrap.dataset.id = p.id;
    img.style.clipPath = CLIP[p.kind];
    wrap.style.setProperty('--clip', CLIP[p.kind]);
    img.addEventListener('pointerdown', onPointerDown);
    wrap.append(img);
    pieceEls.set(p.id, wrap);
    return wrap;
  }

  // 쟁반(내 조각 칸)에서는 조각을 작게 보여 주고, 끌 때는 실제 크기로 키운다.
  function trayCell() {
    const w = $('tray').clientWidth || 300;
    return Math.min(cell(), Math.max(64, Math.floor((w - 8 - 10 * 2) / 3)));
  }

  function stylePiece(wrap, p, size = cell()) {
    const k = size / cell(), img = wrap.firstChild;
    wrap.style.width = wrap.style.height = size + 'px';
    img.style.backgroundImage = `url(${imageUrl})`;
    img.style.backgroundSize = `${boardSize * k}px ${boardSize * k}px`;
    img.style.backgroundPosition = `${-p.col * size}px ${-p.row * size}px`;
  }

  function clearPieces() {
    pieceEls.forEach(e => e.remove());
    pieceEls.clear();
    placedSeen.clear();
    document.querySelectorAll('.slot-ph').forEach(e => e.remove());
    dragging = null;
    guidesKey = null;
  }

  function renderGame() {
    $('game-code').textContent = room.code;
    $('board').classList.toggle('hint', $('hint').checked);
    $('board-hint').style.backgroundImage = imageUrl ? `url(${imageUrl})` : '';
    layoutBoard();
    drawGuides();

    const c = cell(), tray = $('tray');
    const colorOf = id => (room.players.find(x => x.id === id) || {}).color || '#fff';

    room.pieces.forEach(p => {
      let wrap = pieceEls.get(p.id);
      if (p.placed) {
        if (!wrap) wrap = makePiece(p);
        if (dragging && dragging.id === p.id) endDrag(false);
        stylePiece(wrap, p);
        wrap.classList.remove('dragging', 'shake');
        wrap.style.left = p.col * c + 'px';
        wrap.style.top = p.row * c + 'px';
        if (wrap.parentNode !== $('placed-layer')) $('placed-layer').append(wrap);
        if (!placedSeen.has(p.id)) {
          placedSeen.add(p.id);
          if (p.placedBy !== me) {
            wrap.style.setProperty('--flash', colorOf(p.placedBy));
            wrap.classList.remove('flash'); void wrap.offsetWidth; wrap.classList.add('flash');
          }
        }
      } else if (p.owner === me) {
        if (!wrap) wrap = makePiece(p);
        if (dragging && dragging.id === p.id) { stylePiece(wrap, p); return; }
        stylePiece(wrap, p, trayCell());
        wrap.style.left = wrap.style.top = '';
        if (wrap.parentNode !== tray) tray.append(wrap);
      } else if (wrap) {
        if (dragging && dragging.id === p.id) endDrag(false);
        wrap.remove();
        pieceEls.delete(p.id);
      }
    });
    document.querySelectorAll('.slot-ph').forEach(ph => { ph.style.width = ph.style.height = trayCell() + 'px'; });

    const mine = room.players.find(p => p.id === me);
    const left = mine ? mine.left : 0;
    $('tray-title').textContent = left ? `내 조각 (${left}개 남음)` : '내 조각';
    $('tray-done').classList.toggle('hidden', left > 0 || room.status !== 'playing');
    tray.classList.toggle('hidden', left === 0);

    const placed = room.pieces.filter(p => p.placed).length, total = room.pieces.length;
    $('progress-bar').style.width = `${placed / total * 100}%`;
    $('progress-text').textContent = `${placed} / ${total} 조각`;
    renderPlayers($('game-players'), { progress: true });
    tick();

    if (room.status === 'done') showResult(); else $('result').classList.add('hidden');
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function tick() {
    if (!room || !room.startedAt) return;
    const end = room.finishedAt || (Date.now() + clockOffset);
    $('timer').textContent = fmtTime(end - room.startedAt);
  }
  setInterval(tick, 500);

  $('hint').onchange = () => $('board').classList.toggle('hint', $('hint').checked);

  // ---------- 드래그 ----------
  function onPointerDown(e) {
    const wrap = e.currentTarget.parentNode;
    const id = +wrap.dataset.id;
    const p = room && room.pieces.find(x => x.id === id);
    if (!p || p.placed || p.owner !== me || room.status !== 'playing' || dragging) return;
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    const ph = el('div', 'slot-ph');
    ph.style.width = ph.style.height = r.width + 'px';
    wrap.replaceWith(ph);
    document.body.append(wrap);
    wrap.classList.add('dragging');
    wrap.classList.remove('shake');
    stylePiece(wrap, p); // 실제 크기로
    const k = cell() / r.width;
    dragging = { id, wrap, ph, dx: (e.clientX - r.left) * k, dy: (e.clientY - r.top) * k, pointerId: e.pointerId, waiting: false };
    moveTo(e.clientX, e.clientY);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function moveTo(x, y) {
    dragging.wrap.style.left = x - dragging.dx + 'px';
    dragging.wrap.style.top = y - dragging.dy + 'px';
  }

  function onPointerMove(e) {
    if (dragging && e.pointerId === dragging.pointerId && !dragging.waiting) moveTo(e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    if (!dragging || e.pointerId !== dragging.pointerId) return;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);

    const b = $('board').getBoundingClientRect(), r = dragging.wrap.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const onBoard = cx > b.left && cx < b.right && cy > b.top && cy < b.bottom;
    if (!onBoard) return endDrag(false);

    const d = dragging;
    d.waiting = true;
    socket.emit('place', { pieceId: d.id, x: (r.left - b.left) / b.width, y: (r.top - b.top) / b.height }, res => {
      if (res.ok) {
        beep([660, 880]);
        const w = pieceEls.get(d.id);
        if (w) { w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop'); }
        return;
      }
      if (dragging === d) endDrag(true);
      if (res.wrong) { beep([220], 0.15); toast('앗, 거기가 아니에요! 다시 해 봐요'); }
    });
  }

  // 조각을 쟁반(내 조각 칸)으로 되돌림
  function endDrag(shake) {
    const d = dragging;
    if (!d) return;
    dragging = null;
    d.wrap.classList.remove('dragging');
    d.wrap.style.left = d.wrap.style.top = '';
    const p = room && room.pieces.find(x => x.id === d.id);
    if (p) stylePiece(d.wrap, p, trayCell());
    if (d.ph.isConnected) d.ph.replaceWith(d.wrap); else d.wrap.remove();
    if (shake) { void d.wrap.offsetWidth; d.wrap.classList.add('shake'); }
  }

  window.addEventListener('resize', () => { if (room && room.status !== 'lobby' && layoutBoard()) renderGame(); });

  // ---------- 결과 ----------
  function showResult() {
    $('result').classList.remove('hidden');
    $('result-time').textContent = `걸린 시간 ${fmtTime(room.finishedAt - room.startedAt)}`;
    $('result-img').src = imageData || '';
    renderPlayers($('result-players'), { placed: true });
    $('btn-again').classList.toggle('hidden', !isHost());
    $('result-wait').classList.toggle('hidden', isHost());
    if (resultShownFor !== room.startedAt) {
      resultShownFor = room.startedAt;
      beep([523, 659, 784, 1046], 0.14);
      confetti();
    }
  }
  $('btn-again').onclick = () => socket.emit('restart');

  function confetti() {
    const colors = ['#FF595E', '#FFCA3A', '#8AC926', '#1982C4', '#6A4C93', '#FF8FAB'];
    for (let i = 0; i < 90; i++) {
      const c = el('div', 'confetti');
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 2 + Math.random() * 2 + 's';
      c.style.animationDelay = Math.random() * 0.8 + 's';
      document.body.append(c);
      setTimeout(() => c.remove(), 5000);
    }
  }

  // ---------- 서버 이벤트 ----------
  socket.on('image', dataUrl => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageData = dataUrl;
    fetch(dataUrl).then(r => r.blob()).then(blob => {
      imageUrl = URL.createObjectURL(blob);
      if (room) render();
    });
  });

  socket.on('state', state => {
    const prev = room;
    room = state;
    clockOffset = state.serverNow - Date.now();
    if (prev && prev.startedAt !== state.startedAt) { clearPieces(); boardSize = 0; }
    render();
  });

  socket.on('disconnect', () => {
    if (room) { toast('연결이 끊겼어요. 다시 들어와 주세요.'); room = null; clearPieces(); show('home'); }
  });

  function render() {
    if (!room) return show('home');
    if (room.status === 'lobby') {
      show('lobby');
      $('result').classList.add('hidden');
      renderLobby();
    } else {
      show('game');
      $('qr-overlay').classList.add('hidden');
      if (imageUrl) renderGame();
    }
  }
})();
