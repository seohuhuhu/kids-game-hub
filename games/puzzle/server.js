// 함께 맞추는 퍼즐 - 서버 로직 (방/세션, 조각 분배, 정답 판정)
const COLORS = ['#FF6B6B', '#4D96FF', '#6BCB77', '#FFB703', '#C77DFF', '#FF8FAB',
  '#2EC4B6', '#F77F00', '#8AC926', '#00BBF9', '#9B5DE5', '#E76F51'];
const MAX_PLAYERS = 12;
const MIN_GRID = 2;
const MAX_GRID = 8;
const SHAPES = ['square', 'triangle', 'mixed'];
const SNAP_DISTANCE = 0.45; // 정답 위치에서 이만큼(칸 단위) 안에 놓으면 정답 처리
const MAX_IMAGE_LENGTH = 6_000_000;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 칸마다 네모 1조각 또는 대각선으로 나눈 세모 2조각을 만든다.
function buildPieces(grid, shape) {
  const pieces = [];
  let id = 0;
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const cellShape = shape === 'mixed' ? (Math.random() < 0.5 ? 'square' : 'triangle') : shape;
      if (cellShape === 'square') {
        pieces.push({ id: id++, row, col, kind: 'sq' });
      } else if ((row + col) % 2 === 0) {
        // '\' 방향 대각선: 오른쪽 위 / 왼쪽 아래
        pieces.push({ id: id++, row, col, kind: 'tri-ur' });
        pieces.push({ id: id++, row, col, kind: 'tri-ll' });
      } else {
        // '/' 방향 대각선: 왼쪽 위 / 오른쪽 아래
        pieces.push({ id: id++, row, col, kind: 'tri-ul' });
        pieces.push({ id: id++, row, col, kind: 'tri-lr' });
      }
    }
  }
  return pieces.map(p => ({ ...p, owner: null, placed: false, placedBy: null }));
}

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 10);
}

