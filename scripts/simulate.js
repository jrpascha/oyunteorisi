/**
 * Uçtan uca doğrulama: iki bot istemci gerçek sunucuya bağlanıp tam bir maç oynar.
 * 200 tıklama yapmadan tüm zinciri (oda → tur döngüsü → analiz) sınar ve
 * hiçbir mesajda gizli bilginin sızmadığını kontrol eder.
 *
 * Çalıştır: npm run simulate
 */
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { historyWindowSize, scoreRound } from '../server/gameLogic.js';

const PORT = process.env.SIM_PORT || 3999;
process.env.PORT = PORT;
process.env.LEADERBOARD_DB = ':memory:'; // gerçek data/leaderboard.db'ye asla yazma

const { server, io, store, leaderboard } = await import('../server/index.js');
const URL = `http://localhost:${PORT}`;

const leaks = [];

/** Maç bitmeden gelen hiçbir mesaj toplam tur sayısını ya da pencere dışı geçmişi taşımamalı. */
function inspect(botName, event, payload) {
  if (event === 'game_over') return;
  const json = JSON.stringify(payload ?? {});
  if (json.includes('totalRounds')) {
    leaks.push(`${botName}: "${event}" olayı totalRounds taşıyor`);
  }
  const state = event === 'state' ? payload : payload?.state;
  if (state?.history) {
    const allowed = historyWindowSize(state.roundsPlayed);
    if (state.history.length > allowed) {
      leaks.push(
        `${botName}: "${event}" olayında ${state.history.length} tur var, izin verilen ${allowed}`,
      );
    }
  }
}

/**
 * Bot stratejileri. Her biri kendi gördüğü geçmişe göre karar verir.
 */
const strategies = {
  // Kısasa Kısas: iyi niyetle başla, rakibin son hamlesini yansıt.
  tft: (lastOpponentMove) => (lastOpponentMove === null ? 'C' : lastOpponentMove),
  // Bağışlayıcı sondacı: misilleme yapar ama her üç turda bir affeder,
  // ayrıca ara sıra rakibi sınamak için tek turluk ret çeker.
  // İki bot da karşılıklı ret sarmalına kilitlenmesin diye affedici seçildi;
  // böylece simülasyon işbirliği yollarını da gerçekten çalıştırır.
  prober: (lastOpponentMove, round) => {
    if (lastOpponentMove === 'D') return round % 3 === 0 ? 'C' : 'D';
    return round % 11 === 0 ? 'D' : 'C';
  },
};

function makeBot(name, strategyName) {
  const socket = connect(URL, { transports: ['websocket'] });
  const bot = {
    name,
    socket,
    strategy: strategies[strategyName],
    lastOpponentMove: null,
    submittedRound: 0,
    myMoves: [],
    oppMoves: [],
    myPoints: [],
    final: null,
  };

  socket.onAny((event, payload) => inspect(name, event, payload));

  const act = (state) => {
    if (!state || state.phase !== 'playing') return;
    if (state.yourChoice || state.round <= bot.submittedRound) return;
    bot.submittedRound = state.round;
    const choice = bot.strategy(bot.lastOpponentMove, state.round);
    socket.emit('make_choice', { round: state.round, choice }, (res) => {
      assert.ok(res?.ok, `${name}: seçim reddedildi — ${res?.error}`);
    });
  };

  socket.on('state', act);

  socket.on('round_result', (result) => {
    bot.myMoves.push(result.yourChoice);
    bot.oppMoves.push(result.opponentChoice);
    bot.myPoints.push(result.yourPoints);
    bot.lastOpponentMove = result.opponentChoice;
    act(result.state);
  });

  socket.on('game_over', (final) => {
    bot.final = final;
    bot.resolveDone?.();
  });

  bot.done = new Promise((resolve) => {
    bot.resolveDone = resolve;
  });

  return bot;
}

const started = Date.now();
const alice = makeBot('Alice', 'tft');
const bob = makeBot('Bob', 'prober');
const ALICE_WORLD_ID = 'sim-alice-' + Date.now();
const BOB_WORLD_ID = 'sim-bob-' + Date.now();

