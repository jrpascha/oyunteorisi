/**
 * Tarayıcı doğrulaması: sistemdeki Chrome ile iki gerçek sekme açar,
 * biri oyunu kurar, diğeri davet bağlantısından katılır, birkaç tur oynanır,
 * sayfa yenilenip oturumun geri geldiği görülür ve maç sonuna kadar oynanır.
 *
 * Çalıştır: npm run browser-check
 * Ekran görüntüleri: screenshots/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.join(__dirname, '..', 'screenshots');
const PORT = process.env.SIM_PORT || 4010;
process.env.PORT = PORT;
process.env.LEADERBOARD_DB = ':memory:'; // gerçek data/leaderboard.db'ye asla yazma

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) {
  console.error('✖ Chrome/Edge bulunamadı. CHROME_PATH ortam değişkenini ayarla.');
  process.exit(1);
}

const { server, io, leaderboard } = await import('../server/index.js');
const URL = `http://localhost:${PORT}`;
fs.mkdirSync(SHOT_DIR, { recursive: true });

const problems = [];
const shot = (page, name) => page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());
const visible = (page, sel) =>
  page.$eval(sel, (el) => !el.classList.contains('hidden')).catch(() => false);

const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1100,900'],
});

function watchConsole(page, label) {
  page.on('pageerror', (err) => problems.push(`${label} sayfa hatası: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`${label} konsol hatası: ${msg.text()}`);
  });
}

/**
 * Her oyuncu için ayrı tarayıcı bağlamı: localStorage'lar karışmasın.
 * (Aynı tarayıcıda kendi davet linkini açan kişi zaten aynı oyuncudur.)
 */
async function newPage(label) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1100, height: 900 });
  watchConsole(page, label);
  return page;
}

/** Seçim butonları tıklanabilir hale gelene kadar bekler. */
const waitForChoices = (page) =>
  page.waitForFunction(
    () =>
      !document.getElementById('screen-match').classList.contains('hidden') &&
      !document.getElementById('choices').classList.contains('hidden') &&
      !document.getElementById('btn-coop').disabled,
    { timeout: 15000 },
  );

const step = (msg) => console.log('  · ' + msg);

/** OTSound.click/coop/defect'i sayaca çevirir; gerçek Web Audio çağrısını atlar. */
async function instrumentSound(page) {
  await page.evaluate(() => {
    window.__soundCalls = { click: 0, coop: 0, defect: 0 };
    ['click', 'coop', 'defect'].forEach((k) => {
      window.OTSound[k] = () => {
        window.__soundCalls[k]++;
      };
    });
  });
}
const soundCalls = (page) => page.evaluate(() => window.__soundCalls);

// ---------- 1. Oyun kurulumu ----------

const host = await newPage('Kuran');
await host.goto(URL, { waitUntil: 'networkidle0' });
await shot(host, '01-acilis');

// Açılış sade olmalı: iki menü düğmesi, panelller kapalı.
const landing = await host.evaluate(() => ({
  title: document.querySelector('.title').textContent.trim(),
  startHidden: document.getElementById('start-panel').classList.contains('hidden'),
  howHidden: document.getElementById('how-panel').classList.contains('hidden'),
  bodyText: document.body.innerText,
}));
if (landing.title.toLocaleUpperCase('tr') !== 'OYUN TEORİSİ') {
  problems.push(`Açılış başlığı "Oyun Teorisi" olmalı, bulunan: ${landing.title}`);
}
if (!landing.startHidden || !landing.howHidden) problems.push('Açılışta paneller kapalı olmalı');
if (/mahkûm|mahkum/i.test(landing.bodyText)) problems.push('Açılışta "Mahkûm İkilemi" hâlâ geçiyor');

// ---------- 1b. Ses aç/kapa düğmesi ----------

const initiallyMuted = await host.evaluate(() => window.OTSound.isMuted());
if (initiallyMuted) problems.push('Ses varsayılan olarak açık gelmeli');

await host.click('.sound-toggle');
if (!(await host.evaluate(() => window.OTSound.isMuted()))) {
  problems.push('Ses kapatma düğmesi durumu değiştirmedi');
}
if (!(await host.$eval('.sound-toggle', (el) => el.classList.contains('is-muted')))) {
  problems.push('Ses kapatıldığında düğme görsel olarak güncellenmiyor');
}

