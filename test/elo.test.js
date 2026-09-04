import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RATING,
  K_FACTOR,
  expectedScore,
  outcomeFromScores,
  updateRatings,
} from '../server/elo.js';

test('beklenen skor simetriktir: iki tarafın toplamı 1 eder', () => {
  const pairs = [
    [1000, 1000],
    [1200, 1000],
    [800, 1400],
  ];
  for (const [a, b] of pairs) {
    const sum = expectedScore(a, b) + expectedScore(b, a);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${a} vs ${b}: toplam ${sum}`);
  }
});

test('eşit ratingde beklenen skor 0.5', () => {
  assert.equal(expectedScore(1000, 1000), 0.5);
});

test('eşit ratingde galibiyet/mağlubiyet simetrik ve sıfır toplamlı', () => {
  const { a, b } = updateRatings(1000, 1000, 1);
  assert.ok(a.delta > 0, 'kazanan artmalı');
  assert.ok(b.delta < 0, 'kaybeden azalmalı');
  assert.ok(Math.abs(a.delta + b.delta) < 1e-9, 'toplam değişim sıfır olmalı (sıfır toplamlı oyun)');
  assert.equal(a.delta, K_FACTOR * 0.5, 'eşit ratingde tam K/2 değişmeli');
  assert.equal(a.rating, 1000 + K_FACTOR * 0.5);
  assert.equal(b.rating, 1000 - K_FACTOR * 0.5);
});

test('berabere ve eşit rating → değişim yok', () => {
  const { a, b } = updateRatings(1000, 1000, 0.5);
  assert.equal(a.delta, 0);
  assert.equal(b.delta, 0);
});

test('güçlü rakibi yenmek zayıfı yenmekten daha çok puan getirir', () => {
  const beatStronger = updateRatings(1000, 1400, 1).a.delta;
  const beatWeaker = updateRatings(1000, 600, 1).a.delta;
  assert.ok(beatStronger > beatWeaker, 'güçlüyü yenmek daha değerli olmalı');
});

test('zayıf rakibe kaybetmek güçlüye kaybetmekten daha çok puan kaybettirir', () => {
  const lostToWeaker = updateRatings(1000, 600, 0).a.delta;
  const lostToStronger = updateRatings(1000, 1400, 0).a.delta;
  assert.ok(lostToWeaker < lostToStronger, 'zayıfa kaybetmek daha çok cezalandırılmalı');
});

test('outcomeFromScores üç durumu da doğru üretir', () => {
  assert.equal(outcomeFromScores(120, 100), 1);
  assert.equal(outcomeFromScores(100, 120), 0);
  assert.equal(outcomeFromScores(100, 100), 0.5);
});

test('DEFAULT_RATING sabiti makul bir başlangıç değeri', () => {
  assert.equal(DEFAULT_RATING, 1000);
});
