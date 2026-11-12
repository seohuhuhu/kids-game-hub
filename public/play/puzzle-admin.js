// 통합 관리자 - 퍼즐 설정·진행 화면 (public/play/admin.js가 불러 씀)
window.AdminGames = window.AdminGames || {};
window.AdminGames.puzzle = api => {
  const { $, el, toast, sound } = PZ;
  const socket = api.socket;
  let room = null, img = null, selectedPreset = null;
  let library = { current: null, items: [] };
  const minis = new Map();     // 그룹별 작은 퍼즐 판
  const flashes = [];          // 방금 맞춘 조각 (반짝 효과)
  const R = () => room.rounds.puzzle; // 퍼즐 설정·힌트·사진 정보

  // ---------- 설정 ----------
  for (let n = 2; n <= 8; n++) {
    $('cols').append(new Option(n, n));
    $('rows').append(new Option(n, n));
  }
  const send = s => socket.emit('puzzle:settings', s);
  $('cols').onchange = e => send({ cols: +e.target.value });
  $('rows').onchange = e => send({ rows: +e.target.value });
  $('shape').onclick = e => e.target.dataset.v && send({ shape: e.target.dataset.v });

  function sendImage(dataUrl, extra = {}, okMsg) {
    socket.emit('puzzle:image', { dataUrl, ...extra }, res => {
      if (!res.ok) return toast(res.error || '사진을 올리지 못했어요.');
      if (okMsg) toast(okMsg); // 서버가 받은 뒤에만 성공 안내
    });
  }

  // 투명도 (대기실과 게임 중 둘 다)
  ['opacity', 'opacity2'].forEach(id => {
    $(id).oninput = e => { $(id + '-val').textContent = e.target.value + '%'; };
    $(id).onchange = e => send({ opacity: +e.target.value / 100 });
  });
  function showOpacity() {
    const v = Math.round(R().opacity * 100);
    ['opacity', 'opacity2'].forEach(id => {
      if (document.activeElement !== $(id)) $(id).value = v;
      $(id + '-val').textContent = $(id).value + '%';
    });
  }

  // 올린 사진 목록 (방에 임시 보관)
  function renderLibrary() {
    const box = $('library');
    if (!library.items.length) { box.replaceChildren(el('span', 'muted small', '아직 올린 사진이 없어요')); return; }
    box.replaceChildren(...library.items.map(item => {
      const b = el('button', 'lib-item' + (item.id === library.current ? ' sel' : ''));
      b.style.backgroundImage = `url(${item.thumb})`;
      b.title = '이 사진으로 퍼즐 만들기';
      b.onclick = () => { selectedPreset = null; socket.emit('puzzle:useImage', { id: item.id }, r => r.ok || toast(r.error)); };
      const del = el('button', 'del', '✕');
      del.title = '목록에서 지우기';
      del.onclick = ev => { ev.stopPropagation(); socket.emit('puzzle:deleteImage', { id: item.id }); };
      b.append(del);
      return b;
    }));
  }
  socket.on('puzzle:library', lib => { library = lib; renderLibrary(); });
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
    try {
      selectedPreset = null;
      const [full, thumb] = await Promise.all([PZ.fileToDataUrl(f), PZ.fileToDataUrl(f, 240, 0.7)]);
      sendImage(full, { thumb, save: true }, '사진을 올렸어요. 올린 사진 목록에서 다시 고를 수 있어요');
    }
    catch { toast('이 파일은 사진으로 열 수 없어요.'); }
  };
  $('btn-hint').onclick = () => socket.emit('puzzle:hint', { on: !R().hint });

  // 퍼즐로 맞출 사진(판에 쓰이는 영역)을 화면 가득 크게 보여주기
  function sizePhoto() {
    const { rows, cols } = R(), box = $('photo-big');
    const maxW = window.innerWidth * 0.92, maxH = window.innerHeight * 0.84;
    const w = Math.min(maxW, maxH * cols / rows);
    box.style.width = w + 'px';
    box.style.height = w * rows / cols + 'px';
  }
  $('btn-photo').onclick = () => {
    if (!img) return;
    $('photo-big').style.backgroundImage = `url(${img.url})`;
    sizePhoto();
    $('photo-overlay').classList.remove('hidden');
  };
  const closePhoto = () => $('photo-overlay').classList.add('hidden');
  $('btn-photo-close').onclick = closePhoto;
  $('photo-overlay').onclick = e => { if (e.target === $('photo-overlay')) closePhoto(); };
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closePhoto(); });
  window.addEventListener('resize', () => { if (room && !$('photo-overlay').classList.contains('hidden')) sizePhoto(); });

  // ---------- 대기실 ----------
  function piecesPerGroup() {
    const { rows, cols, shape } = R(), n = rows * cols;
    return shape === 'square' ? n : shape === 'triangle' ? n * 2 : Math.round(n * 1.5);
  }

  // 사진 비율과 판 비율이 다르면 잘리는 양을 알려 주고, 비율이 맞는 크기를 추천
  const cropOf = (c, r) => { const a = img.w / img.h, b = c / r; return 1 - Math.min(a, b) / Math.max(a, b); };
  function renderFit(info, cols, rows) {
    if (!img) return;
    const crop = cropOf(cols, rows);
    const box = el('div', 'fit');
    if (crop <= 0.03) {
      box.append(el('span', 'fit-ok', '✔ 사진이 거의 다 보여요'));
    } else {
      box.append(el('span', 'fit-warn', `⚠ 지금 크기는 사진의 약 ${Math.round(crop * 100)}%가 잘려요. 사진 비율에 맞는 크기:`));
      const all = [];
      for (let c = 2; c <= 8; c++) for (let r = 2; r <= 8; r++) all.push({ c, r, n: c * r, crop: cropOf(c, r) });
      const good = all.filter(x => x.crop <= 0.06).sort((a, b) => a.n - b.n);
      const picks = [];
      for (const x of good) if (!picks.length || x.n >= picks[picks.length - 1].n * 1.4) picks.push(x);
      const list = (picks.length ? picks : all.sort((a, b) => a.crop - b.crop).slice(0, 3)).slice(0, 4);
      const row = el('div', 'fit-list');
      list.forEach(x => {
        const b = el('button', 'fit-btn', `${x.c}×${x.r}`);
        b.append(el('small', null, ` ${x.n}칸 · ${x.crop < 0.01 ? '딱 맞음' : `${Math.round(x.crop * 100)}% 잘림`}`));
        b.onclick = () => send({ cols: x.c, rows: x.r });
        row.append(b);
      });
      box.append(row);
    }
    info.append(box);
  }

  function renderLobby() {
    $('btn-photo').disabled = !img;
    const { rows, cols, shape } = R();
    $('cols').value = cols;
    $('rows').value = rows;
    [...$('shape').children].forEach(b => b.classList.toggle('sel', b.dataset.v === shape));
    [...$('presets').children].forEach(b => b.classList.toggle('sel', b.dataset.id === selectedPreset));
    if (library.current !== R().imageId) { library.current = R().imageId; renderLibrary(); }
    showOpacity();
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
    renderFit(info, cols, rows);
  }

  // ---------- 게임 화면 ----------
  function miniFor(g) {
    const { rows, cols } = R();
    const key = room.startedAt + ':' + g.index;
    let m = minis.get(g.index);
    if (!m || m.key !== key) {
      const board = el('div', 'board');
      const hint = el('div', 'hintimg');
      const guides = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      guides.classList.add('guides');
      const layer = el('div', 'layer');
      const loose = el('div', 'layer loose');
      board.append(hint, guides, layer, loose);
      const cell = Math.floor(Math.min(270 / cols, 230 / rows));
      board.style.width = cell * cols + 'px';
      board.style.height = cell * rows + 'px';
      PZ.drawGuides(guides, g.pieces, rows, cols);
      m = { key, board, hint, layer, loose, cell, W: cell * cols, H: cell * rows, els: new Map() };
      minis.set(g.index, m);
    }
    m.hint.style.backgroundImage = img ? `url(${img.url})` : '';
    m.board.classList.toggle('hint', R().hint);
    if (img) {
      g.pieces.forEach(p => {
        let w = m.els.get(p.id);
        if (!p.placed && !p.pos) { if (w) { w.remove(); m.els.delete(p.id); } return; }
        if (!w) { w = PZ.makePiece(p); m.els.set(p.id, w); }
        const x = p.placed ? p.col / cols : p.pos.x, y = p.placed ? p.row / rows : p.pos.y;
        w.style.left = x * m.W + 'px';
        w.style.top = y * m.H + 'px';
        const target = p.placed ? m.layer : m.loose;
        if (w.parentNode !== target) target.append(w);
        PZ.stylePiece(w, p, { img, cell: m.cell, W: m.W, H: m.H, rot: p.placed ? 0 : p.rot });
      });
    }
    return m;
  }

  function renderGame() {
    $('btn-photo').disabled = !img;
    const btn = $('btn-hint');
    btn.classList.toggle('on', R().hint);
    btn.textContent = R().hint ? '💡 힌트 끄기' : '💡 전체 힌트 보여주기';
    showOpacity();
    $('game-groups').classList.remove('vb-groups');
    if (api.editingName()) return;
    $('game-groups').replaceChildren(...room.groups.filter(g => g.active).map(g => {
      const card = el('div', 'gcard' + (g.finishedAt ? ' done' : ''));
      card.dataset.group = g.index;
      const head = el('div', 'gcard-head');
      head.append(api.nameInput(g));
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
      room.players.filter(p => p.group === g.index).forEach(p => chips.append(api.chip(p, { left: p.assigned === 0 ? '도우미' : p.left ? `${p.left}개 남음` : '완료 ✔' })));
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
  }

  // ---------- 서버 이벤트 ----------
  socket.on('puzzle:image', d => {
    PZ.loadImage(d.dataUrl).then(i => { if (img) URL.revokeObjectURL(img.url); img = i; api.render(); });
  });
  socket.on('puzzle:placed', ({ group, pieceId, by, groupDone, rank }) => {
    const p = room && room.players.find(x => x.pid === by);
    flashes.push({ group, pieceId, color: (p && p.color) || '#22D3EE' });
    if (!api.soundOn()) return;
    if (groupDone) {
      sound.fanfare();
      PZ.confetti(60);
      toast(`🎉 ${room.groups[group].name} 완성! ${rank}등`);
    } else {
      sound.ding();
    }
  });
  socket.on('puzzle:piece', d => { if (room && room.game === 'puzzle' && PZ.applyPiece(room, d)) api.render(); });

  return {
    title: '🧩 퍼즐',
    // 방 상태가 바뀔 때마다 (state 수신)
    setRoom(r, prev) {
      if (prev && prev.status === 'lobby' && r.status !== 'lobby') minis.clear();
      room = r;
      $('btn-photo').disabled = !img;
    },
    canStart: () => (img ? { ok: true } : { ok: false, reason: '퍼즐 사진을 먼저 넣어 주세요' }),
    renderLobby,
    renderGame,
    reset() { room = null; img = null; library = { current: null, items: [] }; minis.clear(); },
  };
};