await host.reload({ waitUntil: 'networkidle0' });
if (!(await host.evaluate(() => window.OTSound.isMuted()))) {
  problems.push('Ses tercihi sayfa yenilenince kayboluyor');
}
await host.click('.sound-toggle'); // sonraki adımlar için tekrar aç
step('Ses aç/kapa düğmesi durumu değiştiriyor ve yenilemede kalıcı');

// ---------- 1c. Genel tıklama sesi ----------

await instrumentSound(host);
await host.click('#show-how');
await host.waitForSelector('#how-panel:not(.hidden)', { timeout: 5000 });
await shot(host, '02-nasil-oynanir');
if ((await soundCalls(host)).click !== 1) {
  problems.push(`"Nasıl oynanır" tıklaması tam olarak bir kez ses çalmalı, sayı: ${(await soundCalls(host)).click}`);
}
step('"Nasıl oynanır" paneli açıldı, tıklama sesi bir kez çaldı');

// ---------- 1d. Oyunun amacı ----------

await host.click('#show-purpose');
await host.waitForSelector('#purpose-panel:not(.hidden)', { timeout: 5000 });
if (await visible(host, '#how-panel')) problems.push('"Oyunun amacı" açılınca önceki panel kapanmadı');

const purposeText = await text(host, '#purpose-panel');
if (/mahkûm|mahkum/i.test(purposeText)) {
  problems.push('"Oyunun amacı" panelinde oyunun adı (mahkûm ikilemi) geçiyor, geçmemeli');
}
if (!/kendi (toplam )?puan/i.test(purposeText) || !/rakib/i.test(purposeText)) {
  problems.push('"Oyunun amacı" paneli temel hatırlatmayı içermiyor gibi görünüyor');
}
await shot(host, '02b-oyunun-amaci');
step('"Oyunun amacı" paneli açıldı, oyunun adını sızdırmadı');

await host.click('#show-start');
await host.waitForSelector('#start-panel:not(.hidden)', { timeout: 5000 });
if (await visible(host, '#how-panel')) problems.push('İki panel aynı anda açık kaldı');

// Varsayılan uzunluk "Orta" işaretli gelmeli.
const defaultPreset = await host.$eval('input[name="preset"]:checked', (el) => el.value);
if (defaultPreset !== 'medium') problems.push(`Varsayılan uzunluk "Orta" olmalı, bulunan: ${defaultPreset}`);

// "Kısa"yı seç: hem seçim arayüzünü sınar hem maçı hızlı bitirir (10–20 tur).
// Sayacı burada sıfırla: etiket (label) tıklaması, sarmaladığı radio'ya sentetik
// bir click daha yollar — ikisi de sayılırsa ses çifte çalar, tek olmalı.
await instrumentSound(host);
await host.click('.duration-card:has(input[value="short"])');
const selectedPreset = await host.$eval('input[name="preset"]:checked', (el) => el.value);
if (selectedPreset !== 'short') problems.push('Kısa uzunluk seçilemedi');
const cardHighlighted = await host.$eval(
  '.duration-card:has(input[value="short"])',
  (el) => el.classList.contains('is-selected'),
);
if (!cardHighlighted) problems.push('Seçilen uzunluk kartı görsel olarak vurgulanmıyor');
const durationClickCount = (await soundCalls(host)).click;
if (durationClickCount !== 1) {
  problems.push(`Uzunluk kartı tıklaması tam olarak bir kez ses çalmalı, sayı: ${durationClickCount}`);
}
step(`Kısa uzunluk seçildi, tıklama sesi ${durationClickCount} kez çaldı`);

await host.type('#nickname', 'Alice');
await shot(host, '03-oyuna-basla');
await Promise.all([host.waitForNavigation({ waitUntil: 'networkidle0' }), host.click('#create')]);

const inviteUrl = await host.$eval('#invite-link', (el) => el.value);
if (!/\/g\/[2-9A-HJ-NP-Z]{6}$/.test(inviteUrl)) {
  problems.push(`Davet bağlantısı beklenen biçimde değil: ${inviteUrl}`);
}
const lobbyPresetText = await text(host, '#lobby-preset');
if (!lobbyPresetText.includes('Kısa') || !lobbyPresetText.includes('10')) {
  problems.push(`Lobide seçilen uzunluk doğru görünmüyor: "${lobbyPresetText}"`);
}
await shot(host, '04-lobi');
step(`Lobi kuruldu (${lobbyPresetText}), davet bağlantısı: ${inviteUrl}`);

