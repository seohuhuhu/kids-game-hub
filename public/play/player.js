// 놀이터 통합 플레이어 - 입장·그룹·대기와 게임 화면 전환
// 한 번 입장하면 관리자가 고르는 게임(퍼즐/말씀 블록) 화면으로 자동으로 바뀐다.
(() => {
  const { $, el, toast, store } = PZ;
  const socket = io('/play');
  const SESSION_KEY = 'play-session';
  const GAME_LABEL = { puzzle: '🧩 퍼즐', verse: '📖 말씀 블록' };

  let code = null, pid = null, room = null, selectedGroup = null, clockOffset = 0;

  // 게임 화면 모듈 (puzzle-player.js, verse-player.js)
  const api = { socket, pid: () => pid, room: () => room, clockOffset: () => clockOffset, render: () => render() };
  const games = Object.fromEntries(Object.entries(window.PlayGames).map(([id, make]) => [id, make(api)]));

  const SCREENS = ['code', 'profile', 'group', 'wait', 'puzzle', 'verse'];
  const show = name => SCREENS.forEach(s => $('s-' + s).classList.toggle('hidden', s !== name));
  const meP = () => room && room.players.find(p => p.pid === pid);

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
    const extra = Object.assign({}, ...Object.values(games).map(g => g.joinData()));
    socket.emit('p:join', { code, name, pin, ...extra }, res => {
      if (!res.ok) {
        if (silent) {
          // 새로고침·재접속 때 방을 못 찾으면 서버가 다시 시작되어 방이 사라진 것
          const lost = /없는 입장 코드/.test(res.error || '');
          resetToStart(lost ? '방이 사라졌어요. 선생님께 새 입장 코드를 받아 주세요' : res.error);
          return;
        }
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
    pid = null; room = null; code = null;
    Object.values(games).forEach(g => g.clear());
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
    $('wait-next').textContent = room.game ? `다음 게임: ${GAME_LABEL[room.game] || room.game}` : '선생님이 다음 게임을 고르고 있어요';
    $('wait-text').textContent = room.status === 'lobby' ? '선생님이 게임을 시작할 때까지 기다려 주세요'
      : '이번 게임에는 그룹이 없어 참여하지 못했어요. 다음 게임을 기다려 주세요';
  }

  // ---------- 서버 이벤트 ----------
  socket.on('state', s => {
    room = s;
    clockOffset = s.serverNow - Date.now();
    // 게임 화면에는 항상 새 상태를 넘기고, 끄는 중이면 그리기만 끄기가 끝난 뒤로 미룬다
    Object.values(games).forEach(g => g.setRoom(s));
    if (!Object.values(games).some(g => g.busy())) render();
  });
  socket.on('presence', ({ pid: who, online }) => {
    const p = room && room.players.find(x => x.pid === who);
    if (p) p.online = online;
  });

  function render() {
    if (!pid || !room) return;
    const me = meP();
    if (!me) return;
    if (room.status === 'lobby') {
      Object.values(games).forEach(g => g.clear());
      if (me.group == null) { show('group'); renderGroups(); }
      else { $('confirm').classList.add('hidden'); show('wait'); renderWait(); }
      return;
    }
    const g = me.group != null ? room.groups[me.group] : null;
    if (!g || !g.active || !games[room.game]) { show('wait'); renderWait(); return; }
    show(room.game);
    games[room.game].render(room);
  }
})();
