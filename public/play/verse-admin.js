// 통합 관리자 - 말씀 블록 설정·진행 화면 (public/play/admin.js가 불러 씀)
window.AdminGames = window.AdminGames || {};
window.AdminGames.verse = api => {
  const { $, el, toast, sound } = PZ;
  const socket = api.socket;
  let room = null, verses = { current: null, items: [] };
  const pings = []; // 방금 고정된 칸 (반짝 효과)
  const R = () => room.rounds.verse; // 확인 방식·칸 수·힌트·구절(관리자만)

  // 서버와 같은 규칙: '/'가 있으면 '/' 기준, 없으면 띄어쓰기 기준
  const splitBlocks = text => {
    const s = String(text || '');
    return (s.includes('/') ? s.split('/') : s.split(/\s+/)).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  };

  // ---------- 구절 크게 보기 (교실 화면 전용) ----------
  const verseNow = () => room && R().verse;
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
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeVerse(); });

  // ---------- 설정 / 구절 ----------
  $('mode').onclick = e => { const b = e.target.closest('button'); if (b) socket.emit('verse:round', { mode: b.dataset.v }); };

  function renderPreview() {
    const blocks = splitBlocks($('verse-text').value);
    const box = $('verse-preview');
    box.replaceChildren(...blocks.map(b => el('span', 'pv', b)));
    if (blocks.length) box.append(el('span', 'pv-count', `블록 ${blocks.length}개${blocks.length > 30 ? ' · 최대 30개예요' : ''}`));
  }
  $('verse-text').addEventListener('input', renderPreview);
  $('btn-add-verse').onclick = () => {
    const text = $('verse-text').value, ref = $('verse-ref').value;
    socket.emit('verse:add', { text, ref }, res => {
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
      b.onclick = () => room && room.status === 'lobby' && socket.emit('verse:round', { verseId: v.id });
      const del = el('button', 'del', '✕');
      del.title = '목록에서 지우기';
      del.onclick = ev => { ev.stopPropagation(); if (confirm('이 구절을 목록에서 지울까요?')) socket.emit('verse:delete', { id: v.id }); };
      b.append(del);
      return b;
    }));
  }
  socket.on('verse:list', v => { verses = v; renderVerses(); });

  $('btn-hint-ref').onclick = () => socket.emit('verse:hint', { ref: !R().hint.ref });
  $('btn-hint-words').onclick = () => socket.emit('verse:hint', { words: !R().hint.words });

  // ---------- 대기실 ----------
  function renderLobby() {
    [...$('mode').children].forEach(b => b.classList.toggle('sel', b.dataset.v === R().mode));
    const v = verseNow(), cur = $('current-verse');
    if (v) cur.replaceChildren(document.createTextNode(v.blocks.join(' ')), el('span', 'ref', `${v.ref || '참조 없음'} · 블록 ${v.blocks.length}개`));
    else cur.replaceChildren(el('span', 'muted small', '오른쪽에서 구절을 추가하고 골라 주세요'));
  }

  // ---------- 게임 화면 ----------
  function renderGame() {
    const r = R(), instant = r.mode === 'instant';
    $('btn-hint-ref').classList.toggle('on', r.hint.ref);
    $('btn-hint-ref').textContent = r.hint.ref ? '📖 참조 숨기기' : '📖 참조 보여주기';
    $('btn-hint-words').classList.toggle('on', r.hint.words);
    $('btn-hint-words').textContent = r.hint.words ? '🔤 전체 글자 숨기기' : '🔤 전체 글자 보여주기';
    $('game-pill').textContent = instant ? '📖 A. 칸마다 바로 확인' : '📖 B. 다 채우고 제출';
    $('game-groups').classList.add('vb-groups');
    if (api.editingName()) return;
    const now = Date.now() + api.clockOffset();
    $('game-groups').replaceChildren(...room.groups.filter(g => g.active).map(g => {
      const card = el('div', 'gcard' + (g.finishedAt ? ' done' : ''));
      const head = el('div', 'gcard-head');
      head.append(api.nameInput(g));
      if (g.rank) head.append(el('span', 'rank', `${g.rank}등`));
      const line = el('div', 'vb-line');
      for (let i = 0; i < r.slots; i++) {
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
      room.players.filter(p => p.group === g.index).forEach(p => chips.append(api.chip(p, { left: p.assigned === 0 ? '도우미' : p.left ? `${p.left}개 남음` : '다 넣음 ✔' })));
      card.append(chips);
      return card;
    }));
    pings.length = 0;
  }
  // B 방식 쿨다운 초 표시 갱신
  setInterval(() => { if (room && room.game === 'verse' && room.status === 'playing' && R().mode === 'submit') api.render(); }, 1000);

  // ---------- 서버 이벤트 ----------
  function recount(gi) {
    const g = room.groups[gi];
    room.players.forEach(p => {
      if (p.group !== gi) return;
      const mine = g.blocks.filter(b => b.owner === p.pid);
      p.assigned = mine.length;
      p.left = mine.filter(b => b.slot == null).length;
    });
  }
  const live = () => room && room.game === 'verse' && room.status !== 'lobby';
  socket.on('verse:block', d => {
    if (!live()) return;
    const g = room.groups[d.g], b = g && g.blocks && g.blocks.find(x => x.id === d.b.id);
    if (!b) return;
    Object.assign(b, d.b);
    recount(d.g);
    api.render();
  });
  socket.on('verse:locked', d => {
    if (!live()) return;
    const g = room.groups[d.group], b = g && g.blocks && g.blocks.find(x => x.id === d.blockId);
    if (b) { b.locked = true; pings.push({ g: d.group, id: d.blockId }); }
    if (api.soundOn()) sound.ding();
    api.render();
  });
  socket.on('verse:submitted', d => {
    if (!live()) return;
    const g = room.groups[d.group];
    if (g && !d.correct) { g.lastWrong = d.wrong; g.cooldownUntil = d.cooldownUntil; if (api.soundOn()) sound.wrong(); }
    api.render();
  });
  socket.on('verse:done', d => {
    if (api.soundOn()) { sound.fanfare(); PZ.confetti(60); }
    if (room) toast(`🎉 ${room.groups[d.group].name} 완성! ${d.rank}등`);
  });

  return {
    title: '📖 말씀 블록',
    setRoom(r) { room = r; $('btn-verse-big').disabled = !verseNow(); },
    canStart: () => (verseNow() ? { ok: true } : { ok: false, reason: '구절을 먼저 골라 주세요' }),
    renderLobby,
    renderGame,
    reset() { room = null; verses = { current: null, items: [] }; renderVerses(); },
  };
};
