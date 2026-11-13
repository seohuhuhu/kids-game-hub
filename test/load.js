// 부하 테스트: 플레이어 N명이 그룹별로 동시에 퍼즐을 푸는 상황을 흉내 냄
// 사용법: node test/load.js [플레이어 수=50] [그룹 수=8] [가로=5] [세로=7] [모양=mixed]
const { io } = require('socket.io-client');
const fs = require('fs');
const URL = (process.env.BASE || 'http://localhost:3000') + '/play';
const [N = 50, G = 8, COLS = 5, ROWS = 7] = process.argv.slice(2, 6).map(Number);
const SHAPE = process.argv[6] || 'mixed';
const IMG = process.env.IMG ? 'data:image/jpeg;base64,' + fs.readFileSync(process.env.IMG).toString('base64') : 'data:image/jpeg;base64,AAAA';
const emit = (s, ev, d) => new Promise(r => s.emit(ev, d, r));
const wait = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

(async () => {
  const admin = io(URL, { forceNew: true, transports: ['websocket'] });
  await emit(admin, 'admin:login', { password: process.env.ADMIN_PASSWORD || 'admin' });
  const { code } = await emit(admin, 'admin:create');
  admin.emit('admin:game', { id: 'puzzle' });
  admin.emit('admin:settings', { groups: G });
  admin.emit('puzzle:settings', { cols: COLS, rows: ROWS, shape: SHAPE });
  await emit(admin, 'puzzle:image', { dataUrl: IMG, thumb: IMG, save: true });

  let bytesIn = 0, events = 0, disconnects = 0;
  const lat = [];
  const players = [];
  for (let i = 0; i < N; i++) {
    const s = io(URL, { forceNew: true, transports: ['websocket'] });
    s.onAny((ev, data) => { events++; bytesIn += typeof data === 'string' ? data.length : JSON.stringify(data ?? '').length; });
    s.on('disconnect', () => disconnects++);
    const view = { pid: null, state: null };
    s.on('state', st => { view.state = st; });
    s.on('puzzle:piece', d => {   // 변경분(최적화 버전)
      const g = view.state && view.state.groups[d.g];
      if (!g) return;
      const k = g.pieces.findIndex(p => p.id === d.p.id);
      if (k >= 0) g.pieces[k] = { ...g.pieces[k], ...d.p };
    });
    const r = await emit(s, 'p:join', { code, name: 'P' + i, pin: '1234' });
    view.pid = r.pid;
    await emit(s, 'p:group', { group: i % G });
    players.push({ s, view });
  }
  let adminState; admin.on('state', st => { adminState = st; });
  admin.on('puzzle:piece', d => { const g = adminState && adminState.groups[d.g]; const p = g && g.pieces.find(x => x.id === d.p.id); if (p) Object.assign(p, d.p); });
  const bytesBeforeStart = bytesIn;
  await emit(admin, 'admin:start');
  await wait(500);
  const t0 = Date.now();
  let running = true, actions = 0;

  async function play({ s, view }) {
    while (running) {
      await wait(800 + Math.random() * 1700); // 아이 한 명이 0.8~2.5초마다 한 번 조작
      const st = view.state; if (!st || st.status !== 'playing') continue;
      const me = st.players.find(p => p.pid === view.pid);
      const g = st.groups[me.group];
      const mine = g.pieces.filter(p => p.owner === view.pid && !p.placed);
      if (!mine.length) continue;
      const p = mine[Math.floor(Math.random() * mine.length)];
      const roll = Math.random();
      const t = Date.now();
      let res;
      if (roll < 0.35) res = await emit(s, 'puzzle:rotate', { pieceId: p.id });
      else if (roll < 0.65) res = await emit(s, 'puzzle:move', { pieceId: p.id, x: Math.random() * 0.9, y: Math.random() * 0.9 });
      else {
        if (p.rot !== 0) res = await emit(s, 'puzzle:rotate', { pieceId: p.id });
        else res = await emit(s, 'puzzle:move', { pieceId: p.id, x: p.col / COLS + 0.02, y: p.row / ROWS - 0.02 });
      }
      lat.push(Date.now() - t); actions++;
      if (res && typeof res.rot === 'number') { const q = g.pieces.find(x => x.id === p.id); if (q) q.rot = res.rot; }
    }
  }
  const loops = players.map(play);
  const DURATION = +(process.env.DURATION || 90000);
  while (Date.now() - t0 < DURATION) {
    await wait(1000);
    if (adminState && adminState.status === 'done') break;
  }
  if (process.env.STORM) {
    // 모든 플레이어 휴대폰이 동시에 끊겼다가 다시 들어오는 상황
    const t = Date.now();
    players.forEach(p => p.s.disconnect());
    await wait(300);
    const re = await Promise.all(players.map(async (p, i) => {
      const s2 = io(URL, { forceNew: true, transports: ['websocket'] });
      s2.onAny((ev, data) => { bytesIn += JSON.stringify(data ?? '').length; });
      const r = await emit(s2, 'p:join', { code, name: 'P' + i, pin: '1234', imageVer: 1 });
      return r.ok && r.rejoined;
    }));
    console.log(JSON.stringify({ storm: { rejoined: re.filter(Boolean).length, of: N, ms: Date.now() - t } }));
  }
  running = false;
  await Promise.race([Promise.all(loops), wait(4000)]);
  const secs = (Date.now() - t0) / 1000;
  const gameBytes = bytesIn - bytesBeforeStart;
  const done = adminState ? adminState.groups.filter(g => g.active && g.finishedAt).length : '?';
  console.log(JSON.stringify({
    players: N, groups: G, puzzle: `${COLS}x${ROWS} ${SHAPE}`, seconds: +secs.toFixed(1), actions,
    actionsPerSec: +(actions / secs).toFixed(1), groupsFinished: done,
    latencyMs: { p50: pct(lat, .5), p95: pct(lat, .95), p99: pct(lat, .99), max: Math.max(0, ...lat) },
    receivedPerPlayerKB: +(gameBytes / N / 1024).toFixed(0), receivedAllPlayersMB: +(gameBytes / 1048576).toFixed(1),
    disconnects,
  }));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
