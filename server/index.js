import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { GameStore } from './gameStore.js';
import { Leaderboard } from './leaderboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.LEADERBOARD_DB || path.join(__dirname, '..', 'data', 'leaderboard.db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const store = new GameStore();
const leaderboard = new Leaderboard(DB_PATH);

// Dünya çapında eşleşme kuyruğu — sadece bellekte, her giriş bekleyen bir soketi temsil eder.
/** @type {{ socketId: string, nickname: string, worldId: string }[]} */
const matchQueue = [];

app.use(express.static(PUBLIC_DIR));

// Davet bağlantısı: /g/ABC123
app.get('/g/:gameId', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'game.html'));
});

app.get('/siralama', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'leaderboard.html'));
});

app.get('/api/leaderboard', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  res.json({ players: leaderboard.getTop(limit) });
});

app.get('/api/rank/:worldId', (req, res) => {
  const player = leaderboard.getPlayer(req.params.worldId);
  res.json(player ? { found: true, ...player } : { found: false });
});

app.get('/healthz', (_req, res) => res.json({ ok: true, games: store.games.size, queued: matchQueue.length }));

/** Bir oyuncuya, kendi bakış açısından olay gönderir. */
function emitTo(game, playerIndex, event, payload) {
  const socketId = game.players[playerIndex]?.socketId;
  if (socketId) io.to(socketId).emit(event, payload);
}

function pushState(game) {
  for (let i = 0; i < game.players.length; i++) {
    emitTo(game, i, 'state', store.stateFor(game, i));
  }
}

/** Rakibe haber verir; oyunda henüz tek oyuncu varsa sessizce geçer. */
function notifyOpponent(game, playerIndex, event, payload = {}) {
  const opponentIndex = 1 - playerIndex;
  if (!game.players[opponentIndex]) return;
  emitTo(game, opponentIndex, event, payload);
  emitTo(game, opponentIndex, 'state', store.stateFor(game, opponentIndex));
}

/**
 * Sıralamalı bir maç bittiğinde ELO'yu bir kez hesaplayıp DB'ye yazar ve
 * sonucu game.ratingResult'a (players ile aynı indeksleme) yerleştirir.
 * game.ratingResult zaten doluysa hiçbir şey yapmaz (idempotent).
 */
function recordRankedResult(game) {
  if (!game.ranked || game.ratingResult) return;
  const [p0, p1] = game.players;
  const elo = leaderboard.recordMatch({
    worldIdA: p0.worldId,
    nicknameA: p0.nickname,
    scoreA: p0.score,
    worldIdB: p1.worldId,
    nicknameB: p1.nickname,
    scoreB: p1.score,
  });
  game.ratingResult = [elo.a, elo.b];
}

function pushGameOver(game) {
  recordRankedResult(game);
  for (let i = 0; i < game.players.length; i++) {
    emitTo(game, i, 'game_over', store.finalFor(game, i));
  }
}

function removeFromQueue(socketId) {
  const idx = matchQueue.findIndex((entry) => entry.socketId === socketId);
  if (idx !== -1) matchQueue.splice(idx, 1);
}

/** Aynı oyuncunun eski sekmesini düşürüp yenisini bağlar. */
function attach(socket, game, playerIndex) {
  const previous = game.players[playerIndex].socketId;
  socket.data.gameId = game.id;
  socket.data.playerIndex = playerIndex;

  // Yeni bağlantı ÖNCE kaydedilir: eski soketin disconnect'i tetiklendiğinde
  // artık güncel soket olmadığını görüp oyuncuyu "kopmuş" işaretlemesin.
  store.setConnection(game, playerIndex, socket.id);

  if (previous && previous !== socket.id) {
    io.to(previous).emit('superseded');
    io.sockets.sockets.get(previous)?.disconnect(true);
  }
}

