# Oyun Teorisi

İki kişinin bir bağlantı üzerinden karşı karşıya geldiği, çok turlu bir strateji oyunu.
Maçın sonunda her oyuncunun tur geçmişinden strateji ve kişilik analizi çıkarılır.

Oyunun altındaki model, oyun teorisinin klasik *tekrarlı mahkûm ikilemi* kurgusudur; bu terim
kasıtlı olarak arayüzde geçmez, oyuncu yalnızca "işbirliği / ret" kararıyla karşılaşır.

## Çalıştırma

```bash
npm install
npm start          # http://localhost:3000
```

İki oyun modu var:

- **Oyuna Başla** — takma adını yaz, maç uzunluğunu seç, **Bağlantı Oluştur**. Çıkan
  bağlantıyı rakibine (arkadaşına) gönder; o bağlantıyı açıp katılınca maç kendiliğinden
  başlar.
- **Dünya Çapında Oyna** — takma adını yaz, **Eşleşme Ara**. Sunucu seni bekleyen başka bir
  oyuncuyla eşleştirir; rakibin kim olacağını seçemezsin. Bu modda uzunluk sabittir (Uzun,
  80–90 tur) ve sonucun [dünya sıralamasına](#dünya-sıralaması) yansır.

## Maç uzunluğu

Oyunu kuran taraf üç ön ayardan birini seçer; gerçek tur sayısı seçilen aralıkta rastgele
üretilir ve maç bitene kadar iki oyuncuya da söylenmez. Rakip, katılmadan önce yalnızca
seçilen kategoriyi görür (ör. "Kısa (10–20 tur)") — kesin sayıyı değil.

| Ön ayar | Aralık | Avantaj | Dezavantaj |
|---|---|---|---|
| Kısa | 10–20 tur | Hızlı biter, tek oturumda kolayca tamamlanır | Güven kurmaya vakit yok; bir erken hata maçı belirler |
| Orta | 40–50 tur | Strateji kurmaya ve rakibi okumaya yeter | Kısa kadar hızlı, uzun kadar derin değil |
| Uzun | 80–90 tur | Güven gerçekten sınanır, oyun tarzı netleşir | Sürer; tek oturumda bitirmek zaman ister |

Ön ayarlar tek yerde tanımlıdır: [`server/gameLogic.js`](server/gameLogic.js) içindeki
`ROUND_PRESETS`.

> Aynı tarayıcıda kendi davet bağlantını açarsan sistem seni aynı oyuncu sayar (oturum
> `localStorage`'da tutulur). Tek makinede denemek için ikinci sekmeyi **gizli pencerede** aç.

## Takma adlar

Bir takma ad bir kez alındı mı senindir — **hem özel maçlarda hem Dünya Çapında Oyna'da**.
Başka biri aynı adı (büyük/küçük harf farkı sayılmaz, Türkçe İ/I/ı/i kurallarına göre) alamaz;
sen istediğin zaman değiştirebilirsin — yeni bir ad yazıp göndermen yeterli, eski adın serbest
kalır. Sahiplik, tarayıcına yazılan anonim kimliğe bağlıdır (bkz. [Dünya sıralaması](#dünya-sıralaması));
hesap/şifre yok. Ad alınmışsa oda kurma/katılma/eşleşme arama işlemi mevcut hata kutusunda net
bir mesajla reddedilir. Kural tek yerde: [`server/nickname.js`](server/nickname.js).

## Oyunun kuralları

| | Rakip: İşbirliği | Rakip: Ret |
|---|---|---|
| **Sen: İşbirliği** | 3 / 3 | 0 / 5 |
| **Sen: Ret** | 5 / 0 | 1 / 1 |

- Seçim yapıldığı anda kilitlenir; rakip de seçene kadar hiçbir şekilde karşı tarafa gösterilmez.
- İkisi de seçince sonuç açılır, 2 saniye görünür, sonraki tur otomatik başlar.
- Maç **80–100 arası rastgele** bir tur sürer ve bu sayı oyunculara söylenmez.
- Oyuncu **yalnızca kendi** toplam puanını görür.
- Geçmişten yalnızca son birkaç tur görünür: ilk 30 turda **5**, 31–60 arası **7**, 61'den
  sonra **9** tur.

Puan matrisindeki `S = 0` (işbirliği yapıp ihanete uğrayanın puanı) standart kurgudan
alınmıştır ve tek yerde tanımlıdır: [`server/gameLogic.js`](server/gameLogic.js) içindeki
`PAYOFF`.

## Dünya sıralaması

`/siralama` sayfası, **yalnızca Dünya Çapında Oyna ile oynanan** maçların sonuçlarına göre
ELO puanına dayalı bir sıralama gösterir — sıra, takma ad, ELO, maç/galibiyet/mağlubiyet/
beraberlik. Arkadaş-linki maçları sayılmaz; rakibini seçebildiğin ve süresini belirleyebildiğin
bir mod, açık uçlu bir sıralamayı kolayca manipüle edilebilir kılardı.

- **Yöntem: ELO.** Herkes 1000 puanla başlar; güçlü bir rakibi yenmek zayıf bir rakibi
  yenmekten daha çok puan getirir. Hesaplama: [`server/elo.js`](server/elo.js).
- **Kimlik: hesap yok.** İlk oyun kurma/katılma/eşleşme arama anında tarayıcıya rastgele,
  kalıcı bir anonim kimlik yazılır (`localStorage['gt:worldId']`, [`public/js/identity.js`](public/js/identity.js)).
  Bu kimlik takma adından bağımsızdır — ismini değiştirsen de sıralaman seninle kalır; ama
  tarayıcı verisini silersen veya başka bir cihazdan girersen sıfırdan başlarsın. Aynı kişinin
  iki cihazla kendine karşı oynayıp puan şişirmesi de bu modelin doğal, kabul edilmiş bir
  sınırıdır. Bu aynı kimlik, [takma ad](#takma-adlar) sahipliğinin de temelidir.
- **Sıralamada yalnızca gerçekten maç bitirmiş oyuncular görünür** — bir takma ad claim etmek
  (ör. sadece özel maç oynamak) tek başına sıralamaya girmez, en az bir dünya çapında maç
  bitirmek gerekir.
- **Eşleştirme FIFO'dur** — beceriye göre eşleştirme yapılmaz, kuyrukta bekleyen ilk iki kişi
  eşleşir.
- **Terk edilen maçlar cezalandırılmaz** — bir taraf sıralamalı bir maçtan ayrılırsa maç
  basitçe hiç bitmez (24 saat sonra bellekten temizlenir), rating değişmez.

## Ses

Her düğme benzeri öğe (butonlar, işbirliği/ret daireleri, uzunluk kartları) tıklandığında
kısa bir retro "blip" çalar — işbirliği ve ret için ayrı tonlar var. Sesler dış dosya veya
CDN kullanmadan Web Audio API ile anlık üretilir: [`public/js/sound.js`](public/js/sound.js).
Sağ üstteki **SES** düğmesiyle kapatılabilir; tercih `localStorage`'da kalıcıdır.

## Görünüm

Açık renkli retro tema: kâğıt zemin ve kareli ızgara, kalın mürekkep çerçeveler, bulanık
olmayan kaydırılmış gölgeler, her yerde monospace. **Dış font veya CDN bağımlılığı yoktur** —
sistem monospace yığını kullanılır, böylece Türkçe karakterler her yerde doğru çıkar ve sayfa
çevrimdışı da aynı görünür. Renkler tek yerde, [`public/css/style.css`](public/css/style.css)
başındaki `:root` değişkenlerinde tanımlıdır.

## Mimari

```
server/
  index.js       Express + Socket.IO; olay yönlendirme, eşleştirme kuyruğu
  gameStore.js   Bellek içi odalar, seçim kilitleme, tur çözümü, TTL temizliği
  gameLogic.js   Puan matrisi, tur sayısı üretimi, geçmiş penceresi
  analysis.js    Davranış metrikleri + arketip sınıflandırma (saf fonksiyonlar)
  elo.js         ELO puanlama (saf fonksiyonlar)
  leaderboard.js Kalıcı sıralama + takma ad rezervasyonu (node:sqlite)
  nickname.js    Takma ad kuralları: temizleme + Türkçe'ye duyarlı benzersizlik anahtarı
public/          Derleme adımı olmayan düz HTML/CSS/JS
  js/identity.js       Tarayıcıya özel kalıcı anonim kimlik (worldId)
  leaderboard.html/js  /siralama sayfası
```

Oyunun bütünlüğü sunucunun otoritesine dayanır: seçimler sunucuda tutulur, toplam tur sayısı
ve rakibin açılmamış hamlesi istemciye **hiç gönderilmez**. Geçmiş penceresi de sunucuda
uygulanır — pencere dışındaki turlar ağ trafiğine hiç çıkmaz, dolayısıyla tarayıcı
konsolundan aşılamaz. Tam geçmiş istemciye ilk kez maç bitince ulaşır.

Canlı maç durumu (turlar, kilitli seçimler) yalnızca bellekte tutulur; sunucu yeniden
başlarsa devam eden maçlar kaybolur. **Yalnızca dünya sıralaması kalıcıdır** — bunun için
Node'un yerleşik `node:sqlite` modülü (`data/leaderboard.db`) kullanılır, ek bir bağımlılık
gerekmez. Bu modül Node'da hâlâ deneysel; `npm start` konsolda bir uyarı basar, işlevi
etkilemez.

## Doğrulama

```bash
npm test             # 59 birim testi (puan matrisi, pencere kuralı, oda akışı, arketipler, ELO, sıralama, takma ad)
npm run simulate     # bot istemcilerle uçtan uca özel maç + dünya çapında eşleşme + takma ad çakışması, sızıntı kontrolü
npm run browser-check # sistemdeki Chrome ile tam akış: özel maç, eşleştirme, /siralama, takma ad reddi; screenshots/ altına ekran görüntüsü
```

`npm run simulate` ve `npm run browser-check`, gerçek `data/leaderboard.db` dosyasına asla
yazmaz — her ikisi de `LEADERBOARD_DB=:memory:` ile izole bir veritabanı kullanır.

`browser-check` sistemdeki Chrome veya Edge'i kullanır (tarayıcı indirmez). Farklı bir yol
için `CHROME_PATH` ortam değişkenini ayarla.

## Deploy

Tek bir Node süreci hem statik dosyaları hem WebSocket'i servis eder; Render, Railway veya
Fly.io ücretsiz katmanına doğrudan gider.

- Başlatma komutu: `npm start`
- **Node ≥ 22.5 gerekir** (`node:sqlite` için — `package.json`'daki `engines.node` bunu
  belirtir). Deploy platformunda Node sürümünü buna göre sabitle.
- Port `PORT` ortam değişkeninden okunur
- Veritabanı yolu isteğe bağlı `LEADERBOARD_DB` ortam değişkeninden okunur; verilmezse
  `data/leaderboard.db` kullanılır (klasör yoksa otomatik oluşturulur)
- Sağlık ucu: `GET /healthz`

Davet bağlantısı tarayıcıdaki adresten üretildiği için hem `localhost`'ta hem canlıda doğru
URL çıkar; ayrıca yapılandırma gerekmez.

Şema değişiklikleri (ör. takma ad benzersizliği için eklenen sütun) sunucu her başladığında
otomatik uygulanır — daha eski bir `data/leaderboard.db` dosyan olsa bile elle müdahale
gerekmez.

⚠️ **Kalıcı disk şart.** Çoğu PaaS'in ücretsiz/standart katmanı geçici (ephemeral) dosya
sistemi kullanır — konteyner yeniden deploy edildiğinde veya yeniden başladığında disk
sıfırlanır ve `data/leaderboard.db` ile birlikte **tüm dünya sıralaması silinir**. Sıralamanın
kalıcı olmasını istiyorsan platformun kalıcı disk/volume özelliğini (Render: Persistent Disk,
Railway: Volumes, Fly.io: Volumes) `data/` klasörüne bağlaman gerekir.
