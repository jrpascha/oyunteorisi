import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_RATING, outcomeFromScores, updateRatings } from './elo.js';
import { nicknameKey, sanitizeNickname } from './nickname.js';

/**
 * Dünya sıralaması: yalnızca "Dünya Çapında Oyna" (rastgele eşleşme) maçları
 * burayı günceller — arkadaş-linki maçları saymaz. Kalıcılık için Node'un
 * yerleşik `node:sqlite` modülü kullanılır; ek bir bağımlılık gerekmez.
 */
export class Leaderboard {
  constructor(dbPath) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        world_id     TEXT PRIMARY KEY,
        nickname     TEXT NOT NULL,
        nickname_key TEXT NOT NULL DEFAULT '',
        rating       REAL NOT NULL DEFAULT ${DEFAULT_RATING},
        matches      INTEGER NOT NULL DEFAULT 0,
        wins         INTEGER NOT NULL DEFAULT 0,
        losses       INTEGER NOT NULL DEFAULT 0,
        draws        INTEGER NOT NULL DEFAULT 0,
        total_score  INTEGER NOT NULL DEFAULT 0,
        updated_at   INTEGER NOT NULL
      )
    `);
    this.#migrateNicknameKey();

    this.stmts = {
      ensure: this.db.prepare(
        `INSERT INTO players (world_id, nickname, nickname_key, rating, updated_at)
         VALUES (?, ?, ?, ${DEFAULT_RATING}, ?)
         ON CONFLICT(world_id) DO UPDATE SET nickname = excluded.nickname, nickname_key = excluded.nickname_key`,
      ),
      get: this.db.prepare('SELECT * FROM players WHERE world_id = ?'),
      getByKey: this.db.prepare('SELECT world_id, nickname FROM players WHERE nickname_key = ?'),
      applyResult: this.db.prepare(`
        UPDATE players SET
          rating = ?,
          matches = matches + 1,
          wins = wins + ?,
          losses = losses + ?,
          draws = draws + ?,
          total_score = total_score + ?,
          updated_at = ?
        WHERE world_id = ?
      `),
      rankAbove: this.db.prepare('SELECT COUNT(*) AS cnt FROM players WHERE rating > ?'),
      // matches > 0: yalnızca en az bir sıralamalı maç bitirmiş oyuncular görünür.
      // Bir takma adı sahiplenmek (claimNickname) tek başına bir satır yaratır —
      // bu, henüz hiç maç oynamamış herkesi sıralamada göstermemeli.
      top: this.db.prepare('SELECT * FROM players WHERE matches > 0 ORDER BY rating DESC, matches DESC LIMIT ?'),
    };
  }

  /**
   * `nickname_key` sütunu ve benzersizlik indeksi bu sürümde eklendi. Daha
   * eski bir DB dosyasında tablo zaten var olabilir (CREATE TABLE IF NOT
   * EXISTS bunu atlar) — sütunu ekleyip eski satırları geriye dönük doldurur.
   * Hiçbir elle müdahale gerekmez.
   */
  #migrateNicknameKey() {
    try {
      this.db.exec("ALTER TABLE players ADD COLUMN nickname_key TEXT NOT NULL DEFAULT ''");
    } catch {
      // sütun zaten var — taze şemada CREATE TABLE bunu zaten içeriyordu
    }

    const stale = this.db.prepare("SELECT world_id, nickname FROM players WHERE nickname_key = ''").all();
    if (stale.length > 0) {
      const fill = this.db.prepare('UPDATE players SET nickname_key = ? WHERE world_id = ?');
      for (const row of stale) fill.run(nicknameKey(row.nickname), row.world_id);
    }

    try {
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_nickname_key ON players(nickname_key)');
    } catch (err) {
      // Çakışan eski veri varsa (bu özellikten önce aynı ada sahip iki kayıt) sunucu
      // çökmesin — benzersizlik uygulanmadan devam eder, uyarı basılır.
      console.warn('Uyarı: takma ad benzersizlik indeksi kurulamadı —', err.message);
    }
  }

  #ensurePlayer(worldId, nickname, now) {
    this.stmts.ensure.run(worldId, nickname, nicknameKey(nickname), now);
    return this.stmts.get.get(worldId);
  }

  /**
   * worldId'nin bu takma adı sahiplenmesini sağlar: ad boştaysa alır, kendi
   * adıysa dokunmaz, başka bir worldId'e aitse reddeder. Başarılıysa
   * sanitize edilmiş adı döner — çağıran taraf gerçek kaydı bununla yapmalı.
   */
  claimNickname(worldId, rawNickname) {
    const nickname = sanitizeNickname(rawNickname);
    const key = nicknameKey(nickname);
    const now = Date.now();

    const owner = this.stmts.getByKey.get(key);
    if (owner && owner.world_id !== worldId) {
      return { ok: false, error: `"${owner.nickname}" adı başka bir oyuncu tarafından kullanılıyor.` };
    }

    this.#ensurePlayer(worldId, nickname, now);
    return { ok: true, nickname };
  }

  /**
   * Sıralamalı bir maçın sonucunu işler. Yalnızca maç 'finished' olduğunda ve
   * tam olarak bir kez çağrılmalı — çağıran taraf (server/index.js) bundan
   * sorumludur.
   * Döner: { a: {worldId, oldRating, newRating, delta}, b: {...} }
   */
  recordMatch({ worldIdA, nicknameA, scoreA, worldIdB, nicknameB, scoreB }) {
    const now = Date.now();
    const before = {
      a: this.#ensurePlayer(worldIdA, nicknameA, now),
      b: this.#ensurePlayer(worldIdB, nicknameB, now),
    };

    const outcomeA = outcomeFromScores(scoreA, scoreB);
    const { a, b } = updateRatings(before.a.rating, before.b.rating, outcomeA);

    const winsA = outcomeA === 1 ? 1 : 0;
    const lossesA = outcomeA === 0 ? 1 : 0;
    const drawsA = outcomeA === 0.5 ? 1 : 0;

    this.stmts.applyResult.run(a.rating, winsA, lossesA, drawsA, scoreA, now, worldIdA);
    this.stmts.applyResult.run(b.rating, lossesA, winsA, drawsA, scoreB, now, worldIdB);

    return {
      a: { worldId: worldIdA, oldRating: before.a.rating, newRating: a.rating, delta: a.delta },
      b: { worldId: worldIdB, oldRating: before.b.rating, newRating: b.rating, delta: b.delta },
    };
  }

  /** En yüksek ratingli ilk `limit` oyuncu, 1'den başlayan sıra numarasıyla. */
  getTop(limit = 50) {
    return this.stmts.top.all(limit).map((row, i) => ({ ...row, rank: i + 1 }));
  }

  /** Tek oyuncu + hesaplanmış sırası. Kayıt yoksa null döner. */
  getPlayer(worldId) {
    const row = this.stmts.get.get(worldId);
    if (!row) return null;
    const { cnt } = this.stmts.rankAbove.get(row.rating);
    return { ...row, rank: cnt + 1 };
  }

  close() {
    this.db.close();
  }
}
