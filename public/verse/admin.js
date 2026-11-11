// 말씀 블록 - 관리자 화면
(() => {
  const { $, el, toast, sound, store } = PZ;
  const socket = io('/verse');
  const ADMIN_KEY = 'vb-admin';

  let room = null, verses = { current: null, items: [] }, joinUrl = '', clockOffset = 0;
  const pings = []; // 방금 고정된 칸 (반짝 효과)

  // 서버와 같은 규칙: '/'가 있으면 '/' 기준, 없으면 띄어쓰기 기준
  const splitBlocks = text => {
    const s = String(text || '');
    return (s.includes('/') ? s.split('/') : s.split(/\s+/)).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  };

  // ---------- 로그인 / 방 ----------
  const saved = () => store.get(ADMIN_KEY);
  function showResume() {
    const s = saved();
    $('btn-resume').classList.toggle('hidden', !s);
    if (s) $('btn-resume').textContent = `이전 방(${s.code}) 이어서 관리하기`;
  }
  $('password').addEventListener('keydown', e => e.key === 'Enter' && $('btn-login').click());
  $('btn-login').onclick = () => socket.emit('admin:login', { password: $('password').value }, res => {
    if (!res.ok) return toast(res.error);
    $('login-form').classList.add('hidden');
    $('login-ok').classList.remove('hidden');
    $('btn-login').classList.add('hidden');
    $('btn-create').classList.remove('hidden');
  });
  $('btn-create').onclick = () => socket.emit('admin:create', null, res => {
    if (!res.ok) return toast(res.error);
    store.set(ADMIN_KEY, { code: res.code, adminKey: res.adminKey });
  });
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
    fetch(`/api/qr?game=verse&code=${room.code}`).then(r => r.json()).then(({ url, svg }) => {
      joinUrl = url;
      $('qr').innerHTML = svg;
      $('qr-big').innerHTML = svg;
      $('qr-url').textContent = url.replace(/^https?:\/\//, '');
    }).catch(() => { qrFor = null; });
  }
  $('btn-qr').onclick = () => { $('qr-big-code').textContent = room.code; $('qr-overlay').classList.remove('hidden'); };
  $('btn-qr-close').onclick = () => $('qr-overlay').classList.add('hidden');
  $('btn-copy').onclick = async () => { try { await navigator.clipboard.writeText(joinUrl); toast('링크를 복사했어요'); } catch { toast(joinUrl); } };

  // ---------- 구절 크게 보기 (교실 화면 전용) ----------
  const verseNow = () => room && room.round.verse;
  $('btn-verse-big').onclick = () => {
    const v = verseNow();
    if (!v) return;
    $('verse-big').textContent = v.blocks.join(' ');
    $('verse-big-ref').textContent = v.ref;
    $('verse-overlay').classList.remove('hidden');
  };
  const closeVerse = () => $('verse-overlay').classList.add('hidden');
  $('btn-verse-close').onclick = closeVerse;
  $('verse-overlay').onclick = e => { if (e.target === $('verse-overlay')) closeVerse(); };
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { closeVerse(); $('qr-overlay').classList.add('hidden'); } });

  // ---------- 설정 / 구절 ----------
  $('g-minus').onclick = () => socket.emit('admin:settings', { groups: room.settings.groups - 1 });
  $('g-plus').onclick = () => socket.emit('admin:settings', { groups: room.settings.groups + 1 });
  $('mode').onclick = e => { const b = e.target.closest('button'); if (b) socket.emit('admin:round', { mode: b.dataset.v }); };

  function renderPreview() {
    const blocks = splitBlocks($('verse-text').value);
    const box = $('verse-preview');
    box.replaceChildren(...blocks.map(b => el('span', 'pv', b)));
    if (blocks.length) box.append(el('span', 'pv-count', `블록 ${blocks.length}개${blocks.length > 30 ? ' · 최대 30개예요' : ''}`));
  }
  $('verse-text').addEventListener('input', renderPreview);
  $('btn-add-verse').onclick = () => {
    const text = $('verse-text').value, ref = $('verse-ref').value;
    socket.emit('admin:addVerse', { text, ref }, res => {
      if (!res.ok) return toast(res.error || '추가하지 못했어요.');
      // 그 사이에 새로 입력한 내용은 지우지 않음
      if ($('verse-text').value === text) $('verse-text').value = '';
      if ($('verse-ref').value === ref) $('verse-ref').value = '';
      renderPreview();
      toast('구절을 추가했어요');
    });
  };

  function renderVerses() {
    const list = $('verse-list');
    if (!verses.items.length) { list.replaceChildren(el('span', 'muted small', '아직 구절이 없어요')); return; }
    list.replaceChildren(...verses.items.map(v => {
      const b = el('button', 'verse-item' + (v.id === verses.current ? ' sel' : ''));
      b.append(el('b', null, v.blocks.join(' ')), el('small', null, `${v.ref || '참조 없음'} · 블록 ${v.blocks.length}개`));
      b.onclick = () => room.status === 'lobby' && socket.emit('admin:round', { verseId: v.id });
      const del = el('button', 'del', '✕');
      del.title = '목록에서 지우기';
      del.onclick = ev => { ev.stopPropagation(); if (confirm('이 구절을 목록에서 지울까요?')) socket.emit('admin:deleteVerse', { id: v.id }); };
      b.append(del);
      return b;
    }));
  }
  socket.on('verses', v => { verses = v; renderVerses(); });

  $('btn-start').onclick = () => socket.emit('admin:start', null, res => { if (!res.ok && res.error) toast(res.error); });
  $('btn-reset').onclick = () => {
    if (room.status === 'playing' && !confirm('아직 진행 중이에요. 이번 라운드를 끝내고 다음 라운드를 준비할까요?')) return;
    socket.emit('admin:reset');
  };
  $('btn-hint-ref').onclick = () => socket.emit('admin:hint', { ref: !room.hint.ref });
  $('btn-hint-first').onclick = () => socket.emit('admin:hint', { first: !room.hint.first });

  // ---------- 참가자 ----------
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
    const on = el('span', 'online' + (p.online ? '' : ' off'));
    c.append(d, el('span', 'name', p.name), on);
    if (opts.left != null) c.append(el('span', 'left', p.assigned === 0 ? '도우미' : p.left ? `${p.left}개 남음` : '다 넣음 ✔'));
    if (opts.move) {
      const s = el('select');
      s.append(new Option('미정', ''));
      room.groups.forEach(g => s.append(new Option(g.name, g.index)));
      s.value = p.group == null ? '' : String(p.group);
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
    const n = room.settings.groups;
    $('g-count').textContent = n;
    $('g-minus').disabled = n <= 1;
    $('g-plus').disabled = n >= 10;
    [...$('mode').children].forEach(b => b.classList.toggle('sel', b.dataset.v === room.round.mode));
    const v = verseNow();
    const cur = $('current-verse');
    if (v) { cur.replaceChildren(document.createTextNode(v.blocks.join(' ')), el('span', 'ref', `${v.ref || '참조 없음'} · 블록 ${v.blocks.length}개`)); }
    else cur.replaceChildren(el('span', 'muted small', '아래에서 구절을 추가하고 골라 주세요'));

    const groupsWithPeople = room.groups.filter(g => room.players.some(p => p.group === g.index)).length;
    $('btn-start').disabled = !v || !groupsWithPeople;
    $('btn-start').textContent = !v ? '구절을 먼저 골라 주세요' : !groupsWithPeople ? '참가자를 기다리는 중…' : '게임 시작';

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

  function renderGame() {
    const instant = room.round.mode === 'instant';
    $('mode-pill').textContent = instant ? 'A. 칸마다 바로 확인' : 'B. 다 채우고 제출';
    $('btn-hint-ref').classList.toggle('on', room.hint.ref);
    $('btn-hint-ref').textContent = room.hint.ref ? '📖 참조 숨기기' : '📖 참조 보여주기';
    $('btn-hint-first').classList.toggle('on', room.hint.first);
    $('btn-hint-first').textContent = room.hint.first ? '🔤 첫 글자 숨기기' : '🔤 첫 글자 보여주기';
    $('btn-reset').textContent = room.status === 'done' ? '다음 라운드 준비' : '게임 끝내기';

    const active = room.groups.filter(g => g.active);
    const finished = active.filter(g => g.finishedAt).sort((a, b) => a.rank - b.rank);
    $('ranking').classList.toggle('hidden', !finished.length);
    $('ranking').replaceChildren(el('b', null, room.status === 'done' ? '🏆 최종 순위' : '🏁 완성한 그룹'),
      ...finished.map(g => el('span', 'rank-chip', `${g.rank}등 ${g.name} · ${PZ.fmtTime(g.finishedAt - room.startedAt)}`)));

    const now = Date.now() + clockOffset;
    if (!editingName()) $('game-groups').replaceChildren(...active.map(g => {
      const card = el('div', 'gcard' + (g.finishedAt ? ' done' : ''));
      const head = el('div', 'gcard-head');
      head.append(nameInput(g));
      if (g.rank) head.append(el('span', 'rank', `${g.rank}등`));
      const line = el('div', 'vb-line');
      for (let i = 0; i < room.round.slots; i++) {
        const b = g.blocks.find(x => x.slot === i);
        const s = el('div', 'vb-slot');
        s.append(el('span', 'n', i + 1));
        if (b) {
          const owner = room.players.find(p => p.pid === b.owner) || {};
          s.classList.add('filled');
          if (b.locked) s.classList.add('locked');
          s.style.setProperty('--c', owner.color || '#9AA3AD');
          s.append(b.text);
          if (pings.some(p => p.g === g.index && p.id === b.id)) s.classList.add('ping');
        } else s.append(' ');
        line.append(s);
      }
      const filled = g.blocks.filter(b => b.slot != null).length, locked = g.blocks.filter(b => b.locked).length;
      const bar = el('div', 'bar'), fill = el('i');
      fill.style.width = `${((instant ? locked : filled) / Math.max(1, g.blocks.length)) * 100}%`;
      bar.append(fill);
      const stat = el('div', 'stat');
      stat.append(el('span', null, instant ? `고정 ${locked} / ${g.blocks.length}` : `채움 ${filled} / ${g.blocks.length}`),
        el('span', null, g.finishedAt ? `완성 ${PZ.fmtTime(g.finishedAt - room.startedAt)}` : ''));
      card.append(head, line, bar, stat);
      if (!instant && !g.finishedAt && g.lastWrong != null) {
        const wait = Math.ceil((g.cooldownUntil - now) / 1000);
        card.append(el('div', 'submit-state bad', `마지막 제출: ${g.lastWrong}개 틀림${wait > 0 ? ` · ${wait}초 대기` : ''}`));
      }
      const chips = el('div', 'chips');
      room.players.filter(p => p.group === g.index).forEach(p => chips.append(chip(p, { left: true })));
      card.append(chips);
      return card;
    }));
    pings.length = 0;
    tick();
  }

  function tick() {
    if (!room || !room.startedAt || room.status === 'lobby') return;
    const active = room.groups.filter(g => g.active);
    const end = room.status === 'done' ? Math.max(...active.map(g => g.finishedAt)) : Date.now() + clockOffset;
    $('timer').textContent = PZ.fmtTime(end - room.startedAt);
  }
  setInterval(tick, 500);
  setInterval(() => { if (room && room.status === 'playing' && room.round.mode === 'submit') later(); }, 1000);

  // ---------- 서버 이벤트 ----------
  let raf = null;
  const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = null; render(); }); };
  function recount(gi) {
    const g = room.groups[gi];
    room.players.forEach(p => {
      if (p.group !== gi) return;
      const mine = g.blocks.filter(b => b.owner === p.pid);
      p.assigned = mine.length;
      p.left = mine.filter(b => b.slot == null).length;
    });
  }
  socket.on('block', d => {
    const g = room && room.groups[d.g], b = g && g.blocks.find(x => x.id === d.b.id);
    if (!b) return;
    Object.assign(b, d.b);
    recount(d.g);
    later();
  });
  socket.on('locked', d => {
    const g = room && room.groups[d.group], b = g && g.blocks.find(x => x.id === d.blockId);
    if (b) { b.locked = true; pings.push({ g: d.group, id: d.blockId }); }
    if ($('sound-on').checked) sound.ding();
    later();
  });
  socket.on('submitted', d => {
    const g = room && room.groups[d.group];
    if (g && !d.correct) { g.lastWrong = d.wrong; g.cooldownUntil = d.cooldownUntil; if ($('sound-on').checked) sound.wrong(); }
    later();
  });
  socket.on('done', d => {
    if ($('sound-on').checked) { sound.fanfare(); PZ.confetti(60); }
    toast(`🎉 ${room.groups[d.group].name} 완성! ${d.rank}등`);
  });
  socket.on('presence', ({ pid, online }) => {
    const p = room && room.players.find(x => x.pid === pid);
    if (p) { p.online = online; later(); }
  });
  socket.on('state', s => {
    room = s;
    clockOffset = s.serverNow - Date.now();
    render();
  });

  function render() {
    $('s-login').classList.add('hidden');
    $('s-admin').classList.remove('hidden');
    $('top-code').textContent = room.code;
    $('qr-code').textContent = room.code;
    $('top-status').textContent = { lobby: '🟢 대기 중', playing: '📖 게임 중', done: '🏆 끝' }[room.status];
    $('btn-verse-big').disabled = !verseNow();
    loadQr();
    const lobby = room.status === 'lobby';
    $('v-lobby').classList.toggle('hidden', !lobby);
    $('v-game').classList.toggle('hidden', lobby);
    if (lobby) renderLobby(); else renderGame();
  }
})();
