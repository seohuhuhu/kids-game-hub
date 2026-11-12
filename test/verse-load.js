// 말씀 블록 부하 테스트
// 사용법: node test/verse-load.js [플레이어=50] [그룹=8] [모드=instant|submit]
const { io } = require('socket.io-client');
const URL = (process.env.BASE || 'http://localhost:3000') + '/play';
const [N = 50, G = 8] = process.argv.slice(2, 4).map(Number);
const MODE = process.argv[4] || 'instant';
const TEXT = '말 한마디가 누군가의 인생을 바꿀 수 있어요 오늘 우리의 입술에 감사를 가득 담아'; // 12블록
const emit = (s, ev, d) => new Promise(r => s.emit(ev, d, r));
const wait = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;

(async () => {
  const admin = io(URL, { forceNew: true, transports: ['websocket'] });
  await emit(admin, 'admin:login', { password: process.env.ADMIN_PASSWORD || 'admin' });
  const { code } = await emit(admin, 'admin:create');
  admin.emit('admin:game', { id: 'verse' });
  admin.emit('admin:settings', { groups: G });
  const v = await emit(admin, 'verse:add', { text: TEXT, ref: '테스트' });
  admin.emit('verse:round', { verseId: v.id, mode: MODE });
  const answer = TEXT.split(' ');
  let adminState; admin.on('state', s => { adminState = s; });

  let bytesIn = 0, disconnects = 0;
  const lat = [], players = [];
  for (let i = 0; i < N; i++) {
    const s = io(URL, { forceNew: true, transports: ['websocket'] });
    const c = { s, st: null };
    s.onAny((ev, d) => { bytesIn += JSON.stringify(d ?? '').length; });
    s.on('disconnect', () => disconnects++);
    s.on('state', st => { c.st = st; });
    s.on('verse:block', d => { const b = c.st && c.st.groups[d.g].blocks.find(x => x.id === d.b.id); if (b) Object.assign(b, d.b); });
    c.pid = (await emit(s, 'p:join', { code, name: 'P' + i, pin: '1234' })).pid;
    await emit(s, 'p:group', { group: i % G });
    players.push(c);
  }
  const before = bytesIn;
  await emit(admin, 'admin:start');
  await wait(400);
  const t0 = Date.now();
  let running = true, actions = 0;

  async function play(c) {
    while (running) {
      await wait(800 + Math.random() * 1700); // 아이 한 명이 0.8~2.5초마다 한 번 조작
      const st = c.st; if (!st || st.status !== 'playing') continue;
      const me = st.players.find(p => p.pid === c.pid), g = st.groups[me.group];
      if (!g || g.finishedAt) continue;
      const empty = answer.map((_, i) => i).filter(i => !g.blocks.some(b => b.slot === i));
      const tray = g.blocks.filter(b => b.owner === c.pid && b.slot == null);
      const placed = g.blocks.filter(b => b.owner === c.pid && b.slot != null && !b.locked);
      const t = Date.now();
      if (MODE === 'submit' && !empty.length && Math.random() < 0.3) await emit(c.s, 'verse:submit');
      else if (placed.length && (Math.random() < 0.3 || !tray.length)) {
        const b = placed[0];
        if (answer[b.slot] !== b.text || Math.random() < 0.2) await emit(c.s, 'verse:unplace', { blockId: b.id });
        else continue;
      } else if (tray.length && empty.length) {
        const b = tray[0];
        const right = empty.find(i => answer[i] === b.text);
        const slot = right != null && Math.random() < 0.6 ? right : empty[Math.floor(Math.random() * empty.length)];
        await emit(c.s, 'verse:place', { blockId: b.id, slot });
      } else continue;
      lat.push(Date.now() - t); actions++;
    }
  }
  const loops = players.map(play);
  const DURATION = +(process.env.DURATION || 60000);
  while (Date.now() - t0 < DURATION) { await wait(500); if (adminState && adminState.status === 'done') break; }
  running = false;
  await Promise.race([Promise.all(loops), wait(4000)]);
  const secs = (Date.now() - t0) / 1000, bytes = bytesIn - before;
  console.log(JSON.stringify({
    players: N, groups: G, mode: MODE, seconds: +secs.toFixed(1), actions,
    groupsFinished: adminState ? adminState.groups.filter(g => g.finishedAt).length : '?',
    latencyMs: { p50: pct(lat, .5), p95: pct(lat, .95), p99: pct(lat, .99), max: Math.max(0, ...lat) },
    receivedAllPlayersMB: +(bytes / 1048576).toFixed(2), perMinuteMB: +(bytes / 1048576 / secs * 60).toFixed(2), disconnects,
  }));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