// ---------- 2. Rakip katılıyor ----------

const guest = await newPage('Katılan');
await guest.goto(inviteUrl, { waitUntil: 'networkidle0' });
await instrumentSound(guest);
await guest.waitForSelector('#screen-join:not(.hidden)');

// Katılmadan önce davetin uzunluğunu ve kurucunun adını görmeli — ama tur sayısını değil.
const joinLede = await text(guest, '#join-lede');
if (!joinLede.includes('Alice') || !joinLede.includes('Kısa')) {
  problems.push(`Katılma ekranı davet bilgisini göstermiyor: "${joinLede}"`);
}
// Ön ayarın aralığını taşıyan parantezi çıkarınca geride başka bir sayı kalmamalı.
if (/\d/.test(joinLede.replace(/\([^)]*\)/g, ''))) {
  problems.push(`Katılma ekranı gerçek tur sayısını sızdırıyor olabilir: "${joinLede}"`);
}
await shot(guest, '05-davet');
await guest.type('#join-nickname', 'Elif');
await guest.click('#join');

await Promise.all([waitForChoices(host), waitForChoices(guest)]);
step('İki oyuncu da maç ekranında');

if ((await text(host, '#opp-name')) !== 'Elif') problems.push('Kuran, rakibin adını görmüyor');
if ((await text(guest, '#opp-name')) !== 'Alice') problems.push('Katılan, rakibin adını görmüyor');
if ((await text(host, '#my-score')) !== '0') problems.push('Başlangıç puanı 0 değil');

// Rakibin puanı hiçbir yerde geçmemeli
const matchHtml = await host.$eval('#screen-match', (el) => el.innerHTML);
if (/Rakibin puanı|opponent.*score/i.test(matchHtml)) {
  problems.push('Maç ekranında rakibin puanı görünüyor');
}

// ---------- 3. Kilitlenme ve açılım ----------

// Host bu noktada bir kez tam sayfa yenilendi (lobiden maça), tarayıcı durumu
// sıfırlandı — işbirliği/ret sesini ayrı ayrı sınamak için sayacı yeniden kur.
await instrumentSound(host);
await host.click('#btn-coop');
await host.waitForFunction(
  () => document.getElementById('btn-coop').classList.contains('is-picked'),
  { timeout: 5000 },
);
if (!(await host.$eval('#btn-defect', (el) => el.disabled))) {
  problems.push('Seçim yapıldıktan sonra diğer seçenek hâlâ tıklanabilir');
}
const hostSoundAfterCoop = await soundCalls(host);
if (hostSoundAfterCoop.coop !== 1 || hostSoundAfterCoop.click !== 0 || hostSoundAfterCoop.defect !== 0) {
  problems.push(`İşbirliği seçiminde yanlış ses çaldı: ${JSON.stringify(hostSoundAfterCoop)}`);
}
await shot(host, '06-secim-kilitlendi');
step(`Seçim kilitlendi, diğer seçenek devre dışı, işbirliği sesi çaldı`);

await guest.waitForFunction(
  () => document.getElementById('prompt').textContent.includes('Rakip seçimini yaptı'),
  { timeout: 5000 },
);
step('Rakibe "seçimini yaptı" bilgisi ulaştı (hangi seçim olduğu değil)');

await guest.click('#btn-defect');
const guestSoundAfterDefect = await soundCalls(guest);
if (guestSoundAfterDefect.defect !== 1 || guestSoundAfterDefect.coop !== 0) {
  problems.push(`Ret seçiminde yanlış ses çaldı: ${JSON.stringify(guestSoundAfterDefect)}`);
}
await host.waitForSelector('#reveal:not(.hidden)', { timeout: 5000 });
await shot(host, '07-acilim');
step('Ret seçiminde farklı bir ses çaldı');

const revealedPoints = await text(host, '#reveal-you-points');
const revealedOpp = await text(host, '#reveal-opp-move');
if (revealedPoints !== '+0') problems.push(`İşbirliği-Ret turunda puan +0 olmalı, gelen: ${revealedPoints}`);
if (revealedOpp !== 'Ret') problems.push(`Rakibin hamlesi "Ret" olmalı, gelen: ${revealedOpp}`);
step(`Açılım doğru: sen İşbirliği (${revealedPoints}), rakip ${revealedOpp}`);

