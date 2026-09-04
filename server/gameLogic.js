import { randomInt } from 'node:crypto';

/** Geçerli hamleler. C = İşbirliği, D = Ret. */
export const COOPERATE = 'C';
export const DEFECT = 'D';

/**
 * Mahkûm ikilemi puan matrisi.
 * T > R > P > S ve 2R > T + S koşulları sağlanmalı; aksi halde oyun
 * artık bir mahkûm ikilemi olmaz.
 *
 * S = 0: işbirliği yapıp ihanete uğrayanın puanı. Şartnamede belirtilmemişti,
 * standart mahkûm ikilemine uyularak 0 alındı. Değiştirmek için tek yer burası.
 */
export const PAYOFF = {
  R: 3, // Reward — ikisi de işbirliği
  T: 5, // Temptation — ret yapan, işbirliği yapana karşı
  S: 0, // Sucker — işbirliği yapan, ret yapana karşı
  P: 1, // Punishment — ikisi de ret
};

/**
 * Maç uzunluğu ön ayarları. Oyunu kuran taraf birini seçer; gerçek tur sayısı
 * bu aralıkta rastgele üretilir ve maç bitene kadar gizli kalır.
 */
export const ROUND_PRESETS = {
  short: { min: 10, max: 20 },
  medium: { min: 40, max: 50 },
  long: { min: 80, max: 90 },
};

export const DEFAULT_PRESET = 'medium';

export function isValidPreset(preset) {
  return Object.prototype.hasOwnProperty.call(ROUND_PRESETS, preset);
}

/** Bir turda kendi hamlene ve rakibin hamlesine göre kazandığın puan. */
export function scoreRound(mine, theirs) {
  if (mine === COOPERATE) return theirs === COOPERATE ? PAYOFF.R : PAYOFF.S;
  return theirs === COOPERATE ? PAYOFF.T : PAYOFF.P;
}

/** Maçın toplam tur sayısı: seçilen ön ayarın aralığında, kriptografik rastgelelikle. */
export function randomTotalRounds(preset = DEFAULT_PRESET) {
  const { min, max } = ROUND_PRESETS[isValidPreset(preset) ? preset : DEFAULT_PRESET];
  return randomInt(min, max + 1);
}

/**
 * Oyuncunun ekranında kaç geçmiş turun görüneceği.
 * 1–30 tur → 5 tur, 31–60 tur → 7 tur, 61+ tur → 9 tur.
 */
export function historyWindowSize(playedRounds) {
  if (playedRounds <= 30) return 5;
  if (playedRounds <= 60) return 7;
  return 9;
}

/**
 * Geçmişin, verilen oyuncunun görmeye hakkı olan penceresi.
 * Pencere dışındaki turlar istemciye hiç gönderilmez — kısıt sadece görsel değil.
 */
export function visibleHistory(history, playerIndex) {
  const size = historyWindowSize(history.length);
  return history.slice(-size).map((entry) => ({
    round: entry.round,
    you: entry.moves[playerIndex],
    opponent: entry.moves[1 - playerIndex],
    yourPoints: entry.points[playerIndex],
  }));
}

export function isValidChoice(choice) {
  return choice === COOPERATE || choice === DEFECT;
}
