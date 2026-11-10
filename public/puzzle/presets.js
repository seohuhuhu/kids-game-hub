// 기본 제공 그림 (외부 파일 없이 캔버스로 그림). 새 그림은 PRESETS 배열에 추가하면 됩니다.
(function () {
  const S = 800;

  function canvas() {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return [c, c.getContext('2d')];
  }
  const circle = (g, x, y, r, color) => { g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  // 같은 그림이 매번 똑같이 나오도록 고정 난수
  function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

  function rainbowHill() {
    const [c, g] = canvas();
    const sky = g.createLinearGradient(0, 0, 0, S);
    sky.addColorStop(0, '#7EC8FF'); sky.addColorStop(1, '#D9F1FF');
    g.fillStyle = sky; g.fillRect(0, 0, S, S);
    ['#FF595E', '#FF924C', '#FFCA3A', '#8AC926', '#1982C4', '#6A4C93'].forEach((col, i) => {
      g.strokeStyle = col; g.lineWidth = 28; g.beginPath(); g.arc(400, 620, 380 - i * 28, Math.PI, 0); g.stroke();
    });
    g.strokeStyle = '#FFD93D'; g.lineWidth = 10;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath(); g.moveTo(130 + Math.cos(a) * 80, 130 + Math.sin(a) * 80); g.lineTo(130 + Math.cos(a) * 115, 130 + Math.sin(a) * 115); g.stroke();
    }
    circle(g, 130, 130, 65, '#FFD93D');
    circle(g, 108, 120, 8, '#5A3E00'); circle(g, 152, 120, 8, '#5A3E00');
    g.strokeStyle = '#5A3E00'; g.lineWidth = 6; g.beginPath(); g.arc(130, 140, 26, 0.2, Math.PI - 0.2); g.stroke();
    [[620, 120], [520, 220]].forEach(([x, y]) => { [0, 40, 80].forEach((dx, k) => circle(g, x + dx, y - (k === 1 ? 20 : 0), 38, '#fff')); });
    g.fillStyle = '#7BD389'; g.beginPath(); g.ellipse(180, 820, 520, 260, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4FB861'; g.beginPath(); g.ellipse(700, 860, 480, 280, 0, 0, Math.PI * 2); g.fill();
    // 집
    g.fillStyle = '#FFF1D6'; g.fillRect(470, 520, 170, 130);
    g.fillStyle = '#E63946'; g.beginPath(); g.moveTo(450, 525); g.lineTo(555, 430); g.lineTo(660, 525); g.fill();
    g.fillStyle = '#8D5A3B'; g.fillRect(535, 580, 45, 70);
    g.fillStyle = '#7EC8FF'; g.fillRect(488, 548, 36, 36); g.fillRect(594, 548, 36, 36);
    const r = rng(7);
    for (let i = 0; i < 26; i++) {
      const x = r() * S, y = 640 + r() * 150, col = ['#FF595E', '#FFCA3A', '#FF8FAB', '#fff', '#C77DFF'][i % 5];
      for (let k = 0; k < 5; k++) circle(g, x + Math.cos(k * 1.256) * 10, y + Math.sin(k * 1.256) * 10, 8, col);
      circle(g, x, y, 6, '#FFB703');
    }
    return c.toDataURL('image/jpeg', 0.9);
  }

  function ocean() {
    const [c, g] = canvas();
    const sea = g.createLinearGradient(0, 0, 0, S);
    sea.addColorStop(0, '#48CAE4'); sea.addColorStop(1, '#023E8A');
    g.fillStyle = sea; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(255,255,255,.12)';
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(80 + i * 170, 0); g.lineTo(140 + i * 170, 0); g.lineTo(40 + i * 170 + 100, S); g.lineTo(i * 170 - 40, S); g.fill(); }
    g.fillStyle = '#F4D58D'; g.beginPath(); g.moveTo(0, 690);
    for (let x = 0; x <= S; x += 40) g.quadraticCurveTo(x + 20, 670 + (x % 80 ? 10 : -10), x + 40, 690);
    g.lineTo(S, S); g.lineTo(0, S); g.fill();
    [[90, '#2D6A4F'], [190, '#40916C'], [680, '#2D6A4F'], [740, '#52B788']].forEach(([x, col]) => {
      g.strokeStyle = col; g.lineWidth = 18; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, 720);
      for (let y = 720; y > 470; y -= 50) g.quadraticCurveTo(x + (y % 100 ? 30 : -30), y - 25, x, y - 50);
      g.stroke();
    });
    const fish = (x, y, s, body, fin, flip) => {
      g.save(); g.translate(x, y); g.scale(flip ? -s : s, s);
      g.fillStyle = fin; g.beginPath(); g.moveTo(-50, 0); g.lineTo(-90, -30); g.lineTo(-90, 30); g.fill();
      g.fillStyle = body; g.beginPath(); g.ellipse(0, 0, 60, 38, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(-15, -36, 12, 72);
      circle(g, 30, -8, 10, '#fff'); circle(g, 33, -8, 5, '#111');
      g.restore();
    };
    fish(230, 220, 1.2, '#FF8C42', '#FF5E5B', false);
    fish(560, 330, 1, '#FFD93D', '#F9A620', true);
    fish(330, 500, 0.9, '#C77DFF', '#9D4EDD', false);
    fish(620, 130, 0.7, '#FF8FAB', '#FB6F92', true);
    // 불가사리
    g.fillStyle = '#FF595E'; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 22 : 55; g.lineTo(450 + Math.cos(a) * rr, 740 + Math.sin(a) * rr); }
    g.fill();
    circle(g, 300, 760, 30, '#F7A072'); circle(g, 300, 760, 18, '#FFD6A5');
    const r = rng(3);
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 3;
    for (let i = 0; i < 22; i++) { g.beginPath(); g.arc(r() * S, r() * 640, 5 + r() * 14, 0, Math.PI * 2); g.stroke(); }
    return c.toDataURL('image/jpeg', 0.9);
  }

  function space() {
    const [c, g] = canvas();
    const sky = g.createRadialGradient(400, 400, 50, 400, 400, 600);
    sky.addColorStop(0, '#3C096C'); sky.addColorStop(1, '#10002B');
    g.fillStyle = sky; g.fillRect(0, 0, S, S);
    const r = rng(11);
    for (let i = 0; i < 160; i++) circle(g, r() * S, r() * S, r() * 2.5 + .5, `rgba(255,255,255,${.4 + r() * .6})`);
    // 토성
    circle(g, 580, 230, 110, '#FFB703');
    g.fillStyle = '#FB8500'; g.fillRect(470, 205, 220, 22); g.fillRect(480, 255, 200, 16);
    g.strokeStyle = '#FFE8A3'; g.lineWidth = 14; g.beginPath(); g.ellipse(580, 230, 190, 45, -0.3, 0, Math.PI * 2); g.stroke();
    circle(g, 150, 640, 70, '#4CC9F0'); circle(g, 130, 620, 18, '#3A86FF'); circle(g, 175, 670, 12, '#3A86FF');
    circle(g, 690, 650, 40, '#F72585'); circle(g, 120, 160, 50, '#E9ECEF'); circle(g, 105, 145, 10, '#CED4DA'); circle(g, 140, 175, 8, '#CED4DA');
    // 로켓
    g.save(); g.translate(380, 470); g.rotate(-0.5);
    g.fillStyle = '#FF9E00'; g.beginPath(); g.moveTo(-28, 120); g.lineTo(0, 210); g.lineTo(28, 120); g.fill();
    g.fillStyle = '#FFD60A'; g.beginPath(); g.moveTo(-14, 120); g.lineTo(0, 170); g.lineTo(14, 120); g.fill();
    g.fillStyle = '#E63946'; g.beginPath(); g.moveTo(-48, 70); g.lineTo(-80, 130); g.lineTo(-40, 120); g.fill();
    g.beginPath(); g.moveTo(48, 70); g.lineTo(80, 130); g.lineTo(40, 120); g.fill();
    g.fillStyle = '#F8F9FA'; g.beginPath(); g.moveTo(0, -130); g.quadraticCurveTo(60, -60, 48, 125); g.lineTo(-48, 125); g.quadraticCurveTo(-60, -60, 0, -130); g.fill();
    g.fillStyle = '#E63946'; g.beginPath(); g.moveTo(0, -130); g.quadraticCurveTo(30, -95, 38, -70); g.lineTo(-38, -70); g.quadraticCurveTo(-30, -95, 0, -130); g.fill();
    circle(g, 0, -10, 26, '#457B9D'); circle(g, 0, -10, 17, '#A8DADC');
    g.restore();
    g.fillStyle = '#FFD60A';
    [[300, 120], [720, 470], [260, 330]].forEach(([x, y]) => {
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 9 : 22; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.fill();
    });
    return c.toDataURL('image/jpeg', 0.9);
  }

  const cache = {};
  window.PRESETS = [
    { id: 'rainbow', name: '무지개 언덕', draw: rainbowHill },
    { id: 'ocean', name: '바닷속 친구들', draw: ocean },
    { id: 'space', name: '우주 여행', draw: space },
  ].map(p => ({ ...p, get url() { return cache[p.id] || (cache[p.id] = p.draw()); } }));
})();