// ---------- 4. Otomatik sonraki tur ve geçmiş şeridi ----------

await Promise.all([waitForChoices(host), waitForChoices(guest)]);
step('2 saniye sonra yeni tur otomatik açıldı');

const stripInfo = await host.evaluate(() => ({
  columns: document.querySelectorAll('#strip .strip-col').length,
  filled: document.querySelectorAll('#strip .strip-col:not(.is-empty)').length,
  note: document.getElementById('window-note').textContent,
}));
if (stripInfo.columns !== 5) problems.push(`Şeritte 5 yuva olmalı, bulunan: ${stripInfo.columns}`);
if (stripInfo.filled !== 1) problems.push(`1 tur dolu olmalı, bulunan: ${stripInfo.filled}`);
if (!stripInfo.note.includes('5')) problems.push(`Pencere notu yanlış: ${stripInfo.note}`);
step(`Geçmiş şeridi: ${stripInfo.columns} yuva, ${stripInfo.filled} dolu — "${stripInfo.note}"`);

// Maç ekranı tek ekrana sığmalı: şerit görünür alanın altından taşmamalı.
const stripOverflow = await host.evaluate(() =>
  Math.round(document.querySelector('.history').getBoundingClientRect().bottom - window.innerHeight),
);
if (stripOverflow > 0) problems.push(`Geçmiş şeridi ekranın ${stripOverflow}px altında kalıyor`);

// ---------- 5. Sayfa yenilendiğinde oturum geri geliyor mu ----------

await host.reload({ waitUntil: 'networkidle0' });
await waitForChoices(host);
const scoreAfterReload = await text(host, '#my-score');
const filledAfterReload = await host.$$eval('#strip .strip-col:not(.is-empty)', (n) => n.length);
if (filledAfterReload !== 1) problems.push('Yenilemeden sonra geçmiş kayboldu');
step(`Sayfa yenilendi, oturum geri geldi (puan ${scoreAfterReload}, geçmiş ${filledAfterReload} tur)`);
await shot(host, '08-yenileme-sonrasi');

// ---------- 6. Maçı sonuna kadar oynat ----------

/** Bir sekmede seçim yapılabiliyorsa tıklar. */
async function playRound(page, choice) {
  await waitForChoices(page);
  await page.click(choice === 'C' ? '#btn-coop' : '#btn-defect');
}

const isFinished = (page) => visible(page, '#screen-result');

let round = 1;
while (round < 30 && !(await isFinished(host))) {
  // Alice çoğunlukla işbirlikçi, Elif ara ara ret çeker — analiz için ayırt edici desen.
  const aliceMove = round % 17 === 0 ? 'D' : 'C';
  const elifMove = round % 4 === 0 ? 'D' : 'C';
  try {
    await Promise.all([playRound(host, aliceMove), playRound(guest, elifMove)]);
  } catch {
    break; // maç bitti, seçim ekranı bir daha açılmadı
  }
  round++;
}

await host.waitForSelector('#screen-result:not(.hidden)', { timeout: 20000 });
await guest.waitForSelector('#screen-result:not(.hidden)', { timeout: 20000 });
step(`Maç ${round} turda bitti ve sonuç ekranı açıldı`);

// ---------- 7. Sonuç ekranı ----------

const result = await host.evaluate(() => ({
  summary: document.getElementById('result-summary').textContent,
  personaCount: document.querySelectorAll('.persona').length,
  personaNames: [...document.querySelectorAll('.persona-name')].map((e) => e.textContent),
  statCount: document.querySelectorAll('#relationship .stat').length,
  chartPaths: document.querySelectorAll('#chart svg path').length,
  historyCols: document.querySelectorAll('#full-history .fh-col').length,
  turning: document.getElementById('turning-points').textContent,
  finalScores: [...document.querySelectorAll('.final-score .pts')].map((e) => e.textContent),
}));

