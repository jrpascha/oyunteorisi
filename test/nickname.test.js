import test from 'node:test';
import assert from 'node:assert/strict';
import { nicknameKey, sanitizeNickname } from '../server/nickname.js';

test('sanitizeNickname boşlukları kırpar ve iç boşlukları tekilleştirir', () => {
  assert.equal(sanitizeNickname('  Ahmet   Yılmaz  '), 'Ahmet Yılmaz');
});

test('sanitizeNickname boş girdide "Oyuncu" varsayılanına düşer', () => {
  assert.equal(sanitizeNickname(''), 'Oyuncu');
  assert.equal(sanitizeNickname('   '), 'Oyuncu');
  assert.equal(sanitizeNickname(undefined), 'Oyuncu');
  assert.equal(sanitizeNickname(null), 'Oyuncu');
});

test('sanitizeNickname 20 karakterde keser', () => {
  const long = 'A'.repeat(30);
  assert.equal(sanitizeNickname(long).length, 20);
});

test('nicknameKey büyük/küçük harfi Türkçe kurallarına göre katlar', () => {
  assert.equal(nicknameKey('AHMET'), nicknameKey('ahmet'));
  assert.equal(nicknameKey('Ahmet'), nicknameKey('AHMET'));
});

test('nicknameKey Türkçe İ/I/ı/i çiftlerini doğru ayırt eder', () => {
  // İngilizce/ASCII katlamada "İstanbul" ve "Istanbul" aynı anahtara düşebilir;
  // Türkçe'de bunlar farklı harflerdir (İ→i, I→ı) ve anahtarları FARKLI olmalı.
  assert.notEqual(nicknameKey('İstanbul'), nicknameKey('Istanbul'));
  assert.equal(nicknameKey('İstanbul'), nicknameKey('istanbul'));
  assert.equal(nicknameKey('IŞIK'), nicknameKey('ışık'));
});

test('nicknameKey baştaki/sondaki boşluk ve iç boşluk farklarını eşitler', () => {
  assert.equal(nicknameKey('  Zeynep  '), nicknameKey('Zeynep'));
  assert.equal(nicknameKey('Ali  Veli'), nicknameKey('Ali Veli'));
});
