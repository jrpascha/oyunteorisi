import { COOPERATE, DEFECT, PAYOFF, scoreRound } from './gameLogic.js';

/** value'yu [lo, hi] aralığına göre 0..1'e normalize eder. */
function band(value, lo, hi) {
  if (hi === lo) return value >= hi ? 1 : 0;
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

function ratio(hits, total) {
  return total === 0 ? 0 : hits / total;
}

function pct(x) {
  return Math.round(x * 100) + '%';
}

function coopRateOf(moves) {
  return ratio(moves.filter((m) => m === COOPERATE).length, moves.length);
}

/** Shannon entropisi, 0..1'e normalize (p = işbirliği oranı). */
function normalizedEntropy(p) {
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

/**
 * Tek bir oyuncunun hamle dizisinden davranış metrikleri.
 * own[t] / opp[t] aynı turun hamleleri.
 */
export function playerMetrics(own, opp) {
  const n = own.length;
  const coopRate = coopRateOf(own);

  // Kısasa Kısas benzerliği: bir önceki turda rakibin yaptığını tekrarlama oranı.
  let tftHits = 0;
  for (let t = 1; t < n; t++) if (own[t] === opp[t - 1]) tftHits++;
  const tftSimilarity = ratio(tftHits, Math.max(0, n - 1));

  // Misilleme: rakip ret yaptıktan sonraki turda ret yapma oranı.
  let provoked = 0;
  let retaliated = 0;
  // Fırsatçılık: rakip işbirliği yaptıktan sonraki turda ret yapma oranı.
  let invited = 0;
  let exploited = 0;
  // Affetme: biz ret yaparken rakip işbirliğine döndüyse, ertesi tur bizim de dönmemiz.
  let forgiveChances = 0;
  let forgave = 0;
  for (let t = 0; t < n - 1; t++) {
    if (opp[t] === DEFECT) {
      provoked++;
      if (own[t + 1] === DEFECT) retaliated++;
    } else {
      invited++;
      if (own[t + 1] === DEFECT) exploited++;
      if (own[t] === DEFECT) {
        forgiveChances++;
        if (own[t + 1] === COOPERATE) forgave++;
      }
    }
  }

  // Kin: rakibin ilk ihanetinden önceki ve sonraki işbirliği oranı farkı.
  const firstBetrayal = opp.indexOf(DEFECT);
  let coopBefore = coopRate;
  let coopAfter = coopRate;
  if (firstBetrayal !== -1 && firstBetrayal < n - 1) {
    coopBefore = coopRateOf(own.slice(0, firstBetrayal + 1));
    coopAfter = coopRateOf(own.slice(firstBetrayal + 1));
  }
  const grudgeScore = coopBefore - coopAfter;

  // Sırt çevirme: son 10 turdaki işbirliği oranının genel orandan sapması.
  const tailLength = Math.min(10, n);
  const endgameCoopRate = coopRateOf(own.slice(-tailLength));
  const endgameShift = endgameCoopRate - coopRate;

  // Dönme sıklığı: ardışık turlarda hamle değiştirme oranı.
  let switches = 0;
  for (let t = 1; t < n; t++) if (own[t] !== own[t - 1]) switches++;
  const switchRate = ratio(switches, Math.max(0, n - 1));

  // Sondalama: işbirliği serilerinin arasına serpiştirilmiş tek turluk retler.
  let isolatedDefections = 0;
  let totalDefections = 0;
  for (let t = 0; t < n; t++) {
    if (own[t] !== DEFECT) continue;
    totalDefections++;
    const beforeOk = t === 0 || own[t - 1] === COOPERATE;
    const afterOk = t === n - 1 || own[t + 1] === COOPERATE;
    if (beforeOk && afterOk) isolatedDefections++;
  }
  const isolatedDefectionRate = ratio(isolatedDefections, totalDefections);

  // Kışkırtılmamış ihanet: rakip bir önceki turda işbirliği yapmışken ret çekmek.
  let unprovokedDefections = 0;
  for (let t = 0; t < n; t++) {
    if (own[t] === DEFECT && (t === 0 || opp[t - 1] === COOPERATE)) unprovokedDefections++;
  }

  let longestMutualCoop = 0;
  let run = 0;
  for (let t = 0; t < n; t++) {
    if (own[t] === COOPERATE && opp[t] === COOPERATE) {
      run++;
      longestMutualCoop = Math.max(longestMutualCoop, run);
    } else {
      run = 0;
    }
  }

  return {
    rounds: n,
    coopRate,
    firstMove: own[0] ?? null,
    tftSimilarity,
    retaliationRate: ratio(retaliated, provoked),
    exploitationRate: ratio(exploited, invited),
    forgivenessRate: forgiveChances === 0 ? 1 : ratio(forgave, forgiveChances),
    grudgeScore,
    coopAfterFirstBetrayal: coopAfter,
    endgameShift,
    switchRate,
    entropy: normalizedEntropy(coopRate),
    isolatedDefectionRate,
    unprovokedDefections,
    longestMutualCoop,
  };
}

/**
 * Arketipler. Her biri metriklerden 0..1 arası bir uyum puanı üretir;
 * en yüksek puanlı kazanır. Hiçbiri eşiği geçemezse "Kaotik"e düşülür.
 */
const ARCHETYPES = [
  {
    id: 'saint',
    name: 'Sadık İşbirlikçi',
    tagline: 'Ne olursa olsun elini uzattın.',
    description:
      'Neredeyse her turda işbirliğini seçtin. İhanete uğradığında bile masayı devirmedin. ' +
      'Karşında iyi niyetli biri varsa bu strateji iki tarafa da mümkün olan en yüksek ortak kazancı getirir; ' +
      'ama sömürmeye niyetli bir rakibe karşı savunmasızdır.',
    score: (m) => band(m.coopRate, 0.85, 1),
  },
  {
    id: 'hawk',
    name: 'Şahin',
    tagline: 'Kimseye güvenmedin.',
    description:
      'Neredeyse hiç işbirliği yapmadın. Tek tek turlarda asla kaybetmeyen bir yaklaşım — ' +
      'rakibin ne yaparsa yapsın ret her zaman o turun daha kârlı seçimidir. ' +
      'Fakat rakip de aynı mantığı görüp sana uyduğunda ikiniz de tur başına 1 puana hapsolursunuz; ' +
      'karşılıklı işbirliğinin 3 puanı masada kalır. Mahkûm ikileminin ikilem olmasının sebebi tam olarak budur.',
    score: (m) => band(1 - m.coopRate, 0.85, 1),
  },
  {
    id: 'tft',
    name: 'Kısasa Kısas',
    tagline: 'Rakibin sana ne yaptıysa, bir sonraki turda onu geri verdin.',
    description:
      'İyi niyetle başlayıp rakibin son hamlesini aynen yansıttın: işbirliğine işbirliği, ihanete misilleme. ' +
      'Axelrod turnuvalarında bu basit kural, çok daha karmaşık stratejileri yenerek birinci oldu. ' +
      'Gücü öngörülebilirliğinden gelir — rakip, sana iyi davranmanın karşılığını alacağını hızla öğrenir.',
    score: (m) => {
      const gate = m.coopRate > 0.15 && m.coopRate < 0.92 ? 1 : 0.25;
      return band(m.tftSimilarity, 0.68, 0.95) * gate;
    },
  },
  {
    id: 'generous',
    name: 'Bağışlayıcı Karşılıkçı',
    tagline: 'Karşılık verdin ama kin tutmadın.',
    description:
      'İhanete misilleme yaptın, ancak rakip işbirliğine döndüğü anda sen de döndün. ' +
      'Bu affedicilik, karşılıklı ihanet sarmallarını kırar: iki katı karşılıkçı yanlışlıkla çatışmaya girdiğinde ' +
      'sonsuza kadar birbirini cezalandırır, bağışlayıcı olan ise ilişkiyi onarır.',
    score: (m) => {
      const gate = m.coopRate > 0.5 && m.coopRate < 0.95 ? 1 : 0.3;
      return (
        band(m.forgivenessRate, 0.55, 0.95) *
        band(m.retaliationRate, 0.25, 0.7) *
        gate
      );
    },
  },
  {
    id: 'grim',
    name: 'Kindar',
    tagline: 'Bir kere ihanet gördün, bir daha asla affetmedin.',
    description:
      'İlk ihanete kadar tam bir işbirlikçiydin; o andan sonra kapıyı temelli kapattın. ' +
      'Grim Trigger denen bu strateji caydırıcılığı en yüksek olanlardan biridir — ama tek bir yanlış anlaşılma ' +
      'ya da rakibin tek bir denemesi, geri kalan onlarca turu ikiniz için de 1 puana mahkûm eder.',
    score: (m) =>
      band(m.grudgeScore, 0.5, 0.9) * band(1 - m.coopAfterFirstBetrayal, 0.85, 1),
  },
  {
    id: 'backstabber',
    name: 'Sırt Çevirici',
    tagline: 'Güven inşa ettin, sonuna doğru bozdurdun.',
    description:
      'Maçın büyük kısmında işbirlikçiydin, son turlara doğru ihanete kaydın. ' +
      'Oyun teorisinde buna "geriye doğru tümevarım" denir: son tur yaklaştığında misillemenin bedeli kalmaz. ' +
      'İlginç olan şu — toplam tur sayısı sana hiç söylenmedi, yani bu dönüşü bir bilgiye değil, bir sezgiye dayandırdın.',
    score: (m) => band(-m.endgameShift, 0.3, 0.75),
  },
  {
    id: 'opportunist',
    name: 'Fırsatçı',
    tagline: 'Rakip elini uzattığında ısırdın.',
    description:
      'Rakibin işbirliği yaptığı turların ardından sık sık ret çektin: açığı gördüğün anda 5 puanı aldın. ' +
      'Kısa vadede en kârlı görünen davranış budur, ama karşındaki öğrenen bir rakipse ' +
      'güven kaynağını kendi elinle kurutursun.',
    score: (m) => {
      // Hiç işbirliği yapmayan biri fırsatçı değil, şahindir — sömürecek güven kurmamıştır.
      const gate = m.coopRate > 0.12 ? 1 : 0.3;
      return (
        band(m.exploitationRate, 0.22, 0.6) *
        band(m.unprovokedDefections / Math.max(1, m.rounds), 0.08, 0.3) *
        gate
      );
    },
  },
  {
    id: 'prober',
    name: 'Sondacı',
    tagline: 'Ara ara sınadın, sonra geri döndün.',
    description:
      'Genel olarak işbirlikçiydin ama araya tek turluk retler serpiştirdin — rakibin misilleme yapıp yapmayacağını ' +
      'ölçen kontrollü denemeler. Rakip yutarsa sömürüye geçilir, misilleme gelirse işbirliğine dönülür. ' +
      'Bilgi toplamanın bedeli vardır: her sonda, kurulmuş güvenden biraz eksiltir.',
    score: (m) => {
      const gate = m.coopRate > 0.55 && m.coopRate < 0.92 ? 1 : 0.3;
      return band(m.isolatedDefectionRate, 0.6, 0.95) * band(m.rounds > 0 ? 1 - m.coopRate : 0, 0.06, 0.3) * gate;
    },
  },
  {
    id: 'alternator',
    name: 'Dönek',
    tagline: 'Neredeyse her tur fikir değiştirdin.',
    description:
      'Hamlelerin turdan tura dönüşümlü ilerledi. Rakibin ne yaptığından çok kendi ritmini takip eden bu desen, ' +
      'karşı tarafın seni okumasını zorlaştırır — ama sana karşılıklı işbirliğinin istikrarlı 3 puanını da kaybettirir.',
    score: (m) => band(m.switchRate, 0.72, 0.95),
  },
];

const CHAOTIC = {
  id: 'chaotic',
  name: 'Kaotik',
  tagline: 'Hiçbir kalıba oturmadın.',
  description:
    'Hamlelerin ne rakibin davranışına ne de sabit bir kurala bağlıydı. Öngörülemez olmak seni sömürülmekten korur, ' +
    'ama rakibin sende güvenilecek bir örüntü bulamaması karşılıklı işbirliğinin kurulmasını da engeller.',
};

/** Metriklerden arketip seçimi + güven yüzdesi. */
export function classify(metrics) {
  const scored = ARCHETYPES.map((a) => ({ archetype: a, score: a.score(metrics) })).sort(
    (x, y) => y.score - x.score,
  );
  const best = scored[0];
  const runnerUp = scored[1];

  if (!best || best.score < 0.35) {
    return { ...CHAOTIC, confidence: 0.5, runnerUp: best?.archetype.name ?? null };
  }

  // Güven: mutlak uyumun yanı sıra ikinciyle arasındaki fark da hesaba katılır.
  const gap = best.score - (runnerUp?.score ?? 0);
  const confidence = Math.min(0.99, 0.5 + 0.35 * best.score + 0.3 * gap);

  return {
    id: best.archetype.id,
    name: best.archetype.name,
    tagline: best.archetype.tagline,
    description: best.archetype.description,
    confidence,
    runnerUp: runnerUp && runnerUp.score > 0.4 ? runnerUp.archetype.name : null,
  };
}

/** Sonuç ekranında gösterilecek metrik çubukları. */
function metricBars(m) {
  return [
    { label: 'İşbirliği eğilimi', value: m.coopRate },
    { label: 'Karşılık verme (misilleme)', value: m.retaliationRate },
    { label: 'Affedicilik', value: m.forgivenessRate },
    { label: 'Fırsatçılık', value: m.exploitationRate },
    { label: 'Kısasa Kısas benzerliği', value: m.tftSimilarity },
    { label: 'Öngörülemezlik', value: m.entropy * (0.4 + 0.6 * m.switchRate) },
  ];
}

/**
 * İkilinin uyumu: arketiplerden farklı olarak tek bir oyuncuyu değil,
 * ÇİFTİN ortak davranışını değerlendirir — ilişki metrikleri (karşılıklı
 * işbirliği/ret, sömürü dengesi) ve iki oyuncunun bağışlayıcılık/kin/sona
 * doğru değişim ortalamalarından çıkarılır.
 */
export function pairMetrics(relationship, totalRounds, mA, mB) {
  const n = Math.max(1, totalRounds);
  return {
    mutualCoopShare: relationship.mutualCoopRounds / n,
    mutualDefectShare: relationship.mutualDefectRounds / n,
    exploitationAsymmetry: Math.abs(relationship.exploitedBy[0] - relationship.exploitedBy[1]) / n,
    totalExploitShare: (relationship.exploitedBy[0] + relationship.exploitedBy[1]) / n,
    avgForgiveness: (mA.forgivenessRate + mB.forgivenessRate) / 2,
    avgGrudge: (Math.max(0, mA.grudgeScore) + Math.max(0, mB.grudgeScore)) / 2,
    avgEndgameShift: (mA.endgameShift + mB.endgameShift) / 2,
    minEndgameShift: Math.min(mA.endgameShift, mB.endgameShift),
    avgUnpredictability:
      (mA.entropy * (0.4 + 0.6 * mA.switchRate) + mB.entropy * (0.4 + 0.6 * mB.switchRate)) / 2,
    hadBetrayal: relationship.firstDefectionRound !== null,
  };
}

/**
 * Uyum profilleri. Her biri ilişki metriklerinden 0..1 arası bir uyum puanı
 * üretir; en yüksek puanlı kazanır. `predictions`, gerçek hayattaki olası
 * senaryolara dair, bu maçın gerçek sayılarına dayanan tahminler döner.
 */
const COMPATIBILITY_PROFILES = [
  {
    id: 'perfect-sync',
    name: 'Mükemmel Senkron',
    verdict: 'Neredeyse kusursuz bir uyum yakaladınız.',
    score: (pm) =>
      band(pm.mutualCoopShare, 0.68, 0.95) *
      band(1 - pm.avgGrudge, 0.7, 1) *
      band(1 - Math.max(0, -pm.avgEndgameShift), 0.6, 1),
    predictions: (pm) => [
      `Turların ${pct(pm.mutualCoopShare)}'inde ikiniz de aynı anda işbirliğini seçtiniz — iki yabancının rastgele eşleşmesinde ender rastlanan bir oran.`,
      'Uzun bir yol yolculuğuna çıksanız kararları birlikte alır, biriniz yorulduğunda diğeri yükü sessizce üstlenir.',
      'Ortak bir iş kursanız güven zaten hazır durumda — geriye sadece işin detaylarını konuşmak kalır.',
      'Bu uyumun sırrı basit: ikiniz de karşılıklı güveni bozmanın kısa vadeli kazançtan daha değerli olduğunu oyun boyunca gösterdiniz.',
    ],
  },
  {
    id: 'trust-partnership',
    name: 'Güvene Dayalı Ortaklık',
    verdict: 'Aranızda sağlam, işleyen bir güven kuruldu.',
    score: (pm) => {
      // Çok yüksek mutualCoopShare "Mükemmel Senkron"un alanı — burada geri çekil.
      const gate = pm.mutualCoopShare < 0.75 ? 1 : 0.25;
      return (
        gate *
        band(pm.mutualCoopShare, 0.32, 0.62) *
        band(pm.avgForgiveness, 0.3, 0.7) *
        band(1 - pm.avgGrudge, 0.3, 0.75)
      );
    },
    predictions: (pm) => [
      `Karşılıklı işbirliği oranınız ${pct(pm.mutualCoopShare)} — mükemmel değil ama net biçimde güven yönünde.`,
      'Uzun bir yolculuk ya da ortak bir proje makul bir risk sizin için; küçük sürtüşmeler çıksa da ilişkiyi yıkacak kadar büyümüyor.',
      'Bir iş ortaklığında kriz anında birbirinizi terk etmek yerine önce konuşmayı denersiniz.',
      'Zaman zaman temkinli davransanız da genel eğilim rakibe kredi tanımak yönünde.',
    ],
  },
  {
    id: 'fragile-trust',
    name: 'Kırılgan Güven',
    verdict: 'Bir kırılma yaşadınız ama tamamen kopmadınız.',
    score: (pm) => {
      const gate = pm.hadBetrayal ? 1 : 0.12;
      return (
        gate *
        band(pm.avgGrudge, 0.08, 0.35) *
        band(pm.avgForgiveness, 0.12, 0.6) *
        band(pm.mutualCoopShare, 0.12, 0.45)
      );
    },
    predictions: () => [
      'Aranızda en az bir ihanet yaşandı; işbirliği bir süre düştü ama sıfırlanmadı — kısmi bir toparlanma oldu.',
      'Kısa süreli, net kuralları olan bir işbirliği (tek seferlik bir görev gibi) şu an uzun soluklu bir ortaklıktan daha güvenli.',
      'Uzun bir yolculuğa çıkmadan önce aranızdaki o ilk kırılmayı konuşmanızda fayda var — telafi edilmemiş bir gerginlik hâlâ orada olabilir.',
      'Bir iş ortaklığı kurarsanız, kim ne zaman ne yapacak gibi net ve yazılı kurallar güveni yeniden oturtmanıza yardımcı olur.',
    ],
  },
  {
    id: 'imbalanced',
    name: 'Dengesiz İlişki',
    verdict: 'İlişki eşit şartlarda ilerlemedi.',
    score: (pm) => band(pm.exploitationAsymmetry, 0.05, 0.22) * band(pm.totalExploitShare, 0.12, 0.4),
    predictions: (pm) => [
      `Sömürünün büyük kısmı tek yönlüydü — turların ${pct(pm.totalExploitShare)}'i bir tarafın diğerinden çıkar sağladığı turlardı.`,
      'Bir iş ortaklığında bu dinamik tehlikeli: taraflardan biri sürekli veren, diğeri sürekli alan konumunda kalabilir.',
      'Uzun bir yolculukta kararları kim alıyor, masrafları kim karşılıyor gibi sorular önceden netleşmeli — aksi halde biri hep taviz veren taraf olur.',
      'Bu dengesizliği ikiniz de fark edip konuşursanız, ilişki çok daha sağlıklı bir zemine oturabilir.',
    ],
  },
  {
    id: 'mutual-hawks',
    name: 'Karşılıklı Şahin',
    verdict: 'İkiniz de büyük ölçüde temkinli ve kapalı kaldınız.',
    score: (pm) => band(pm.mutualDefectShare, 0.28, 0.7) * band(1 - pm.mutualCoopShare, 0.5, 0.9),
    predictions: (pm) => [
      `Turların ${pct(pm.mutualDefectShare)}'inde ikiniz de reddi seçtiniz — karşılıklı güvensizlik baskın strateji oldu.`,
      'Ortak bir iş ya da uzun bir yolculuk şu an için riskli görünüyor; ikiniz de önce kendi çıkarını gözetme refleksiyle hareket ediyor.',
      'Bu, kötü insanlar olduğunuz anlamına gelmez — ikiniz de aynı temkinli mantıkla oynadınız ve birbirinizi bu tuzağa kilitlediniz.',
      'Küçük, düşük riskli bir görevle başlayıp güveni adım adım inşa etmek, doğrudan büyük bir taahhüde girmekten daha mantıklı olur.',
    ],
  },
  {
    id: 'endgame-cooling',
    name: 'Sona Doğru Soğuma',
    verdict: 'İyi başladınız ama sona doğru soğudunuz.',
    score: (pm) => band(pm.mutualCoopShare, 0.25, 0.6) * band(-pm.minEndgameShift, 0.18, 0.55),
    predictions: () => [
      'Maçın büyük bölümünde işbirlikçiydiniz, ama son turlara doğru en az biriniz geri çekildi.',
      'Kısa vadeli, net bir bitiş çizgisi olan işler (bir haftalık proje, kısa bir tatil) sizin için sorun olmaz.',
      'Ama sonu belirsiz, uzun soluklu bir taahhütte (uzun bir yolculuk, süresiz bir ortaklık gibi) bitişe yaklaşırken gerginlik çıkabilir.',
      "Bunun sebebi kötü niyet değil — sona yaklaşıldığını hissetmenin doğal bir sonucu. Baştan bir 'çıkış planı' konuşmak işe yarayabilir.",
    ],
  },
  {
    id: 'unpredictable',
    name: 'Öngörülemez Eşleşme',
    verdict: 'Bir örüntü bulmak zor — davranışlarınız dalgalandı.',
    score: (pm) => band(pm.avgUnpredictability, 0.3, 0.65),
    predictions: () => [
      'Hamleleriniz turdan tura tutarlı bir kalıba oturmadı; birbirinizi okumakta zorlanmış olabilirsiniz.',
      'Uzun vadeli, yüksek riskli bir ortaklığa (uzun bir yolculuk, bir iş kurmak gibi) girmeden önce birbirinizi daha çok tanımanızda fayda var.',
      'Kısa, tekrar oynanabilir görevler öngörülemezliğin zararını sınırlı tutar.',
      'Zamanla birbirinizin tarzını öğrendikçe bu belirsizlik azalabilir — bu yalnızca tek bir maçın fotoğrafı.',
    ],
  },
];

const COMPATIBILITY_FALLBACK = {
  id: 'undetermined',
  name: 'Belirsiz Uyum',
  verdict: 'Net bir eğilim ortaya çıkmadı.',
  predictions: () => [
    'Bu maçtaki davranışlarınız yukarıdaki profillerden hiçbirine güçlü biçimde oturmadı.',
    'Daha uzun bir maç ya da başka bir eşleşme, aranızdaki dinamiği daha net ortaya çıkarabilir.',
    'Şimdilik büyük ortak taahhütlere (uzun bir yolculuk, bir iş ortaklığı) girmeden önce küçük, düşük riskli bir deneme yapmanız mantıklı olur.',
  ],
};

/** İlişki metriklerinden en iyi uyan uyum profilini + güven yüzdesini seçer. */
export function classifyCompatibility(pm) {
  const scored = COMPATIBILITY_PROFILES.map((p) => ({ profile: p, score: p.score(pm) })).sort(
    (x, y) => y.score - x.score,
  );
  const best = scored[0];
  const runnerUp = scored[1];

  if (!best || best.score < 0.3) {
    return {
      id: COMPATIBILITY_FALLBACK.id,
      name: COMPATIBILITY_FALLBACK.name,
      verdict: COMPATIBILITY_FALLBACK.verdict,
      predictions: COMPATIBILITY_FALLBACK.predictions(pm),
      confidence: 0.45,
      runnerUp: best?.profile.name ?? null,
    };
  }

  const gap = best.score - (runnerUp?.score ?? 0);
  const confidence = Math.min(0.99, 0.5 + 0.35 * best.score + 0.3 * gap);

  return {
    id: best.profile.id,
    name: best.profile.name,
    verdict: best.profile.verdict,
    predictions: best.profile.predictions(pm),
    confidence,
    runnerUp: runnerUp && runnerUp.score > 0.4 ? runnerUp.profile.name : null,
  };
}

/**
 * Maçın tamamını analiz eder.
 * history: [{ round, moves: [p0, p1], points: [p0, p1] }]
 * players: [{ nickname, score }]
 */
export function analyzeMatch(history, players) {
  const moves = [history.map((h) => h.moves[0]), history.map((h) => h.moves[1])];
  const n = history.length;

  const playerReports = [0, 1].map((i) => {
    const metrics = playerMetrics(moves[i], moves[1 - i]);
    return {
      nickname: players[i].nickname,
      score: players[i].score,
      metrics,
      bars: metricBars(metrics),
      archetype: classify(metrics),
    };
  });

  // İlişki düzeyi
  let mutualCoop = 0;
  let mutualDefect = 0;
  const exploitedBy = [0, 0]; // exploitedBy[i] = i'nin rakibi sömürdüğü tur sayısı
  for (const h of history) {
    const [a, b] = h.moves;
    if (a === COOPERATE && b === COOPERATE) mutualCoop++;
    else if (a === DEFECT && b === DEFECT) mutualDefect++;
    else if (a === DEFECT) exploitedBy[0]++;
    else exploitedBy[1]++;
  }

  const firstDefectionRound = history.findIndex((h) => h.moves.includes(DEFECT));
  let firstDefector = null;
  if (firstDefectionRound !== -1) {
    const m = history[firstDefectionRound].moves;
    firstDefector =
      m[0] === DEFECT && m[1] === DEFECT ? 'both' : m[0] === DEFECT ? 0 : 1;
  }

  const totalScored = players[0].score + players[1].score;
  const bestPossibleTogether = 2 * PAYOFF.R * n;

  const relationship = {
    mutualCoopRounds: mutualCoop,
    mutualDefectRounds: mutualDefect,
    exploitedBy,
    firstDefectionRound: firstDefectionRound === -1 ? null : firstDefectionRound + 1,
    firstDefector,
    longestTrustStreak: Math.max(
      playerReports[0].metrics.longestMutualCoop,
      playerReports[1].metrics.longestMutualCoop,
    ),
    totalScored,
    bestPossibleTogether,
    efficiency: bestPossibleTogether === 0 ? 0 : totalScored / bestPossibleTogether,
    pointsBurned: bestPossibleTogether - totalScored,
  };

  const compatibility = classifyCompatibility(
    pairMetrics(relationship, n, playerReports[0].metrics, playerReports[1].metrics),
  );

  return {
    totalRounds: n,
    players: playerReports,
    relationship,
    compatibility,
  };
}

export { scoreRound };