const totalFromSummary = Number(result.summary.match(/^(\d+)/)?.[1]);
if (!(totalFromSummary >= 10 && totalFromSummary <= 20)) {
  problems.push(`"Kısa" maçın tur sayısı 10–20 dışında: ${result.summary}`);
}
if (result.personaCount !== 2) problems.push('İki kişilik kartı bekleniyordu');
if (result.statCount !== 8) problems.push(`İlişki kutusu sayısı 8 olmalı, bulunan: ${result.statCount}`);
if (result.chartPaths !== 2) problems.push('Grafikte iki çizgi bekleniyordu');
if (result.historyCols !== totalFromSummary) {
  problems.push(`Tam geçmiş ${totalFromSummary} sütun olmalı, bulunan: ${result.historyCols}`);
}

await shot(host, '09-sonuc');
await host.evaluate(() => document.getElementById('relationship').scrollIntoView());
await shot(host, '10-iliski-ozeti');
await host.evaluate(() => document.getElementById('chart').scrollIntoView());
await shot(host, '11-puan-grafigi');
await host.evaluate(() => document.getElementById('full-history').scrollIntoView());
await shot(host, '12-tum-turlar');

step(`Toplam tur ilk kez açıklandı: ${totalFromSummary}`);
step(`Arketipler: ${result.personaNames.join(' / ')}`);
step(`Puanlar: ${result.finalScores.join(' — ')}`);
step(`Dönüm noktaları: ${result.turning}`);

// ---------- 8. Bitmiş maça geri dönüş ----------

await host.reload({ waitUntil: 'networkidle0' });
await host.waitForSelector('#screen-result:not(.hidden)', { timeout: 15000 });
const summaryAfterReload = await text(host, '#result-summary');
if (summaryAfterReload !== result.summary) {
  problems.push('Yenilemeden sonra sonuç ekranı aynı dökümü göstermiyor');
}
if (await visible(host, '#screen-match')) {
  problems.push('Bitmiş maça dönüşte maç ekranı görünüyor');
}
step('Bitmiş maç yenilendi, sonuç ekranı doğrudan geri geldi');

// ---------- 9. Mobil genişlik ----------

await host.setViewport({ width: 390, height: 844 });
await host.evaluate(() => window.scrollTo(0, 0));
await shot(host, '13-mobil-sonuc');

const overflow = await host.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (overflow > 1) problems.push(`Mobil genişlikte sayfa yatay taşıyor (${overflow}px)`);

const mobile = await newPage('Mobil');
await mobile.setViewport({ width: 390, height: 844 });
await mobile.goto(URL, { waitUntil: 'networkidle0' });

// Takma ad alanına odaklanma sayfayı kaydırmamalı; kullanıcı en üstten başlamalı.
const homeScroll = await mobile.evaluate(() => window.scrollY);
if (homeScroll > 0) problems.push(`Giriş sayfası açılışta ${homeScroll}px kaydırılmış`);

await shot(mobile, '14-mobil-acilis');
const homeOverflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (homeOverflow > 1) problems.push(`Giriş sayfası mobilde yatay taşıyor (${homeOverflow}px)`);

// Uzunluk kartları mobilde tek sütuna düşüp taşmasız görünmeli.
await mobile.click('#show-start');
await mobile.waitForSelector('#start-panel:not(.hidden)', { timeout: 5000 });
await shot(mobile, '15-mobil-uzunluk-secimi');
const durationOverflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (durationOverflow > 1) problems.push(`Uzunluk seçimi mobilde yatay taşıyor (${durationOverflow}px)`);
step(
  `Mobil genişlikte yatay taşma yok (sonuç ${overflow}px, giriş ${homeOverflow}px, uzunluk ${durationOverflow}px)`,
);

// ---------- 10. Dünya çapında eşleşme ----------

const worldA = await newPage('DünyaA');
const worldB = await newPage('DünyaB');

await worldA.goto(URL, { waitUntil: 'networkidle0' });
await worldB.goto(URL, { waitUntil: 'networkidle0' });

await worldA.click('#show-world');
await worldA.waitForSelector('#world-panel:not(.hidden)', { timeout: 5000 });
await worldA.type('#world-nickname', 'Zeynep');
await worldA.click('#find-match');
await worldA.waitForSelector('#world-waiting:not(.hidden)', { timeout: 5000 });
await shot(worldA, '16-dunya-araniyor');
step('İlk oyuncu kuyrukta "aranıyor" durumunda');

// Bu modda uzunluk seçimi olmamalı — sabit "uzun". Sayfa henüz maça geçmeden kontrol et.
const worldPanelHtml = await worldA.$eval('#world-panel', (el) => el.innerHTML);
if (/duration-card/.test(worldPanelHtml)) {
  problems.push('Dünya çapında oyna panelinde uzunluk seçimi görünüyor, sabit olmalı');
}

