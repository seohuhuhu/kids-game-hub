// 통합 세션 테스트 공통 도구
const { io } = require('socket.io-client');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:3000';
const URL = BASE + '/play';
const PW = process.env.ADMIN_PASSWORD || 'admin';

const connect = () => io(URL, { forceNew: true, transports: ['websocket'] });
const emit = (s, ev, d) => new Promise(r => s.emit(ev, d, r));
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✔', msg); };
const count = () => passed;

// 소켓이 보는 방 상태: 전체 상태 + 조각/블록 변경분 + 접속 표시 반영
function track(s) {
  const t = { st: null };
  s.on('state', st => { t.st = st; });
  const apply = key => d => {
    const g = t.st && t.st.groups[d.g];
    const list = g && g[key];
    const item = list && list.find(x => x.id === (d.p || d.b).id);
    if (item) Object.assign(item, d.p || d.b);
  };
  s.on('puzzle:piece', apply('pieces'));
  s.on('verse:block', apply('blocks'));
  s.on('presence', d => { const p = t.st && t.st.players.find(x => x.pid === d.pid); if (p) p.online = d.online; });
  return t;
}

// 관리자 로그인 → 방 만들기 → 게임 선택
async function adminRoom(game) {
  const admin = connect();
  const t = track(admin);
  await emit(admin, 'admin:login', { password: PW });
  const { code, adminKey } = await emit(admin, 'admin:create');
  if (game) admin.emit('admin:game', { id: game });
  await wait(80);
  return { admin, code, adminKey, st: () => t.st };
}

module.exports = { BASE, URL, PW, connect, emit, wait, ok, count, track, adminRoom };