const gameId = await new Promise((resolve, reject) => {
  alice.socket.emit('create_game', { nickname: 'Alice', preset: 'long', worldId: ALICE_WORLD_ID }, (res) => {
    res?.ok ? resolve(res.gameId) : reject(new Error(res?.error || 'oyun kurulamadı'));
  });
});

await new Promise((resolve, reject) => {
  bob.socket.emit('join_game', { gameId, nickname: 'Bob', worldId: BOB_WORLD_ID }, (res) => {
    res?.ok ? resolve() : reject(new Error(res?.error || 'katılınamadı'));
  });
});

const timeout = setTimeout(() => {
  console.error('✖ Maç 30 saniyede bitmedi — tur döngüsü takılmış olabilir.');
  process.exit(1);
}, 30_000);

await Promise.all([alice.done, bob.done]);
clearTimeout(timeout);

// ---------- Doğrulamalar ----------

const final = alice.final;
const n = final.totalRounds;

assert.ok(n >= 80 && n <= 90, `"uzun" ön ayarın 80–90 aralığı dışında: ${n}`);
assert.equal(final.fullHistory.length, n, 'oynanan tur sayısı toplam tur sayısına eşit değil');
assert.equal(alice.myMoves.length, n, 'Alice her turun sonucunu almadı');
assert.equal(bob.myMoves.length, n, 'Bob her turun sonucunu almadı');
assert.equal(bob.final.totalRounds, n, 'iki oyuncuya farklı tur sayısı bildirildi');

// İki oyuncunun gördüğü hamleler birbirinin aynası olmalı
assert.deepEqual(alice.myMoves, bob.oppMoves, 'Alice’ın hamleleri Bob’a farklı ulaşmış');
assert.deepEqual(bob.myMoves, alice.oppMoves, 'Bob’un hamleleri Alice’a farklı ulaşmış');

// Puanlar matristen bağımsız olarak yeniden hesaplandığında tutmalı
const recomputed = alice.myMoves.reduce((sum, m, i) => sum + scoreRound(m, alice.oppMoves[i]), 0);
assert.equal(
  recomputed,
  alice.myPoints.reduce((a, b) => a + b, 0),
  'tur tur gelen puanlar matrisle uyuşmuyor',
);
assert.equal(final.players[final.yourIndex].score, recomputed, 'toplam puan yanlış');

// Botlar gerçekten strateji uygulamış olmalı (hepsi aynı hamle değil)
assert.ok(new Set(bob.myMoves).size === 2, 'Sondacı bot tek tip oynamış');
assert.ok(
  final.analysis.relationship.mutualCoopRounds > 0,
  'simülasyon hiç karşılıklı işbirliği üretmedi — analizin işbirliği yolları sınanmamış olur',
);

// Analiz
const report = final.analysis.players[final.yourIndex];
assert.ok(report.archetype.name, 'arketip üretilmemiş');
assert.equal(final.analysis.cumulative[0].length, n);
assert.equal(final.analysis.relationship.bestPossibleTogether, 6 * n);

const aliceReport = final.analysis.players[final.yourIndex];
const bobReport = final.analysis.players[1 - final.yourIndex];

console.log('');
console.log(`✔ Özel maç: ${n} tur oynandı (${Date.now() - started} ms)`);
console.log(`✔ Alice ${final.players[final.yourIndex].score} puan — ${aliceReport.archetype.name}`);
console.log(`✔ Bob   ${final.players[1 - final.yourIndex].score} puan — ${bobReport.archetype.name}`);
console.log(`✔ Karşılıklı işbirliği: ${final.analysis.relationship.mutualCoopRounds} tur`);

// ---------- Senaryo 2: Dünya çapında eşleşme + ELO ----------

const rankedStarted = Date.now();
const charlie = makeBot('Charlie', 'tft');
const dana = makeBot('Dana', 'prober');
const CHARLIE_WORLD_ID = 'sim-charlie-' + Date.now();
const DANA_WORLD_ID = 'sim-dana-' + Date.now();

function queueJoin(bot, worldId) {
  return new Promise((resolve, reject) => {
    bot.socket.emit('queue_join', { nickname: bot.name, worldId }, (res) => {
      res?.ok ? resolve(res) : reject(new Error(`${bot.name}: kuyruğa girilemedi — ${res?.error}`));
    });
  });
}
function waitMatched(bot) {
  return new Promise((resolve) => bot.socket.once('matched', resolve));
}