await worldB.click('#show-world');
await worldB.waitForSelector('#world-panel:not(.hidden)', { timeout: 5000 });
await worldB.type('#world-nickname', 'Kerem');
await worldB.click('#find-match');

await Promise.all([
  worldA.waitForFunction(() => location.pathname.startsWith('/g/'), { timeout: 10000 }),
  worldB.waitForFunction(() => location.pathname.startsWith('/g/'), { timeout: 10000 }),
]);
step('İkinci oyuncu katılınca ikisi de otomatik maç sayfasına yönlendirildi');

// Not: bu dosyadaki `URL` adı zaten sunucu adresini tutan sabit için kullanılıyor
// (yukarıda), o yüzden global URL sınıfı yerine basit bir yol karşılaştırması yapılıyor.
const pathOf = (fullUrl) => fullUrl.replace(/^https?:\/\/[^/]+/, '');
const [urlA, urlB] = await Promise.all([worldA.url(), worldB.url()]);
if (pathOf(urlA) !== pathOf(urlB)) {
  problems.push(`İki oyuncu farklı maça düşmüş: ${urlA} vs ${urlB}`);
}

await Promise.all([waitForChoices(worldA), waitForChoices(worldB)]);
step('Lobi ekranı hiç görünmeden doğrudan maç ekranına düşüldü');

await shot(worldA, '17-dunya-mac');

// Maçı hızlıca bitirmek yerine sadece eşleşmenin ve sıralama sayfasının doğru
// çalıştığını doğrulamak yeterli — "uzun" 80-90 tur sürer, browser-check'i
// gereksiz uzatmamak için maçı burada yarıda bırakıyoruz.

await worldA.goto(`${URL}/siralama`, { waitUntil: 'networkidle0' });
await worldA.waitForSelector('#board-wrap:not(.hidden), #error:not(.hidden)', { timeout: 10000 });
const leaderboardOk = await visible(worldA, '#board-wrap');
if (!leaderboardOk) problems.push('Sıralama sayfası tabloyu göstermedi');

const emptyStateShown = await visible(worldA, '#empty-note');
if (!emptyStateShown) problems.push('Hiç maç bitmemişken boş durum notu görünmeli');
await shot(worldA, '18-siralama-bos');
step('/siralama sayfası açılıp boş durumu doğru gösterdi');

// Dolu tablo görünümünü de doğrula — gerçek maç oynatmadan (uzun mod 80-90 tur
// sürer), doğrudan leaderboard modülüne birkaç sonuç yazarak. Her recordMatch
// çağrısı iki ayrı oyuncu (A ve B) ekler.
const MATCH_COUNT = 5;
for (let i = 0; i < MATCH_COUNT; i++) {
  leaderboard.recordMatch({
    worldIdA: `preview-a${i}`,
    nicknameA: `Oyuncu${i}A`,
    scoreA: 200 + i * 10,
    worldIdB: `preview-b${i}`,
    nicknameB: `Oyuncu${i}B`,
    scoreB: 150,
  });
}
await worldA.reload({ waitUntil: 'networkidle0' });
await worldA.waitForSelector('#board tbody tr', { timeout: 10000 });
const rowCount = await worldA.$$eval('#board tbody tr', (rows) => rows.length);
const expectedRows = MATCH_COUNT * 2;
if (rowCount !== expectedRows) {
  problems.push(`Dolu tabloda ${expectedRows} satır bekleniyordu, bulunan: ${rowCount}`);
}
await shot(worldA, '19-siralama-dolu');
step(`Dolu sıralama tablosu ${rowCount} satırla göründü`);

// "Sen" satırının vurgulanması: worldA'nın gerçek (localStorage'daki) kimliğine
// bir sonuç yazıp tablonun kendi satırını işaretlediğini doğrula.
const ownWorldId = await worldA.evaluate(() => localStorage.getItem('gt:worldId'));
leaderboard.recordMatch({
  worldIdA: ownWorldId,
  nicknameA: 'Zeynep',
  scoreA: 300,
  worldIdB: 'preview-filler',
  nicknameB: 'Dolgu',
  scoreB: 100,
});
await worldA.reload({ waitUntil: 'networkidle0' });
await worldA.waitForSelector('#board tbody tr.is-you', { timeout: 10000 });
const ownRowText = await worldA.$eval('#board tbody tr.is-you', (el) => el.textContent);
if (!ownRowText.includes('Zeynep') || !ownRowText.includes('sen')) {
  problems.push(`"Sen" satırı beklenen içeriği taşımıyor: "${ownRowText}"`);
}
await shot(worldA, '20-siralama-sen-vurgusu');
step('Kendi satırın tabloda "(sen)" etiketiyle vurgulandı');

