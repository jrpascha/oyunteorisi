import test from 'node:test';
import assert from 'node:assert/strict';
import { COOPERATE as C, DEFECT as D, scoreRound } from '../server/gameLogic.js';
import { analyzeMatch, classify, playerMetrics } from '../server/analysis.js';

const N = 100;

function buildHistory(a, b) {
  assert.equal(a.length, b.length);
  return a.map((mine, i) => ({
    round: i + 1,
    moves: [mine, b[i]],
    points: [scoreRound(mine, b[i]), scoreRound(b[i], mine)],
  }));
}

/** İki hamle dizisinden 0. oyuncunun arketip kimliğini döndürür. */
function archetypeOf(own, opp) {
  return classify(playerMetrics(own, opp)).id;
}

const seq = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

test('hep işbirliği yapan → Sadık İşbirlikçi', () => {
  const opp = seq(N, (i) => (i % 5 === 4 ? D : C));
  assert.equal(archetypeOf(seq(N, () => C), opp), 'saint');
});

test('hep ret yapan → Şahin', () => {
  const opp = seq(N, (i) => (i % 5 === 4 ? D : C));
  assert.equal(archetypeOf(seq(N, () => D), opp), 'hawk');
});

test('saf Kısasa Kısas → Kısasa Kısas', () => {
  const opp = seq(N, (i) => (i % 7 === 6 ? D : C));
  const own = seq(N, (i) => (i === 0 ? C : opp[i - 1]));
  assert.equal(archetypeOf(own, opp), 'tft');
});

test('ilk ihanetten sonra hiç affetmeyen → Kindar', () => {
  // Rakip yalnızca 20. turda ret çekip sonra işbirliğine dönüyor; oyuncu bir daha dönmüyor.
  const opp = seq(N, (i) => (i === 19 ? D : C));
  const own = seq(N, (i) => (i <= 19 ? C : D));
  const metrics = playerMetrics(own, opp);

  assert.equal(archetypeOf(own, opp), 'grim');
  assert.equal(metrics.grudgeScore, 1, 'ihanet öncesi/sonrası fark tam olmalı');
  assert.equal(metrics.coopAfterFirstBetrayal, 0);
});

test('son turlarda ihanete kayan → Sırt Çevirici', () => {
  const opp = seq(N, () => C);
  const own = seq(N, (i) => (i < 90 ? C : D));
  const metrics = playerMetrics(own, opp);

  assert.equal(archetypeOf(own, opp), 'backstabber');
  assert.ok(metrics.endgameShift < -0.8, 'son 10 turdaki düşüş belirgin olmalı');
});

test('dönüşümlü oynayan → Dönek', () => {
  const opp = seq(N, () => C);
  const own = seq(N, (i) => (i % 2 === 0 ? C : D));
  assert.equal(archetypeOf(own, opp), 'alternator');
});

test('rakip işbirliğine döndükçe affeden karşılıkçı → Bağışlayıcı Karşılıkçı', () => {
  // Rakip ara ara ret çekiyor; oyuncu iki tur misilleme yapıp sonra işbirliğine dönüyor.
  const opp = seq(N, (i) => (i % 10 === 3 ? D : C));
  const own = seq(N, (i) => {
    if (i === 0) return C;
    return opp[i - 1] === D || (i >= 2 && opp[i - 2] === D) ? D : C;
  });
  const id = archetypeOf(own, opp);
  assert.ok(['generous', 'tft'].includes(id), `beklenmedik arketip: ${id}`);
});

test('metrikler temel davranışları doğru ölçüyor', () => {
  const opp = [C, D, C, D, C, C];
  const own = [C, C, D, C, D, C];
  const m = playerMetrics(own, opp);

  assert.equal(m.rounds, 6);
  assert.equal(m.firstMove, C);
  assert.equal(m.coopRate, 4 / 6);
  // Rakibin ret yaptığı turlar: 1 ve 3 (0-tabanlı). Sonraki turda kendi hamlem: D ve D.
  assert.equal(m.retaliationRate, 1);
  // Rakibin işbirliği yaptığı turlar (son tur hariç): 0, 2, 4. Sonraki hamlelerim: C, C, C.
  assert.equal(m.exploitationRate, 0);
  assert.equal(m.longestMutualCoop, 1);
});

test('analyzeMatch ilişki metriklerini ve kümülatif puanı doğru üretiyor', () => {
  const own = [C, C, D, D];
  const opp = [C, D, D, C];
  const history = buildHistory(own, opp);
  const players = [
    { nickname: 'A', score: history.reduce((s, h) => s + h.points[0], 0) },
    { nickname: 'B', score: history.reduce((s, h) => s + h.points[1], 0) },
  ];

  const result = analyzeMatch(history, players);
  const r = result.relationship;

  assert.equal(result.totalRounds, 4);
  assert.equal(r.mutualCoopRounds, 1);
  assert.equal(r.mutualDefectRounds, 1);
  assert.equal(r.exploitedBy[0], 1, 'A, 4. turda B’yi sömürdü');
  assert.equal(r.exploitedBy[1], 1, 'B, 2. turda A’yı sömürdü');
  assert.equal(r.firstDefectionRound, 2);
  assert.equal(r.firstDefector, 1);
  assert.equal(r.bestPossibleTogether, 24);
  assert.equal(r.totalScored, players[0].score + players[1].score);
  assert.equal(r.pointsBurned, 24 - r.totalScored);

  // Kümülatif seriler tur sayısı kadar ve son değerleri toplam puana eşit olmalı
  assert.equal(result.cumulative[0].length, 4);
  assert.equal(result.cumulative[0].at(-1), players[0].score);
  assert.equal(result.cumulative[1].at(-1), players[1].score);
});

test('her arketip kimliği bir isim ve açıklama taşıyor', () => {
  const opp = seq(N, (i) => (i % 3 === 0 ? D : C));
  const own = seq(N, (i) => (i % 4 === 0 ? D : C));
  const a = classify(playerMetrics(own, opp));

  assert.ok(a.name && a.description && a.tagline);
  assert.ok(a.confidence > 0 && a.confidence <= 1);
});
