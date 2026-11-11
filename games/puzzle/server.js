// CODE:Block 퍼즐 - 서버 로직
// 관리자(선생님)가 방을 만들고 제어하며, 플레이어는 코드+이름+비밀번호로 들어와 그룹을 골라 그룹별로 퍼즐을 맞춘다.
const crypto = require('crypto');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const COLORS = ['#FF6B6B', '#4D96FF', '#22C55E', '#F59E0B', '#A855F7', '#EC4899',
  '#14B8A6', '#F97316', '#84CC16', '#06B6D4', '#8B5CF6', '#EF4444'];
const LIMITS = { minGrid: 2, maxGrid: 8, minGroups: 1, maxGroups: 10, maxPlayers: 60 };
const SHAPES = ['square', 'triangle', 'mixed'];
const SNAP_DISTANCE = 0.45;           // 정답 칸에서 이 거리(칸 단위) 안이면 정답
const MAX_IMAGE_LENGTH = 6_000_000;

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

// 칸마다 네모 1조각 또는 대각선으로 나눈 세모 2조각. rot = 0~3 (90도 단위, 0이 정답 방향)
function buildPieces(rows, cols, shape) {
  const pieces = [];
  let id = 0;
  const add = (row, col, kind) => pieces.push({
    id: id++, row, col, kind, rot: Math.floor(Math.random() * 4), owner: null, placed: false, placedBy: null,
  });
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const s = shape === 'mixed' ? (Math.random() < 0.5 ? 'square' : 'triangle') : shape;
      if (s === 'square') add(row, col, 'sq');
      else if ((row + col) % 2 === 0) { add(row, col, 'tri-ur'); add(row, col, 'tri-ll'); }
      else { add(row, col, 'tri-ul'); add(row, col, 'tri-lr'); }
    }
  }
  // 돌리지 않아도 되는 조각이 너무 많지 않게: 최소 절반은 돌아가 있도록
  pieces.forEach((p, i) => { if (i % 2 === 0 && p.rot === 0) p.rot = 1 + Math.floor(Math.random() * 3); });
  return pieces;
}

