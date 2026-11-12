// 통합 플레이어 - 퍼즐 게임 화면 (public/play/player.js가 불러 씀)
window.PlayGames = window.PlayGames || {};
window.PlayGames.puzzle = api => {
  const { $, el, toast, sound } = PZ;
  const socket = api.socket;
  let room = null, pid = null, img = null, imageVer = null;
  let cell = 0, W = 0, H = 0, gameKey = null, doneShownFor = null;
  const pieceEls = new Map(), placedSeen = new Set();
  let press = null, drag = null, lastTap = null;
  const meP = () => room && room.players.find(p => p.pid === pid);
  const myGroup = () => { const p = meP(); return p && p.group != null ? room.groups[p.group] : null; };
  const clockOffset = () => api.clockOffset();

  function layout() {
    const { rows, cols } = room.round;
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
  const pending = new Map();   // 서버 확인을 기다리는 내 조각 위치 (깜빡임 방지)
  const posOf = p => (pending.has(p.id) ? pending.get(p.id) : p.pos);
  const playerOf = id => room.players.find(x => x.pid === id) || {};

  function putLoose(wrap, pos) {
    wrap.style.left = pos.x * W + 'px';
    wrap.style.top = pos.y * H + 'px';
    if (wrap.parentNode !== $('loose')) $('loose').append(wrap);
  }

  function renderGame() {
    const g = myGroup();
    const key = room.startedAt + ':' + g.index;
    if (key !== gameKey) { clearGame(); gameKey = key; }
    layout();
    PZ.drawGuides($('guides'), g.pieces, room.round.rows, room.round.cols);
    $('hintimg').style.backgroundImage = `url(${img.url})`;
    $('board').classList.toggle('hint', room.round.hint);
    $('board').style.setProperty('--op', room.round.opacity);
    $('hint-on').classList.toggle('hidden', !room.round.hint);
    $('game-group').textContent = g.name;

    const tray = $('tray'), tc = trayCell();
    g.pieces.forEach(p => {
      let wrap = pieceEls.get(p.id);
      const pos = posOf(p);
      const mine = p.owner === pid;
      if (p.placed) {
        // 정답 자리에 고정된 조각
        if (!wrap) { wrap = PZ.makePiece(p, onDown); pieceEls.set(p.id, wrap); }
        if (drag && drag.id === p.id) endDrag();
        pending.delete(p.id);
        style(wrap, p, cell);
        wrap.classList.remove('dragging', 'shake', 'mine', 'other');
        wrap.removeAttribute('data-name');
        wrap.style.left = p.col * cell + 'px';
        wrap.style.top = p.row * cell + 'px';
        if (wrap.parentNode !== $('layer')) $('layer').append(wrap);
        if (!placedSeen.has(p.id)) {
          placedSeen.add(p.id);
          if (p.placedBy !== pid) {
            wrap.style.setProperty('--flash', playerOf(p.placedBy).color || '#fff');
            wrap.classList.remove('flash'); void wrap.offsetWidth; wrap.classList.add('flash');
          }
        }
      } else if (pos) {
        // 판 위에 올려 둔 조각: 내 것은 또렷하게, 친구 것은 관리자가 정한 투명도로
        if (!wrap) { wrap = PZ.makePiece(p, onDown); pieceEls.set(p.id, wrap); }
        if (drag && drag.id === p.id) { style(wrap, p, cell); return; }
        style(wrap, p, cell);
        wrap.classList.toggle('mine', mine);
        wrap.classList.toggle('other', !mine);
        if (mine) wrap.removeAttribute('data-name');
        else {
          const o = playerOf(p.owner);
          wrap.dataset.name = o.name || '';
          wrap.style.setProperty('--c', o.color || '#888');
        }
        putLoose(wrap, pos);
      } else if (mine) {
        if (!wrap) { wrap = PZ.makePiece(p, onDown); pieceEls.set(p.id, wrap); }
        if (drag && drag.id === p.id) { style(wrap, p, cell); return; }
        wrap.classList.remove('mine', 'other');
        style(wrap, p, tc);
        wrap.style.left = wrap.style.top = '';
        if (wrap.parentNode !== tray) tray.append(wrap);
      } else if (wrap) {
        if (drag && drag.id === p.id) endDrag();
        wrap.remove();
        pieceEls.delete(p.id);
      }
    });
    document.querySelectorAll('.slot-ph').forEach(ph => { ph.style.width = ph.style.height = tc + 'px'; });

    const me = meP();
    const inTray = g.pieces.filter(p => p.owner === pid && !p.placed && !posOf(p)).length;
    const onBoard = me.left - inTray;
    $('tray-title').textContent = me.left ? `내 조각 ${me.left}개` + (onBoard ? ` (판 위 ${onBoard})` : '') : '내 조각';
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
    const end = (g && g.finishedAt) || Date.now() + clockOffset();
    $('timer').textContent = PZ.fmtTime(end - room.startedAt);
  }
  setInterval(tick, 500);

  // ---------- 누르기 / 두 번 눌러 돌리기 / 끌어 놓기 ----------
  const pieceById = id => { const g = myGroup(); return g && g.pieces && g.pieces.find(x => x.id === id); };

  function onDown(e) {
    if (press || drag || !room || room.status !== 'playing') return;
    const wrap = e.currentTarget.parentNode, id = +wrap.dataset.id;
    const p = pieceById(id);
    if (!p || p.placed || p.owner !== pid) return;
    e.preventDefault();
    press = { id, wrap, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function startDrag(e) {
    const { id, wrap } = press;
    const p = pieceById(id);
    const r = wrap.getBoundingClientRect();
    let ph = null;
    if (wrap.parentNode === $('tray')) {   // 쟁반에서 꺼낼 때만 빈자리 표시
      ph = el('div', 'slot-ph');
      ph.style.width = ph.style.height = r.width + 'px';
      wrap.replaceWith(ph);
    }
    document.body.append(wrap);
    wrap.classList.add('dragging');
    wrap.classList.remove('shake', 'pop');
    style(wrap, p, cell);
    const k = cell / r.width;
    drag = { id, wrap, ph, dx: (press.x - r.left) * k, dy: (press.y - r.top) * k, pointerId: press.pointerId };
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
    if (drag && e.pointerId === drag.pointerId) moveTo(e.clientX, e.clientY);
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
    const p = pieceById(id);
    if (!p) return;
    p.rot = (p.rot + 1) % 4; // 바로 돌려 보이기
    const w = pieceEls.get(id);
    if (w) style(w, p, posOf(p) ? cell : trayCell());
    sound.turn();
    socket.emit('puzzle:rotate', { pieceId: id }, res => { if (res && res.placed) sound.good(); });
  }

  function sendMove(id, pos) {
    pending.set(id, pos);
    socket.emit('puzzle:move', { pieceId: id, x: pos ? pos.x : null, y: pos ? pos.y : null }, res => {
      pending.delete(id);
      if (!res || !res.ok) return room && api.render();
      if (res.placed) {
        sound.good();
        const w = pieceEls.get(id);
        if (w) { w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop'); }
      }
    });
  }

  function drop() {
    const d = drag, p = pieceById(d.id);
    // 끄는 사이에 게임이 끝났으면(대기실로) 조각을 내려놓고 새 상태로 다시 그림
    if (!p || !room || room.status !== 'playing') return endDrag();
    const b = $('board').getBoundingClientRect(), r = d.wrap.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const onBoard = cx > b.left && cx < b.right && cy > b.top && cy < b.bottom;
    if (!onBoard) {
      // 판 밖에 놓으면 쟁반으로 되돌림
      const wasOnBoard = !!posOf(p);
      endDrag();
      if (wasOnBoard) { sendMove(d.id, null); api.render(); }
      return;
    }
    const pos = { x: (r.left - b.left) / b.width, y: (r.top - b.top) / b.height };
    drag = null;
    d.wrap.classList.remove('dragging');
    if (d.ph) d.ph.remove();
    sendMove(d.id, pos);
    putLoose(d.wrap, pos);
    api.render();
  }

  // 끌던 조각을 원래 있던 곳(쟁반 빈자리 또는 판 위 자리)으로 돌려놓음
  function endDrag() {
    const d = drag;
    if (!d) return;
    drag = null;
    d.wrap.classList.remove('dragging');
    d.wrap.style.left = d.wrap.style.top = '';
    if (d.ph && d.ph.isConnected) d.ph.replaceWith(d.wrap);
    else if (!d.ph) d.wrap.remove(), pieceEls.delete(d.id);
    else d.wrap.remove();
    api.render(); // 끄는 동안 미뤄 둔 새 상태로 다시 그림
  }

  window.addEventListener('resize', () => { if (room && myGroup() && room.status !== 'lobby' && img && layout()) renderGame(); });


  // ---------- 서버 이벤트 ----------
  socket.on('puzzle:image', d => {
    imageVer = d.ver;
    PZ.loadImage(d.dataUrl).then(i => { if (img) URL.revokeObjectURL(img.url); img = i; api.render(); });
  });
  socket.on('puzzle:piece', d => { if (room && room.game === 'puzzle' && PZ.applyPiece(room, d)) api.render(); });

  return {
    joinData: () => ({ imageVer: img ? imageVer : null }),
    setRoom(r) { room = r; pid = api.pid(); },
    render(r) { room = r; pid = api.pid(); if (img) renderGame(); },
    clear() { clearGame(); $('done').classList.add('hidden'); },
    busy: () => !!drag,
  };
};
