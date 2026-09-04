/**
 * Retro tıklama sesleri. Web Audio API ile anlık üretilir — dış ses dosyası,
 * CDN bağımlılığı yok. Sayfadaki her .btn / .choice / .duration-card
 * tıklamasında kısa bir "blip" çalar; işbirliği ve ret için ayrı tonlar var.
 */
(function () {
  const MUTE_KEY = 'gt:sound-muted';
  let ctx = null;
  let muted = localStorage.getItem(MUTE_KEY) === '1';

  function audioCtx() {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = Ctx ? new Ctx() : null;
    return ctx;
  }

  function blip({ freq = 640, duration = 0.06, type = 'square', volume = 0.05, slide = 0 } = {}) {
    if (muted) return;
    const audio = audioCtx();
    if (!audio) return;
    if (audio.state === 'suspended') audio.resume();

    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const t0 = audio.currentTime;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.linearRampToValueAtTime(Math.max(40, freq + slide), t0 + duration);

    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(gain).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  const Sound = {
    click: () => blip({ freq: 680, duration: 0.055, type: 'square', volume: 0.045, slide: -120 }),
    coop: () => blip({ freq: 480, duration: 0.09, type: 'square', volume: 0.055, slide: 300 }),
    defect: () => blip({ freq: 340, duration: 0.11, type: 'sawtooth', volume: 0.055, slide: -160 }),
    isMuted: () => muted,
    setMuted(next) {
      muted = next;
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      syncToggle();
    },
  };

  window.OTSound = Sound;

  // ---------- Genel tıklama sesi ----------

  document.addEventListener('click', (event) => {
    // Etiket (.duration-card) tıklaması, gizli radio'ya ikinci bir sentetik
    // click daha yollar; o ikinci olayı görmezden gel, aksi halde ses çifte çalar.
    if (event.target.closest('input, textarea')) return;

    const el = event.target.closest('.btn, .choice, .duration-card');
    if (!el) return;

    if (el.id === 'btn-coop') return Sound.coop();
    if (el.id === 'btn-defect') return Sound.defect();
    Sound.click();
  });

  // ---------- Ses aç/kapa düğmesi ----------

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'sound-toggle';
  toggle.textContent = 'SES';

  function syncToggle() {
    toggle.classList.toggle('is-muted', muted);
    toggle.setAttribute('aria-pressed', String(!muted));
    toggle.title = muted ? 'Sesi aç' : 'Sesi kapat';
    toggle.setAttribute('aria-label', muted ? 'Ses kapalı — açmak için tıkla' : 'Ses açık — kapatmak için tıkla');
  }
  syncToggle();

  toggle.addEventListener('click', () => {
    Sound.setMuted(!muted);
    if (!muted) Sound.click(); // sesi yeni açtıysa duysun
  });

  document.body.appendChild(toggle);
})();
