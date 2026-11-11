// 말씀 블록 - 블록 나누기와 정답 판정 규칙 (순수 함수)
const LIMITS = { maxBlocks: 30, maxVerses: 20 };

const shuffle = arr => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// 본문에 '/'가 있으면 '/' 기준, 없으면 띄어쓰기 기준으로 블록을 나눈다
function splitBlocks(text) {
  const s = String(text || '');
  const parts = s.includes('/') ? s.split('/') : s.split(/\s+/);
  return parts.map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// 블록을 섞고, id도 정답 순서와 무관하게 섞어서 붙인다 (id로 순서를 알 수 없게)
function makeBlocks(words) {
  const n = words.length;
  let ids = shuffle([...Array(n).keys()]);
  while (n >= 2 && ids.every((v, i) => v === i)) ids = shuffle(ids);
  return shuffle(words.map((text, i) => ({ id: ids[i], text })));
}

// 칸의 정답 글자와 같으면 정답 (같은 글자 블록은 서로 바꿔 넣어도 됨)
const slotIsCorrect = (answer, slot, text) => answer[slot] === text;

// 칸에 들어간 블록 중 정답과 다른 칸의 수
const countWrong = (answer, placed) => placed.filter(b => !slotIsCorrect(answer, b.slot, b.text)).length;

module.exports = { LIMITS, splitBlocks, makeBlocks, slotIsCorrect, countWrong };
