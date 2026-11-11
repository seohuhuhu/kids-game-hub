// CODE:Block 퍼즐 - 플레이어 화면
(() => {
  const { $, el, toast, sound, store } = PZ;
  const socket = io('/puzzle');
  const SESSION_KEY = 'cb-session';

  let code = null;          // 확인된 입장 코드
  let pid = null;           // 내 플레이어 id
  let room = null;          // 방 상태
  let img = null;           // {url,w,h,dataUrl}
  let selectedGroup = null;
  let clockOffset = 0;
  let cell = 0, W = 0, H = 0;
  let gameKey = null;
  let doneShownFor = null;
  const pieceEls = new Map();
  const placedSeen = new Set();
  let press = null;         // 누르고 있는 조각
  let drag = null;          // 끌고 있는 조각
  let lastTap = null;

  // ---------- 화면 전환 ----------
  const SCREENS = ['code', 'profile', 'group', 'wait', 'game'];
  function show(name) { SCREENS.forEach(s => $('s-' + s).classList.toggle('hidden', s !== name)); }

  const meP = () => room && room.players.find(p => p.pid === pid);
  const myGroup = () => { const p = meP(); return p && p.group != null ? room.groups[p.group] : null; };

  // ---------- 1. 입장 코드 ----------
  const urlCode = new URLSearchParams(location.search).get('code');
  if (/^\d{4}$/.test(urlCode || '')) $('code').value = urlCode;
  $('code').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
  $('code').addEventListener('keydown', e => e.key === 'Enter' && $('btn-code').click());

  $('btn-code').onclick = () => {
    const c = $('code').value.trim();
    if (!/^\d{4}$/.test(c)) return toast('입장 코드 4자리를 입력해 주세요.');
    socket.emit('p:check', { code: c }, res => {
      if (!res.ok) return toast(res.error);
      code = c;
      const saved = store.get(SESSION_KEY);
      if (saved && saved.code === c) { $('name').value = saved.name; $('pin').value = saved.pin; }
      show('profile');
      setTimeout(() => $(saved && saved.code === c ? 'btn-join' : 'name').focus(), 50);
    });
  };

  // ---------- 2. 이름 + 비밀번호 ----------
  $('pin').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
  $('pin').addEventListener('keydown', e => e.key === 'Enter' && $('btn-join').click());
  $('btn-back-code').onclick = () => show('code');

  function join(name, pin, silent) {
    socket.emit('p:join', { code, name, pin }, res => {
      if (!res.ok) {
        if (silent) { store.del(SESSION_KEY); show('code'); }
        return toast(res.error);
      }
      pid = res.pid;
      store.set(SESSION_KEY, { code, name, pin });
      history.replaceState(null, '', '?code=' + code);
      if (res.rejoined && !silent) toast('다시 돌아왔어요! 하던 퍼즐을 이어서 해요');
    });
  }
  $('btn-join').onclick = () => {
    const name = $('name').value.trim(), pin = $('pin').value.trim();
    if (!name) return toast('이름을 입력해 주세요.');
    if (!/^\d{4}$/.test(pin)) return toast('비밀번호는 숫자 4자리예요.');
    join(name, pin);
  };

  // 새로고침/연결 끊김 뒤 자동으로 다시 들어가기
  socket.on('connect', () => {
    const saved = store.get(SESSION_KEY);
    const target = pid ? code : (urlCode || null);
    if (saved && saved.code && (pid || saved.code === target)) {
      code = saved.code;
      join(saved.name, saved.pin, true);
    }
  });

  function resetToStart(msg) {
    pid = null; room = null; code = null;
    clearGame();
    store.del(SESSION_KEY);
    show('code');
    if (msg) toast(msg);
  }
  socket.on('kicked', msg => resetToStart(msg || '선생님이 방에서 내보냈어요.'));
  socket.on('closed', () => resetToStart('선생님이 방을 닫았어요.'));
  $('btn-leave').onclick = () => { socket.emit('p:leave'); resetToStart(); };

  // ---------- 3. 그룹 선택 ----------
  function renderGroups() {
    $('hello-name').textContent = meP().name;
    const list = $('group-list');
    list.innerHTML = '';
    room.groups.forEach(g => {
      const members = room.players.filter(p => p.group === g.index);
      const b = el('button', 'group-btn' + (selectedGroup === g.index ? ' sel' : ''));
      b.append(el('b', null, g.name), el('span', 'cnt', `${members.length}명`), el('span', 'names', members.map(m => m.name).join(', ')));
      b.onclick = () => { selectedGroup = g.index; renderGroups(); };
      list.append(b);
    });
    if (selectedGroup != null && selectedGroup >= room.groups.length) selectedGroup = null;
    $('btn-group').disabled = selectedGroup == null;
  }
  $('btn-group').onclick = () => {
    if (selectedGroup == null) return;
    $('confirm-group').textContent = room.groups[selectedGroup].name;
    $('confirm').classList.remove('hidden');
  };
  $('btn-cancel').onclick = () => $('confirm').classList.add('hidden');
  $('btn-accept').onclick = () => {
    socket.emit('p:group', { group: selectedGroup }, res => {
      $('confirm').classList.add('hidden');
      if (!res.ok) toast(res.error);
    });
  };

  // ---------- 4. 대기 ----------
  function renderWait() {
    const p = meP(), list = $('wait-members');
    $('wait-group').textContent = p.group != null ? room.groups[p.group].name : '구경 중';
    list.innerHTML = '';
    room.players.filter(x => x.group === p.group && p.group != null).forEach(m => {
      const li = el('li');
      const d = el('span', 'dot'); d.style.background = m.color;
      li.append(d, el('span', null, m.name));
      if (m.pid === pid) li.append(el('span', 'me', '나'));
      list.append(li);
    });
    const sub = document.querySelector('#s-wait .cb-sub');
    sub.textContent = room.status === 'lobby' ? '선생님이 게임을 시작할 때까지 기다려 주세요'
      : '이번 판에는 그룹이 없어 참여하지 못했어요. 다음 판을 기다려 주세요';
  }

  // ---------- 5. 게임 ----------
  function layout() {
    const { rows, cols } = room.settings;
    let maxW, maxH;
    if (window.innerWidth <= 820) {
      maxW = window.innerWidth - 44;
      maxH = window.innerHeight * 0.46;
    } else {
      const r = $('board-wrap').getBoundingClientRect();
      maxW = r.width - 30;
      maxH = r.height - 60;
    }
    const c = Math.max(24, Math.floor(Math.min(maxW / cols, maxH / rows)));
    if (c === cell) return false;
    cell = c; W = c * cols; H = c * rows;
    $('board').style.width = W + 'px';
    $('board').style.height = H + 'px';
    return true;
  }

  function trayCell() {
    const w = $('tray').clientWidth || 300;
    return Math.min(cell, Math.max(60, Math.floor((w - 8 - 12 * 3) / 4)), 110);
  }

  function clearGame() {
    pieceEls.forEach(e => e.remove());
    pieceEls.clear();
    placedSeen.clear();
    document.querySelectorAll('.slot-ph').forEach(e => e.remove());
    drag = press = null;
    gameKey = null;
    cell = 0;
  }

  const style = (wrap, p, size) => PZ.stylePiece(wrap, p, { img, cell, size, W, H, rot: p.placed ? 0 : p.rot });

  function renderGame() {
    const g = myGroup();
    const key = room.startedAt + ':' + g.index;
    if (key !== gameKey) { clearGame(); gameKey = key; }
    layout();
    PZ.drawGuides($('guides'), g.pieces, room.settings.rows, room.settings.cols);
    $('hintimg').style.backgroundImage = `url(${img.url})`;
    $('board').classList.toggle('hint', room.hint);
    $('hint-on').classList.toggle('hidden', !room.hint);
    $('game-group').textContent = g.name;

    const tray = $('tray'), tc = trayCell();
    const colorOf = id => (room.players.find(x => x.pid === id) || {}).color;
    g.pieces.forEach(p => {
      let wrap = pieceEls.get(p.id);
      if (p.placed) {
        if (!wrap) { wrap = PZ.makePiece(p, onDown); pieceEls.set(p.id, wrap); }
        if (drag && drag.id === p.id) endDrag(false);
        style(wrap, p, cell);
        wrap.classList.remove('dragging', 'shake');
        wrap.style.left = p.col * cell + 'px';
        wrap.style.top = p.row * cell + 'px';
        if (wrap.parentNode !== $('layer')) $('layer').append(wrap);
        if (!placedSeen.has(p.id)) {
          placedSeen.add(p.id);
          if (p.placedBy !== pid) {
            wrap.style.setProperty('--flash', colorOf(p.placedBy) || '#fff');
            wrap.classList.remove('flash'); void wrap.offsetWidth; wrap.classList.add('flash');
          }
        }
      } else if (p.owner === pid) {
        if (!wrap) { wrap = PZ.makePiece(p, onDown); pieceEls.set(p.id, wrap); }
        if (drag && drag.id === p.id) { style(wrap, p, cell); return; }
        style(wrap, p, tc);
        wrap.style.left = wrap.style.top = '';
        if (wrap.parentNode !== tray) tray.append(wrap);
      } else if (wrap) {
        if (drag && drag.id === p.id) endDrag(false);
        wrap.remove();
        pieceEls.delete(p.id);
      }
    });
    document.querySelectorAll('.slot-ph').forEach(ph => { ph.style.width = ph.style.height = tc + 'px'; });

    const me = meP();
    $('tray-title').textContent = me.left ? `내 조각 ${me.left}개` : '내 조각';
    const finishedMine = me.left === 0;
    $('tray-done').classList.toggle('hidden', !finishedMine || !!g.finishedAt);
    tray.classList.toggle('hidden', finishedMine);
    document.querySelector('.tray-head .tip').classList.toggle('hidden', finishedMine);

    $('bar').style.width = `${g.placed / g.total * 100}%`;
    $('progress-text').textContent = `${g.placed} / ${g.total}`;
    tick();

    if (g.finishedAt && doneShownFor !== key) {
      doneShownFor = key;
      $('done-text').textContent = `${g.rank}등으로 완성했어요! (${PZ.fmtTime(g.finishedAt - room.startedAt)})`;
      $('done-img').src = img.dataUrl;
      $('done').classList.remove('hidden');
      sound.fanfare();
      PZ.confetti();
    }
  }
  $('btn-done-close').onclick = () => $('done').classList.add('hidden');

  function tick() {
    if (!room || !room.startedAt || room.status === 'lobby') return;
    const g = myGroup();
    const end = (g && g.finishedAt) || Date.now() + clockOffset;
    $('timer').textContent = PZ.fmtTime(end - room.startedAt);
  }
  setInterval(tick, 500);

  // ---------- 누르기 / 두 번 눌러 돌리기 / 끌어 놓기 ----------
  function onDown(e) {
    if (press || drag || !room || room.status !== 'playing') return;
    const wrap = e.currentTarget.parentNode, id = +wrap.dataset.id;
    const p = myGroup().pieces.find(x => x.id === id);
    if (!p || p.placed || p.owner !== pid) return;
    e.preventDefault();
    press = { id, wrap, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function startDrag(e) {
    const { id, wrap } = press;
    const p = myGroup().pieces.find(x => x.id === id);
    const r = wrap.getBoundingClientRect();
    const ph = el('div', 'slot-ph');
    ph.style.width = ph.style.height = r.width + 'px';
    wrap.replaceWith(ph);
    document.body.append(wrap);
    wrap.classList.add('dragging');
    wrap.classList.remove('shake', 'pop');
    style(wrap, p, cell);
    const k = cell / r.width;
    drag = { id, wrap, ph, dx: (press.x - r.left) * k, dy: (press.y - r.top) * k, pointerId: press.pointerId, waiting: false };
    moveTo(e.clientX, e.clientY);
  }

  function moveTo(x, y) {
    drag.wrap.style.left = x - drag.dx + 'px';
    drag.wrap.style.top = y - drag.dy + 'px';
  }

  function onMove(e) {
    if (press && e.pointerId === press.pointerId && !drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) startDrag(e);
      return;
    }
    if (drag && e.pointerId === drag.pointerId && !drag.waiting) moveTo(e.clientX, e.clientY);
  }

  function onUp(e) {
    if (!press || e.pointerId !== press.pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    const id = press.id;
    press = null;
    if (!drag) return onTap(id);
    drop();
  }

  function onTap(id) {
    const now = Date.now();
    if (lastTap && lastTap.id === id && now - lastTap.t < 380) {
      lastTap = null;
      rotate(id);
    } else {
      lastTap = { id, t: now };
    }
  }

  function rotate(id) {
    const p = myGroup().pieces.find(x => x.id === id);
    if (!p) return;
    p.rot = (p.rot + 1) % 4; // 바로 돌려 보이기
    const w = pieceEls.get(id);
    if (w) style(w, p, trayCell());
    sound.turn();
    socket.emit('p:rotate', { pieceId: id });
  }

  function drop() {
    const b = $('board').getBoundingClientRect(), r = drag.wrap.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) return endDrag(false);
    const d = drag;
    d.waiting = true;
    socket.emit('p:place', { pieceId: d.id, x: (r.left - b.left) / b.width, y: (r.top - b.top) / b.height }, res => {
      if (res.ok) {
        sound.good();
        const w = pieceEls.get(d.id);
        if (w) { w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop'); }
        return;
      }
      if (drag === d) endDrag(true);
      sound.wrong();
      if (res.wrong === 'rot') toast('자리는 맞았어요! 두 번 눌러서 방향을 돌려 보세요 🔄');
      else if (res.wrong) toast('앗, 거기가 아니에요! 다시 해 봐요');
    });
  }

  function endDrag(shake) {
    const d = drag;
    if (!d) return;
    drag = null;
    d.wrap.classList.remove('dragging');
    d.wrap.style.left = d.wrap.style.top = '';
    const g = myGroup(), p = g && g.pieces.find(x => x.id === d.id);
    if (p && !p.placed) style(d.wrap, p, trayCell());
    if (d.ph.isConnected) d.ph.replaceWith(d.wrap); else d.wrap.remove();
    if (shake) { void d.wrap.offsetWidth; d.wrap.classList.add('shake'); }
  }

  window.addEventListener('resize', () => { if (room && myGroup() && room.status !== 'lobby' && img && layout()) renderGame(); });

  // ---------- 서버 이벤트 ----------
  socket.on('image', dataUrl => {
    PZ.loadImage(dataUrl).then(i => { if (img) URL.revokeObjectURL(img.url); img = i; if (room) render(); });
  });

  socket.on('state', s => {
    room = s;
    clockOffset = s.serverNow - Date.now();
    render();
  });

  function render() {
    if (!pid || !room) return;
    const me = meP();
    if (!me) return;
    if (room.status === 'lobby') {
      clearGame();
      $('done').classList.add('hidden');
      if (me.group == null) { show('group'); renderGroups(); }
      else { $('confirm').classList.add('hidden'); show('wait'); renderWait(); }
      return;
    }
    const g = myGroup();
    if (!g || !g.active) { show('wait'); renderWait(); return; }
    show('game');
    if (img) renderGame();
  }
})();
