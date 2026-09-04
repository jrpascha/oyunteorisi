import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COOPERATE,
  DEFECT,
  DEFAULT_PRESET,
  PAYOFF,
  ROUND_PRESETS,
  historyWindowSize,
  isValidPreset,
  randomTotalRounds,
  scoreRound,
  visibleHistory,
} from '../server/gameLogic.js';

test('puan matrisi dört kombinasyonu da doğru veriyor', () => {
  assert.equal(scoreRound(COOPERATE, COOPERATE), 3);
  assert.equal(scoreRound(COOPERATE, DEFECT), 0);
  assert.equal(scoreRound(DEFECT, COOPERATE), 5);
  assert.equal(scoreRound(DEFECT, DEFECT), 1);
});

test('matris gerçek bir mahkûm ikilemi kuruyor', () => {
  const { T, R, P, S } = PAYOFF;
  assert.ok(T > R && R > P && P > S, 'T > R > P > S olmalı');
  assert.ok(2 * R > T + S, 'karşılıklı işbirliği, sırayla sömürmekten iyi olmalı');
});

test('her ön ayarın toplam tur sayısı kendi aralığında kalır', () => {
  for (const [preset, { min, max }] of Object.entries(ROUND_PRESETS)) {
    const seen = new Set();
    for (let i = 0; i < 1500; i++) {
      const n = randomTotalRounds(preset);
      assert.ok(Number.isInteger(n));
      assert.ok(n >= min && n <= max, `${preset}: aralık dışı: ${n}`);
      seen.add(n);
    }
    // 1500 çekilişte aralıktaki her değer görülmeli; uçlar da dahil olmalı.
    assert.equal(seen.size, max - min + 1, `${preset}: bazı değerler hiç çıkmadı`);
    assert.ok(seen.has(min) && seen.has(max), `${preset}: uçlar görülmedi`);
  }
});

test('istenen üç ön ayar doğru aralıklarla tanımlı', () => {
  assert.deepEqual(ROUND_PRESETS.short, { min: 10, max: 20 });
  assert.deepEqual(ROUND_PRESETS.medium, { min: 40, max: 50 });
  assert.deepEqual(ROUND_PRESETS.long, { min: 80, max: 90 });
});

test('geçersiz veya eksik ön ayar varsayılana düşer', () => {
  assert.equal(isValidPreset('short'), true);
  assert.equal(isValidPreset('epic'), false);
  assert.equal(isValidPreset(undefined), false);

  const { min, max } = ROUND_PRESETS[DEFAULT_PRESET];
  const n = randomTotalRounds('epic');
  assert.ok(n >= min && n <= max, 'tanımsız ön ayar varsayılan aralığa düşmeli');
});

test('geçmiş penceresi sınır turlarında doğru genişliyor', () => {
  assert.equal(historyWindowSize(0), 5);
  assert.equal(historyWindowSize(1), 5);
  assert.equal(historyWindowSize(30), 5);
  assert.equal(historyWindowSize(31), 7);
  assert.equal(historyWindowSize(60), 7);
  assert.equal(historyWindowSize(61), 9);
  assert.equal(historyWindowSize(100), 9);
});

test('görünür geçmiş pencereden fazlasını sızdırmıyor', () => {
  const history = Array.from({ length: 45 }, (_, i) => ({
    round: i + 1,
    moves: [COOPERATE, DEFECT],
    points: [0, 5],
  }));

  const view = visibleHistory(history, 0);
  assert.equal(view.length, 7, '45 tur oynanmışken 7 tur görünmeli');
  assert.equal(view[0].round, 39);
  assert.equal(view.at(-1).round, 45);
  assert.equal(view[0].you, COOPERATE);
  assert.equal(view[0].opponent, DEFECT);
  assert.equal(view[0].yourPoints, 0);

  // Rakibin bakışı simetrik olmalı
  const oppView = visibleHistory(history, 1);
  assert.equal(oppView[0].you, DEFECT);
  assert.equal(oppView[0].opponent, COOPERATE);
  assert.equal(oppView[0].yourPoints, 5);

  // Görünür kayıtlarda rakibin puanı veya tam geçmiş yer almamalı
  assert.deepEqual(Object.keys(view[0]).sort(), ['opponent', 'round', 'you', 'yourPoints']);
});
