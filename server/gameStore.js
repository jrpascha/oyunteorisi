import { randomBytes } from 'node:crypto';
import {
  DEFAULT_PRESET,
  isValidChoice,
  isValidPreset,
  randomTotalRounds,
  scoreRound,
  visibleHistory,
} from './gameLogic.js';
import { analyzeMatch } from './analysis.js';
import { sanitizeNickname } from './nickname.js';

// Karışabilecek karakterler (0/O, 1/I/L) alfabeden çıkarıldı — link elle de yazılabilsin.
const ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const ID_LENGTH = 6;

const GAME_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

function makeGameId() {
  const bytes = randomBytes(ID_LENGTH);
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) id += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return id;
}

function makeToken() {
  return randomBytes(32).toString('hex');
}

export class GameStore {
  constructor() {
    /** @type {Map<string, object>} */
    this.games = new Map();
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref?.();
  }

  createGame(nickname, preset, worldId) {
    let id = makeGameId();
    while (this.games.has(id)) id = makeGameId();

    const now = Date.now();
    const game = {
      id,
      createdAt: now,
      updatedAt: now,
      phase: 'lobby', // lobby → playing → finished
      preset: isValidPreset(preset) ? preset : DEFAULT_PRESET,
      ranked: false, // yalnızca dünya çapında eşleşmeler sıralamaya sayılır
      ratingResult: null, // maç bitince index.js tarafından doldurulur (yalnızca ranked)
      totalRounds: null, // ikinci oyuncu katılınca üretilir, maç bitene dek gizli
      currentRound: 1,
      pending: [null, null],
      history: [],
      analysis: null,
      players: [this.#makePlayer(nickname, worldId)],
    };
    this.games.set(id, game);
    return { game, playerIndex: 0, token: game.players[0].token };
  }

  /**
   * Dünya çapında eşleşmeden doğan maç: iki oyuncu da baştan belli, lobi
   * adımı yok, uzunluk sabit "uzun". Gerçek tur sayısı burada üretilir ama
   * (özel maçlarda olduğu gibi) maç bitene kadar istemciye söylenmez.
   */
  createRankedMatch(playerA, playerB) {
    let id = makeGameId();
    while (this.games.has(id)) id = makeGameId();

    const now = Date.now();
    const game = {
      id,
      createdAt: now,
      updatedAt: now,
      phase: 'playing',
      preset: 'long',
      ranked: true,
      ratingResult: null,
      totalRounds: randomTotalRounds('long'),
      currentRound: 1,
      pending: [null, null],
      history: [],
      analysis: null,
      players: [
        this.#makePlayer(playerA.nickname, playerA.worldId),
        this.#makePlayer(playerB.nickname, playerB.worldId),
      ],
    };
    this.games.set(id, game);
    return {
      game,
      tokens: [game.players[0].token, game.players[1].token],
    };
  }

  #makePlayer(nickname, worldId = null) {
    return {
      token: makeToken(),
      nickname: sanitizeNickname(nickname),
      worldId: worldId || null,
      socketId: null,
      connected: false,
      score: 0,
    };
  }

  get(gameId) {
    return this.games.get(String(gameId ?? '').toUpperCase());
  }

  joinGame(gameId, nickname, worldId) {
    const game = this.get(gameId);
    if (!game) return { error: 'Böyle bir oyun bulunamadı. Bağlantıyı kontrol et.' };
    if (game.phase === 'finished') return { error: 'Bu oyun çoktan bitmiş.' };
    if (game.players.length >= 2) return { error: 'Bu oyun zaten dolu.' };

    game.players.push(this.#makePlayer(nickname, worldId));
    game.phase = 'playing';
    game.totalRounds = randomTotalRounds(game.preset);
    game.updatedAt = Date.now();
    return { game, playerIndex: 1, token: game.players[1].token };
  }

  /** Token ile oyuncu kimliğini doğrular (sayfa yenilendiğinde kullanılır). */
  resolvePlayer(gameId, token) {
    const game = this.get(gameId);
    if (!game) return null;
    const playerIndex = game.players.findIndex((p) => p.token === token);
    if (playerIndex === -1) return null;
    return { game, playerIndex };
  }

  setConnection(game, playerIndex, socketId) {
    const player = game.players[playerIndex];
    player.socketId = socketId;
    player.connected = socketId !== null;
    game.updatedAt = Date.now();
  }

  /**
   * Bir oyuncunun seçimini kaydeder.
   * Seçim, rakip de seçene kadar hiçbir şekilde dışarı verilmez.
   */
  submitChoice(game, playerIndex, round, choice) {
    if (game.phase !== 'playing') return { error: 'Oyun şu anda oynanmıyor.' };
    if (!isValidChoice(choice)) return { error: 'Geçersiz seçim.' };
    if (round !== game.currentRound) return { error: 'Bu tur çoktan geçti.' };
    if (game.pending[playerIndex] !== null) return { error: 'Seçimin zaten kilitlendi.' };

    game.pending[playerIndex] = choice;
    game.updatedAt = Date.now();

    if (game.pending[0] === null || game.pending[1] === null) {
      return { locked: true, resolved: false };
    }
    return { locked: true, resolved: true, entry: this.#resolveRound(game) };
  }

  #resolveRound(game) {
    const [a, b] = game.pending;
    const points = [scoreRound(a, b), scoreRound(b, a)];
    const entry = { round: game.currentRound, moves: [a, b], points };

    game.history.push(entry);
    game.players[0].score += points[0];
    game.players[1].score += points[1];
    game.pending = [null, null];

    if (game.history.length >= game.totalRounds) {
      game.phase = 'finished';
      game.analysis = analyzeMatch(game.history, game.players);
    } else {
      game.currentRound += 1;
    }
    game.updatedAt = Date.now();
    return entry;
  }

  /**
   * Bir oyuncunun görmeye hakkı olan durum.
   * totalRounds ve rakibin açılmamış seçimi burada ASLA yer almaz.
   */
  stateFor(game, playerIndex) {
    const me = game.players[playerIndex];
    const opponent = game.players[1 - playerIndex] ?? null;

    return {
      gameId: game.id,
      phase: game.phase,
      preset: game.preset,
      round: game.currentRound,
      you: { nickname: me.nickname, score: me.score },
      opponent: opponent
        ? { nickname: opponent.nickname, connected: opponent.connected, joined: true }
        : { nickname: null, connected: false, joined: false },
      yourChoice: game.pending[playerIndex],
      opponentLocked: game.pending[1 - playerIndex] !== null,
      history: visibleHistory(game.history, playerIndex),
      roundsPlayed: game.history.length,
    };
  }

  /** Maç bittiğinde gönderilen tam döküm — tam geçmiş ilk kez burada açılır. */
  finalFor(game, playerIndex) {
    return {
      gameId: game.id,
      totalRounds: game.totalRounds,
      yourIndex: playerIndex,
      players: game.players.map((p) => ({ nickname: p.nickname, score: p.score })),
      fullHistory: game.history.map((h) => ({
        round: h.round,
        moves: h.moves,
        points: h.points,
      })),
      analysis: game.analysis,
      ranked: game.ranked,
      // ratingResult DB'ye erişmeden burada sadece taşınır — index.js doldurur.
      ratingResult: game.ratingResult ? game.ratingResult[playerIndex] : null,
    };
  }

  sweep(now = Date.now()) {
    let removed = 0;
    for (const [id, game] of this.games) {
      if (now - game.updatedAt > GAME_TTL_MS) {
        this.games.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