io.on('connection', (socket) => {
  socket.on('create_game', (payload, ack) => {
    const worldId = String(payload?.worldId ?? '').trim();
    const rawNickname = String(payload?.nickname ?? '').trim();
    if (!rawNickname) return ack?.({ ok: false, error: 'Önce bir takma ad yaz.' });
    if (!worldId) return ack?.({ ok: false, error: 'Kimlik üretilemedi, sayfayı yenile.' });

    const claim = leaderboard.claimNickname(worldId, rawNickname);
    if (!claim.ok) return ack?.({ ok: false, error: claim.error });

    const { game, playerIndex, token } = store.createGame(claim.nickname, payload?.preset, worldId);
    attach(socket, game, playerIndex);
    ack?.({ ok: true, gameId: game.id, token, state: store.stateFor(game, playerIndex) });
  });

  // Katılmadan önce davetin temel bilgilerini gösterebilmek için (uzunluk, kurucunun adı).
  socket.on('peek_game', (payload, ack) => {
    const game = store.get(payload?.gameId);
    if (!game) return ack?.({ ok: false, error: 'Böyle bir oyun bulunamadı. Bağlantıyı kontrol et.' });
    ack?.({
      ok: true,
      phase: game.phase,
      preset: game.preset,
      hostNickname: game.players[0]?.nickname ?? null,
      full: game.players.length >= 2,
    });
  });

  socket.on('join_game', (payload, ack) => {
    const worldId = String(payload?.worldId ?? '').trim();
    const rawNickname = String(payload?.nickname ?? '').trim();
    if (!rawNickname) return ack?.({ ok: false, error: 'Önce bir takma ad yaz.' });
    if (!worldId) return ack?.({ ok: false, error: 'Kimlik üretilemedi, sayfayı yenile.' });

    const claim = leaderboard.claimNickname(worldId, rawNickname);
    if (!claim.ok) return ack?.({ ok: false, error: claim.error });

    const result = store.joinGame(payload?.gameId, claim.nickname, worldId);
    if (result.error) return ack?.({ ok: false, error: result.error });

    const { game, playerIndex, token } = result;
    attach(socket, game, playerIndex);
    ack?.({ ok: true, gameId: game.id, token, state: store.stateFor(game, playerIndex) });

    emitTo(game, 0, 'opponent_joined', { nickname: game.players[1].nickname });
    pushState(game);
  });

  // ---------- Dünya çapında eşleşme ----------

  socket.on('queue_join', (payload, ack) => {
    const rawNickname = String(payload?.nickname ?? '').trim();
    const worldId = String(payload?.worldId ?? '').trim();
    if (!rawNickname) return ack?.({ ok: false, error: 'Önce bir takma ad yaz.' });
    if (!worldId) return ack?.({ ok: false, error: 'Kimlik üretilemedi, sayfayı yenile.' });

    const claim = leaderboard.claimNickname(worldId, rawNickname);
    if (!claim.ok) return ack?.({ ok: false, error: claim.error });
    const nickname = claim.nickname;

    removeFromQueue(socket.id); // aynı soket kuyrukta iki kez yer almasın

    // Kendi worldId'siyle eşleşmeyi engelle (aynı sekmeden kazara çift giriş gibi durumlar için).
    const opponentIndex = matchQueue.findIndex((entry) => entry.worldId !== worldId);
    const opponent = opponentIndex === -1 ? null : matchQueue[opponentIndex];
    const opponentSocket = opponent ? io.sockets.sockets.get(opponent.socketId) : null;

    if (!opponent || !opponentSocket) {
      // Bekleyen kimse yok, ya da bulunan kayıt zaten kopmuş (temizliği atlanmış) — kuyruğa gir.
      matchQueue.push({ socketId: socket.id, nickname, worldId });
      return ack?.({ ok: true, queued: true });
    }

    matchQueue.splice(opponentIndex, 1);
    const { game, tokens } = store.createRankedMatch(
      { nickname: opponent.nickname, worldId: opponent.worldId },
      { nickname, worldId },
    );
    attach(opponentSocket, game, 0);
    attach(socket, game, 1);
    pushState(game); // join_game'deki gibi — sayfa yönlendirmeden state'e ihtiyaç duyan her istemci için

    // İki taraf da eşleşme haberini AYNI 'matched' olayından alır — kimin
    // beklediği kimin az önce katıldığı istemci tarafında fark etmemeli.
    ack?.({ ok: true, queued: true });
    opponentSocket.emit('matched', { gameId: game.id, token: tokens[0] });
    socket.emit('matched', { gameId: game.id, token: tokens[1] });
  });

  socket.on('queue_leave', () => removeFromQueue(socket.id));

  socket.on('resume', (payload, ack) => {
    const resolved = store.resolvePlayer(payload?.gameId, payload?.token);
    if (!resolved) return ack?.({ ok: false, error: 'Oturum bulunamadı.' });

    const { game, playerIndex } = resolved;
    attach(socket, game, playerIndex);
    ack?.({ ok: true, gameId: game.id, state: store.stateFor(game, playerIndex) });

    if (game.phase === 'finished') {
      emitTo(game, playerIndex, 'game_over', store.finalFor(game, playerIndex));
    }
    notifyOpponent(game, playerIndex, 'opponent_reconnected');
  });

  socket.on('make_choice', (payload, ack) => {
    const { gameId, playerIndex } = socket.data;
    const game = store.get(gameId);
    if (!game || playerIndex === undefined) {
      return ack?.({ ok: false, error: 'Oyuna bağlı değilsin.' });
    }

    const result = store.submitChoice(game, playerIndex, payload?.round, payload?.choice);
    if (result.error) return ack?.({ ok: false, error: result.error });

    ack?.({ ok: true });

    if (!result.resolved) {
      // Rakip yalnızca "seçim yapıldı" bilgisini alır — hangi seçim olduğunu değil.
      notifyOpponent(game, playerIndex, 'opponent_locked');
      return;
    }

    // İki seçim de geldi — ancak şimdi hamleler açılabilir.
    const { entry } = result;
    for (let i = 0; i < 2; i++) {
      emitTo(game, i, 'round_result', {
        round: entry.round,
        yourChoice: entry.moves[i],
        opponentChoice: entry.moves[1 - i],
        yourPoints: entry.points[i],
        yourTotal: game.players[i].score,
        state: store.stateFor(game, i),
      });
    }

    if (game.phase === 'finished') pushGameOver(game);
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket.id);

    const { gameId, playerIndex } = socket.data;
    const game = store.get(gameId);
    if (!game || playerIndex === undefined) return;
    if (game.players[playerIndex].socketId !== socket.id) return; // başka sekme devraldı

    store.setConnection(game, playerIndex, null);
    notifyOpponent(game, playerIndex, 'opponent_disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`Oyun Teorisi → http://localhost:${PORT}`);
});

export { app, server, io, store, leaderboard, matchQueue };
