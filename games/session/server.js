// 놀이터 통합 세션 서버
// 방·관리자·플레이어·그룹·재입장·접속 표시를 맡고, 게임 규칙은 게임 모듈(games/<id>/game.js)에 맡긴다.
// 아이들은 한 번 입장한 방에서 관리자가 고르는 게임을 차례로 플레이한다.
const crypto = require('crypto');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const COLORS = ['#FF6B6B', '#4D96FF', '#22C55E', '#F59E0B', '#A855F7', '#EC4899',
  '#14B8A6', '#F97316', '#84CC16', '#06B6D4', '#8B5CF6', '#EF4444'];
const LIMITS = { minGroups: 1, maxGroups: 10, maxPlayers: 60 };

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
const reply = (cb, data) => typeof cb === 'function' && cb(data);

module.exports = function registerSession(nsp, games) {
  const rooms = new Map();
  const modOf = room => (room.game ? games[room.game] : null);

  const newCode = () => {
    let c;
    do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c));
    return c;
  };
  const groupName = (room, i) => room.groupNames[i] || `${i + 1}그룹`;
  const baseGroup = () => ({ active: false, finishedAt: null, rank: null });

  // view: 'admin' = 전체, 숫자 = 그 그룹 데이터만, 'none' = 게임 데이터 없음
  function publicState(room, view = 'admin') {
    const mod = modOf(room);
    const live = room.status !== 'lobby';
    const zero = { assigned: 0, left: 0, placed: 0 };
    const state = {
      code: room.code,
      status: room.status,
      game: room.game,
      games: Object.values(games).map(g => ({ id: g.id, title: g.title })),
      settings: { groups: room.settings.groups },
      startedAt: room.startedAt,
      serverNow: Date.now(),
      players: [...room.players.values()].map(p => ({
        pid: p.pid, name: p.name, color: p.color, group: p.group, online: !!p.socketId,
        ...(live && mod && p.group != null ? mod.playerStats(room, p) : zero),
      })),
      groups: room.groups.map((g, i) => ({
        index: i, name: groupName(room, i), active: g.active, finishedAt: g.finishedAt, rank: g.rank,
        ...(live && mod ? mod.groupView(room, i, view === 'admin' || view === i) : {}),
      })),
      round: mod ? mod.roundView(room, view) : {},
    };
    // 관리자는 대기실에서 모든 게임의 설정을 본다 (게임을 고르기 전에도 사진·구절 준비)
    if (view === 'admin') state.rounds = Object.fromEntries(Object.values(games).map(g => [g.id, g.roundView(room, 'admin')]));
    return state;
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

  // 게임 모듈이 쓰는 도구
  const ctx = {
    reply,
    // 전체 상태: 참가·그룹 선택·시작·완성처럼 구조가 바뀔 때만
    broadcast(room) {
      const cache = new Map();
      eachSocket(room, (s, v) => {
        if (!cache.has(v)) cache.set(v, publicState(room, v));
        s.emit('state', cache.get(v));
      });
    },
    toGroup: (room, gi, ev, data) => eachSocket(room, (s, v) => { if (v === 'admin' || v === gi) s.emit(ev, data); }),
    toAdmins: (room, ev, data) => nsp.to(room.code + ':admin').emit(ev, data),
    toRoom: (room, ev, data) => nsp.to(room.code).emit(ev, data),
    // 그룹 완성: 순위를 매기고, 진행 중인 그룹이 모두 끝났으면 게임 종료. 순위를 돌려준다
    finishGroup(room, gi) {
      const g = room.groups[gi];
      g.finishedAt = Date.now();
      g.rank = room.groups.filter(x => x.finishedAt).length;
      checkAllDone(room);
      return g.rank;
    },
    shuffle,
  };
  const broadcast = ctx.broadcast;
  const sendPresence = (room, pid, online, exceptId) =>
    eachSocket(room, s => { if (s.id !== exceptId) s.emit('presence', { pid, online }); });
  function checkAllDone(room) {
    const act = room.groups.filter(x => x.active);
    if (room.status === 'playing' && act.length && act.every(x => x.finishedAt)) room.status = 'done';
  }

  function resizeGroups(room) {
    const n = room.settings.groups;
    while (room.groups.length < n) room.groups.push(baseGroup());
    room.groups.length = n;
    room.groupNames.length = Math.max(room.groupNames.length, n);
    for (const p of room.players.values()) if (p.group != null && p.group >= n) p.group = null;
  }

  nsp.on('connection', socket => {
    let isAdmin = false;
    let adminRoom = null;
    let room = null;
    let pid = null;
    const me = () => room && room.players.get(pid);
    // 잘못된 메시지(null·문자열 등)가 와도 서버가 죽지 않도록 payload를 객체로 맞추고 오류를 가둔다
    const on = (ev, fn) => socket.on(ev, (d, cb) => {
      if (typeof d === 'function' && cb === undefined) { cb = d; d = undefined; }
      try { fn(d && typeof d === 'object' ? d : {}, cb); }
      catch (e) { console.error(`[play] ${ev} 처리 오류:`, e.message); reply(cb, { ok: false }); }
    });
    const adminOk = () => isAdmin && adminRoom && rooms.get(adminRoom.code) === adminRoom;

    // ================= 관리자 =================
    on('admin:login', ({ password }, cb) => {
      isAdmin = String(password || '') === ADMIN_PASSWORD;
      reply(cb, isAdmin ? { ok: true } : { ok: false, error: '관리자 비밀번호가 틀렸어요.' });
    });

    function attachAdmin(r) {
      if (adminRoom) { socket.leave(adminRoom.code); socket.leave(adminRoom.code + ':admin'); }
      adminRoom = r;
      socket.data.adminOf = r.code;
      socket.join(r.code);
      socket.join(r.code + ':admin');
      Object.values(games).forEach(g => g.onAdminAttach && g.onAdminAttach(ctx, r, socket));
      broadcast(r);
    }

    on('admin:create', (_, cb) => {
      if (!isAdmin) return reply(cb, { ok: false, error: '관리자만 방을 만들 수 있어요.' });
      const code = newCode();
      const r = {
        code, adminKey: crypto.randomBytes(16).toString('hex'),
        status: 'lobby', game: null, settings: { groups: 4 }, groupNames: [],
        players: new Map(), groups: [], startedAt: null, createdAt: Date.now(),
        data: Object.fromEntries(Object.values(games).map(g => [g.id, g.createState()])),
      };
      resizeGroups(r);
      rooms.set(code, r);
      reply(cb, { ok: true, code, adminKey: r.adminKey });
      attachAdmin(r);
    });

    on('admin:resume', ({ code, adminKey }, cb) => {
      const r = rooms.get(String(code));
      if (!r || r.adminKey !== adminKey) return reply(cb, { ok: false });
      isAdmin = true;
      reply(cb, { ok: true, code: r.code });
      attachAdmin(r);
    });

    on('admin:settings', s => {
      if (!adminOk() || adminRoom.status !== 'lobby') return;
      if (intIn(s.groups, LIMITS.minGroups, LIMITS.maxGroups)) { adminRoom.settings.groups = +s.groups; resizeGroups(adminRoom); }
      broadcast(adminRoom);
    });

    on('admin:rename', ({ group, name }) => {
      if (!adminOk() || !intIn(group, 0, adminRoom.settings.groups - 1)) return;
      adminRoom.groupNames[+group] = cleanName(name) || null;
      broadcast(adminRoom);
    });

    // 이번 게임 고르기 (대기실에서만)
    on('admin:game', ({ id }, cb) => {
      if (!adminOk() || adminRoom.status !== 'lobby' || !games[id]) return reply(cb, { ok: false });
      adminRoom.game = id;
      reply(cb, { ok: true });
      broadcast(adminRoom);
    });

    on('admin:move', ({ pid: target, group }) => {
      if (!adminOk() || adminRoom.status !== 'lobby') return;
      const p = adminRoom.players.get(target);
      if (!p) return;
      p.group = group == null || group === '' ? null : (intIn(group, 0, adminRoom.settings.groups - 1) ? +group : p.group);
      broadcast(adminRoom);
    });

    on('admin:kick', ({ pid: target }) => {
      if (!adminOk()) return;
      const r = adminRoom, p = r.players.get(target), mod = modOf(r);
      if (!p) return;
      const gi = p.group;
      if (r.status !== 'lobby' && gi != null && mod) mod.onKick(ctx, r, p.pid, gi);
      r.players.delete(target);
      // 그룹에 아무도 남지 않으면 그 그룹은 빼고, 남은 그룹이 모두 끝났으면 게임 종료
      if (r.status === 'playing' && gi != null && ![...r.players.values()].some(x => x.group === gi)) {
        const g = r.groups[gi];
        if (g.active && !g.finishedAt) g.active = false;
        checkAllDone(r);
      }
      if (p.socketId) nsp.to(p.socketId).emit('kicked');
      broadcast(r);
    });

    on('admin:start', (_, cb) => {
      if (!adminOk() || adminRoom.status !== 'lobby') return reply(cb, { ok: false });
      const r = adminRoom, mod = modOf(r);
      if (!mod) return reply(cb, { ok: false, error: '먼저 이번 게임을 골라 주세요.' });
      const players = [...r.players.values()];
      if (!players.some(p => p.group != null)) return reply(cb, { ok: false, error: '그룹을 고른 플레이어가 아직 없어요.' });
      const members = r.groups.map((_, i) => shuffle(players.filter(p => p.group === i).map(p => p.pid)));
      const res = mod.start(ctx, r, members);
      if (!res.ok) return reply(cb, res);
      r.groups.forEach((g, i) => Object.assign(g, { active: members[i].length > 0, finishedAt: null, rank: null }));
      r.status = 'playing';
      r.startedAt = Date.now();
      reply(cb, { ok: true });
      broadcast(r);
    });

    // 다음 게임 준비: 플레이어·그룹·이름·사진/구절 목록은 두고 게임 데이터만 정리해서 대기실로
    on('admin:reset', () => {
      if (!adminOk()) return;
      const r = adminRoom;
      r.status = 'lobby';
      r.startedAt = null;
      r.groups.forEach(g => Object.assign(g, baseGroup()));
      Object.values(games).forEach(g => g.onReset(r));
      broadcast(r);
    });

    on('admin:close', () => {
      if (!adminOk()) return;
      nsp.to(adminRoom.code).emit('closed');
      rooms.delete(adminRoom.code);
      socket.leave(adminRoom.code);
      adminRoom = null;
    });

    // ================= 게임 모듈 이벤트 =================
    for (const mod of Object.values(games)) {
      // 관리자: 대기실에서는 모든 게임의 준비 이벤트, 진행 중에는 지금 게임의 이벤트만
      for (const [ev, fn] of Object.entries(mod.adminEvents)) {
        on(ev, (d, cb) => {
          if (!adminOk()) return reply(cb, { ok: false });
          if (adminRoom.status !== 'lobby' && adminRoom.game !== mod.id) return reply(cb, { ok: false });
          fn(ctx, adminRoom, d, cb, socket);
        });
      }
      // 플레이어: 지금 진행 중인 게임의 이벤트만
      for (const [ev, fn] of Object.entries(mod.playerEvents)) {
        on(ev, (d, cb) => {
          const p = me();
          if (!p || room.status !== 'playing' || room.game !== mod.id || p.group == null) return reply(cb, { ok: false });
          fn(ctx, room, p, d, cb, socket);
        });
      }
    }

    // ================= 플레이어 =================
    on('p:check', ({ code }, cb) => {
      const r = rooms.get(String(code || '').trim());
      reply(cb, r ? { ok: true, status: r.status } : { ok: false, error: '없는 입장 코드예요. 다시 확인해 주세요.' });
    });

    on('p:join', (data, cb) => {
      const { code, name, pin } = data;
      const r = rooms.get(String(code || '').trim());
      if (!r) return reply(cb, { ok: false, error: '없는 입장 코드예요.' });
      const n = cleanName(name);
      if (!n) return reply(cb, { ok: false, error: '이름을 입력해 주세요.' });
      if (!validPin(pin)) return reply(cb, { ok: false, error: '비밀번호는 숫자 4자리예요.' });

      const existing = [...r.players.values()].find(p => p.name === n);
      let player;
      if (existing) {
        if (existing.pin !== String(pin)) return reply(cb, { ok: false, error: '이미 있는 이름이에요. 내 이름이면 비밀번호를 확인해 주세요.' });
        player = existing; // 다시 들어오기: 그룹과 게임 데이터 그대로
        if (player.socketId && player.socketId !== socket.id) nsp.to(player.socketId).emit('kicked', '다른 기기에서 같은 이름으로 들어왔어요.');
      } else {
        if (r.status !== 'lobby') return reply(cb, { ok: false, error: '지금은 게임 중이에요. 처음 들어온 친구는 다음 게임에 함께해요.' });
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
      Object.values(games).forEach(g => g.onJoin && g.onJoin(ctx, r, socket, data));
      if (existing && r.status !== 'lobby') {
        // 게임 중 재접속: 본인에게만 전체 상태, 나머지에게는 접속 표시만
        socket.emit('state', publicState(r, viewOf(r, socket)));
        sendPresence(r, player.pid, true, socket.id);
      } else {
        broadcast(r);
      }
    });

    on('p:group', ({ group }, cb) => {
      const p = me();
      if (!p || room.status !== 'lobby') return reply(cb, { ok: false, error: '지금은 그룹을 고를 수 없어요.' });
      if (p.group != null) return reply(cb, { ok: false, error: '이미 그룹을 정했어요.' });
      if (!intIn(group, 0, room.settings.groups - 1)) return reply(cb, { ok: false, error: '없는 그룹이에요.' });
      p.group = +group;
      reply(cb, { ok: true });
      broadcast(room);
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

    // 스스로 나가기 (대기실에서는 명단에서 빠지고, 게임 중이면 자리를 남겨 둬서 비밀번호로 돌아올 수 있음)
    on('p:leave', () => {
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
