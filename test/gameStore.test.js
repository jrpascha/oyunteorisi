import test from 'node:test';
import assert from 'node:assert/strict';
import { GameStore } from '../server/gameStore.js';
import { COOPERATE as C, DEFECT as D, DEFAULT_PRESET, ROUND_PRESETS } from '../server/gameLogic.js';

function newMatch(totalRounds, preset) {
  const store = new GameStore();
  const { game } = store.createGame('Alice', preset);
  store.joinGame(game.id, 'Bob');
  if (totalRounds) game.totalRounds = totalRounds; // testi kısaltmak için
  return { store, game };
}

test('oyun kurulur, lobide bekler, ikinci oyuncu katılınca başlar', () => {
  const store = new GameStore();
  const created = store.createGame('  Alice  ', 'short');

  assert.equal(created.game.phase, 'lobby');
  assert.equal(created.game.preset, 'short', 'seçilen uzunluk kaydedilmeli');
  assert.equal(created.game.totalRounds, null, 'lobide tur sayısı henüz üretilmemeli');
  assert.equal(created.game.players[0].nickname, 'Alice', 'takma ad kırpılmalı');
  assert.match(created.game.id, /^[2-9A-HJ-NP-Z]{6}$/);

  const joined = store.joinGame(created.game.id.toLowerCase(), 'Bob');
  assert.equal(joined.playerIndex, 1);
  assert.equal(created.game.phase, 'playing');
  const { min, max } = ROUND_PRESETS.short;
  assert.ok(
    created.game.totalRounds >= min && created.game.totalRounds <= max,
    'tur sayısı, seçilen ön ayarın aralığında ve katılımda üretilmeli',
  );
});

test('geçersiz veya eksik ön ayar varsayılana düşer', () => {
  const store = new GameStore();
  const invalid = store.createGame('Alice', 'epic-mod');
  assert.equal(invalid.game.preset, DEFAULT_PRESET);

  const missing = store.createGame('Bob');
  assert.equal(missing.game.preset, DEFAULT_PRESET);
});

test('createRankedMatch lobi adımı olmadan doğrudan başlar, uzunluk sabit "uzun"', () => {
  const store = new GameStore();
  const { game, tokens } = store.createRankedMatch(
    { nickname: 'Alice', worldId: 'w-alice' },
    { nickname: 'Bob', worldId: 'w-bob' },
  );

  assert.equal(game.phase, 'playing', 'lobi adımı atlanmalı');
  assert.equal(game.preset, 'long');
  assert.equal(game.ranked, true);
  assert.equal(game.ratingResult, null);
  assert.ok(
    game.totalRounds >= ROUND_PRESETS.long.min && game.totalRounds <= ROUND_PRESETS.long.max,
    'tur sayısı "uzun" aralığında olmalı',
  );
  assert.equal(game.players[0].worldId, 'w-alice');
  assert.equal(game.players[1].worldId, 'w-bob');
  assert.equal(tokens.length, 2);
  assert.notEqual(tokens[0], tokens[1]);

  // Görünür durumda toplam tur sayısı yine gizli kalmalı — özel maçlarla aynı kural.
  assert.equal(JSON.stringify(store.stateFor(game, 0)).includes('totalRounds'), false);
});

test('worldId verilmezse özel maçlarda null kalır, sıralamayı etkilemez', () => {
  const { store, game } = newMatch();
  assert.equal(game.players[0].worldId, null);
  assert.equal(game.players[1].worldId, null);
  assert.equal(game.ranked, false);
  assert.equal(store.finalFor(game, 0).ranked, false);
  assert.equal(store.finalFor(game, 0).ratingResult, null);
});

test('createGame ve joinGame worldId verilince özel maçta da saklar', () => {
  const store = new GameStore();
  const { game } = store.createGame('Alice', 'medium', 'w-alice');
  store.joinGame(game.id, 'Bob', 'w-bob');

  assert.equal(game.players[0].worldId, 'w-alice');
  assert.equal(game.players[1].worldId, 'w-bob');
  // worldId dolu olsa da özel maç sıralamayı etkilememeli — ranked ayrı bir bayrak.
  assert.equal(game.ranked, false);
});

test('dolu, bitmiş ve olmayan oyunlara katılım reddedilir', () => {
  const { store, game } = newMatch();
  assert.match(store.joinGame(game.id, 'Cem').error, /dolu/i);
  assert.match(store.joinGame('YOKYOK', 'Cem').error, /bulunamadı/i);

  game.phase = 'finished';
  assert.match(store.joinGame(game.id, 'Cem').error, /bitmiş/i);
});