const charlieMatched = waitMatched(charlie);
const danaMatched = waitMatched(dana);

const firstJoin = await queueJoin(charlie, CHARLIE_WORLD_ID);
assert.equal(firstJoin.queued, true, 'ilk giren beklemeye alınmalı');
await queueJoin(dana, DANA_WORLD_ID);

const [charliePayload, danaPayload] = await Promise.all([charlieMatched, danaMatched]);
assert.equal(charliePayload.gameId, danaPayload.gameId, 'iki taraf da aynı maça eşleşmeli');
assert.notEqual(charliePayload.token, danaPayload.token, 'ayrı token almalılar');

const rankedTimeout = setTimeout(() => {
  console.error('✖ Sıralamalı maç 30 saniyede bitmedi.');
  process.exit(1);
}, 30_000);

await Promise.all([charlie.done, dana.done]);
clearTimeout(rankedTimeout);

const rankedFinal = charlie.final;
const rn = rankedFinal.totalRounds;

assert.ok(rn >= 80 && rn <= 90, `dünya çapında eşleşme "uzun" olmalı, tur: ${rn}`);
assert.equal(rankedFinal.ranked, true, 'game_over.ranked true olmalı');
assert.ok(rankedFinal.ratingResult, 'sıralamalı maçta ratingResult dolu olmalı');
assert.equal(dana.final.ranked, true);
assert.ok(dana.final.ratingResult, 'rakip tarafta da ratingResult dolmalı');

// Kazanan yükselmeli, kaybeden düşmeli (berabere değilse) — sıfır toplamlı kontrol.
const charlieScore = rankedFinal.players[rankedFinal.yourIndex].score;
const danaScore = dana.final.players[dana.final.yourIndex].score;
if (charlieScore !== danaScore) {
  const winnerResult = charlieScore > danaScore ? rankedFinal.ratingResult : dana.final.ratingResult;
  const loserResult = charlieScore > danaScore ? dana.final.ratingResult : rankedFinal.ratingResult;
  assert.ok(winnerResult.delta > 0, 'kazananın ratingi artmalı');
  assert.ok(loserResult.delta < 0, 'kaybedenin ratingi azalmalı');
}
assert.ok(
  Math.abs(rankedFinal.ratingResult.delta + dana.final.ratingResult.delta) < 1e-6,
  'ELO sıfır toplamlı olmalı',
);

// Özel maçlar sıralamayı etkilememeli.
assert.equal(final.ranked, false, 'özel maç ranked:false olmalı');
assert.equal(final.ratingResult, null, 'özel maçta ratingResult olmamalı');

// Leaderboard REST ucundan da doğrula.
const leaderboardRes = await fetch(`${URL}/api/leaderboard?limit=10`);
const { players: topPlayers } = await leaderboardRes.json();
const charlieRow = topPlayers.find((p) => p.world_id === CHARLIE_WORLD_ID);
assert.ok(charlieRow, 'Charlie /api/leaderboard listesinde görünmeli');
assert.equal(charlieRow.matches, 1);
assert.ok(Math.abs(charlieRow.rating - rankedFinal.ratingResult.newRating) < 1e-6);

const rankRes = await fetch(`${URL}/api/rank/${encodeURIComponent(DANA_WORLD_ID)}`);
const danaRank = await rankRes.json();
assert.equal(danaRank.found, true);
assert.equal(danaRank.matches, 1);

console.log('');
console.log(`✔ Dünya çapında eşleşme: ${rn} tur oynandı (${Date.now() - rankedStarted} ms)`);
console.log(
  `✔ Charlie ${charlieScore} puan — ELO ${Math.round(rankedFinal.ratingResult.oldRating)} → ${Math.round(rankedFinal.ratingResult.newRating)}`,
);
console.log(
  `✔ Dana    ${danaScore} puan — ELO ${Math.round(dana.final.ratingResult.oldRating)} → ${Math.round(dana.final.ratingResult.newRating)}`,
);
console.log('✔ /api/leaderboard ve /api/rank tutarlı');
console.log(`✔ Özel maç sıralamayı etkilemedi (ranked:false)`);

