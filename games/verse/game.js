// 말씀 블록 - 게임 모듈 (통합 세션 games/session/server.js에서 사용)
// 구절을 단어 블록으로 나눠 그룹 멤버에게 나눠 주고, 함께 문장 줄의 칸을 채운다.
// 확인 방식: A(instant) 칸마다 바로 확인 / B(submit) 다 채우고 제출
const crypto = require('crypto');
const { LIMITS: V, splitBlocks, makeBlocks, slotIsCorrect, countWrong } = require('./logic');

const MODES = ['instant', 'submit'];
const COOLDOWN_MS = 5000; // B 방식에서 틀린 뒤 다시 제출할 수 없는 시간
const intIn = (v, lo, hi) => Number.isInteger(+v) && +v >= lo && +v <= hi;

const D = room => room.data.verse;
const blocksOf = (room, gi) => room.groups[gi].blocks || [];
const currentVerse = room => D(room).verses.find(v => v.id === D(room).verseId) || null;
// 진행 중인 라운드의 정답 (시작할 때 고정)
const answerOf = room => D(room).answer || (currentVerse(room) ? currentVerse(room).blocks : []);

function sendList(ctx, room) {
  const d = D(room);
  ctx.toAdmins(room, 'verse:list', { current: d.verseId, items: d.verses.map(({ id, text, ref, blocks }) => ({ id, text, ref, blocks })) });
}
const sendBlock = (ctx, room, gi, b) =>
  ctx.toGroup(room, gi, 'verse:block', { g: gi, b: { id: b.id, owner: b.owner, slot: b.slot, locked: b.locked } });

function finish(ctx, room, gi, by) {
  const rank = ctx.finishGroup(room, gi);
  ctx.toGroup(room, gi, 'verse:done', { group: gi, rank, by });
  ctx.broadcast(room);
}

// 내 블록 찾기 (완성 전 그룹의 내 것)
function myBlock(room, player, id) {
  const g = room.groups[player.group];
  if (!g.active || g.finishedAt) return null;
  const b = blocksOf(room, player.group).find(x => x.id === id);
  return b && b.owner === player.pid ? b : null;
}