module.exports = function registerPuzzle(nsp) {
  const rooms = new Map();

  function newCode() {
    let code;
    do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
    return code;
  }

  function publicState(room) {
    const players = [...room.players.values()].map(p => {
      const mine = room.pieces.filter(x => x.owner === p.id);
      return {
        id: p.id, name: p.name, color: p.color,
        assigned: mine.length,
        placed: room.pieces.filter(x => x.placedBy === p.id).length,
        left: mine.filter(x => !x.placed).length,
      };
    });
    return {
      code: room.code,
      hostId: room.hostId,
      status: room.status,
      settings: room.settings,
      hasImage: !!room.image,
      players,
      pieces: room.pieces,
      startedAt: room.startedAt,
      finishedAt: room.finishedAt,
      serverNow: Date.now(),
    };
  }

  function broadcast(room) {
    nsp.to(room.code).emit('state', publicState(room));
  }

  function addPlayer(room, socket, rawName) {
    let name = cleanName(rawName);
    const taken = new Set([...room.players.values()].map(p => p.name));
    if (taken.has(name)) {
      let n = 2;
      while (taken.has(`${name}${n}`)) n++;
      name = `${name}${n}`;
    }
    const used = new Set([...room.players.values()].map(p => p.color));
    const color = COLORS.find(c => !used.has(c)) || COLORS[room.players.size % COLORS.length];
    room.players.set(socket.id, { id: socket.id, name, color });
    socket.join(room.code);
  }

  // 나간 사람의 남은 조각을 남은 사람들에게 골고루 다시 나눠준다.
  function redistribute(room, leaverId) {
    const orphans = room.pieces.filter(p => p.owner === leaverId && !p.placed);
    const ids = [...room.players.keys()];
    if (!ids.length) return;
    const load = new Map(ids.map(id => [id, room.pieces.filter(p => p.owner === id && !p.placed).length]));
    for (const piece of orphans) {
      const target = ids.reduce((a, b) => (load.get(a) <= load.get(b) ? a : b));
      piece.owner = target;
      load.set(target, load.get(target) + 1);
    }
  }

  nsp.on('connection', socket => {
    let room = null;
    const isHost = () => room && room.hostId === socket.id;
    const reply = (cb, data) => typeof cb === 'function' && cb(data);

    socket.on('create', ({ name } = {}, cb) => {
      if (room) leave();
      if (!cleanName(name)) return reply(cb, { ok: false, error: '이름을 입력해 주세요.' });
      const code = newCode();
      room = {
        code, hostId: socket.id, status: 'lobby',
        settings: { grid: 5, shape: 'square' },
        image: null, pieces: [], players: new Map(),
        startedAt: null, finishedAt: null,
      };
      rooms.set(code, room);
      addPlayer(room, socket, name);
      reply(cb, { ok: true, code, me: socket.id });
      broadcast(room);
    });

    socket.on('join', ({ code, name } = {}, cb) => {
      const target = rooms.get(String(code || '').trim());
      if (!target) return reply(cb, { ok: false, error: '그런 방이 없어요. 코드를 다시 확인해 주세요.' });
      if (!cleanName(name)) return reply(cb, { ok: false, error: '이름을 입력해 주세요.' });
      if (target.status !== 'lobby') return reply(cb, { ok: false, error: '이미 게임이 시작된 방이에요.' });
      if (target.players.size >= MAX_PLAYERS) return reply(cb, { ok: false, error: `방이 가득 찼어요. (최대 ${MAX_PLAYERS}명)` });
      if (room) leave();
      room = target;
      addPlayer(room, socket, name);
      reply(cb, { ok: true, code: room.code, me: socket.id });
      if (room.image) socket.emit('image', room.image);
      broadcast(room);
    });

    socket.on('settings', ({ grid, shape } = {}) => {
      if (!isHost() || room.status !== 'lobby') return;
      const g = Number(grid);
      if (Number.isInteger(g) && g >= MIN_GRID && g <= MAX_GRID) room.settings.grid = g;
      if (SHAPES.includes(shape)) room.settings.shape = shape;
      broadcast(room);
    });

    socket.on('setImage', (dataUrl, cb) => {
      if (!isHost() || room.status !== 'lobby') return reply(cb, { ok: false });
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || dataUrl.length > MAX_IMAGE_LENGTH) {
        return reply(cb, { ok: false, error: '사진이 너무 크거나 올바르지 않아요.' });
      }
      room.image = dataUrl;
      nsp.to(room.code).emit('image', dataUrl);
      reply(cb, { ok: true });
      broadcast(room);
    });

    socket.on('start', (_, cb) => {
      if (!isHost() || room.status !== 'lobby') return reply(cb, { ok: false });
      if (!room.image) return reply(cb, { ok: false, error: '먼저 퍼즐 사진을 골라 주세요.' });
      const pieces = shuffle(buildPieces(room.settings.grid, room.settings.shape));
      const ids = shuffle([...room.players.keys()]);
      pieces.forEach((p, i) => { p.owner = ids[i % ids.length]; });
      room.pieces = pieces;
      room.status = 'playing';
      room.startedAt = Date.now();
      room.finishedAt = null;
      reply(cb, { ok: true });
      broadcast(room);
    });

    socket.on('place', ({ pieceId, x, y } = {}, cb) => {
      if (!room || room.status !== 'playing') return reply(cb, { ok: false });
      const piece = room.pieces.find(p => p.id === pieceId);
      if (!piece || piece.placed || piece.owner !== socket.id) return reply(cb, { ok: false });
      const n = room.settings.grid;
      const dx = Number(x) * n - piece.col;
      const dy = Number(y) * n - piece.row;
      if (!(Math.hypot(dx, dy) < SNAP_DISTANCE)) return reply(cb, { ok: false, wrong: true });

      piece.placed = true;
      piece.placedBy = socket.id;
      if (room.pieces.every(p => p.placed)) {
        room.status = 'done';
        room.finishedAt = Date.now();
      }
      broadcast(room);
      reply(cb, { ok: true });
    });

    socket.on('restart', () => {
      if (!isHost() || room.status === 'lobby') return;
      room.status = 'lobby';
      room.pieces = [];
      room.startedAt = room.finishedAt = null;
      broadcast(room);
    });

    function leave() {
      if (!room) return;
      const r = room;
      room = null;
      r.players.delete(socket.id);
      socket.leave(r.code);
      if (r.players.size === 0) {
        rooms.delete(r.code);
        return;
      }
      if (r.hostId === socket.id) r.hostId = r.players.keys().next().value;
      if (r.status === 'playing') redistribute(r, socket.id);
      broadcast(r);
    }

    socket.on('leave', leave);
    socket.on('disconnect', leave);
  });
};
