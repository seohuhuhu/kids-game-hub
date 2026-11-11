// CODE:Block 퍼즐 - 관리자 화면
(() => {
  const { $, el, toast, sound, store } = PZ;
  const socket = io('/puzzle');
  const ADMIN_KEY = 'cb-admin';

  let room = null;
  let img = null;
  let joinUrl = '';
  let selectedPreset = null;
  let clockOffset = 0;
  const minis = new Map();     // 그룹별 작은 퍼즐 판
  const flashes = [];          // 방금 맞춘 조각 (반짝 효과)

  // ---------- 로그인 / 방 ----------
  const saved = () => store.get(ADMIN_KEY);
  function showResume() {
    const s = saved();
    $('btn-resume').classList.toggle('hidden', !s);
    if (s) $('btn-resume').textContent = `이전 방(${s.code}) 이어서 관리하기`;
  }

  $('password').addEventListener('keydown', e => e.key === 'Enter' && $('btn-login').click());
  $('btn-login').onclick = () => {
    socket.emit('admin:login', { password: $('password').value }, res => {
      if (!res.ok) return toast(res.error);
      $('login-form').classList.add('hidden');
      $('room-actions').classList.remove('hidden');
      $('btn-login').classList.add('hidden');
      $('btn-create').classList.remove('hidden');
    });
  };
  $('btn-create').onclick = () => {
    socket.emit('admin:create', null, res => {
      if (!res.ok) return toast(res.error);
      store.set(ADMIN_KEY, { code: res.code, adminKey: res.adminKey });
    });
  };
  function resume(silent) {
    const s = saved();
    if (!s) return;
    socket.emit('admin:resume', s, res => {
      if (!res.ok) { store.del(ADMIN_KEY); showResume(); if (!silent) toast('그 방은 이미 닫혔어요.'); }
    });
  }
  $('btn-resume').onclick = () => resume(false);
  socket.on('connect', () => { if (room || saved()) resume(true); });
  showResume();

  $('btn-close').onclick = () => {
    if (!confirm('방을 닫으면 모든 플레이어가 나가게 돼요. 닫을까요?')) return;
    socket.emit('admin:close');
    store.del(ADMIN_KEY);
    location.reload();
  };

  // ---------- QR ----------
  let qrFor = null;
  function loadQr() {
    if (qrFor === room.code) return;
    qrFor = room.code;
    fetch(`/api/qr?game=puzzle&code=${room.code}`).then(r => r.json()).then(({ url, svg }) => {
      joinUrl = url;
      $('qr').innerHTML = svg;
      $('qr-big').innerHTML = svg;
      $('qr-url').textContent = url.replace(/^https?:\/\//, '');
    }).catch(() => { qrFor = null; });
  }
  $('btn-qr').onclick = () => { $('qr-big-code').textContent = room.code; $('qr-overlay').classList.remove('hidden'); };
  $('btn-qr-close').onclick = () => $('qr-overlay').classList.add('hidden');
  $('btn-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(joinUrl); toast('링크를 복사했어요'); } catch { toast(joinUrl); }
  };

  // ---------- 설정 ----------
  for (let n = 2; n <= 8; n++) {
    $('cols').append(new Option(n, n));
    $('rows').append(new Option(n, n));
  }
  const send = s => socket.emit('admin:settings', s);
  $('cols').onchange = e => send({ cols: +e.target.value });
  $('rows').onchange = e => send({ rows: +e.target.value });
  $('shape').onclick = e => e.target.dataset.v && send({ shape: e.target.dataset.v });
  $('g-minus').onclick = () => send({ groups: room.settings.groups - 1 });
  $('g-plus').onclick = () => send({ groups: room.settings.groups + 1 });

  function sendImage(dataUrl) {
    socket.emit('admin:image', dataUrl, res => { if (!res.ok) toast(res.error || '사진을 올리지 못했어요.'); });
  }
  PRESETS.forEach(p => {
    const b = el('button');
    b.title = p.name;
    b.dataset.id = p.id;
    b.style.backgroundImage = `url(${p.url})`;
    b.onclick = () => { selectedPreset = p.id; sendImage(p.url); };
    $('presets').append(b);
  });
  $('upload').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { selectedPreset = null; sendImage(await PZ.fileToDataUrl(f)); }
    catch { toast('이 파일은 사진으로 열 수 없어요.'); }
  };

  $('btn-start').onclick = () => socket.emit('admin:start', null, res => { if (!res.ok && res.error) toast(res.error); });
  $('btn-reset').onclick = () => {
    if (room.status === 'playing' && !confirm('아직 진행 중이에요. 이번 판을 끝내고 다음 판을 준비할까요?')) return;
    socket.emit('admin:reset');
  };
  $('btn-hint').onclick = () => socket.emit('admin:hint', { on: !room.hint });

  // ---------- 대기실 화면 ----------
  function piecesPerGroup() {
    const { rows, cols, shape } = room.settings, n = rows * cols;
    return shape === 'square' ? n : shape === 'triangle' ? n * 2 : Math.round(n * 1.5);
  }

  function chip(p, opts = {}) {
    const c = el('div', 'chip');
    const d = el('span', 'dot'); d.style.background = p.color;
    const on = el('span', 'online' + (p.online ? '' : ' off')); on.title = p.online ? '접속 중' : '접속 끊김';
    c.append(d, el('span', 'name', p.name), on);
    if (opts.left != null) c.append(el('span', 'left', opts.left ? `${opts.left}개 남음` : '완료 ✔'));
    if (opts.move) {
      const s = el('select');
      s.append(new Option('미정', ''));
      room.groups.forEach(g => s.append(new Option(g.name, g.index)));
      s.value = p.group == null ? '' : String(p.group);
      s.title = '그룹 옮기기';
      s.onchange = () => socket.emit('admin:move', { pid: p.pid, group: s.value === '' ? null : +s.value });
      c.append(s);
    }
    const x = el('button', 'x', '✕');
    x.title = '내보내기';
    x.onclick = () => confirm(`${p.name} 님을 내보낼까요?`) && socket.emit('admin:kick', { pid: p.pid });
    c.append(x);
    return c;
  }

  function renderLobby() {
    const { rows, cols, shape, groups } = room.settings;
    $('cols').value = cols;
    $('rows').value = rows;
    [...$('shape').children].forEach(b => b.classList.toggle('sel', b.dataset.v === shape));
    $('g-count').textContent = groups;
    $('g-minus').disabled = groups <= 1;
    $('g-plus').disabled = groups >= 10;
    [...$('presets').children].forEach(b => b.classList.toggle('sel', b.dataset.id === selectedPreset));
    const pv = $('preview');
    pv.style.aspectRatio = `${cols} / ${rows}`;
    pv.classList.toggle('has', !!img);
    pv.style.backgroundImage = img ? `url(${img.url})` : '';

    const per = piecesPerGroup();
    const sizes = room.groups.map(g => room.players.filter(p => p.group === g.index).length).filter(Boolean);
    const info = $('piece-info');
    info.innerHTML = '';
    info.append(`${cols}×${rows} ${PZ.SHAPE_NAME[shape]} → 그룹마다 `, el('b', null, `${shape === 'mixed' ? '약 ' : ''}${per}조각`));
    if (sizes.length) {
      info.append(el('br'), `참여 그룹 ${sizes.length}개 · 1인당 약 `, el('b', null, `${Math.floor(per / Math.max(...sizes))}~${Math.ceil(per / Math.min(...sizes))}조각`));
    }
    $('btn-start').disabled = !img || !sizes.length;
    $('btn-start').textContent = !img ? '사진을 먼저 넣어 주세요' : !sizes.length ? '참가자를 기다리는 중…' : '게임 시작';

    $('player-total').textContent = `${room.players.length}명`;
    const un = room.players.filter(p => p.group == null);
    $('unassigned').replaceChildren(...un.map(p => chip(p, { move: true })));
    if (!un.length) $('unassigned').append(el('span', 'muted small', '모두 그룹을 골랐어요'));

    $('group-board').replaceChildren(...room.groups.map(g => {
      const members = room.players.filter(p => p.group === g.index);
      const col = el('div', 'gcol');
      const head = el('div', 'gcol-head');
      head.append(el('b', null, g.name), el('span', 'muted', `${members.length}명`));
      const list = el('div', 'chips');
      if (members.length) list.append(...members.map(p => chip(p, { move: true })));
      else list.append(el('div', 'empty', '아직 아무도 없어요'));
      col.append(head, list);
      return col;
    }));
  }

  // ---------- 게임 화면 ----------
  function miniFor(g) {
    const { rows, cols } = room.settings;
    const key = room.startedAt + ':' + g.index;
    let m = minis.get(g.index);
    if (!m || m.key !== key) {
      const board = el('div', 'board');
      const hint = el('div', 'hintimg');
      const guides = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      guides.classList.add('guides');
      const layer = el('div', 'layer');
      board.append(hint, guides, layer);
      const cell = Math.floor(Math.min(270 / cols, 230 / rows));
      board.style.width = cell * cols + 'px';
      board.style.height = cell * rows + 'px';
      PZ.drawGuides(guides, g.pieces, rows, cols);
      m = { key, board, hint, layer, cell, W: cell * cols, H: cell * rows, els: new Map() };
      minis.set(g.index, m);
    }
    m.hint.style.backgroundImage = img ? `url(${img.url})` : '';
    m.board.classList.toggle('hint', room.hint);
    if (img) {
      g.pieces.filter(p => p.placed).forEach(p => {
        let w = m.els.get(p.id);
        if (!w) {
          w = PZ.makePiece(p);
          m.els.set(p.id, w);
          w.style.left = p.col * m.cell + 'px';
          w.style.top = p.row * m.cell + 'px';
          m.layer.append(w);
        }
        PZ.stylePiece(w, p, { img, cell: m.cell, W: m.W, H: m.H });
      });
    }
    return m;
  }

  function renderGame() {
    const btn = $('btn-hint');
    btn.classList.toggle('on', room.hint);
    btn.textContent = room.hint ? '💡 힌트 끄기' : '💡 전체 힌트 보여주기';
    $('btn-reset').textContent = room.status === 'done' ? '다음 판 준비' : '게임 끝내기';

    const active = room.groups.filter(g => g.active);
    const finished = active.filter(g => g.finishedAt).sort((a, b) => a.rank - b.rank);
    const rk = $('ranking');
    rk.classList.toggle('hidden', !finished.length);
    rk.replaceChildren(el('b', null, room.status === 'done' ? '🏆 최종 순위' : '🏁 완성한 그룹'),
      ...finished.map(g => el('span', 'rank-chip', `${g.rank}등 ${g.name} · ${PZ.fmtTime(g.finishedAt - room.startedAt)}`)));

    $('game-groups').replaceChildren(...active.map(g => {
      const card = el('div', 'gcard' + (g.finishedAt ? ' done' : ''));
      card.dataset.group = g.index;
      const head = el('div', 'gcard-head');
      head.append(el('b', null, g.name));
      if (g.rank) head.append(el('span', 'rank', `${g.rank}등`));
      const wrap = el('div', 'mini-wrap');
      wrap.append(miniFor(g).board);
      const bar = el('div', 'bar'), fill = el('i');
      fill.style.width = `${g.placed / g.total * 100}%`;
      bar.append(fill);
      const stat = el('div', 'stat');
      stat.append(el('span', null, `${g.placed} / ${g.total} 조각`),
        el('span', null, g.finishedAt ? `완성 ${PZ.fmtTime(g.finishedAt - room.startedAt)}` : `${Math.round(g.placed / g.total * 100)}%`));
      const chips = el('div', 'chips');
      room.players.filter(p => p.group === g.index).forEach(p => chips.append(chip(p, { left: p.left })));
      card.append(head, wrap, bar, stat, chips);
      return card;
    }));

    // 방금 맞춘 조각 반짝
    while (flashes.length) {
      const f = flashes.shift(), m = minis.get(f.group), w = m && m.els.get(f.pieceId);
      if (w) {
        w.style.setProperty('--flash', f.color);
        w.classList.remove('flash'); void w.offsetWidth; w.classList.add('flash');
      }
      const card = document.querySelector(`.gcard[data-group="${f.group}"]`);
      if (card) { card.classList.add('ping'); setTimeout(() => card.classList.remove('ping'), 500); }
    }
    tick();
  }

  function tick() {
    if (!room || !room.startedAt || room.status === 'lobby') return;
    const active = room.groups.filter(g => g.active);
    const end = room.status === 'done' ? Math.max(...active.map(g => g.finishedAt)) : Date.now() + clockOffset;
    $('timer').textContent = PZ.fmtTime(end - room.startedAt);
  }
  setInterval(tick, 500);

  // ---------- 서버 이벤트 ----------
  socket.on('image', dataUrl => {
    PZ.loadImage(dataUrl).then(i => { if (img) URL.revokeObjectURL(img.url); img = i; if (room) render(); });
  });

  socket.on('placed', ({ group, pieceId, by, groupDone, rank }) => {
    const p = room && room.players.find(x => x.pid === by);
    flashes.push({ group, pieceId, color: (p && p.color) || '#22D3EE' });
    if (!$('sound-on').checked) return;
    if (groupDone) {
      sound.fanfare();
      PZ.confetti(60);
      toast(`🎉 ${group + 1}그룹 완성! ${rank}등`);
    } else {
      sound.ding();
    }
  });

  socket.on('state', s => {
    const wasLobby = !room || room.status === 'lobby';
    room = s;
    clockOffset = s.serverNow - Date.now();
    if (wasLobby && s.status !== 'lobby') minis.clear();
    render();
  });

  function render() {
    $('s-login').classList.add('hidden');
    $('s-admin').classList.remove('hidden');
    $('top-code').textContent = room.code;
    $('qr-code').textContent = room.code;
    $('top-status').textContent = { lobby: '🟢 대기 중', playing: '🧩 게임 중', done: '🏆 끝' }[room.status];
    loadQr();
    const lobby = room.status === 'lobby';
    $('v-lobby').classList.toggle('hidden', !lobby);
    $('v-game').classList.toggle('hidden', lobby);
    if (lobby) renderLobby(); else renderGame();
  }
})();
