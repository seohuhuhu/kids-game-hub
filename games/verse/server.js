// 말씀 블록 - 서버 로직
// 관리자가 구절을 준비하고 라운드를 진행하며, 플레이어는 그룹별로 나눠 받은 단어 블록을 문장 줄의 칸에 넣는다.
// 방·관리자·플레이어·그룹·재입장·접속 표시 구조는 퍼즐(games/puzzle/server.js)과 같다.
const crypto = require('crypto');
const { LIMITS: V, splitBlocks, makeBlocks, slotIsCorrect, countWrong } = require('./logic');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const COLORS = ['#FF6B6B', '#4D96FF', '#22C55E', '#F59E0B', '#A855F7', '#EC4899',
  '#14B8A6', '#F97316', '#84CC16', '#06B6D4', '#8B5CF6', '#EF4444'];
const LIMITS = { minGroups: 1, maxGroups: 10, maxPlayers: 60 };
const MODES = ['instant', 'submit'];
const COOLDOWN_MS = 5000; // B 방식에서 틀린 뒤 다시 제출할 수 없는 시간

const shuffle = arr => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const cleanName = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 10);
const validPin = p => /^\d{4}$/.test(String(p || ''));
const intIn = (v, lo, hi) => Number.isInteger(+v) && +v >= lo && +v <= hi;

