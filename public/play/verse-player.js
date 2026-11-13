// 통합 플레이어 - 말씀 블록 게임 화면 (public/play/player.js가 불러 씀)
window.PlayGames = window.PlayGames || {};
window.PlayGames.verse = api => {
  const { $, el, toast, sound } = PZ;
  const socket = api.socket;
  let room = null, pid = null, selected = null, doneShownFor = null, lastSubmit = null;
  let press = null, drag = null;
  const meP = () => room && room.players.find(p => p.pid === pid);
  const myGroup = () => { const p = meP(); return p && p.group != null ? room.groups[p.group] : null; };
  const playerOf = id => (room && room.players.find(p => p.pid === id)) || {};
  let clockOffset = 0;

  const blockAt = (g, i) => g.blocks.find(b => b.slot === i);

  function renderGame() {
    const g = myGroup(), me = meP(), r = room.round;
    const instant = r.mode === 'instant';
    $('v-game-group').textContent = g.name;
    $('v-mode-chip').textContent = instant ? '맞는 칸에 넣으면 바로 고정돼요' : '모두 채우고 제출해요';
    $('v-ref-chip').classList.toggle('hidden', !r.ref);
    $('v-ref-chip').textContent = r.ref ? '📖 ' + r.ref : '';

    // 문장 줄
    $('v-sentence').replaceChildren(...Array.from({ length: r.slots }, (_, i) => {
      const b = blockAt(g, i);
      const s = el('div', 'slot');
      s.dataset.slot = i;
      s.append(el('span', 'num', i + 1));
      if (b) {
        const owner = playerOf(b.owner);
        s.classList.add('filled');
        if (b.locked) s.classList.add('locked');
        if (b.owner === pid && !b.locked) s.classList.add('mine');
        s.style.setProperty('--c', owner.color || '#9AA3AD');
        s.append(el('span', 'word', b.text), el('span', 'who', b.owner === pid ? '나' : (owner.name || '')));
        s.dataset.block = b.id;
      } else if (r.words) {
        s.append(el('span', 'ghost', r.words[i]));
      }
      return s;
    }));

    // 내 블록
    const mine = g.blocks.filter(b => b.owner === pid && b.slot == null);
    if (selected != null && !mine.some(b => b.id === selected)) selected = null;
    $('v-tray').replaceChildren(...mine.map(b => {
      const x = el('button', 'blk' + (b.id === selected ? ' sel' : ''), b.text);
      x.dataset.block = b.id;
      return x;
    }));
    const hasAny = me.assigned > 0;
    $('v-helper').classList.toggle('hidden', hasAny);
    $('v-tray-done').classList.toggle('hidden', !hasAny || mine.length > 0 || !!g.finishedAt);
    $('v-tray').classList.toggle('hidden', !mine.length);
    $('v-tray-tip').classList.toggle('hidden', !mine.length);
    $('v-tray-title').textContent = mine.length ? `내 블록 ${mine.length}개` : '내 블록';

    // B 방식 제출
    const filled = g.blocks.filter(b => b.slot != null).length;
    $('v-submit-area').classList.toggle('hidden', instant || !!g.finishedAt);
    updateSubmit();

    const done = instant ? g.blocks.filter(b => b.locked).length : filled;
    $('v-bar').style.width = `${(done / Math.max(1, r.slots)) * 100}%`;
    $('v-progress-text').textContent = instant ? `고정 ${done} / ${r.slots}` : `채움 ${filled} / ${r.slots}`;
    tick();

    if (g.finishedAt && doneShownFor !== room.startedAt) {
      doneShownFor = room.startedAt;
      $('v-done-text').textContent = `${g.rank}등으로 완성했어요! (${PZ.fmtTime(g.finishedAt - room.startedAt)})`;
      $('v-done-verse').textContent = g.blocks.slice().sort((a, b) => a.slot - b.slot).map(b => b.text).join(' ');
      $('v-done-ref').textContent = r.ref || '';
      $('v-done').classList.remove('hidden');
      sound.fanfare();
      PZ.confetti();
    }
  }
  $('v-btn-done-close').onclick = () => $('v-done').classList.add('hidden');

  function updateSubmit() {
    const g = myGroup();
    if (!g || room.round.mode !== 'submit') return;
    const full = g.blocks.every(b => b.slot != null);
    const wait = Math.ceil(((g.cooldownUntil || 0) - (Date.now() + clockOffset)) / 1000);
    $('v-btn-submit').disabled = !full || wait > 0;
    const msg = $('v-submit-msg');
    if (wait > 0) { msg.className = 'submit-msg bad'; msg.textContent = `${g.lastWrong}개가 틀렸어요 · ${wait}초 뒤 다시 제출`; }
    else if (lastSubmit && lastSubmit.startedAt === room.startedAt && !lastSubmit.correct) { msg.className = 'submit-msg bad'; msg.textContent = `${lastSubmit.wrong}개가 틀렸어요. 다시 맞춰 보세요`; }
    else { msg.className = 'submit-msg'; msg.textContent = full ? '다 채웠어요! 제출해 보세요' : '빈칸을 모두 채우면 제출할 수 있어요'; }
  }
  $('v-btn-submit').onclick = () => socket.emit('verse:submit', null, res => { if (!res.ok && res.error) toast(res.error); });

  function tick() {
    if (!room || !room.startedAt || room.status === 'lobby') return;
    const g = myGroup();
    $('v-timer').textContent = PZ.fmtTime(((g && g.finishedAt) || Date.now() + clockOffset) - room.startedAt);
    updateSubmit();
  }
  setInterval(tick, 500);

  // ---------- 누르기 / 끌기 ----------
  const place = (id, slot) => socket.emit('verse:place', { blockId: id, slot }, res => {
    if (!res.ok) { if (res.error) toast(res.error); return; }
    selected = null;
    if (res.locked) sound.good(); else sound.turn();
  });
  const unplace = id => socket.emit('verse:unplace', { blockId: id }, () => sound.turn());

  function slotFromPoint(x, y) {
    const t = document.elementFromPoint(x, y);
    return t && t.closest('.slot');
  }
  function playing() { return room && room.game === 'verse' && room.status === 'playing' && myGroup() && !myGroup().finishedAt; }

  document.addEventListener('pointerdown', e => {
    if (!playing()) return;
    const blk = e.target.closest('.blk');
    const slot = e.target.closest('.slot');
    if (blk) {
      e.preventDefault();
      press = { kind: 'tray', id: +blk.dataset.block, node: blk, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    } else if (slot && slot.classList.contains('mine')) {
      e.preventDefault();
      press = { kind: 'slot', id: +slot.dataset.block, node: slot, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    } else if (slot && !slot.classList.contains('filled') && selected != null) {
      place(selected, +slot.dataset.slot); // 고른 블록을 빈칸에
    }
  });

  document.addEventListener('pointermove', e => {
    if (!press || e.pointerId !== press.pointerId) return;
    if (!drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) {
      const g = myGroup(), b = g.blocks.find(x => x.id === press.id);
      const ghost = el('div', 'blk dragging', b.text);
      document.body.append(ghost);
      drag = { ghost, id: press.id, from: press.kind };
      if (press.kind === 'tray') press.node.style.visibility = 'hidden';
    }
    if (drag) {
      drag.ghost.style.left = e.clientX - 30 + 'px';
      drag.ghost.style.top = e.clientY - 28 + 'px';
      document.querySelectorAll('.slot.target').forEach(s => s.classList.remove('target'));
      const s = slotFromPoint(e.clientX, e.clientY);
      if (s && !s.classList.contains('filled')) s.classList.add('target');
    }
  });

  const endPress = e => {
    if (!press || e.pointerId !== press.pointerId) return;
    const p = press;
    press = null;
    document.querySelectorAll('.slot.target').forEach(s => s.classList.remove('target'));
    if (!drag) {
      // 누르기: 쟁반 블록은 고르기, 칸에 있는 내 블록은 빼기
      if (p.kind === 'tray') { selected = selected === p.id ? null : p.id; renderGame(); }
      else unplace(p.id);
      return;
    }
    const d = drag;
    drag = null;
    d.ghost.remove();
    p.node.style.visibility = '';
    const s = slotFromPoint(e.clientX, e.clientY);
    if (s && !s.classList.contains('filled')) place(d.id, +s.dataset.slot);
    else if (!s && d.from === 'slot') unplace(d.id); // 칸 밖에 놓으면 내 블록으로
    api.render(); // 끄는 동안 미뤄 둔 친구들의 변경을 화면에 반영
  };
  // 스크롤 등으로 브라우저가 누르기를 취소하면 아무것도 바꾸지 않고 원래대로
  const cancelPress = e => {
    if (!press || e.pointerId !== press.pointerId) return;
    const p = press;
    press = null;
    document.querySelectorAll('.slot.target').forEach(s => s.classList.remove('target'));
    if (drag) { drag.ghost.remove(); drag = null; }
    p.node.style.visibility = '';
    api.render();
  };
  document.addEventListener('pointerup', endPress);
  document.addEventListener('pointercancel', cancelPress);

  // ---------- 서버 이벤트 ----------
  socket.on('verse:block', d => {
    const g = room && room.groups[d.g];
    const b = g && g.blocks.find(x => x.id === d.b.id);
    if (!b) return;
    Object.assign(b, d.b);
    const me = meP();
    if (me && d.g === me.group) {
      const mine = g.blocks.filter(x => x.owner === pid);
      me.assigned = mine.length;
      me.left = mine.filter(x => x.slot == null).length;
    }
    if (!drag) api.render();
  });
  socket.on('verse:submitted', d => {
    const g = room && room.groups[d.group];
    if (!g) return;
    lastSubmit = { ...d, startedAt: room.startedAt };
    if (!d.correct) { g.cooldownUntil = d.cooldownUntil; g.lastWrong = d.wrong; sound.wrong(); }
    api.render();
  });

  return {
    joinData: () => ({}),
    setRoom(r) { room = r; pid = api.pid(); clockOffset = api.clockOffset(); },
    render(r) { room = r; pid = api.pid(); clockOffset = api.clockOffset(); if (!drag) renderGame(); },
    clear() { selected = null; lastSubmit = null; $('v-done').classList.add('hidden'); },
    busy: () => !!drag,
  };
};
