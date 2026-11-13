// 놀이터 통합 관리자 - 방·QR·참가자·그룹·게임 고르기와 게임별 화면 전환
(() => {
  const { $, el, toast, store } = PZ;
  const socket = io('/play');
  const ADMIN_KEY = 'play-admin';
  const STATUS = { lobby: '🟢 대기 중', playing: '▶ 게임 중', done: '🏆 끝' };

  let room = null, joinUrl = '', clockOffset = 0, raf = null;

  // ---------- 참가자 칩 / 그룹 이름 (게임 화면에서도 씀) ----------
  const editingName = () => document.activeElement && document.activeElement.classList.contains('gname');
  function nameInput(g) {
    const i = el('input', 'gname');
    i.value = g.name;
    i.maxLength = 10;
    i.title = '눌러서 그룹 이름 바꾸기';
    const save = () => {
      const v = i.value.trim();
      if (v && v !== g.name) socket.emit('admin:rename', { group: g.index, name: v });
      else i.value = g.name;
    };
    i.onkeydown = e => { if (e.key === 'Enter') i.blur(); if (e.key === 'Escape') { i.value = g.name; i.blur(); } };
    i.onblur = save;
    return i;
  }
  function chip(p, opts = {}) {
    const c = el('div', 'chip');
    const d = el('span', 'dot'); d.style.background = p.color;
    const on = el('span', 'online' + (p.online ? '' : ' off')); on.title = p.online ? '접속 중' : '접속 끊김';
    c.append(d, el('span', 'name', p.name), on);
    if (opts.left != null) c.append(el('span', 'left', opts.left));
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

  // 게임별 화면 (puzzle-admin.js, verse-admin.js)
  const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = null; if (room) render(); }); };
  const api = {
    socket, render: later, chip, nameInput, editingName,
    soundOn: () => $('sound-on').checked, clockOffset: () => clockOffset,
  };
  const games = Object.fromEntries(Object.entries(window.AdminGames).map(([id, make]) => [id, make(api)]));

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
      $('login-ok').textContent = '로그인했어요. 방을 만들어 주세요.';
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
      if (!res.ok) {
        store.del(ADMIN_KEY);
        showResume();
        if (room) roomLost();
        else if (!silent) toast('그 방은 이미 닫혔어요.');
      }
    });
  }
  $('btn-resume').onclick = () => resume(false);
  socket.on('connect', () => { if (room || saved()) resume(true); });
  showResume();

  // 서버가 다시 시작되면(배포·Render 재시작) 서버 메모리의 방이 사라진다.
  // 사라진 방 화면에 머물지 않도록 알리고 처음(로그인) 화면으로 돌아간다.
  function roomLost() {
    room = null;
    qrFor = null;
    Object.values(games).forEach(g => g.reset());
    $('s-admin').classList.add('hidden');
    $('s-login').classList.remove('hidden');
    $('login-form').classList.remove('hidden');
    $('room-actions').classList.remove('hidden');
    $('login-ok').textContent = '⚠ 서버가 다시 시작되어 방이 사라졌어요. 다시 로그인해서 새 방을 만들어 주세요.';
    $('btn-login').classList.remove('hidden');
    $('btn-create').classList.add('hidden');
    toast('서버가 다시 시작되어 방이 사라졌어요');
  }

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
    fetch(`/api/qr?game=play&code=${room.code}`).then(r => r.json()).then(({ url, svg }) => {
      joinUrl = url;
      $('qr').innerHTML = svg;
      $('qr-big').innerHTML = svg;
      $('qr-url').textContent = url.replace(/^https?:\/\//, '');
    }).catch(() => { qrFor = null; });
  }
  $('btn-qr').onclick = () => { $('qr-big-code').textContent = room.code; $('qr-overlay').classList.remove('hidden'); };
  $('btn-qr-close').onclick = () => $('qr-overlay').classList.add('hidden');
  window.addEventListener('keydown', e => { if (e.key === 'Escape') $('qr-overlay').classList.add('hidden'); });
  $('btn-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(joinUrl); toast('링크를 복사했어요'); } catch { toast(joinUrl); }
  };

  // ---------- 게임 고르기 / 그룹 수 / 시작 ----------
  $('game-tabs').onclick = e => {
    const b = e.target.closest('button');
    if (b && room && room.status === 'lobby') socket.emit('admin:game', { id: b.dataset.v });
  };
  $('g-minus').onclick = () => socket.emit('admin:settings', { groups: room.settings.groups - 1 });
  $('g-plus').onclick = () => socket.emit('admin:settings', { groups: room.settings.groups + 1 });
  $('btn-start').onclick = () => socket.emit('admin:start', null, res => { if (!res.ok && res.error) toast(res.error); });
  $('btn-reset').onclick = () => {
    if (room.status === 'playing' && !confirm('아직 진행 중이에요. 이번 게임을 끝내고 다음 게임을 준비할까요?')) return;
    socket.emit('admin:reset');
  };

  // ---------- 대기실 ----------
  function renderLobby() {
    const n = room.settings.groups, game = room.game;
    $('g-count').textContent = n;
    $('g-minus').disabled = n <= 1;
    $('g-plus').disabled = n >= 10;
    [...$('game-tabs').children].forEach(b => b.classList.toggle('sel', b.dataset.v === game));
    ['puzzle', 'verse'].forEach(id => $('panel-' + id).classList.toggle('hidden', game !== id));
    $('verse-editor').classList.toggle('hidden', game !== 'verse');
    $('pick-hint').classList.toggle('hidden', !!game);
    if (game) games[game].renderLobby();

    const withPeople = room.groups.filter(g => room.players.some(p => p.group === g.index)).length;
    const can = game ? games[game].canStart() : { ok: false, reason: '이번 게임을 골라 주세요' };
    $('btn-start').disabled = !can.ok || !withPeople;
    $('btn-start').textContent = !can.ok ? can.reason : !withPeople ? '참가자를 기다리는 중…' : `${games[game].title} 시작`;

    $('player-total').textContent = `${room.players.length}명`;
    const un = room.players.filter(p => p.group == null);
    $('unassigned').replaceChildren(...(un.length ? un.map(p => chip(p, { move: true })) : [el('span', 'muted small', '모두 그룹을 골랐어요')]));
    if (!editingName()) $('group-board').replaceChildren(...room.groups.map(g => {
      const members = room.players.filter(p => p.group === g.index);
      const col = el('div', 'gcol'), head = el('div', 'gcol-head'), list = el('div', 'chips');
      head.append(nameInput(g), el('span', 'muted', `${members.length}명`));
      if (members.length) list.append(...members.map(p => chip(p, { move: true })));
      else list.append(el('div', 'empty', '아직 아무도 없어요'));
      col.append(head, list);
      return col;
    }));
  }

  // ---------- 게임 중 ----------
  function renderGame() {
    const game = room.game;
    ['puzzle', 'verse'].forEach(id => $('ctl-' + id).classList.toggle('hidden', game !== id));
    $('game-pill').textContent = games[game].title;
    $('btn-reset').textContent = room.status === 'done' ? '다음 게임 준비' : '게임 끝내기';
    const finished = room.groups.filter(g => g.active && g.finishedAt).sort((a, b) => a.rank - b.rank);
    $('ranking').classList.toggle('hidden', !finished.length);
    $('ranking').replaceChildren(el('b', null, room.status === 'done' ? '🏆 최종 순위' : '🏁 완성한 그룹'),
      ...finished.map(g => el('span', 'rank-chip', `${g.rank}등 ${g.name} · ${PZ.fmtTime(g.finishedAt - room.startedAt)}`)));
    games[game].renderGame();
    tick();
  }

  function tick() {
    if (!room || !room.startedAt || room.status === 'lobby') return;
    const active = room.groups.filter(g => g.active);
    const end = room.status === 'done' && active.length ? Math.max(...active.map(g => g.finishedAt)) : Date.now() + clockOffset;
    $('timer').textContent = PZ.fmtTime(end - room.startedAt);
  }
  setInterval(tick, 500);

  // ---------- 서버 이벤트 ----------
  socket.on('state', s => {
    const prev = room;
    room = s;
    clockOffset = s.serverNow - Date.now();
    Object.values(games).forEach(g => g.setRoom(s, prev));
    render();
  });
  socket.on('presence', ({ pid, online }) => {
    const p = room && room.players.find(x => x.pid === pid);
    if (p) { p.online = online; later(); }
  });

  function render() {
    $('s-login').classList.add('hidden');
    $('s-admin').classList.remove('hidden');
    $('top-code').textContent = room.code;
    $('qr-code').textContent = room.code;
    $('top-status').textContent = STATUS[room.status];
    $('btn-photo').classList.toggle('hidden', room.game !== 'puzzle');
    $('btn-verse-big').classList.toggle('hidden', room.game !== 'verse');
    loadQr();
    const lobby = room.status === 'lobby';
    $('v-lobby').classList.toggle('hidden', !lobby);
    $('v-game').classList.toggle('hidden', lobby);
    if (lobby) renderLobby(); else renderGame();
  }
})();