test('seçim ikinci oyuncu da seçene kadar açılmaz', () => {
  const { store, game } = newMatch();

  const first = store.submitChoice(game, 0, 1, C);
  assert.equal(first.resolved, false, 'tek seçimle tur çözülmemeli');

  // Rakibin durumunda karşı tarafın seçimi asla yer almaz — sadece "kilitlendi" bilgisi.
  const oppState = store.stateFor(game, 1);
  assert.equal(oppState.yourChoice, null);
  assert.equal(oppState.opponentLocked, true);
  assert.equal(JSON.stringify(oppState).includes('"C"'), false, 'rakibin hamlesi sızmamalı');

  assert.match(store.submitChoice(game, 0, 1, D).error, /kilitlendi/i, 'seçim değiştirilemez');
  assert.match(store.submitChoice(game, 1, 5, C).error, /geçti/i, 'yanlış tur reddedilir');
  assert.match(store.submitChoice(game, 1, 1, 'X').error, /geçersiz/i);

  const second = store.submitChoice(game, 1, 1, D);
  assert.equal(second.resolved, true);
  assert.deepEqual(second.entry.moves, [C, D]);
  assert.deepEqual(second.entry.points, [0, 5]);
  assert.equal(game.players[0].score, 0);
  assert.equal(game.players[1].score, 5);
  assert.equal(game.currentRound, 2, 'tur ilerlemeli');
});

test('oyuncuya gönderilen durum toplam tur sayısını hiç taşımaz', () => {
  const { store, game } = newMatch(85);
  for (let r = 1; r <= 40; r++) {
    store.submitChoice(game, 0, r, C);
    store.submitChoice(game, 1, r, C);
    const state = store.stateFor(game, 0);
    assert.equal(JSON.stringify(state).includes('totalRounds'), false);
    assert.ok(state.history.length <= 7, `${r}. turda pencere aşıldı`);
  }
  const finalState = store.stateFor(game, 0);
  assert.equal(finalState.you.score, 120);
  assert.equal(finalState.preset, DEFAULT_PRESET, 'seçilen uzunluk kategorisi görünür kalmalı');
});

test('maç tam tur sayısında biter ve analiz üretilir', () => {
  const total = 82;
  const { store, game } = newMatch(total);

  for (let r = 1; r <= total; r++) {
    assert.equal(game.phase, 'playing', `${r}. turdan önce oyun bitmiş olmamalı`);
    store.submitChoice(game, 0, r, r % 4 === 0 ? D : C);
    store.submitChoice(game, 1, r, r % 3 === 0 ? D : C);
  }

  assert.equal(game.phase, 'finished');
  assert.equal(game.history.length, total);
  assert.ok(game.analysis, 'analiz üretilmeli');

  const final = store.finalFor(game, 0);
  assert.equal(final.totalRounds, total, 'tur sayısı ilk kez burada açıklanır');
  assert.equal(final.fullHistory.length, total, 'tam geçmiş ilk kez burada verilir');
  assert.equal(final.players.length, 2);
  assert.ok(final.analysis.players[0].archetype.name);

  // Bittikten sonra yeni seçim kabul edilmez
  assert.match(store.submitChoice(game, 0, total + 1, C).error, /oynanmıyor/i);
});

test('token ile oturum geri alınır, yanlış token reddedilir', () => {
  const store = new GameStore();
  const { game, token } = store.createGame('Alice');

  const resolved = store.resolvePlayer(game.id, token);
  assert.equal(resolved.playerIndex, 0);
  assert.equal(store.resolvePlayer(game.id, 'sahte-token'), null);
  assert.equal(store.resolvePlayer('YOKYOK', token), null);
});

test('bağlantı durumu rakibin ekranına yansır', () => {
  const { store, game } = newMatch();
  store.setConnection(game, 0, 'sock-a');
  store.setConnection(game, 1, 'sock-b');
  assert.equal(store.stateFor(game, 0).opponent.connected, true);

  store.setConnection(game, 1, null);
  const view = store.stateFor(game, 0);
  assert.equal(view.opponent.connected, false);
  assert.equal(view.opponent.joined, true, 'kopan rakip hâlâ katılmış sayılır');
});

test('eskimiş oyunlar bellekten temizlenir', () => {
  const store = new GameStore();
  const { game } = store.createGame('Alice');
  const fresh = store.createGame('Cem');

  game.updatedAt = Date.now() - 25 * 60 * 60 * 1000;
  assert.equal(store.sweep(), 1);
  assert.equal(store.get(game.id), undefined);
  assert.ok(store.get(fresh.game.id), 'taze oyun silinmemeli');
});
