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
  const applyDelta = d => { const p = st && st.groups[d.g] && st.groups[d.g].pieces.find(x => x.id === d.p.id); if (p) Object.assign(p, d.p); };
  admin.on('piece', applyDelta);
  const applyPresence = d => { const p = st && st.players.find(x => x.pid === d.pid); if (p) p.online = d.online; };
  admin.on('presence', applyPresence);
  const dings = []; admin.on('placed', e => dings.push(e));

  ok(!(await emit(admin, 'admin:create')).ok, '로그인 전에는 방을 만들 수 없음');
  ok(!(await emit(admin, 'admin:login', { password: 'wrong' })).ok, '틀린 관리자 비밀번호 거부');
  ok((await emit(admin, 'admin:login', { password: PW })).ok, '관리자 로그인');
  const { code, adminKey } = await emit(admin, 'admin:create');
  ok(/^\d{4}$/.test(code), `방 만들기 (코드 ${code})`);
  admin.emit('admin:settings', { groups: 3, rows: 3, cols: 4, shape: 'mixed', opacity: 0.3 });
  await wait(100);
  ok(st.settings.rows === 3 && st.settings.cols === 4 && st.groups.length === 3, '크기 4×3, 그룹 3개 설정');
  ok(st.settings.opacity === 0.3, '친구 조각 투명도 30% 설정');
  admin.emit('admin:rename', { group: 0, name: '  호랑이팀  ' }); await wait(80);
  ok(st.groups[0].name === '호랑이팀' && st.groups[1].name === '2그룹', '그룹 이름 바꾸기 (1그룹 → 호랑이팀)');

  // 올린 사진은 방에 임시 보관
  let lib; admin.on('library', l => { lib = l; });
  const imgA = 'data:image/jpeg;base64,AAAA', imgB = 'data:image/jpeg;base64,BBBB';
  const upA = await emit(admin, 'admin:image', { dataUrl: imgA, thumb: imgA, save: true });
  await emit(admin, 'admin:image', { dataUrl: imgB, thumb: imgB, save: true });
  await emit(admin, 'admin:image', { dataUrl: imgB, thumb: imgB, save: true }); // 같은 사진 다시 → 중복 저장 안 함
  await emit(admin, 'admin:image', { dataUrl: 'data:image/jpeg;base64,PRESET' }); // 기본 그림은 목록에 안 들어감
  await wait(80);
  ok(lib.items.length === 2, '올린 사진 2장이 목록에 보관됨 (중복·기본 그림 제외)');
  ok((await emit(admin, 'admin:useImage', { id: upA.id })).ok, '목록에서 예전 사진 다시 고르기');
  await wait(80);
  ok(st.imageId === upA.id && lib.current === upA.id, '고른 사진이 현재 퍼즐 사진이 됨');
  admin.emit('admin:deleteImage', { id: lib.items.find(x => x.id !== upA.id).id }); await wait(80);
  ok(lib.items.length === 1, '목록에서 사진 지우기');

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

  // 판 위 아무 곳에 올려 두기 → 같은 그룹 친구에게 보임
  const idx = names.indexOf('지민');
  const mine = st.groups[0].pieces.filter(p => p.owner === pids[idx]);
  const piece = mine.find(p => p.rot !== 0) || mine[0];
  const mv = await emit(ps[idx], 'p:move', { pieceId: piece.id, x: 0.5, y: 0.5 });
  await wait(80);
  const seen = st.groups[0].pieces.find(p => p.id === piece.id);
  ok(mv.ok && !mv.placed && seen.pos && seen.pos.x === 0.5, '아무 곳에 올려 둔 조각 위치가 그룹에 공유됨');
  const other = st.groups[0].pieces.find(p => p.owner !== pids[idx]);
  ok(!(await emit(ps[idx], 'p:move', { pieceId: other.id, x: 0.1, y: 0.1 })).ok, '남의 조각은 움직일 수 없음');
  // 정답 자리에 놓았지만 방향이 틀리면 판 위에 그대로 → 돌려서 맞추면 자동으로 고정
  if (piece.rot !== 0) {
    const r = await emit(ps[idx], 'p:move', { pieceId: piece.id, x: piece.col / 4, y: piece.row / 3 });
    ok(r.wrong === 'rot' && !r.placed, '자리는 맞고 방향이 틀리면 고정 안 됨');
    let res; do { res = await emit(ps[idx], 'p:rotate', { pieceId: piece.id }); } while (!res.placed && res.rot !== 0);
    ok(res.placed, '판 위에서 돌려 방향을 맞추면 바로 고정');
  }
  const back2 = await emit(ps[idx], 'p:move', { pieceId: mine.find(p => p.id !== piece.id).id, x: null, y: null });
  await wait(80);
  ok(back2.ok && !st.groups[0].pieces.find(p => p.id === mine.find(q => q.id !== piece.id).id).pos, '판 밖에 놓으면 쟁반으로 돌아감');
  admin.emit('admin:settings', { opacity: 0.7, rows: 8 }); await wait(80);
  ok(st.settings.opacity === 0.7 && st.settings.rows === 3, '게임 중 투명도만 바뀌고 크기는 그대로');

  // 서준이 나갔다가 같은 비밀번호로 돌아옴
  const sj = names.indexOf('서준');
  const before = st.players.find(p => p.name === '서준').assigned;
  ps[sj].disconnect(); await wait(100);
  ok(!st.players.find(p => p.name === '서준').online, '서준 연결 끊김 표시');
  ps[sj] = connect();
  const back = await emit(ps[sj], 'p:join', { code, name: '서준', pin: '1100' });
  ok(back.ok && back.rejoined && back.pid === pids[sj], '같은 이름+비밀번호로 다시 들어옴');
  await wait(80);
  ok(st.players.find(p => p.name === '서준').online, '다시 들어오면 관리자 화면에 접속 표시');
  await wait(100);
  ok(st.players.find(p => p.name === '서준').assigned === before, '돌아오면 내 조각 그대로');
  let seenOther = null; ps[sj].once('state', s => { seenOther = s; });
  admin.emit('admin:hint', { on: false }); await wait(100);
  ok(seenOther && seenOther.groups[1].pieces.length === 0 && seenOther.groups[0].pieces.length > 0, '플레이어는 자기 그룹 조각만 받음 (데이터 절약)');

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
      const r = await emit(s, 'p:move', { pieceId: p.id, x: (p.col + 0.2) / 4, y: (p.row - 0.15) / 3 });
      assert.ok(r.ok, 'place ' + JSON.stringify(r));
    }
    await wait(100);
  }
  ok(dings.length === g1.total + g2.total, `관리자에게 맞출 때마다 알림 (${dings.length}번)`);
  ok(st.groups[1].rank === 1 && st.groups[0].rank === 2, '순위: 2그룹 1등, 호랑이팀 2등');
  ok(st.status === 'done', '모든 그룹 완성 → 게임 끝');

  // 관리자 새로고침 후 복구, 다음 판
  admin.disconnect();
  const admin2 = connect(); admin2.on('state', s => { st = s; }); admin2.on('piece', applyDelta); admin2.on('presence', applyPresence);
  ok((await emit(admin2, 'admin:resume', { code, adminKey })).ok, '관리자 새로고침 후 방 이어서 관리');
  admin2.emit('admin:reset'); await wait(100);
  ok(st.status === 'lobby' && st.players.length === 6 && st.players.find(p => p.name === '서준').group === 0, '다음 판: 대기실로, 그룹 유지');
  ok(st.groups[0].name === '호랑이팀' && st.imageId === upA.id, '다음 판에도 그룹 이름·사진 유지');
  let lib2; admin2.on('library', l => { lib2 = l; });
  await emit(admin2, 'admin:resume', { code, adminKey }); await wait(80);
  ok(lib2 && lib2.items.length === 1, '관리자 새로고침 후에도 올린 사진 목록 유지');

  console.log(`\n모든 테스트 통과 (${passed}개)`);
  process.exit(0);
})().catch(e => { console.error('✘ 실패:', e.message); process.exit(1); });
