/**
 * Takma ad kuralları — tek yerde tanımlı, hem oda mantığı (gameStore.js) hem
 * kimlik/benzersizlik mantığı (leaderboard.js) burayı kullanır.
 */

export function sanitizeNickname(raw) {
  const trimmed = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Oyuncu';
  return trimmed.slice(0, 20);
}

/**
 * Benzersizlik karşılaştırması için normalize edilmiş anahtar. Türkçe'ye
 * duyarlı küçük harfe çevirir (İ→i, I→ı) — SQLite'ın yerleşik NOCASE'i
 * yalnızca ASCII'yi doğru katlar, Türkçe harflerde yanlış sonuç verir.
 */
export function nicknameKey(nickname) {
  return sanitizeNickname(nickname).toLocaleLowerCase('tr-TR');
}
