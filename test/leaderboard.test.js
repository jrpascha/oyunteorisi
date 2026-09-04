import test from 'node:test';
import assert from 'node:assert/strict';
import { Leaderboard } from '../server/leaderboard.js';
import { DEFAULT_RATING } from '../server/elo.js';

function newBoard() {
  return new Leaderboard(':memory:');
}

test('bilinmeyen oyuncu için getPlayer null döner', () => {
  const board = newBoard();
  assert.equal(board.getPlayer('yok'), null);
  board.close();
});

test('recordMatch iki oyuncuyu da DEFAULT_RATING ile oluşturur ve günceller', () => {
  const board = newBoard();
  const result = board.recordMatch({
    worldIdA: 'a1',
    nicknameA: 'Alice',
    scoreA: 150,
    worldIdB: 'b1',
    nicknameB: 'Bob',
    scoreB: 100,
  });

  assert.equal(result.a.oldRating, DEFAULT_RATING);
  assert.equal(result.b.oldRating, DEFAULT_RATING);
  assert.ok(result.a.newRating > DEFAULT_RATING, 'kazanan yükselmeli');
  assert.ok(result.b.newRating < DEFAULT_RATING, 'kaybeden düşmeli');

  const a = board.getPlayer('a1');
  const b = board.getPlayer('b1');
  assert.equal(a.nickname, 'Alice');
  assert.equal(a.matches, 1);
  assert.equal(a.wins, 1);
  assert.equal(a.losses, 0);
  assert.equal(a.total_score, 150);
  assert.equal(a.rating, result.a.newRating);

  assert.equal(b.matches, 1);
  assert.equal(b.losses, 1);
  assert.equal(b.wins, 0);
  assert.equal(b.total_score, 100);

  board.close();
});

test('berabere maç ikisine de draw yazar, matches sayaçları artar', () => {
  const board = newBoard();
  board.recordMatch({
    worldIdA: 'a1',
    nicknameA: 'Alice',
    scoreA: 90,
    worldIdB: 'b1',
    nicknameB: 'Bob',
    scoreB: 90,
  });
  const a = board.getPlayer('a1');
  const b = board.getPlayer('b1');
  assert.equal(a.draws, 1);
  assert.equal(b.draws, 1);
  assert.equal(a.rating, DEFAULT_RATING, 'eşit ratingde berabere değişim yaratmamalı');
  board.close();
});

test('aynı oyuncu birden çok maç oynadıkça sayaçlar birikir', () => {
  const board = newBoard();
  board.recordMatch({ worldIdA: 'a1', nicknameA: 'Alice', scoreA: 100, worldIdB: 'b1', nicknameB: 'Bob', scoreB: 50 });
  board.recordMatch({ worldIdA: 'a1', nicknameA: 'Alice', scoreA: 40, worldIdB: 'c1', nicknameB: 'Cem', scoreB: 80 });

  const a = board.getPlayer('a1');
  assert.equal(a.matches, 2);
  assert.equal(a.wins, 1);
  assert.equal(a.losses, 1);
  assert.equal(a.total_score, 140);
  board.close();
});

test('nickname sonraki maçta güncellenir, kimlik world_id ile korunur', () => {
  const board = newBoard();
  board.recordMatch({ worldIdA: 'a1', nicknameA: 'Alice', scoreA: 10, worldIdB: 'b1', nicknameB: 'Bob', scoreB: 10 });
  board.recordMatch({ worldIdA: 'a1', nicknameA: 'AliceYeni', scoreA: 10, worldIdB: 'c1', nicknameB: 'Cem', scoreB: 5 });

  assert.equal(board.getPlayer('a1').nickname, 'AliceYeni');
  board.close();
});

test('getTop ratinge göre azalan sırada döner ve rank alanı taşır', () => {
  const board = newBoard();
  board.recordMatch({ worldIdA: 'a1', nicknameA: 'Alice', scoreA: 200, worldIdB: 'b1', nicknameB: 'Bob', scoreB: 50 });
  board.recordMatch({ worldIdA: 'a1', nicknameA: 'Alice', scoreA: 200, worldIdB: 'c1', nicknameB: 'Cem', scoreB: 50 });

  const top = board.getTop(10);
  assert.equal(top.length, 3);
  assert.equal(top[0].world_id, 'a1', 'iki kez kazanan Alice birinci olmalı');
  assert.equal(top[0].rank, 1);
  assert.ok(top[0].rating >= top[1].rating && top[1].rating >= top[2].rating, 'azalan sırada olmalı');

  board.close();
});

test('getTop, yalnızca takma ad claim edip hiç maç oynamamış kimlikleri listelemez', () => {
  const board = newBoard();
  board.claimNickname('w-claim-only', 'HenüzOynamadı'); // 0 maç
  board.recordMatch({ worldIdA: 'a1', nicknameA: 'A', scoreA: 10, worldIdB: 'b1', nicknameB: 'B', scoreB: 5 });

  const top = board.getTop(50);
  assert.equal(top.length, 2, 'yalnızca gerçekten maç oynamış iki oyuncu görünmeli');
  assert.ok(!top.some((p) => p.world_id === 'w-claim-only'), 'claim-only kimlik sıralamada görünmemeli');
  board.close();
});

