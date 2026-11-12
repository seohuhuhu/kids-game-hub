// 어린이 게임 허브 - 메인 서버
// 게임마다 Socket.IO 네임스페이스를 하나씩 쓰므로, 새 게임은 games/<이름>/server.js 를 만들고 아래에 등록만 하면 됩니다.
const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const registerSession = require('./games/session/server');
const puzzleGame = require('./games/puzzle/game');
const verseGame = require('./games/verse/game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 8e6 }); // 업로드 사진(최대 수 MB) 전송 허용

app.set('trust proxy', true);
app.use(express.static(path.join(__dirname, 'public')));

// 같은 와이파이의 휴대폰이 접속할 수 있는 이 PC의 IP (localhost로 열었을 때 QR에 사용)
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

// QR 코드: 찍으면 바로 해당 방 입장 화면으로 이동
app.get('/api/qr', async (req, res) => {
  const game = String(req.query.game || 'play').replace(/[^a-z0-9-]/gi, '');
  const code = String(req.query.code || '').replace(/\D/g, '').slice(0, 4);
  let base = process.env.PUBLIC_URL;
  if (!base) {
    let host = req.get('host');
    const [name, port] = host.split(':');
    if (['localhost', '127.0.0.1', '::1'].includes(name) && lanAddress()) host = lanAddress() + (port ? ':' + port : '');
    base = `${req.protocol}://${host}`;
  }
  const url = `${base.replace(/\/$/, '')}/${game}/?code=${code}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#2B2D42', light: '#FFFFFF' } });
  res.json({ url, svg });
});

// ---- 게임 등록 ----
// 통합 세션: 한 방에서 여러 게임을 차례로
registerSession(io.of('/play'), { puzzle: puzzleGame, verse: verseGame });

// 한 게임의 처리 오류로 서버 전체(다른 게임의 방까지)가 꺼지지 않도록 기록만 하고 계속 실행
process.on('uncaughtException', e => console.error('처리되지 않은 오류:', e));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 게임 허브 실행 중: http://localhost:${PORT}`);
});
