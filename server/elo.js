/**
 * ELO puanlama. Dünya sıralaması yalnızca bu modülü kullanır; başka hiçbir
 * yerde rating hesaplanmaz.
 */

export const DEFAULT_RATING = 1000;
export const K_FACTOR = 32;

/** A'nın B'ye karşı beklenen kazanma olasılığı (0..1). */
export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * İki oyuncunun maç sonrası yeni ratingleri.
 * outcomeA: 1 = A kazandı, 0.5 = berabere, 0 = A kaybetti.
 */
export function updateRatings(ratingA, ratingB, outcomeA) {
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = 1 - expectedA;
  const outcomeB = 1 - outcomeA;

  const deltaA = K_FACTOR * (outcomeA - expectedA);
  const deltaB = K_FACTOR * (outcomeB - expectedB);

  return {
    a: { rating: ratingA + deltaA, delta: deltaA },
    b: { rating: ratingB + deltaB, delta: deltaB },
  };
}

/** Maç puanlarından ELO'nun beklediği outcomeA değerini üretir. */
export function outcomeFromScores(scoreA, scoreB) {
  if (scoreA > scoreB) return 1;
  if (scoreA < scoreB) return 0;
  return 0.5;
}
