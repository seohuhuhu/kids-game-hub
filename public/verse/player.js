// 말씀 블록 - 플레이어 화면
(() => {
  const { $, el, toast, sound, store } = PZ;
  const socket = io('/verse');
  const SESSION_KEY = 'vb-session';

  let code = null, pid = null, room = null;
  let selectedGroup = null, selected = null; // 고른 그룹, 고른 내 블록 id
  let clockOffset = 0, doneShownFor = null, lastSubmit = null;
  let press = null, drag = null;

  const SCREENS = ['code', 'profile', 'group', 'wait', 'game'];
  const show = name => SCREENS.forEach(s => $('s-' + s).classList.toggle('hidden', s !== name));
  const meP = () => room && room.players.find(p => p.pid === pid);
  const myGroup = () => { const p = meP(); return p && p.group != null ? room.groups[p.group] : null; };
  const playerOf = id => (room && room.players.find(p => p.pid === id)) || {};

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
      if (res.rejoined && !silent) toast('다시 돌아왔어요! 이어서 해요');
    });
  }
  $('btn-join').onclick = () => {
    const name = $('name').value.trim(), pin = $('pin').value.trim();
    if (!name) return toast('이름을 입력해 주세요.');
    if (!/^\d{4}$/.test(pin)) return toast('비밀번호는 숫자 4자리예요.');
    join(name, pin);
  };

  // 새로고침·연결 끊김 뒤 자동 재입장
  socket.on('connect', () => {
    const saved = store.get(SESSION_KEY);
    const target = pid ? code : (urlCode || null);
    if (saved && saved.code && (pid || saved.code === target)) { code = saved.code; join(saved.name, saved.pin, true); }
  });

  function resetToStart(msg) {
    pid = null; room = null; code = null; selected = null;
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
    if (selectedGroup != null && selectedGroup >= room.groups.length) selectedGroup = null;
    $('group-list').replaceChildren(...room.groups.map(g => {
      const members = room.players.filter(p => p.group === g.index);
      const b = el('button', 'group-btn' + (selectedGroup === g.index ? ' sel' : ''));
      b.append(el('b', null, g.name), el('span', 'cnt', `${members.length}명`), el('span', 'names', members.map(m => m.name).join(', ')));
      b.onclick = () => { selectedGroup = g.index; renderGroups(); };
      return b;
    }));
    $('btn-group').disabled = selectedGroup == null;
  }
  $('btn-group').onclick = () => {
    if (selectedGroup == null) return;
    $('confirm-group').textContent = room.groups[selectedGroup].name;
    $('confirm').classList.remove('hidden');
  };
  $('btn-cancel').onclick = () => $('confirm').classList.add('hidden');
  $('btn-accept').onclick = () => socket.emit('p:group', { group: selectedGroup }, res => {
    $('confirm').classList.add('hidden');
    if (!res.ok) toast(res.error);
  });

  // ---------- 4. 대기 ----------
  function renderWait() {
    const p = meP();
    $('wait-group').textContent = p.group != null ? room.groups[p.group].name : '구경 중';
    $('wait-members').replaceChildren(...room.players.filter(x => p.group != null && x.group === p.group).map(m => {
      const li = el('li'), d = el('span', 'dot');
      d.style.background = m.color;
      li.append(d, el('span', null, m.name));
      if (m.pid === pid) li.append(el('span', 'me', '나'));
      return li;
    }));
    $('wait-text').textContent = room.status === 'lobby' ? '선생님이 게임을 시작할 때까지 기다려 주세요'
      : '이번 판에는 그룹이 없어 참여하지 못했어요. 다음 판을 기다려 주세요';
  }

  // ---------- 5. 게임 ----------
  const blockAt = (g, i) => g.blocks.find(b => b.slot === i);

  function renderGame() {
    const g = myGroup(), me = meP(), r = room.round;
    const instant = r.mode === 'instant';
    $('game-group').textContent = g.name;
    $('mode-chip').textContent = instant ? '맞는 칸에 넣으면 바로 고정돼요' : '모두 채우고 제출해요';
    $('ref-chip').classList.toggle('hidden', !r.ref);
    $('ref-chip').textContent = r.ref ? '📖 ' + r.ref : '';

    // 문장 줄
    $('sentence').replaceChildren(...Array.from({ length: r.slots }, (_, i) => {
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
      } else if (r.first) {
        s.append(el('span', 'ghost', r.first[i]));
      }
      return s;
    }));

    // 내 블록
    const mine = g.blocks.filter(b => b.owner === pid && b.slot == null);
    if (selected != null && !mine.some(b => b.id === selected)) selected = null;
    $('tray').replaceChildren(...mine.map(b => {
      const x = el('button', 'blk' + (b.id === selected ? ' sel' : ''), b.text);
      x.dataset.block = b.id;
      return x;
    }));
    const hasAny = me.assigned > 0;
    $('helper').classList.toggle('hidden', hasAny);
    $('tray-done').classList.toggle('hidden', !hasAny || mine.length > 0 || !!g.finishedAt);
    $('tray').classList.toggle('hidden', !mine.length);
    $('tray-tip').classList.toggle('hidden', !mine.length);
    $('tray-title').textContent = mine.length ? `내 블록 ${mine.length}개` : '내 블록';

    // B 방식 제출
    const filled = g.blocks.filter(b => b.slot != null).length;
    $('submit-area').classList.toggle('hidden', instant || !!g.finishedAt);
    updateSubmit();

    const done = instant ? g.blocks.filter(b => b.locked).length : filled;
    $('bar').style.width = `${(done / Math.max(1, r.slots)) * 100}%`;
    $('progress-text').textContent = instant ? `고정 ${done} / ${r.slots}` : `채움 ${filled} / ${r.slots}`;
    tick();

    if (g.finishedAt && doneShownFor !== room.startedAt) {
      doneShownFor = room.startedAt;
      $('done-text').textContent = `${g.rank}등으로 완성했어요! (${PZ.fmtTime(g.finishedAt - room.startedAt)})`;
      $('done-verse').textContent = g.blocks.slice().sort((a, b) => a.slot - b.slot).map(b => b.text).join(' ');
      $('done-ref').textContent = r.ref || '';
      $('done').classList.remove('hidden');
      sound.fanfare();
      PZ.confetti();
    }
  }
  $('btn-done-close').onclick = () => $('done').classList.add('hidden');

  function updateSubmit() {
    const g = myGroup();
    if (!g || room.round.mode !== 'submit') return;
    const full = g.blocks.every(b => b.slot != null);
    const wait = Math.ceil(((g.cooldownUntil || 0) - (Date.now() + clockOffset)) / 1000);
    $('btn-submit').disabled = !full || wait > 0;
    const msg = $('submit-msg');
    if (wait > 0) { msg.className = 'submit-msg bad'; msg.textContent = `${g.lastWrong}개가 틀렸어요 · ${wait}초 뒤 다시 제출`; }
    else if (lastSubmit && lastSubmit.startedAt === room.startedAt && !lastSubmit.correct) { msg.className = 'submit-msg bad'; msg.textContent = `${lastSubmit.wrong}개가 틀렸어요. 다시 맞춰 보세요`; }
    else { msg.className = 'submit-msg'; msg.textContent = full ? '다 채웠어요! 제출해 보세요' : '빈칸을 모두 채우면 제출할 수 있어요'; }
  }
  $('btn-submit').onclick = () => socket.emit('p:submit', null, res => { if (!res.ok && res.error) toast(res.error); });

  function tick() {
    if (!room || !room.startedAt || room.status === 'lobby') return;
    const g = myGroup();
    $('timer').textContent = PZ.fmtTime(((g && g.finishedAt) || Date.now() + clockOffset) - room.startedAt);
    updateSubmit();
  }
  setInterval(tick, 500);

  // ---------- 누르기 / 끌기 ----------
  const place = (id, slot) => socket.emit('p:place', { blockId: id, slot }, res => {
    if (!res.ok) { if (res.error) toast(res.error); return; }
    selected = null;
    if (res.locked) sound.good(); else sound.turn();
  });
  const unplace = id => socket.emit('p:unplace', { blockId: id }, () => sound.turn());

  function slotFromPoint(x, y) {
    const t = document.elementFromPoint(x, y);
    return t && t.closest('.slot');
  }
  function playing() { return room && room.status === 'playing' && myGroup() && !myGroup().finishedAt; }

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
  };
  document.addEventListener('pointerup', endPress);
  document.addEventListener('pointercancel', endPress);

  // ---------- 서버 이벤트 ----------
  socket.on('block', d => {
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
    if (!drag) render();
  });
  socket.on('submitted', d => {
    const g = room && room.groups[d.group];
    if (!g) return;
    lastSubmit = { ...d, startedAt: room.startedAt };
    if (!d.correct) { g.cooldownUntil = d.cooldownUntil; g.lastWrong = d.wrong; sound.wrong(); }
    render();
  });
  socket.on('presence', ({ pid: who, online }) => { const p = playerOf(who); if (p.pid) p.online = online; });
  socket.on('state', s => {
    room = s;
    clockOffset = s.serverNow - Date.now();
    if (!drag) render();
  });

  function render() {
    if (!pid || !room) return;
    const me = meP();
    if (!me) return;
    if (room.status === 'lobby') {
      $('done').classList.add('hidden');
      lastSubmit = null;
      if (me.group == null) { show('group'); renderGroups(); }
      else { $('confirm').classList.add('hidden'); show('wait'); renderWait(); }
      return;
    }
    const g = myGroup();
    if (!g || !g.active) { show('wait'); renderWait(); return; }
    show('game');
    renderGame();
  }
})();