module.exports = {
  id: 'verse',
  title: '말씀 블록',

  createState: () => ({
    verses: [], verseId: null, mode: 'instant',
    hint: { ref: false, words: false }, answer: null, verseAtStart: null,
  }),

  start(ctx, room, members) {
    const d = D(room), verse = currentVerse(room);
    if (!verse) return { ok: false, error: '먼저 구절을 추가하고 골라 주세요.' };
    d.answer = verse.blocks.slice();
    d.verseAtStart = { ...verse };
    d.hint = { ref: false, words: false };
    room.groups.forEach((g, i) => {
      const m = members[i];
      g.cooldownUntil = 0;
      g.lastWrong = null;
      g.blocks = m.length ? makeBlocks(d.answer).map((b, k) => ({ ...b, owner: m[k % m.length], slot: null, locked: false })) : [];
    });
    return { ok: true };
  },

  groupView(room, gi, full) {
    const g = room.groups[gi], blocks = blocksOf(room, gi);
    return {
      blocks: full ? blocks : [], total: blocks.length,
      filledCount: blocks.filter(b => b.slot != null).length,
      lockedCount: blocks.filter(b => b.locked).length,
      cooldownUntil: g.cooldownUntil || 0, lastWrong: g.lastWrong ?? null,
    };
  },

  // 정답 본문은 관리자에게만. 참조·전체 글자는 힌트가 켜졌을 때만(완성한 그룹에는 참조 공개)
  roundView(room, view) {
    const d = D(room), answer = answerOf(room), live = room.status !== 'lobby';
    const round = { mode: d.mode, verseId: d.verseId, slots: answer.length, hint: { ...d.hint } };
    if (view === 'admin') {
      const v = live ? d.verseAtStart : currentVerse(room);
      round.verse = v ? { text: v.text, ref: v.ref, blocks: v.blocks } : null;
    }
    const groupDone = typeof view === 'number' && room.groups[view] && room.groups[view].finishedAt;
    if (live && d.verseAtStart && (d.hint.ref || groupDone)) round.ref = d.verseAtStart.ref;
    if (live && d.hint.words) round.words = answer.slice();
    return round;
  },

  playerStats(room, p) {
    const mine = blocksOf(room, p.group).filter(b => b.owner === p.pid);
    return { assigned: mine.length, left: mine.filter(b => b.slot == null).length, placed: mine.filter(b => b.locked).length };
  },

  // 내보낸 사람의 블록(칸에 있는 것 포함)을 그룹 안 다른 멤버에게 넘김. 칸에 있는 블록은 칸에 그대로 둔다
  onKick(ctx, room, fromPid, gi) {
    const g = room.groups[gi];
    if (!g.active) return;
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
  },

  onReset(room) {
    const d = D(room);
    d.hint = { ref: false, words: false };
    d.answer = null;
    d.verseAtStart = null;
    if (d.verseId && !d.verses.some(v => v.id === d.verseId)) d.verseId = d.verses[0] ? d.verses[0].id : null;
    room.groups.forEach(g => { g.blocks = []; g.cooldownUntil = 0; g.lastWrong = null; });
  },

  onAdminAttach(ctx, room) { sendList(ctx, room); },

  adminEvents: {
    // 구절 목록 (방에 임시 보관)
    'verse:add'(ctx, room, { text, ref }, cb) {
      const blocks = splitBlocks(text);
      if (!blocks.length) return ctx.reply(cb, { ok: false, error: '구절을 입력해 주세요.' });
      if (blocks.length > V.maxBlocks) return ctx.reply(cb, { ok: false, error: `블록이 너무 많아요. (최대 ${V.maxBlocks}개)` });
      const d = D(room);
      const v = {
        id: crypto.randomBytes(6).toString('hex'),
        text: String(text).trim().slice(0, 500), ref: String(ref || '').trim().slice(0, 40), blocks,
      };
      d.verses.unshift(v);
      while (d.verses.length > V.maxVerses) {
        const old = d.verses.pop();
        if (old.id === d.verseId && room.status === 'lobby') d.verseId = null;
      }
      if (!d.verseId && room.status === 'lobby') d.verseId = v.id;
      ctx.reply(cb, { ok: true, id: v.id });
      sendList(ctx, room);
      ctx.broadcast(room);
    },

    'verse:delete'(ctx, room, { id }) {
      const d = D(room);
      d.verses = d.verses.filter(v => v.id !== id);
      if (d.verseId === id && room.status === 'lobby') d.verseId = d.verses[0] ? d.verses[0].id : null;
      sendList(ctx, room);
      ctx.broadcast(room);
    },

    'verse:round'(ctx, room, { verseId, mode }) {
      if (room.status !== 'lobby') return;
      const d = D(room);
      if (verseId !== undefined && d.verses.some(v => v.id === verseId)) d.verseId = verseId;
      if (MODES.includes(mode)) d.mode = mode;
      sendList(ctx, room);
      ctx.broadcast(room);
    },

    'verse:hint'(ctx, room, h) {
      if (room.status === 'lobby') return;
      const d = D(room);
      if (typeof h.ref === 'boolean') d.hint.ref = h.ref;
      if (typeof h.words === 'boolean') d.hint.words = h.words;
      ctx.broadcast(room);
    },
  },

  playerEvents: {
    'verse:place'(ctx, room, player, { blockId, slot }, cb) {
      const b = myBlock(room, player, blockId);
      if (!b || b.locked) return ctx.reply(cb, { ok: false });
      const answer = answerOf(room), gi = player.group, g = room.groups[gi];
      if (!intIn(slot, 0, answer.length - 1)) return ctx.reply(cb, { ok: false });
      if (g.blocks.some(x => x.slot === +slot && x !== b)) return ctx.reply(cb, { ok: false, error: '이미 다른 블록이 있어요.' });
      b.slot = +slot;
      const instant = D(room).mode === 'instant';
      if (instant && slotIsCorrect(answer, b.slot, b.text)) b.locked = true;
      ctx.reply(cb, { ok: true, locked: b.locked });
      if (b.locked) ctx.toGroup(room, gi, 'verse:locked', { group: gi, blockId: b.id, by: player.pid });
      if (instant && g.blocks.every(x => x.locked)) return finish(ctx, room, gi, player.pid);
      sendBlock(ctx, room, gi, b);
    },

    'verse:unplace'(ctx, room, player, { blockId }, cb) {
      const b = myBlock(room, player, blockId);
      if (!b || b.locked || b.slot == null) return ctx.reply(cb, { ok: false });
      b.slot = null;
      ctx.reply(cb, { ok: true });
      sendBlock(ctx, room, player.group, b);
    },

    // B 방식: 모든 칸이 차면 그룹 누구나 제출
    'verse:submit'(ctx, room, player, _, cb) {
      const d = D(room), gi = player.group, g = room.groups[gi];
      if (d.mode !== 'submit' || !g.active || g.finishedAt) return ctx.reply(cb, { ok: false });
      if (g.blocks.some(b => b.slot == null)) return ctx.reply(cb, { ok: false, error: '빈칸을 모두 채워야 제출할 수 있어요.' });
      const now = Date.now();
      if (now < g.cooldownUntil) return ctx.reply(cb, { ok: false, error: '잠시 후에 다시 제출할 수 있어요.', cooldownMs: g.cooldownUntil - now });
      const wrong = countWrong(answerOf(room), g.blocks);
      g.lastWrong = wrong;
      if (wrong === 0) {
        g.blocks.forEach(b => { b.locked = true; });
        ctx.reply(cb, { ok: true, correct: true, wrong: 0 });
        ctx.toGroup(room, gi, 'verse:submitted', { group: gi, by: player.pid, correct: true, wrong: 0 });
        return finish(ctx, room, gi, player.pid);
      }
      g.cooldownUntil = now + COOLDOWN_MS;
      ctx.reply(cb, { ok: true, correct: false, wrong, cooldownMs: COOLDOWN_MS });
      ctx.toGroup(room, gi, 'verse:submitted', { group: gi, by: player.pid, correct: false, wrong, cooldownUntil: g.cooldownUntil });
    },
  },
};
