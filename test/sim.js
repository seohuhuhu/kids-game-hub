// 5명이 25조각(5x5 네모)과 50조각(세모)을 나눠 맞추는 시뮬레이션
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:3000/puzzle';
const emit = (s, ev, data) => new Promise(r => s.emit(ev, data, r));
const wait = ms => new Promise(r => setTimeout(r, ms));
async function run(shape) {
  const socks = Array.from({ length: 5 }, () => io(URL, { forceNew: true }));
  let state = {}; socks.forEach((s, i) => s.on('state', st => { state[i] = st; }));
  const { code } = await emit(socks[0], 'create', { name: '방장' });
  for (let i = 1; i < 5; i++) { const r = await emit(socks[i], 'join', { code, name: '친구' + i }); if (!r.ok) throw r; }
  socks[0].emit('settings', { grid: 5, shape });
  await emit(socks[0], 'setImage', 'data:image/png;base64,AAAA');
  await emit(socks[0], 'start');
  await wait(100);
  const st = state[0];
  console.log(shape, 'pieces', st.pieces.length, 'per player', st.players.map(p => p.assigned).join(','));
  // wrong placement
  const p0 = st.pieces.find(p => p.owner === socks[0].id);
  const wrong = await emit(socks[0], 'place', { pieceId: p0.id, x: ((p0.col + 2) % 5) / 5, y: p0.row / 5 });
  // someone else's piece
  const other = st.pieces.find(p => p.owner === socks[1].id);
  const steal = await emit(socks[0], 'place', { pieceId: other.id, x: other.col / 5, y: other.row / 5 });
  console.log(' wrong ->', JSON.stringify(wrong), ' steal ->', JSON.stringify(steal));
  // player 4 leaves mid game -> pieces redistributed
  socks[4].disconnect(); await wait(100);
  console.log(' after leave per player', state[0].pieces.length, state[0].players.map(p => p.assigned - 0).join(','));
  for (const p of state[0].pieces) {
    const i = socks.findIndex(s => s.id === p.owner);
    const r = await emit(socks[i], 'place', { pieceId: p.id, x: (p.col + 0.1) / 5, y: (p.row - 0.1) / 5 });
    if (!r.ok) throw new Error('place failed ' + p.id);
  }
  await wait(100);
  console.log(' status', state[0].status, 'placed by', state[0].players.map(p => p.name + ':' + p.placed).join(' '));
  socks.forEach(s => s.disconnect());
}
(async () => { await run('square'); await run('triangle'); await run('mixed'); process.exit(0); })().catch(e => { console.error(e); process.exit(1); });