// ---------- Senaryo 3: Takma ad benzersizliği ----------

const nickStarted = Date.now();
const eve = connect(URL, { transports: ['websocket'] });
const frank = connect(URL, { transports: ['websocket'] });
await Promise.all([
  new Promise((resolve) => eve.on('connect', resolve)),
  new Promise((resolve) => frank.on('connect', resolve)),
]);

const EVE_WORLD_ID = 'sim-eve-' + Date.now();
const FRANK_WORLD_ID = 'sim-frank-' + Date.now();
// Kısa tutulur: sanitizeNickname 20 karakterde keser, uzun bir ad + zaman
// damgası kesilip testin beklediği tam metinle uyuşmayabilir.
const CONTESTED_NAME = 'Cakis' + Date.now();

const emitAck = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

// Eve ismi ilk alır.
const eveCreate = await emitAck(eve, 'create_game', {
  nickname: CONTESTED_NAME,
  preset: 'short',
  worldId: EVE_WORLD_ID,
});
assert.ok(eveCreate?.ok, `Eve oyun kuramadı — ${eveCreate?.error}`);

// Frank aynı ismi (farklı büyük/küçük harfle) almaya çalışır — reddedilmeli.
// 'tr-TR' ile büyütülür: düz .toUpperCase() Türkçe i/İ/I/ı çiftlerini bozar
// (ör. 'i' -> ASCII 'I' -> tr-TR küçültmede 'ı' olur, 'i'ye değil) ve testi
// gerçekte var olmayan bir çakışma senaryosuna çevirir.
const frankAttempt = await emitAck(frank, 'create_game', {
  nickname: CONTESTED_NAME.toLocaleUpperCase('tr-TR'),
  preset: 'short',
  worldId: FRANK_WORLD_ID,
});
assert.equal(frankAttempt?.ok, false, 'alınmış bir ad (büyük/küçük harf farklı olsa da) kabul edilmiş');
assert.match(frankAttempt?.error || '', new RegExp(CONTESTED_NAME, 'i'));

// Frank farklı bir adla dener — başarmalı.
const frankRetry = await emitAck(frank, 'create_game', {
  nickname: 'FrankinAdi' + Date.now(),
  preset: 'short',
  worldId: FRANK_WORLD_ID,
});
assert.ok(frankRetry?.ok, `Frank farklı adla da oyun kuramadı — ${frankRetry?.error}`);

// Eve kendi worldId'siyle serbestçe yeniden adlandırabilmeli.
const eveRename = await emitAck(eve, 'create_game', {
  nickname: CONTESTED_NAME + '-Yeni',
  preset: 'short',
  worldId: EVE_WORLD_ID,
});
assert.ok(eveRename?.ok, `Eve kendi adını değiştiremedi — ${eveRename?.error}`);

// Eve adından vazgeçtiğine göre, önceden reddedilen Frank artık o adı alabilmeli.
const frankTakesFreedName = await emitAck(frank, 'queue_join', { nickname: CONTESTED_NAME, worldId: FRANK_WORLD_ID });
assert.ok(frankTakesFreedName?.ok, `Serbest kalan ad hâlâ alınamıyor — ${frankTakesFreedName?.error}`);
frank.emit('queue_leave'); // kuyrukta unutulmasın

eve.close();
frank.close();

console.log('');
console.log(
  `✔ Takma ad benzersizliği: alınmış ad (büyük/küçük harf farkı dahil) reddedildi, ` +
    `sahibi serbestçe yeniden adlandırdı, eski ad sonra başkasına açıldı (${Date.now() - nickStarted} ms)`,
);

// ---------- Sızıntı (her iki senaryo, tüm botlar) ----------

assert.equal(leaks.length, 0, 'Gizli bilgi sızdı:\n' + leaks.join('\n'));
console.log(`✔ Sızıntı kontrolü temiz (${leaks.length} bulgu)`);
console.log('');

alice.socket.close();
bob.socket.close();
charlie.socket.close();
dana.socket.close();
store.games.clear();
leaderboard.close();
io.close();
server.close();
