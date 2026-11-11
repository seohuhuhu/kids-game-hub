// 말씀 블록 판정 규칙 테스트: node test/verse-logic.js
const assert = require('assert');
const { splitBlocks, makeBlocks, slotIsCorrect, countWrong, LIMITS } = require('../games/verse/logic');
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ✔', name); };

t('띄어쓰기 기준으로 나누기 (연속 공백 무시)', () =>
  assert.deepStrictEqual(splitBlocks('말 한마디가  누군가의 인생을'), ['말', '한마디가', '누군가의', '인생을']));
t('/ 가 있으면 / 기준으로 나누기', () =>
  assert.deepStrictEqual(splitBlocks('말 한마디가 / 누군가의 인생을 / 바꿀 수 있어요'), ['말 한마디가', '누군가의 인생을', '바꿀 수 있어요']));
t('빈 블록은 빼기', () => assert.deepStrictEqual(splitBlocks(' / a // b / '), ['a', 'b']));
t('makeBlocks: 글자 집합 유지', () => {
  const words = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const bs = makeBlocks(words);
  assert.deepStrictEqual(bs.map(b => b.text).sort(), words.slice().sort());
  assert.deepStrictEqual(bs.map(b => b.id).sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7]);
});
t('블록 id가 정답 순서와 다름', () => {
  const words = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  for (let i = 0; i < 20; i++) {
    const bs = makeBlocks(words);
    const byId = bs.slice().sort((x, y) => x.id - y.id).map(b => b.text);
    assert.notDeepStrictEqual(byId, words);
  }
});
t('slotIsCorrect: 같은 글자는 어느 칸이든 정답', () => {
  assert.strictEqual(slotIsCorrect(['나', '는', '나'], 2, '나'), true);
  assert.strictEqual(slotIsCorrect(['나', '는', '나'], 1, '나'), false);
});
t('countWrong 같은 글자 교환', () => {
  assert.strictEqual(countWrong(['a', 'b', 'a'], [{ slot: 0, text: 'a' }, { slot: 1, text: 'b' }, { slot: 2, text: 'a' }]), 0);
  assert.strictEqual(countWrong(['a', 'b', 'c'], [{ slot: 0, text: 'b' }, { slot: 1, text: 'a' }, { slot: 2, text: 'c' }]), 2);
});
t('LIMITS 값', () => assert.deepStrictEqual(LIMITS, { maxBlocks: 30, maxVerses: 20 }));
console.log(`\n판정 규칙 테스트 통과 (${passed}개)`);