// ---------- 11. Takma ad benzersizliği ----------

const nickCheck = await newPage('AdKontrol');
await nickCheck.goto(URL, { waitUntil: 'networkidle0' });
await nickCheck.click('#show-start');
await nickCheck.waitForSelector('#start-panel:not(.hidden)', { timeout: 5000 });

// Bu taze bağlamın kendi worldId'si var ama "Alice" adı zaten host'a (bölüm 1) ait.
await nickCheck.type('#nickname', 'Alice');
await nickCheck.click('#create');
await nickCheck.waitForSelector('#error:not(.hidden)', { timeout: 5000 });
const takenErrorText = await text(nickCheck, '#error');
if (!/Alice/.test(takenErrorText)) {
  problems.push(`Alınmış ad hatası "Alice"den söz etmiyor: "${takenErrorText}"`);
}
await shot(nickCheck, '21-ad-alinmis-hatasi');
// Not: bu dosyada `URL` sunucu adresini tutan sabit için kullanılıyor, o yüzden
// global URL sınıfı yerine doğrudan location.pathname okunuyor.
if ((await nickCheck.evaluate(() => location.pathname)) !== '/') {
  problems.push('Alınmış adla oyun kurulduğu halde sayfa yönlendirilmiş');
}
step(`Alınmış ad reddedildi: "${takenErrorText}"`);

// Farklı, boş bir adla dener — başarmalı.
await nickCheck.evaluate(() => {
  document.getElementById('nickname').value = '';
});
await nickCheck.type('#nickname', 'BcOyuncu1');
await Promise.all([nickCheck.waitForNavigation({ waitUntil: 'networkidle0' }), nickCheck.click('#create')]);
if (!(await nickCheck.url()).includes('/g/')) {
  problems.push('Boş bir adla oyun kurulamadı');
}
step('Boş bir adla oyun kurma başarılı');

// Yeniden adlandırma: aynı tarayıcı (aynı worldId) farklı bir ad yazıp tekrar
// oyun kurarsa, bu sessizce bir yeniden adlandırma olmalı — hata vermemeli.
await nickCheck.goto(URL, { waitUntil: 'networkidle0' });
await nickCheck.click('#show-start');
await nickCheck.waitForSelector('#start-panel:not(.hidden)', { timeout: 5000 });
const prefilled = await nickCheck.$eval('#nickname', (el) => el.value);
if (prefilled !== 'BcOyuncu1') {
  problems.push(`Takma ad alanı son kullanılan adla dolu gelmeli, gelen: "${prefilled}"`);
}
await nickCheck.evaluate(() => {
  document.getElementById('nickname').value = '';
});
await nickCheck.type('#nickname', 'BcOyuncu2');
await Promise.all([nickCheck.waitForNavigation({ waitUntil: 'networkidle0' }), nickCheck.click('#create')]);
if (!(await nickCheck.url()).includes('/g/')) {
  problems.push('Sahibi kendi adını serbestçe değiştiremedi');
}
step('Aynı oyuncu farklı bir ad yazınca sorunsuz yeniden adlandırdı');

await browser.close();
io.close();
leaderboard.close();
server.close();

console.log('');
if (problems.length) {
  console.error('✖ Tarayıcı doğrulaması başarısız:');
  problems.forEach((p) => console.error('   - ' + p));
  process.exitCode = 1;
} else {
  console.log(`✔ Tarayıcı doğrulaması temiz — ekran görüntüleri: screenshots/`);
}
// process.exit() kasıtlı olarak çağrılmıyor: node:sqlite'ın native handle'ı
// Windows'ta abrupt exit ile çakışıyor (UV_HANDLE_CLOSING assertion). Tüm
// handle'lar kapandıktan sonra Node event loop'u kendiliğinden boşalıp çıkar.
