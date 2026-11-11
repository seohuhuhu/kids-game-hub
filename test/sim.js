// CODE:Block 퍼즐 서버 시나리오 테스트 (서버 실행 중일 때: npm test)
const { io } = require('socket.io-client');
const assert = require('assert');
const URL = process.env.URL || 'http://localhost:3000/puzzle';
const PW = process.env.ADMIN_PASSWORD || 'admin';
const emit = (s, ev, d) => new Promise(r => s.emit(ev, d, r));
const wait = ms => new Promise(r => setTimeout(r, ms));
const connect = () => io(URL, { forceNew: true });
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✔', msg); };

(async () => {
  const admin = connect();
  let st; admin.on('state', s => { st = s; });
  const dings = []; admin.on('placed', e => dings.push(e));

  ok(!(await emit(admin, 'admin:create')).ok, '로그인 전에는 방을 만들 수 없음');
  ok(!(await emit(admin, 'admin:login', { password: 'wrong' })).ok, '틀린 관리자 비밀번호 거부');
  ok((await emit(admin, 'admin:login', { password: PW })).ok, '관리자 로그인');
  const { code, adminKey } = await emit(admin, 'admin:create');
  ok(/^\d{4}$/.test(code), `방 만들기 (코드 ${code})`);
  admin.emit('admin:settings', { groups: 3, rows: 3, cols: 4, shape: 'mixed' });
  await wait(100);
  ok(st.settings.rows === 3 && st.settings.cols === 4 && st.groups.length === 3, '크기 4×3, 그룹 3개 설정');

  // 플레이어 7명: 1그룹 3명, 2그룹 2명, 1명 미정, 1명은 관리자가 옮김
  const names = ['지민', '서준', '하윤', '도윤', '서연', '민준', '예린'];
  const ps = names.map(connect);
  ok(!(await emit(ps[0], 'p:check', { code: '0000' })).ok, '없는 입장 코드 거부');
  ok((await emit(ps[0], 'p:check', { code })).ok, '입장 코드 확인');
  ok(!(await emit(ps[0], 'p:join', { code, name: '지민', pin: '12a' })).ok, '비밀번호 4자리 숫자 검사');
  const pids = [];
  for (let i = 0; i < ps.length; i++) pids.push((await emit(ps[i], 'p:join', { code, name: names[i], pin: '1' + i + '00' })).pid);
  ok(!(await emit(connect(), 'p:join', { code, name: '지민', pin: '9999' })).ok, '같은 이름 + 다른 비밀번호 거부');
  const groupsOf = [0, 0, 0, 1, 1, null, 2];
  for (let i = 0; i < ps.length; i++) if (groupsOf[i] != null) ok((await emit(ps[i], 'p:group', { group: groupsOf[i] })).ok, `${names[i]} → ${groupsOf[i] + 1}그룹 선택`);
  ok(!(await emit(ps[0], 'p:group', { group: 1 })).ok, '결정한 그룹은 바꿀 수 없음');
  admin.emit('admin:move', { pid: pids[6], group: 1 }); // 예린을 2그룹으로
  await wait(100);
  ok(st.players.find(p => p.name === '예린').group === 1, '관리자가 예린을 2그룹으로 옮김');
  ok(!(await emit(admin, 'admin:start')).ok, '사진 없이 시작 불가');
  await emit(admin, 'admin:image', 'data:image/png;base64,AAAA');
  ok((await emit(admin, 'admin:start')).ok, '게임 시작');
  await wait(150);
  const [g1, g2, g3] = st.groups;
  ok(g1.active && g2.active && !g3.active, '사람 있는 그룹만 진행 (3그룹 비활성)');
  const counts = g => st.players.filter(p => p.group === g.index).map(p => p.assigned);
  ok(Math.max(...counts(g1)) - Math.min(...counts(g1)) <= 1, `1그룹 조각 분배 ${counts(g1)} / 총 ${g1.total}`);
  ok(Math.max(...counts(g2)) - Math.min(...counts(g2)) <= 1, `2그룹 조각 분배 ${counts(g2)} / 총 ${g2.total}`);
  ok(st.players.find(p => p.name === '민준').assigned === 0, '그룹 없는 민준은 조각 없음');
  ok(!(await emit(connect(), 'p:join', { code, name: '새친구', pin: '1111' })).ok, '시작 후 새 플레이어 입장 불가');

  admin.emit('admin:hint', { on: true }); await wait(80);
  ok(st.hint === true, '관리자 전체 힌트 켜기');
  admin.emit('admin:hint', { on: false }); await wait(80);

  // 회전이 안 맞으면 거부, 맞추면 정답
  const idx = names.indexOf('지민');
  const piece = st.groups[0].pieces.find(p => p.owner === pids[idx] && p.rot !== 0) || st.groups[0].pieces.find(p => p.owner === pids[idx]);
  if (piece.rot !== 0) {
    const r = await emit(ps[idx], 'p:place', { pieceId: piece.id, x: piece.col / 4, y: piece.row / 3 });
    ok(r.wrong === 'rot', '방향이 틀리면 거부 (rot)');
  }
  const wrongPos = await emit(ps[idx], 'p:place', { pieceId: piece.id, x: ((piece.col + 2) % 4) / 4, y: piece.row / 3 });
  ok(wrongPos.wrong === 'place', '자리가 틀리면 거부');
  const other = st.groups[0].pieces.find(p => p.owner !== pids[idx]);
  ok(!(await emit(ps[idx], 'p:place', { pieceId: other.id, x: other.col / 4, y: other.row / 3 })).ok, '남의 조각은 놓을 수 없음');

  // 서준이 나갔다가 같은 비밀번호로 돌아옴
  const sj = names.indexOf('서준');
  const before = st.players.find(p => p.name === '서준').assigned;
  ps[sj].disconnect(); await wait(100);
  ok(!st.players.find(p => p.name === '서준').online, '서준 연결 끊김 표시');
  ps[sj] = connect();
  const back = await emit(ps[sj], 'p:join', { code, name: '서준', pin: '1100' });
  ok(back.ok && back.rejoined && back.pid === pids[sj], '같은 이름+비밀번호로 다시 들어옴');
  await wait(100);
  ok(st.players.find(p => p.name === '서준').assigned === before, '돌아오면 내 조각 그대로');

  // 관리자가 하윤을 내보내면 조각이 그룹 안에서 다시 나눠짐
  const hy = names.indexOf('하윤');
  admin.emit('admin:kick', { pid: pids[hy] }); await wait(100);
  ok(st.groups[0].pieces.every(p => p.owner !== pids[hy]), '내보낸 하윤의 조각을 1그룹 친구들에게 재분배');

  // 모든 조각 돌리고 맞추기 (2그룹 먼저)
  const sockOf = pid => ps[pids.indexOf(pid)];
  for (const gi of [1, 0]) {
    for (const p of st.groups[gi].pieces.filter(p => !p.placed)) {
      const s = sockOf(p.owner);
      let rot = p.rot;
      while (rot !== 0) rot = (await emit(s, 'p:rotate', { pieceId: p.id })).rot;
      const r = await emit(s, 'p:place', { pieceId: p.id, x: (p.col + 0.2) / 4, y: (p.row - 0.15) / 3 });
      assert.ok(r.ok, 'place ' + JSON.stringify(r));
    }
    await wait(100);
  }
  ok(dings.length === g1.total + g2.total, `관리자에게 맞출 때마다 알림 (${dings.length}번)`);
  ok(st.groups[1].rank === 1 && st.groups[0].rank === 2, '순위: 2그룹 1등, 1그룹 2등');
  ok(st.status === 'done', '모든 그룹 완성 → 게임 끝');

  // 관리자 새로고침 후 복구, 다음 판
  admin.disconnect();
  const admin2 = connect(); admin2.on('state', s => { st = s; });
  ok((await emit(admin2, 'admin:resume', { code, adminKey })).ok, '관리자 새로고침 후 방 이어서 관리');
  admin2.emit('admin:reset'); await wait(100);
  ok(st.status === 'lobby' && st.players.length === 6 && st.players.find(p => p.name === '서준').group === 0, '다음 판: 대기실로, 그룹 유지');

  console.log(`\n모든 테스트 통과 (${passed}개)`);
  process.exit(0);
})().catch(e => { console.error('✘ 실패:', e.message); process.exit(1); });