module.exports = function registerPuzzle(nsp) {
  const rooms = new Map();

  const newCode = () => {
    let c;
    do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c));
    return c;
  };

  function publicState(room) {
    const players = [...room.players.values()].map(p => {
      const g = p.group != null ? room.groups[p.group] : null;
      const mine = g ? g.pieces.filter(x => x.owner === p.pid) : [];
      return {
        pid: p.pid, name: p.name, color: p.color, group: p.group, online: !!p.socketId,
        assigned: mine.length, left: mine.filter(x => !x.placed).length,
        placed: g ? g.pieces.filter(x => x.placedBy === p.pid).length : 0,
      };
    });
    return {
      code: room.code,
      status: room.status,
      settings: room.settings,
      hasImage: !!room.image,
      hint: room.hint,
      startedAt: room.startedAt,
      serverNow: Date.now(),
      players,
      groups: room.groups.map((g, i) => ({
        index: i, name: `${i + 1}그룹`, active: g.active,
        pieces: g.pieces, total: g.pieces.length, placed: g.pieces.filter(p => p.placed).length,
        finishedAt: g.finishedAt, rank: g.rank,
      })),
    };
  }

  const broadcast = room => nsp.to(room.code).emit('state', publicState(room));

  function resizeGroups(room) {
    const n = room.settings.groups;
    while (room.groups.length < n) room.groups.push({ active: false, pieces: [], finishedAt: null, rank: null });
    room.groups.length = n;
    for (const p of room.players.values()) if (p.group != null && p.group >= n) p.group = null;
  }

  // 그룹 안에서 주인이 없어진 조각을 남은 멤버에게 고르게 나눈다
  function redistribute(room, groupIdx, fromPid) {
    const g = room.groups[groupIdx];
    if (!g || !g.active) return;
    const members = [...room.players.values()].filter(p => p.group === groupIdx && p.pid !== fromPid);
    if (!members.length) return;
    const online = members.filter(m => m.socketId);
    const pool = (online.length ? online : members).map(m => m.pid);
    const load = new Map(pool.map(id => [id, g.pieces.filter(p => p.owner === id && !p.placed).length]));
    for (const piece of g.pieces.filter(p => p.owner === fromPid && !p.placed)) {
      const target = pool.reduce((a, b) => (load.get(a) <= load.get(b) ? a : b));
      piece.owner = target;
      load.set(target, load.get(target) + 1);
    }
  }

  nsp.on('connection', socket => {
    let isAdmin = false;   // 관리자 비밀번호 확인 여부
    let adminRoom = null;  // 관리 중인 방
    let room = null;       // 플레이어로 들어간 방
    let pid = null;
    const reply = (cb, data) => typeof cb === 'function' && cb(data);
    const me = () => room && room.players.get(pid);

    // ================= 관리자 =================
    socket.on('admin:login', ({ password } = {}, cb) => {
      isAdmin = String(password || '') === ADMIN_PASSWORD;
      reply(cb, isAdmin ? { ok: true } : { ok: false, error: '관리자 비밀번호가 틀렸어요.' });
    });

    function attachAdmin(r) {
      if (adminRoom) socket.leave(adminRoom.code);
      adminRoom = r;
      socket.join(r.code);
      if (r.image) socket.emit('image', r.image);
      broadcast(r);
    }

    socket.on('admin:create', (_, cb) => {
      if (!isAdmin) return reply(cb, { ok: false, error: '관리자만 방을 만들 수 있어요.' });
      const code = newCode();
      const r = {
        code, adminKey: crypto.randomBytes(16).toString('hex'),
        status: 'lobby', settings: { groups: 4, rows: 4, cols: 4, shape: 'square' },
        image: null, hint: false, players: new Map(), groups: [], startedAt: null, createdAt: Date.now(),
      };
      resizeGroups(r);
      rooms.set(code, r);
      reply(cb, { ok: true, code, adminKey: r.adminKey });
      attachAdmin(r);
    });

    // 새로고침해도 관리 권한 유지
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
      const st = adminRoom.settings;
      if (intIn(s.rows, LIMITS.minGrid, LIMITS.maxGrid)) st.rows = +s.rows;
      if (intIn(s.cols, LIMITS.minGrid, LIMITS.maxGrid)) st.cols = +s.cols;
      if (intIn(s.groups, LIMITS.minGroups, LIMITS.maxGroups)) { st.groups = +s.groups; resizeGroups(adminRoom); }
      if (SHAPES.includes(s.shape)) st.shape = s.shape;
      broadcast(adminRoom);
    });

    socket.on('admin:image', (dataUrl, cb) => {
      if (!adminOk() || adminRoom.status !== 'lobby') return reply(cb, { ok: false });
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || dataUrl.length > MAX_IMAGE_LENGTH) {
        return reply(cb, { ok: false, error: '사진이 너무 크거나 올바르지 않아요.' });
      }
      adminRoom.image = dataUrl;
      nsp.to(adminRoom.code).emit('image', dataUrl);
      reply(cb, { ok: true });
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
      const r = adminRoom;
      if (!r.image) return reply(cb, { ok: false, error: '먼저 퍼즐 사진을 넣어 주세요.' });
      const players = [...r.players.values()];
      if (!players.some(p => p.group != null)) return reply(cb, { ok: false, error: '그룹을 고른 플레이어가 아직 없어요.' });
      const { rows, cols, shape } = r.settings;
      r.groups.forEach((g, i) => {
        const members = shuffle(players.filter(p => p.group === i).map(p => p.pid));
        g.active = members.length > 0;
        g.finishedAt = null;
        g.rank = null;
        g.pieces = g.active ? shuffle(buildPieces(rows, cols, shape)) : [];
        g.pieces.forEach((p, k) => { p.owner = members[k % members.length]; });
      });
      r.status = 'playing';
      r.hint = false;
      r.startedAt = Date.now();
      reply(cb, { ok: true });
      broadcast(r);
    });

    socket.on('admin:hint', ({ on } = {}) => {
      if (!adminOk() || adminRoom.status === 'lobby') return;
      adminRoom.hint = !!on;
      broadcast(adminRoom);
    });

    // 다음 판: 플레이어와 그룹은 그대로 두고 대기실로
    socket.on('admin:reset', () => {
      if (!adminOk()) return;
      const r = adminRoom;
      r.status = 'lobby';
      r.hint = false;
      r.startedAt = null;
      r.groups.forEach(g => Object.assign(g, { active: false, pieces: [], finishedAt: null, rank: null }));
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
        player = existing; // 다시 들어오기: 그룹과 조각 그대로
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
      socket.join(r.code);
      reply(cb, { ok: true, pid, rejoined: !!existing, code: r.code });
      if (r.image) socket.emit('image', r.image);
      broadcast(r);
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

    const myPiece = id => {
      const p = me();
      if (!p || room.status !== 'playing' || p.group == null) return null;
      const g = room.groups[p.group];
      const piece = g.pieces.find(x => x.id === id);
      return piece && !piece.placed && piece.owner === pid ? { g, piece } : null;
    };

    socket.on('p:rotate', ({ pieceId } = {}, cb) => {
      const found = myPiece(pieceId);
      if (!found) return reply(cb, { ok: false });
      found.piece.rot = (found.piece.rot + 1) % 4;
      reply(cb, { ok: true, rot: found.piece.rot });
      broadcast(room);
    });

    socket.on('p:place', ({ pieceId, x, y } = {}, cb) => {
      const found = myPiece(pieceId);
      if (!found) return reply(cb, { ok: false });
      const { g, piece } = found;
      const { rows, cols } = room.settings;
      const dist = Math.hypot(Number(x) * cols - piece.col, Number(y) * rows - piece.row);
      if (!(dist < SNAP_DISTANCE)) return reply(cb, { ok: false, wrong: 'place' });
      if (piece.rot !== 0) return reply(cb, { ok: false, wrong: 'rot' });

      piece.placed = true;
      piece.placedBy = pid;
      const groupIdx = room.groups.indexOf(g);
      let groupDone = false;
      if (g.pieces.every(p => p.placed)) {
        g.finishedAt = Date.now();
        g.rank = room.groups.filter(x => x.finishedAt).length;
        groupDone = true;
        if (room.groups.filter(x => x.active).every(x => x.finishedAt)) room.status = 'done';
      }
      nsp.to(room.code).emit('placed', { group: groupIdx, pieceId, by: pid, groupDone, rank: g.rank });
      reply(cb, { ok: true });
      broadcast(room);
    });

    function leavePlayer() {
      const p = me();
      if (p && p.socketId === socket.id) p.socketId = null;
      if (room) { socket.leave(room.code); broadcast(room); }
      room = null;
      pid = null;
    }

    // 스스로 나가기 (대기실에서는 명단에서 빠지고, 게임 중이면 자리를 남겨 둬서 비밀번호로 돌아올 수 있음)
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