module.exports = function registerVerse(nsp) {
  const rooms = new Map();

  const newCode = () => {
    let c;
    do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c));
    return c;
  };
  const groupName = (room, i) => room.groupNames[i] || `${i + 1}그룹`;
  const currentVerse = room => room.verses.find(v => v.id === room.round.verseId) || null;
  // 진행 중인 라운드의 정답 (시작할 때 고정)
  const answerOf = room => room.answer || (currentVerse(room) ? currentVerse(room).blocks : []);

  // view: 'admin' = 전체 + 구절 본문, 숫자 = 그 그룹 블록만, 'none' = 블록 없음
  function publicState(room, view = 'admin') {
    const answer = answerOf(room);
    const round = { mode: room.round.mode, verseId: room.round.verseId, slots: answer.length };
    const live = room.status !== 'lobby';
    if (view === 'admin') {
      const v = room.status === 'lobby' ? currentVerse(room) : room.verseAtStart;
      round.verse = v ? { text: v.text, ref: v.ref, blocks: v.blocks } : null;
    }
    const groupDone = typeof view === 'number' && room.groups[view] && room.groups[view].finishedAt;
    if (live && (room.hint.ref || groupDone)) round.ref = room.verseAtStart.ref; // 완성한 그룹은 축하 화면에 참조 표시
    if (live && room.hint.first) round.first = answer.map(w => w[0]);
    const players = [...room.players.values()].map(p => {
      const g = p.group != null ? room.groups[p.group] : null;
      const mine = g ? g.blocks.filter(b => b.owner === p.pid) : [];
      return {
        pid: p.pid, name: p.name, color: p.color, group: p.group, online: !!p.socketId,
        assigned: mine.length, left: mine.filter(b => b.slot == null).length,
      };
    });
    return {
      code: room.code,
      status: room.status,
      settings: room.settings,
      round,
      hint: room.hint,
      startedAt: room.startedAt,
      serverNow: Date.now(),
      players,
      groups: room.groups.map((g, i) => ({
        index: i, name: groupName(room, i), active: g.active,
        blocks: view === 'admin' || view === i ? g.blocks : [],
        total: g.blocks.length,
        filledCount: g.blocks.filter(b => b.slot != null).length,
        lockedCount: g.blocks.filter(b => b.locked).length,
        finishedAt: g.finishedAt, rank: g.rank, cooldownUntil: g.cooldownUntil, lastWrong: g.lastWrong,
      })),
    };
  }

  function viewOf(room, s) {
    if (s.data.adminOf === room.code) return 'admin';
    const p = s.data.pid && room.players.get(s.data.pid);
    return p && p.group != null ? p.group : 'none';
  }
  function eachSocket(room, fn) {
    const ids = nsp.adapter.rooms.get(room.code);
    if (!ids) return;
    for (const id of ids) { const s = nsp.sockets.get(id); if (s) fn(s, viewOf(room, s)); }
  }
  // 전체 상태: 참가·그룹 선택·시작·완성처럼 구조가 바뀔 때만
  function broadcast(room) {
    const cache = new Map();
    eachSocket(room, (s, v) => {
      if (!cache.has(v)) cache.set(v, publicState(room, v));
      s.emit('state', cache.get(v));
    });
  }
  const toGroup = (room, gi, ev, data) => eachSocket(room, (s, v) => { if (v === 'admin' || v === gi) s.emit(ev, data); });
  const sendPresence = (room, pid, online, exceptId) =>
    eachSocket(room, s => { if (s.id !== exceptId) s.emit('presence', { pid, online }); });
  const sendBlock = (room, gi, b) => toGroup(room, gi, 'block', { g: gi, b: { id: b.id, owner: b.owner, slot: b.slot, locked: b.locked } });
  const sendVerses = room => nsp.to(room.code + ':admin').emit('verses', {
    current: room.round.verseId, items: room.verses.map(({ id, text, ref, blocks }) => ({ id, text, ref, blocks })),
  });

  function resizeGroups(room) {
    const n = room.settings.groups;
    while (room.groups.length < n) room.groups.push(emptyGroup());
    room.groups.length = n;
    for (const p of room.players.values()) if (p.group != null && p.group >= n) p.group = null;
  }
  const emptyGroup = () => ({ active: false, blocks: [], finishedAt: null, rank: null, cooldownUntil: 0, lastWrong: null });

  // 그룹 완성 처리
  function finishGroup(room, gi, by) {
    const g = room.groups[gi];
    g.finishedAt = Date.now();
    g.rank = room.groups.filter(x => x.finishedAt).length;
    if (room.groups.filter(x => x.active).every(x => x.finishedAt)) room.status = 'done';
    toGroup(room, gi, 'done', { group: gi, rank: g.rank, by });
    broadcast(room);
  }

  // 나간(내보낸) 사람의 블록을 그룹 안 다른 멤버에게 넘김. 칸에 있는 블록은 칸에 그대로 둔다
  function redistribute(room, gi, fromPid) {
    const g = room.groups[gi];
    if (!g || !g.active) return;
    const members = [...room.players.values()].filter(p => p.group === gi && p.pid !== fromPid);
    if (!members.length) return;
    const online = members.filter(m => m.socketId);
    const pool = (online.length ? online : members).map(m => m.pid);
    const load = new Map(pool.map(id => [id, g.blocks.filter(b => b.owner === id).length]));
    for (const b of g.blocks.filter(x => x.owner === fromPid)) {
      const target = pool.reduce((a, c) => (load.get(a) <= load.get(c) ? a : c));
      b.owner = target;
      load.set(target, load.get(target) + 1);
    }
  }

  nsp.on('connection', socket => {
    let isAdmin = false;
    let adminRoom = null;
    let room = null;
    let pid = null;
    const reply = (cb, data) => typeof cb === 'function' && cb(data);
    const me = () => room && room.players.get(pid);

    // ================= 관리자 =================
    socket.on('admin:login', ({ password } = {}, cb) => {
      isAdmin = String(password || '') === ADMIN_PASSWORD;
      reply(cb, isAdmin ? { ok: true } : { ok: false, error: '관리자 비밀번호가 틀렸어요.' });
    });

    function attachAdmin(r) {
      if (adminRoom) { socket.leave(adminRoom.code); socket.leave(adminRoom.code + ':admin'); }
      adminRoom = r;
      socket.data.adminOf = r.code;
      socket.join(r.code);
      socket.join(r.code + ':admin');
      sendVerses(r);
      broadcast(r);
    }

    socket.on('admin:create', (_, cb) => {
      if (!isAdmin) return reply(cb, { ok: false, error: '관리자만 방을 만들 수 있어요.' });
      const code = newCode();
      const r = {
        code, adminKey: crypto.randomBytes(16).toString('hex'),
        status: 'lobby', settings: { groups: 4 }, groupNames: [],
        verses: [], round: { verseId: null, mode: 'instant' }, hint: { ref: false, first: false },
        answer: null, verseAtStart: null,
        players: new Map(), groups: [], startedAt: null, createdAt: Date.now(),
      };
      resizeGroups(r);
      rooms.set(code, r);
      reply(cb, { ok: true, code, adminKey: r.adminKey });
      attachAdmin(r);
    });

    socket.on('admin:resume', ({ code, adminKey } = {}, cb) => {
      const r = rooms.get(String(code));
      if (!r || r.adminKey !== adminKey) return reply(cb, { ok: false });
      isAdmin = true;
      reply(cb, { ok: true, code: r.code });
      attachAdmin(r);
    });

    const adminOk = () => isAdmin && adminRoom && rooms.get(adminRoom.code) === adminRoom;

    socket.on('admin:settings', (s = {}) => {
      if (!adminOk() || adminRoom.status !== 'lobby') return;
      if (intIn(s.groups, LIMITS.minGroups, LIMITS.maxGroups)) { adminRoom.settings.groups = +s.groups; resizeGroups(adminRoom); }
      broadcast(adminRoom);
    });

    socket.on('admin:rename', ({ group, name } = {}) => {
      if (!adminOk() || !intIn(group, 0, adminRoom.settings.groups - 1)) return;
      adminRoom.groupNames[+group] = cleanName(name) || null;
      broadcast(adminRoom);
    });

    // 구절 목록 (방에 임시 보관)
    socket.on('admin:addVerse', ({ text, ref } = {}, cb) => {
      if (!adminOk()) return reply(cb, { ok: false });
      const blocks = splitBlocks(text);
      if (!blocks.length) return reply(cb, { ok: false, error: '구절을 입력해 주세요.' });
      if (blocks.length > V.maxBlocks) return reply(cb, { ok: false, error: `블록이 너무 많아요. (최대 ${V.maxBlocks}개)` });
      const r = adminRoom;
      const v = {
        id: crypto.randomBytes(6).toString('hex'),
        text: String(text).trim().slice(0, 500), ref: String(ref || '').trim().slice(0, 40), blocks,
      };
      r.verses.unshift(v);
      while (r.verses.length > V.maxVerses) {
        const old = r.verses.pop();
        if (old.id === r.round.verseId && r.status === 'lobby') r.round.verseId = null;
      }
      if (!r.round.verseId && r.status === 'lobby') r.round.verseId = v.id;
      reply(cb, { ok: true, id: v.id });
      sendVerses(r);
      broadcast(r);
    });

    socket.on('admin:deleteVerse', ({ id } = {}) => {
      if (!adminOk()) return;
      const r = adminRoom;
      r.verses = r.verses.filter(v => v.id !== id);
      if (r.round.verseId === id && r.status === 'lobby') r.round.verseId = r.verses[0] ? r.verses[0].id : null;
      sendVerses(r);
      broadcast(r);
    });

    socket.on('admin:round', ({ verseId, mode } = {}) => {
      if (!adminOk() || adminRoom.status !== 'lobby') return;
      if (verseId !== undefined && adminRoom.verses.some(v => v.id === verseId)) adminRoom.round.verseId = verseId;
      if (MODES.includes(mode)) adminRoom.round.mode = mode;
      sendVerses(adminRoom);
      broadcast(adminRoom);
    });

    socket.on('admin:move', ({ pid: target, group } = {}) => {
      if (!adminOk() || adminRoom.status !== 'lobby') return;
      const p = adminRoom.players.get(target);
      if (!p) return;
      p.group = group == null || group === '' ? null : (intIn(group, 0, adminRoom.settings.groups - 1) ? +group : p.group);
      broadcast(adminRoom);
    });

    socket.on('admin:kick', ({ pid: target } = {}) => {
      if (!adminOk()) return;
      const r = adminRoom, p = r.players.get(target);
      if (!p) return;
      if (r.status !== 'lobby' && p.group != null) redistribute(r, p.group, p.pid);
      r.players.delete(target);
      if (p.socketId) nsp.to(p.socketId).emit('kicked');
      broadcast(r);
    });

    socket.on('admin:start', (_, cb) => {
      if (!adminOk() || adminRoom.status !== 'lobby') return reply(cb, { ok: false });
      const r = adminRoom, verse = currentVerse(r);
      if (!verse) return reply(cb, { ok: false, error: '먼저 구절을 추가하고 골라 주세요.' });
      const players = [...r.players.values()];
      if (!players.some(p => p.group != null)) return reply(cb, { ok: false, error: '그룹을 고른 플레이어가 아직 없어요.' });
      r.answer = verse.blocks.slice();
      r.verseAtStart = { ...verse };
      r.groups.forEach((g, i) => {
        const members = shuffle(players.filter(p => p.group === i).map(p => p.pid));
        Object.assign(g, emptyGroup());
        g.active = members.length > 0;
        g.blocks = g.active ? makeBlocks(r.answer).map((b, k) => ({ ...b, owner: members[k % members.length], slot: null, locked: false })) : [];
      });
      r.status = 'playing';
      r.hint = { ref: false, first: false };
      r.startedAt = Date.now();
      reply(cb, { ok: true });
      broadcast(r);
    });

    socket.on('admin:hint', (h = {}) => {
      if (!adminOk() || adminRoom.status === 'lobby') return;
      if (typeof h.ref === 'boolean') adminRoom.hint.ref = h.ref;
      if (typeof h.first === 'boolean') adminRoom.hint.first = h.first;
      broadcast(adminRoom);
    });

    // 다음 라운드: 플레이어·그룹·구절 목록은 그대로 두고 대기실로
    socket.on('admin:reset', () => {
      if (!adminOk()) return;
      const r = adminRoom;
      r.status = 'lobby';
      r.hint = { ref: false, first: false };
      r.startedAt = null;
      r.answer = null;
      r.verseAtStart = null;
      r.groups.forEach(g => Object.assign(g, emptyGroup()));
      broadcast(r);
    });

    socket.on('admin:close', () => {
      if (!adminOk()) return;
      nsp.to(adminRoom.code).emit('closed');
      rooms.delete(adminRoom.code);
      socket.leave(adminRoom.code);
      adminRoom = null;
    });

    // ================= 플레이어 =================
    socket.on('p:check', ({ code } = {}, cb) => {
      const r = rooms.get(String(code || '').trim());
      reply(cb, r ? { ok: true, status: r.status } : { ok: false, error: '없는 입장 코드예요. 다시 확인해 주세요.' });
    });

    socket.on('p:join', ({ code, name, pin } = {}, cb) => {
      const r = rooms.get(String(code || '').trim());
      if (!r) return reply(cb, { ok: false, error: '없는 입장 코드예요.' });
      const n = cleanName(name);
      if (!n) return reply(cb, { ok: false, error: '이름을 입력해 주세요.' });
      if (!validPin(pin)) return reply(cb, { ok: false, error: '비밀번호는 숫자 4자리예요.' });

      const existing = [...r.players.values()].find(p => p.name === n);
      let player;
      if (existing) {
        if (existing.pin !== String(pin)) return reply(cb, { ok: false, error: '이미 있는 이름이에요. 내 이름이면 비밀번호를 확인해 주세요.' });
        player = existing;
        if (player.socketId && player.socketId !== socket.id) nsp.to(player.socketId).emit('kicked', '다른 기기에서 같은 이름으로 들어왔어요.');
      } else {
        if (r.status !== 'lobby') return reply(cb, { ok: false, error: '이미 게임이 시작됐어요. 처음 들어온 친구는 다음 판에 함께해요.' });
        if (r.players.size >= LIMITS.maxPlayers) return reply(cb, { ok: false, error: '방이 가득 찼어요.' });
        const used = new Set([...r.players.values()].map(p => p.color));
        player = {
          pid: crypto.randomBytes(8).toString('hex'), name: n, pin: String(pin), group: null, socketId: null,
          color: COLORS.find(c => !used.has(c)) || COLORS[r.players.size % COLORS.length],
        };
        r.players.set(player.pid, player);
      }
      if (room && room !== r) leavePlayer();
      room = r;
      pid = player.pid;
      player.socketId = socket.id;
      socket.data.pid = player.pid;
      socket.join(r.code);
      reply(cb, { ok: true, pid, rejoined: !!existing, code: r.code });
      if (existing && r.status !== 'lobby') {
        socket.emit('state', publicState(r, viewOf(r, socket)));
        sendPresence(r, player.pid, true, socket.id);
      } else {
        broadcast(r);
      }
    });

    socket.on('p:group', ({ group } = {}, cb) => {
      const p = me();
      if (!p || room.status !== 'lobby') return reply(cb, { ok: false, error: '지금은 그룹을 고를 수 없어요.' });
      if (p.group != null) return reply(cb, { ok: false, error: '이미 그룹을 정했어요.' });
      if (!intIn(group, 0, room.settings.groups - 1)) return reply(cb, { ok: false, error: '없는 그룹이에요.' });
      p.group = +group;
      reply(cb, { ok: true });
      broadcast(room);
    });

    // 내 블록 찾기 (게임 중, 내 그룹, 내 것)
    const myBlock = id => {
      const p = me();
      if (!p || room.status !== 'playing' || p.group == null) return null;
      const g = room.groups[p.group];
      if (!g.active || g.finishedAt) return null;
      const b = g.blocks.find(x => x.id === id);
      return b && b.owner === pid ? { g, gi: p.group, b } : null;
    };

    socket.on('p:place', ({ blockId, slot } = {}, cb) => {
      const f = myBlock(blockId);
      if (!f || f.b.locked) return reply(cb, { ok: false });
      const answer = answerOf(room);
      if (!intIn(slot, 0, answer.length - 1)) return reply(cb, { ok: false });
      if (f.g.blocks.some(x => x.slot === +slot && x !== f.b)) return reply(cb, { ok: false, error: '이미 다른 블록이 있어요.' });
      f.b.slot = +slot;
      if (room.round.mode === 'instant' && slotIsCorrect(answer, f.b.slot, f.b.text)) f.b.locked = true;
      reply(cb, { ok: true, locked: f.b.locked });
      if (f.b.locked) toGroup(room, f.gi, 'locked', { group: f.gi, blockId: f.b.id, by: pid });
      if (room.round.mode === 'instant' && f.g.blocks.every(x => x.locked)) return finishGroup(room, f.gi, pid);
      sendBlock(room, f.gi, f.b);
    });

    socket.on('p:unplace', ({ blockId } = {}, cb) => {
      const f = myBlock(blockId);
      if (!f || f.b.locked || f.b.slot == null) return reply(cb, { ok: false });
      f.b.slot = null;
      reply(cb, { ok: true });
      sendBlock(room, f.gi, f.b);
    });

    // B 방식: 모든 칸이 차면 그룹 누구나 제출
    socket.on('p:submit', (_, cb) => {
      const p = me();
      if (!p || room.status !== 'playing' || room.round.mode !== 'submit' || p.group == null) return reply(cb, { ok: false });
      const gi = p.group, g = room.groups[gi];
      if (!g.active || g.finishedAt) return reply(cb, { ok: false });
      const answer = answerOf(room);
      if (g.blocks.some(b => b.slot == null)) return reply(cb, { ok: false, error: '빈칸을 모두 채워야 제출할 수 있어요.' });
      const now = Date.now();
      if (now < g.cooldownUntil) return reply(cb, { ok: false, error: '잠시 후에 다시 제출할 수 있어요.', cooldownMs: g.cooldownUntil - now });
      const wrong = countWrong(answer, g.blocks);
      g.lastWrong = wrong;
      if (wrong === 0) {
        g.blocks.forEach(b => { b.locked = true; });
        reply(cb, { ok: true, correct: true, wrong: 0 });
        toGroup(room, gi, 'submitted', { group: gi, by: pid, correct: true, wrong: 0 });
        return finishGroup(room, gi, pid);
      }
      g.cooldownUntil = now + COOLDOWN_MS;
      reply(cb, { ok: true, correct: false, wrong, cooldownMs: COOLDOWN_MS });
      toGroup(room, gi, 'submitted', { group: gi, by: pid, correct: false, wrong, cooldownUntil: g.cooldownUntil });
    });

    function leavePlayer() {
      const p = me();
      const active = p && p.socketId === socket.id;
      if (active) p.socketId = null;
      socket.data.pid = null;
      if (room) {
        socket.leave(room.code);
        if (room.status !== 'lobby' && p) { if (active) sendPresence(room, p.pid, false); }
        else broadcast(room);
      }
      room = null;
      pid = null;
    }

    socket.on('p:leave', () => {
      const p = me();
      if (p && room.status === 'lobby') room.players.delete(pid);
      leavePlayer();
    });

    socket.on('disconnect', () => {
      leavePlayer();
      if (adminRoom) socket.leave(adminRoom.code);
    });
  });

  // 오래된 빈 방 정리 (6시간)
  setInterval(() => {
    const now = Date.now();
    for (const [code, r] of rooms) {
      const connected = nsp.adapter.rooms.get(code)?.size || 0;
      if (connected === 0 && now - r.createdAt > 6 * 3600e3) rooms.delete(code);
    }
  }, 600e3).unref();
};
