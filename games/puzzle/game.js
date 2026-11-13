// CODE:Block 퍼즐 - 게임 모듈 (통합 세션 games/session/server.js에서 사용)
// 사진 한 장을 그룹별로 조각내 멤버에게 나눠 주고, 판 위에 올려 두거나 두 번 눌러 돌려 맞춘다.
const crypto = require('crypto');

const LIMITS = { minGrid: 2, maxGrid: 8 };
const SHAPES = ['square', 'triangle', 'mixed'];
const SNAP_DISTANCE = 0.45;          // 정답 칸에서 이 거리(칸 단위) 안이면 정답
const MAX_IMAGE_LENGTH = 6_000_000;
const MAX_LIBRARY = 12;              // 방마다 임시로 보관하는 올린 사진 수
const intIn = (v, lo, hi) => Number.isInteger(+v) && +v >= lo && +v <= hi;
const isImage = d => typeof d === 'string' && d.startsWith('data:image/') && d.length <= MAX_IMAGE_LENGTH;

// 칸마다 네모 1조각 또는 대각선으로 나눈 세모 2조각. rot = 0~3 (90도 단위, 0이 정답 방향)
function buildPieces(rows, cols, shape) {
  const pieces = [];
  let id = 0;
  const add = (row, col, kind) => pieces.push({
    id: id++, row, col, kind, rot: Math.floor(Math.random() * 4), owner: null, placed: false, placedBy: null,
    pos: null, // 판 위에 올려 둔 위치 {x,y} (판 기준 0~1), 쟁반에 있으면 null
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

const D = room => room.data.puzzle;
const piecesOf = (room, gi) => room.groups[gi].pieces || [];

function sendLibrary(ctx, room) {
  const d = D(room);
  ctx.toAdmins(room, 'puzzle:library', { current: d.imageId, items: d.library.map(({ id, thumb }) => ({ id, thumb })) });
}

function setImage(ctx, room, dataUrl, id) {
  const d = D(room);
  d.image = dataUrl;
  d.imageId = id;
  d.imageVer++;
  ctx.toRoom(room, 'puzzle:image', { dataUrl, ver: d.imageVer });
  sendLibrary(ctx, room);
  ctx.broadcast(room);
}

// 위치와 방향이 모두 맞으면 정답 처리. 결과: 'placed' | 'rot'(자리는 맞고 방향이 틀림) | null
function tryPlace(ctx, room, gi, piece, pid) {
  if (!piece.pos) return null;
  const { rows, cols } = D(room);
  const dist = Math.hypot(piece.pos.x * cols - piece.col, piece.pos.y * rows - piece.row);
  if (!(dist < SNAP_DISTANCE)) return null;
  if (piece.rot !== 0) return 'rot';
  piece.placed = true;
  piece.placedBy = pid;
  piece.pos = null;
  const g = room.groups[gi];
  let groupDone = false;
  if (g.pieces.every(p => p.placed)) { ctx.finishGroup(room, gi); groupDone = true; }
  ctx.toGroup(room, gi, 'puzzle:placed', { group: gi, pieceId: piece.id, by: pid, groupDone, rank: g.rank });
  return 'placed';
}

// 조각 하나가 바뀌면 바뀐 조각만 보냄 (그룹 완성·순위는 전체 상태로)
function sendPiece(ctx, room, gi, piece) {
  if (room.groups[gi].finishedAt) return ctx.broadcast(room);
  const { id, rot, pos, placed, placedBy, owner } = piece;
  ctx.toGroup(room, gi, 'puzzle:piece', { g: gi, p: { id, rot, pos, placed, placedBy, owner } });
}

// 내 조각 찾기 (아직 맞추지 않은 내 것)
function myPiece(room, player, id) {
  const piece = piecesOf(room, player.group).find(x => x.id === id);
  return piece && !piece.placed && piece.owner === player.pid ? piece : null;
}

module.exports = {
  id: 'puzzle',
  title: '퍼즐',

  createState: () => ({
    rows: 4, cols: 4, shape: 'square', opacity: 0.5, hint: false,
    library: [], image: null, imageId: null, imageVer: 0,
  }),

  start(ctx, room, members) {
    const d = D(room);
    if (!d.image) return { ok: false, error: '먼저 퍼즐 사진을 넣어 주세요.' };
    room.groups.forEach((g, i) => {
      const m = members[i];
      g.pieces = m.length ? ctx.shuffle(buildPieces(d.rows, d.cols, d.shape)) : [];
      g.pieces.forEach((p, k) => { p.owner = m[k % m.length]; });
    });
    d.hint = false;
    return { ok: true };
  },

  groupView(room, gi, full) {
    const pieces = piecesOf(room, gi);
    return { pieces: full ? pieces : [], total: pieces.length, placed: pieces.filter(p => p.placed).length };
  },

  roundView(room) {
    const d = D(room);
    return {
      rows: d.rows, cols: d.cols, shape: d.shape, opacity: d.opacity, hint: d.hint,
      hasImage: !!d.image, imageId: d.imageId, imageVer: d.imageVer,
    };
  },

  playerStats(room, p) {
    const pieces = piecesOf(room, p.group);
    const mine = pieces.filter(x => x.owner === p.pid);
    return { assigned: mine.length, left: mine.filter(x => !x.placed).length, placed: pieces.filter(x => x.placedBy === p.pid).length };
  },

  // 내보낸 사람의 남은 조각을 그룹 안 다른 멤버에게 고르게 나눈다
  onKick(ctx, room, fromPid, gi) {
    const g = room.groups[gi];
    if (!g.active) return;
    const members = [...room.players.values()].filter(p => p.group === gi && p.pid !== fromPid);
    if (!members.length) return;
    const online = members.filter(m => m.socketId);
    const pool = (online.length ? online : members).map(m => m.pid);
    const load = new Map(pool.map(id => [id, g.pieces.filter(p => p.owner === id && !p.placed).length]));
    for (const piece of g.pieces.filter(p => p.owner === fromPid && !p.placed)) {
      const target = pool.reduce((a, b) => (load.get(a) <= load.get(b) ? a : b));
      piece.owner = target;
      piece.pos = null;
      load.set(target, load.get(target) + 1);
    }
  },

  onReset(room) {
    room.groups.forEach(g => { g.pieces = []; });
    D(room).hint = false;
  },

  onAdminAttach(ctx, room, socket) {
    const d = D(room);
    if (d.image) socket.emit('puzzle:image', { dataUrl: d.image, ver: d.imageVer });
    socket.emit('puzzle:library', { current: d.imageId, items: d.library.map(({ id, thumb }) => ({ id, thumb })) });
  },

  // 이미 받은 사진이면 다시 보내지 않음 (재접속 시 데이터 절약)
  onJoin(ctx, room, socket, { imageVer }) {
    const d = D(room);
    if (d.image && imageVer !== d.imageVer) socket.emit('puzzle:image', { dataUrl: d.image, ver: d.imageVer });
  },

  adminEvents: {
    'puzzle:settings'(ctx, room, s) {
      const d = D(room);
      // 친구 조각 투명도는 게임 중에도 바꿀 수 있음
      const op = Number(s.opacity);
      if (s.opacity != null && op >= 0.1 && op <= 1) d.opacity = Math.round(op * 100) / 100;
      if (room.status === 'lobby') {
        if (intIn(s.rows, LIMITS.minGrid, LIMITS.maxGrid)) d.rows = +s.rows;
        if (intIn(s.cols, LIMITS.minGrid, LIMITS.maxGrid)) d.cols = +s.cols;
        if (SHAPES.includes(s.shape)) d.shape = s.shape;
      }
      ctx.broadcast(room);
    },

    // 사진 정하기. 직접 올린 사진(save=true)은 방의 사진 목록에 임시 보관해 다시 쓸 수 있음
    'puzzle:image'(ctx, room, { dataUrl, thumb, save }, cb) {
      if (room.status !== 'lobby') return ctx.reply(cb, { ok: false });
      if (!isImage(dataUrl) || (thumb != null && !isImage(thumb))) return ctx.reply(cb, { ok: false, error: '사진이 너무 크거나 올바르지 않아요.' });
      const d = D(room);
      let id = null;
      if (save) {
        const same = d.library.find(x => x.dataUrl === dataUrl);
        id = same ? same.id : crypto.randomBytes(6).toString('hex');
        if (!same) {
          d.library.unshift({ id, dataUrl, thumb: thumb || dataUrl });
          d.library.length = Math.min(d.library.length, MAX_LIBRARY);
        }
      }
      ctx.reply(cb, { ok: true, id });
      setImage(ctx, room, dataUrl, id);
    },

    'puzzle:useImage'(ctx, room, { id }, cb) {
      if (room.status !== 'lobby') return ctx.reply(cb, { ok: false });
      const item = D(room).library.find(x => x.id === id);
      if (!item) return ctx.reply(cb, { ok: false, error: '없는 사진이에요.' });
      ctx.reply(cb, { ok: true });
      setImage(ctx, room, item.dataUrl, item.id);
    },

    'puzzle:deleteImage'(ctx, room, { id }) {
      const d = D(room);
      d.library = d.library.filter(x => x.id !== id);
      sendLibrary(ctx, room);
    },

    'puzzle:hint'(ctx, room, { on }) {
      if (room.status === 'lobby') return;
      D(room).hint = !!on;
      ctx.broadcast(room);
    },
  },

  playerEvents: {
    // 두 번 눌러 돌리기. 판 위 정답 자리에 있던 조각이 바른 방향이 되면 바로 맞춰짐
    'puzzle:rotate'(ctx, room, player, { pieceId }, cb) {
      const piece = myPiece(room, player, pieceId);
      if (!piece) return ctx.reply(cb, { ok: false });
      piece.rot = (piece.rot + 1) % 4;
      const result = tryPlace(ctx, room, player.group, piece, player.pid);
      ctx.reply(cb, { ok: true, rot: piece.rot, placed: result === 'placed' });
      sendPiece(ctx, room, player.group, piece);
    },

    // 조각을 판 위 아무 곳에 올려 두기 (같은 그룹 친구에게 보임). x,y = null 이면 쟁반으로 되돌림
    'puzzle:move'(ctx, room, player, { pieceId, x, y }, cb) {
      const piece = myPiece(room, player, pieceId);
      if (!piece) return ctx.reply(cb, { ok: false });
      if (x == null || y == null) {
        piece.pos = null;
      } else {
        const nx = Number(x), ny = Number(y);
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) return ctx.reply(cb, { ok: false });
        piece.pos = { x: Math.min(1, Math.max(-0.2, nx)), y: Math.min(1, Math.max(-0.2, ny)) };
      }
      const result = tryPlace(ctx, room, player.group, piece, player.pid);
      ctx.reply(cb, { ok: true, placed: result === 'placed', wrong: result === 'rot' ? 'rot' : undefined });
      sendPiece(ctx, room, player.group, piece);
    },
  },
};
