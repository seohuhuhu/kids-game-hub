// 말씀 블록 시나리오 테스트 (통합 세션 /play, 서버 실행 중일 때: node test/verse-sim.js)
const { io } = require('socket.io-client');
const assert = require('assert');
const URL = (process.env.BASE || 'http://localhost:3000') + '/play';
const PW = process.env.ADMIN_PASSWORD || 'admin';
const emit = (s, ev, d) => new Promise(r => s.emit(ev, d, r));
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✔', msg); };

// 소켓 하나와 그 소켓이 보는 방 상태 (state + block 변경분 반영)
function client() {
  const s = io(URL, { forceNew: true, transports: ['websocket'] });
  const c = { s, st: null, events: [] };
  s.on('state', st => { c.st = st; });
  s.on('verse:block', d => {
    const g = c.st && c.st.groups[d.g];
    const b = g && g.blocks.find(x => x.id === d.b.id);
    if (b) Object.assign(b, d.b);
  });
  ['verse:submitted', 'verse:done', 'verse:locked', 'verse:list', 'presence'].forEach(ev => s.on(ev, d => c.events.push({ ev: ev.replace('verse:', ''), d })));
  return c;
}

(async () => {
  const A = client();
  ok(!(await emit(A.s, 'admin:create')).ok, '관리자 로그인 전 방 만들기 거부');
  ok((await emit(A.s, 'admin:login', { password: PW })).ok, '관리자 로그인');
  const { code, adminKey } = await emit(A.s, 'admin:create');
  A.s.emit('admin:game', { id: 'verse' });
  ok(/^\d{4}$/.test(code), `방 만들기 (코드 ${code})`);

  const v0 = await emit(A.s, 'verse:add', { text: '말 한마디가 / 누군가의 인생을 / 바꿀 수 있어요', ref: '열왕기하 5:3' });
  await wait(80);
  const lastVerses = () => A.events.filter(e => e.ev === 'list').pop().d;
  ok(v0.ok && lastVerses().items.find(v => v.id === v0.id).blocks.length === 3, '구절 추가: / 기준 블록 3개');
  const empty = await emit(A.s, 'verse:add', { text: '   ', ref: '' });
  const tooMany = await emit(A.s, 'verse:add', { text: Array.from({ length: 31 }, (_, i) => 'w' + i).join(' '), ref: '' });
  ok(!empty.ok && !tooMany.ok, '블록 0개·31개 구절 거부');

  const TEXT = '나 는 나 를 사랑 해';
  const v1 = await emit(A.s, 'verse:add', { text: TEXT, ref: '테스트 1:1' });
  A.s.emit('admin:settings', { groups: 3 });
  A.s.emit('verse:round', { verseId: v1.id, mode: 'instant' });
  await wait(80);
  ok(A.st.round.mode === 'instant' && A.st.round.verse.text === TEXT, '라운드 구절·A 방식 선택 (관리자는 본문을 봄)');

  // 플레이어: 0그룹 4명, 1그룹 7명(블록 6개보다 많음), 2그룹 0명
  const P = [];
  for (let i = 0; i < 11; i++) {
    const c = client();
    if (i === 0) ok((await emit(c.s, 'p:check', { code })).ok, '입장 코드 확인');
    const r = await emit(c.s, 'p:join', { code, name: '친구' + i, pin: '12' + String(i).padStart(2, '0') });
    c.pid = r.pid; c.name = '친구' + i; c.pin = '12' + String(i).padStart(2, '0');
    await emit(c.s, 'p:group', { group: i < 4 ? 0 : 1 });
    P.push(c);
  }
  ok((await emit(A.s, 'admin:start')).ok, '게임 시작');
  await wait(150);

  const p0 = P[0];
  ok(p0.st.round.verse === undefined && !JSON.stringify(p0.st).includes(TEXT) && !JSON.stringify(p0.st).includes('테스트 1:1'),
    '플레이어 상태에 구절 본문 없음');
  ok(p0.st.round.slots === 6, '플레이어는 칸 수만 받음 (6칸)');
  ok(p0.st.groups[1].blocks.length === 0 && p0.st.groups[0].blocks.length === 6, '플레이어는 자기 그룹 블록만 받음');

  A.s.emit('verse:hint', { ref: true }); await wait(80);
  ok(p0.st.round.ref === '테스트 1:1', '참조 힌트 켜면 플레이어에게 ref 표시');
  A.s.emit('verse:hint', { words: true }); await wait(80);
  assert.deepStrictEqual(p0.st.round.words, TEXT.split(' ')); ok(p0.st.round.first === undefined, '전체 글자 힌트 켜면 words = 정답 단어 배열');
  A.s.emit('verse:hint', { ref: false, words: false }); await wait(80);
  ok(p0.st.round.words === undefined && p0.st.round.ref === undefined, '힌트 끄면 words 없음');

  const count = (st, g) => st.players.filter(p => p.group === g).map(p => p.assigned);
  const c0 = count(A.st, 0);
  ok(Math.max(...c0) - Math.min(...c0) <= 1 && c0.reduce((a, b) => a + b) === 6, `블록 분배: 그룹 안 차이 1 이하 (${c0})`);
  ok(count(A.st, 1).includes(0) && A.st.groups[1].active && !A.st.groups[2].active, '블록 없는 멤버 / 빈 그룹 비활성');

  // A 방식
  const answer = TEXT.split(' ');
  const g0 = () => A.st.groups[0].blocks;
  const sockOf = pid => P.find(p => p.pid === pid);
  const mine0 = g0().find(b => b.owner === p0.pid);
  const other0 = g0().find(b => b.owner !== p0.pid);
  ok(!(await emit(p0.s, 'verse:place', { blockId: other0.id, slot: 0 })).ok, '남의 블록 넣기 거부');

  // 틀린 칸에 넣기 → 고정 안 됨
  const wrongSlot = answer.findIndex(w => w !== mine0.text);
  const r1 = await emit(p0.s, 'verse:place', { blockId: mine0.id, slot: wrongSlot });
  await wait(60);
  ok(r1.ok && !r1.locked && g0().find(b => b.id === mine0.id).slot === wrongSlot, 'A 방식 틀린 칸은 고정 안 됨');
  const ownerOfOther = sockOf(other0.owner);
  ok(!(await emit(ownerOfOther.s, 'verse:place', { blockId: other0.id, slot: wrongSlot })).ok, '찬 칸에 넣기 거부');
  ok((await emit(p0.s, 'verse:unplace', { blockId: mine0.id })).ok, '고정 안 된 내 블록 빼기');

  // 같은 글자 블록: '나' 블록 두 개를 서로 바뀐 자리(0과 2)에 넣어도 고정
  const na = g0().filter(b => b.text === '나');
  const rNa1 = await emit(sockOf(na[0].owner).s, 'verse:place', { blockId: na[0].id, slot: 2 });
  const rNa2 = await emit(sockOf(na[1].owner).s, 'verse:place', { blockId: na[1].id, slot: 0 });
  ok(rNa1.locked && rNa2.locked, 'A 방식 같은 글자 블록 고정');
  ok(!(await emit(sockOf(na[0].owner).s, 'verse:unplace', { blockId: na[0].id })).ok, '고정 블록 빼기 거부');

  // 나머지 블록 맞는 칸에 넣기 → 완성
  for (const b of g0().filter(x => !x.locked)) {
    const slot = answer.findIndex((w, i) => w === b.text && !g0().some(x => x.slot === i));
    const r = await emit(sockOf(b.owner).s, 'verse:place', { blockId: b.id, slot });
    assert.ok(r.ok && r.locked, 'place ' + JSON.stringify(r));
    await wait(30);
  }
  await wait(120);
  ok(A.st.groups[0].finishedAt && A.st.groups[0].rank === 1 && A.events.some(e => e.ev === 'done' && e.d.group === 0), 'A 방식 모두 고정 → 완성·순위');
  ok(A.events.filter(e => e.ev === 'locked').length >= 6, '관리자에게 고정 알림');
  ok(p0.st.round.ref === '테스트 1:1' && P[5].st.round.ref === undefined, '완성한 그룹에게만 참조 공개 (축하 화면용)');

  // 1그룹: 재입장, 내보내기
  const g1 = () => A.st.groups[1].blocks;
  const holder = P.find(p => p.st.groups[1] && p.st.players.find(x => x.pid === p.pid).assigned > 0 && p !== p0 && P.indexOf(p) >= 4);
  const before = A.st.players.find(x => x.pid === holder.pid).assigned;
  holder.s.disconnect(); await wait(100);
  const back = client();
  const rb = await emit(back.s, 'p:join', { code, name: holder.name, pin: holder.pin });
  await wait(100);
  ok(rb.ok && rb.rejoined && A.st.players.find(x => x.pid === holder.pid).assigned === before, '재입장하면 블록 그대로');
  back.pid = holder.pid; P[P.indexOf(holder)] = back;

  const kb = g1().find(b => b.owner === back.pid);
  const kslot = answer.findIndex(w => w !== kb.text);
  await emit(back.s, 'verse:place', { blockId: kb.id, slot: kslot }); // 틀린 칸에 넣어 둠
  A.s.emit('admin:kick', { pid: back.pid }); await wait(120);
  const moved = g1().find(b => b.id === kb.id);
  ok(moved.owner !== back.pid && moved.slot === kslot && A.st.players.some(p => p.pid === moved.owner && p.group === 1), '내보내기: 칸에 있는 블록 주인도 넘김');
  ok(g1().every(b => b.owner !== back.pid), '내보낸 사람 블록이 모두 그룹 멤버에게 넘어감');

  // 다음 라운드: B 방식
  A.s.emit('admin:reset'); await wait(100);
  ok(A.st.status === 'lobby' && lastVerses().items.length === 2 && A.st.players.filter(p => p.group === 0).length === 4, '다음 라운드: 그룹·구절 목록 유지');
  A.s.emit('verse:round', { verseId: v0.id, mode: 'submit' }); await wait(60);
  ok((await emit(A.s, 'admin:start')).ok, 'B 방식 라운드 시작');
  await wait(120);
  const ans0 = ['말 한마디가', '누군가의 인생을', '바꿀 수 있어요'];
  const b0 = () => A.st.groups[0].blocks;
  ok(!(await emit(p0.s, 'verse:submit')).ok, 'B 방식 빈칸 있으면 제출 거부');
  // 일부러 거꾸로 채우기 → 2개 틀림
  for (const b of b0()) await emit(sockOf(b.owner).s, 'verse:place', { blockId: b.id, slot: 2 - ans0.indexOf(b.text) });
  await wait(80);
  ok(b0().every(b => b.slot != null && !b.locked), 'B 방식은 맞아도 바로 고정하지 않음');
  const sub1 = await emit(p0.s, 'verse:submit');
  await wait(80);
  ok(sub1.ok && !sub1.correct && sub1.wrong === 2 && sub1.cooldownMs === 5000 && p0.events.some(e => e.ev === 'submitted' && e.d.wrong === 2),
    'B 방식 틀리면 틀린 개수 + 5초 쿨다운');
  // 고치기: 빼고 다시 넣기
  for (const b of b0()) await emit(sockOf(b.owner).s, 'verse:unplace', { blockId: b.id });
  for (const b of b0()) await emit(sockOf(b.owner).s, 'verse:place', { blockId: b.id, slot: ans0.indexOf(b.text) });
  ok(!(await emit(p0.s, 'verse:submit')).ok, '쿨다운 중 제출 거부');
  await wait(5100);
  const sub2 = await emit(p0.s, 'verse:submit');
  await wait(100);
  ok(sub2.ok && sub2.correct && A.st.groups[0].finishedAt && b0().every(b => b.locked), 'B 방식 모두 맞으면 완성');

  // 잘못된 메시지(null)를 보내도 서버가 죽지 않음 (퍼즐까지 함께 꺼지는 것 방지)
  const bad = client();
  for (const ev of ['verse:place', 'p:join', 'p:check', 'p:group', 'verse:unplace', 'admin:login', 'admin:settings', 'verse:hint', 'verse:add']) bad.s.emit(ev, null);
  await wait(300);
  const alive = client();
  ok((await emit(alive.s, 'p:check', { code })).ok, '잘못된 메시지(null)에도 서버 유지');
  const pz = io(URL, { forceNew: true, transports: ['websocket'] });
  pz.emit('puzzle:move', null); pz.emit('puzzle:settings', null); pz.emit('admin:game', null);
  await wait(300);
  const pz2 = io(URL, { forceNew: true, transports: ['websocket'] });
  ok((await Promise.race([emit(pz2, 'p:check', { code: '0000' }), wait(2000).then(() => null)])) !== null, '퍼즐 이벤트에 잘못된 메시지가 와도 서버 유지');

  // 그룹의 마지막 멤버를 내보내면 그 그룹은 빠지고 라운드가 끝날 수 있음
  A.s.emit('admin:reset'); await wait(100);
  A.s.emit('verse:round', { verseId: v1.id, mode: 'instant' }); await wait(60);
  await emit(A.s, 'admin:start'); await wait(150);
  const solo = A.st.groups.findIndex((g, i) => g.active && A.st.players.filter(p => p.group === i).length === 4 ? false : g.active);
  // 1그룹 멤버 전원 내보내기
  for (const p of A.st.players.filter(x => x.group === 1)) A.s.emit('admin:kick', { pid: p.pid });
  await wait(150);
  ok(!A.st.groups[1].active, '마지막 멤버를 내보낸 그룹은 비활성');
  for (const b of A.st.groups[0].blocks.filter(x => !x.locked)) {
    const slot = answer.findIndex((w, i) => w === b.text && !A.st.groups[0].blocks.some(x => x.slot === i));
    await emit(sockOf(b.owner).s, 'verse:place', { blockId: b.id, slot });
    await wait(30);
  }
  await wait(150);
  ok(A.st.status === 'done', '남은 그룹이 모두 끝나면 라운드 종료');

  // 관리자 새로고침
  A.s.disconnect();
  const A2 = client();
  ok((await emit(A2.s, 'admin:resume', { code, adminKey })).ok, '관리자 새로고침 후 이어서 관리');

  console.log(`\n말씀 블록 테스트 통과 (${passed}개)`);
  process.exit(0);
})().catch(e => { console.error('✘ 실패:', e.message); process.exit(1); });
