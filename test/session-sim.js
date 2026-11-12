// 통합 세션 테스트: 한 방에서 퍼즐 ↔ 말씀 블록 전환 (서버 실행 중일 때: node test/session-sim.js)
const assert = require('assert');
const { connect, emit, wait, ok, count, track, adminRoom } = require('./session-helpers');

const IMG = 'data:image/jpeg;base64,AAAA';
const TEXT = '말 한마디가 누군가의 인생을 바꿀 수 있어요';

// 퍼즐 한 판을 끝까지: 각자 조각을 바른 방향으로 돌려 정답 자리에 놓기
async function solvePuzzle(st, players) {
  const { rows, cols } = st().round;
  for (const g of st().groups.filter(x => x.active)) {
    for (const p of g.pieces.filter(x => !x.placed)) {
      const s = players.find(q => q.pid === p.owner).s;
      let rot = p.rot;
      while (rot !== 0) rot = (await emit(s, 'puzzle:rotate', { pieceId: p.id })).rot;
      const r = await emit(s, 'puzzle:move', { pieceId: p.id, x: p.col / cols, y: p.row / rows });
      assert.ok(r.ok && r.placed, 'puzzle place ' + JSON.stringify(r));
    }
  }
}
// 말씀 블록 한 판을 끝까지 (A 방식)
async function solveVerse(st, players) {
  const answer = TEXT.split(' ');
  for (const g of st().groups.filter(x => x.active)) {
    for (const b of g.blocks.filter(x => !x.locked)) {
      const s = players.find(q => q.pid === b.owner).s;
      const slot = answer.findIndex((w, i) => w === b.text && !g.blocks.some(x => x.slot === i && x.locked));
      const r = await emit(s, 'verse:place', { blockId: b.id, slot });
      assert.ok(r.ok && r.locked, 'verse place ' + JSON.stringify(r));
      b.slot = slot; b.locked = true;
    }
  }
}

(async () => {
  const { admin, code, adminKey, st } = await adminRoom(null);
  admin.emit('admin:settings', { groups: 2 });
  admin.emit('admin:rename', { group: 0, name: '사자팀' });
  // 퍼즐을 고르기 전에도 사진·구절 준비 가능
  const up = await emit(admin, 'puzzle:image', { dataUrl: IMG, thumb: IMG, save: true });
  ok(up.ok, '퍼즐 사진은 대기실에서 퍼즐을 안 골라도 올릴 수 있음');
  const v = await emit(admin, 'verse:add', { text: TEXT, ref: '열왕기하 5:3' });
  ok(v.ok, '구절도 게임을 고르기 전에 추가 가능');
  admin.emit('puzzle:settings', { rows: 2, cols: 2 });
  ok(!(await emit(admin, 'admin:start')).ok, '게임을 고르지 않으면 시작 불가');

  // 플레이어 4명 입장 (2명씩 두 그룹)
  const players = [];
  for (let i = 0; i < 4; i++) {
    const s = connect(), t = track(s);
    const r = await emit(s, 'p:join', { code, name: '친구' + i, pin: '1234' });
    await emit(s, 'p:group', { group: i % 2 });
    players.push({ s, t, pid: r.pid, name: '친구' + i });
  }
  const pids = players.map(p => p.pid).join();

  admin.emit('admin:game', { id: 'puzzle' }); await wait(100);
  ok(players.every(p => p.t.st.game === 'puzzle'), '대기실에서 게임 고르면 플레이어 상태의 game 변경');

  // 1판: 퍼즐
  ok((await emit(admin, 'admin:start')).ok, '퍼즐 시작');
  await wait(150);
  ok(!(await emit(admin, 'admin:game', { id: 'verse' })).ok && st().game === 'puzzle', '진행 중 게임 변경 거부');
  const vb = await emit(players[0].s, 'verse:place', { blockId: 0, slot: 0 });
  const vs = await emit(players[0].s, 'verse:submit');
  ok(!vb.ok && !vs.ok, '다른 게임 이벤트 거부 (퍼즐 중 verse:*)');
  await solvePuzzle(st, players);
  await wait(150);
  ok(st().status === 'done', '1판 퍼즐 완성');

  // 다음 게임 준비 → 말씀 블록
  admin.emit('admin:reset'); await wait(100);
  ok(st().status === 'lobby' && st().groups.every(g => !g.pieces && !g.blocks)
    && st().groups[0].name === '사자팀' && st().rounds.puzzle.imageId === up.id,
    '다음 게임 준비: 게임 데이터 정리, 공통 데이터 유지');
  admin.emit('admin:game', { id: 'verse' });
  admin.emit('verse:round', { verseId: v.id, mode: 'instant' }); await wait(100);
  ok((await emit(admin, 'admin:start')).ok, '말씀 블록 시작 (재입장 없음)');
  await wait(150);
  const pm = await emit(players[1].s, 'puzzle:move', { pieceId: 0, x: 0, y: 0 });
  const pr = await emit(players[1].s, 'puzzle:rotate', { pieceId: 0 });
  ok(!pm.ok && !pr.ok, '다른 게임 이벤트 거부 (말씀 중 puzzle:*)');

  // 말씀 진행 중 재입장 → 말씀 상태와 자기 그룹 블록을 받음
  players[2].s.disconnect(); await wait(100);
  const s2 = connect(), t2 = track(s2);
  const back = await emit(s2, 'p:join', { code, name: '친구2', pin: '1234' });
  await wait(150);
  ok(back.rejoined && t2.st.game === 'verse' && t2.st.groups[0].blocks.length === TEXT.split(' ').length && t2.st.groups[1].blocks.length === 0,
    '재입장하면 진행 중인 게임 상태 받음');
  players[2] = { s: s2, t: t2, pid: back.pid, name: '친구2' };

  await solveVerse(st, players);
  await wait(150);
  ok(st().status === 'done', '2판 말씀 블록 완성');

  // 다시 퍼즐
  admin.emit('admin:reset'); await wait(100);
  admin.emit('admin:game', { id: 'puzzle' }); await wait(60);
  ok((await emit(admin, 'admin:start')).ok, '다시 퍼즐 시작');
  await wait(150);
  await solvePuzzle(st, players);
  await wait(150);
  ok(st().status === 'done' && players.map(p => p.pid).join() === pids,
    '한 번 입장으로 퍼즐 → 말씀 블록 → 퍼즐 진행 (재입장 없음)');
  ok(st().groups[0].name === '사자팀' && st().players.filter(p => p.group === 0).length === 2, '그룹과 그룹 이름이 게임을 바꿔도 유지');

  // 관리자 새로고침 후 이어서 관리
  admin.disconnect();
  const a2 = connect();
  ok((await emit(a2, 'admin:resume', { code, adminKey })).ok, '관리자 새로고침 후 이어서 관리');

  console.log(`\n통합 세션 테스트 통과 (${count()}개)`);
  process.exit(0);
})().catch(e => { console.error('✘ 실패:', e.message); process.exit(1); });