test('getTop limiti uygular', () => {
  const board = newBoard();
  board.recordMatch({ worldIdA: 'a1', nicknameA: 'A', scoreA: 10, worldIdB: 'b1', nicknameB: 'B', scoreB: 5 });
  board.recordMatch({ worldIdA: 'c1', nicknameA: 'C', scoreA: 10, worldIdB: 'd1', nicknameB: 'D', scoreB: 5 });
  assert.equal(board.getTop(2).length, 2);
  board.close();
});

test('getPlayer rankini doğru hesaplar (kendisinden yüksek ratingli oyuncu sayısı + 1)', () => {
  const board = newBoard();
  board.recordMatch({ worldIdA: 'a1', nicknameA: 'A', scoreA: 100, worldIdB: 'b1', nicknameB: 'B', scoreB: 10 });
  board.recordMatch({ worldIdA: 'a1', nicknameA: 'A', scoreA: 100, worldIdB: 'c1', nicknameB: 'C', scoreB: 10 });

  assert.equal(board.getPlayer('a1').rank, 1);
  assert.ok(board.getPlayer('b1').rank >= 2);
  board.close();
});

// ---------- claimNickname ----------

test('claimNickname ilk seferde yeni bir kimlik yaratır', () => {
  const board = newBoard();
  const claim = board.claimNickname('w1', 'Zeynep');
  assert.equal(claim.ok, true);
  assert.equal(claim.nickname, 'Zeynep');

  const row = board.getPlayer('w1');
  assert.equal(row.nickname, 'Zeynep');
  assert.equal(row.rating, DEFAULT_RATING);
  assert.equal(row.matches, 0);
  board.close();
});

test('claimNickname kendi adını tekrar claim etmek no-op başarıdır', () => {
  const board = newBoard();
  board.claimNickname('w1', 'Zeynep');
  const second = board.claimNickname('w1', 'Zeynep');
  assert.equal(second.ok, true);
  assert.equal(board.getPlayer('w1').nickname, 'Zeynep');
  board.close();
});

test('claimNickname başkasının adını almaya izin vermez ve hiçbir satırı değiştirmez', () => {
  const board = newBoard();
  board.claimNickname('w1', 'Zeynep');

  const attempt = board.claimNickname('w2', 'Zeynep');
  assert.equal(attempt.ok, false);
  assert.match(attempt.error, /Zeynep/);

  assert.equal(board.getPlayer('w1').nickname, 'Zeynep', 'sahibin adı değişmemeli');
  assert.equal(board.getPlayer('w2'), null, 'reddedilen tarafta kayıt oluşmamalı');
  board.close();
});

test('claimNickname büyük/küçük harf farkını (Türkçe kurallarına göre) çakışma sayar', () => {
  const board = newBoard();
  board.claimNickname('w1', 'Zeynep');
  const attempt = board.claimNickname('w2', 'ZEYNEP');
  assert.equal(attempt.ok, false);
  board.close();
});

test('claimNickname aynı worldId için yeniden adlandırmaya izin verir, eski ad serbest kalır', () => {
  const board = newBoard();
  board.claimNickname('w1', 'Zeynep');

  const renamed = board.claimNickname('w1', 'ZeynepYeni');
  assert.equal(renamed.ok, true);
  assert.equal(board.getPlayer('w1').nickname, 'ZeynepYeni');

  // Eski ad artık başkasına açık olmalı.
  const takeOld = board.claimNickname('w2', 'Zeynep');
  assert.equal(takeOld.ok, true);
  assert.equal(board.getPlayer('w2').nickname, 'Zeynep');
  board.close();
});

test('claimNickname başkasına ait ada yeniden adlandırmayı reddeder, mevcut ad korunur', () => {
  const board = newBoard();
  board.claimNickname('w1', 'Zeynep');
  board.claimNickname('w2', 'Kerem');

  const attempt = board.claimNickname('w2', 'Zeynep');
  assert.equal(attempt.ok, false);
  assert.equal(board.getPlayer('w2').nickname, 'Kerem', 'reddedilen yeniden adlandırmadan sonra eski ad kalmalı');
  board.close();
});

test('claimNickname sonradan recordMatch ile aynı kimliği paylaşır', () => {
  const board = newBoard();
  board.claimNickname('w1', 'Zeynep');
  board.claimNickname('w2', 'Kerem');

  board.recordMatch({ worldIdA: 'w1', nicknameA: 'Zeynep', scoreA: 120, worldIdB: 'w2', nicknameB: 'Kerem', scoreB: 90 });

  const a = board.getPlayer('w1');
  assert.equal(a.matches, 1, 'claim sırasında oluşan kimlik, sonraki maçta tekrar sayılmamalı');
  board.close();
});
