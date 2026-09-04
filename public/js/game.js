(function () {
  const REVEAL_MS = 2000;

  const gameId = decodeURIComponent(window.location.pathname.split('/').pop() || '').toUpperCase();
  const tokenKey = 'gt:token:' + gameId;

  const socket = io();
  const $ = (id) => document.getElementById(id);

  let state = null;
  let pendingFinal = null;
  let revealTimer = null;
  let inReveal = false;

  const screens = {
    loading: $('screen-loading'),
    join: $('screen-join'),
    lobby: $('screen-lobby'),
    match: $('screen-match'),
    result: $('screen-result'),
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => el.classList.toggle('hidden', key !== name));
  }

  function showError(message) {
    const box = $('error');
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function clearError() {
    $('error').classList.add('hidden');
  }

  const PRESET_LABELS = {
    short: 'Kısa (10–20 tur)',
    medium: 'Orta (40–50 tur)',
    long: 'Uzun (80–90 tur)',
  };

  const moveName = (m) => (m === 'C' ? 'İşbirliği' : 'Ret');
  const moveIcon = (m) => (m === 'C' ? '✓' : '✕');
  const moveClass = (m) => (m === 'C' ? 'coop' : 'defect');

  /** Sunucudaki historyWindowSize ile aynı kural — boş yuvaları çizebilmek için. */
  function windowSize(roundsPlayed) {
    if (roundsPlayed <= 30) return 5;
    if (roundsPlayed <= 60) return 7;
    return 9;
  }

  // ---------- Bağlanma ----------

  function bootstrap() {
    if (!gameId) {
      showError('Geçersiz oyun bağlantısı.');
      showScreen('loading');
      return;
    }
    const token = localStorage.getItem(tokenKey);
    if (!token) return showJoinPrompt();

    socket.emit('resume', { gameId, token }, (res) => {
      if (!res || !res.ok) {
        localStorage.removeItem(tokenKey);
        return showJoinPrompt();
      }
      applyState(res.state);
    });
  }

  function showJoinPrompt() {
    const input = $('join-nickname');
    input.value = localStorage.getItem('gt:nickname') || '';
    showScreen('join');
    input.focus({ preventScroll: true });

    socket.emit('peek_game', { gameId }, (res) => {
      if (!res || !res.ok) return; // katılma denemesinde asıl hata mesajı görünecek
      const presetLabel = PRESET_LABELS[res.preset] || res.preset;
      const host = res.hostNickname ? `<strong>${escapeHtml(res.hostNickname)}</strong>` : 'Rakibin';
      $('join-lede').innerHTML =
        `${host} seni bir maça davet etti — uzunluk: <strong>${presetLabel}</strong>. ` +
        'Her turda işbirliği ya da ret seçeceksin. Amacın kendi puanını en yükseğe çıkarmak.';
      if (res.full) showError('Bu oyun zaten dolu.');
    });
  }

  function join() {
    const nickname = $('join-nickname').value.trim();
    if (!nickname) {
      showError('Önce bir takma ad yaz.');
      return;
    }
    clearError();
    const btn = $('join');
    btn.disabled = true;
    btn.textContent = 'Katılıyor…';

    socket.emit('join_game', { gameId, nickname, worldId: OTIdentity.worldId() }, (res) => {
      if (!res || !res.ok) {
        showError((res && res.error) || 'Maça katılınamadı.');
        btn.disabled = false;
        btn.textContent = 'Maça Katıl';
        return;
      }
      localStorage.setItem('gt:nickname', nickname);
      localStorage.setItem(tokenKey, res.token);
      applyState(res.state);
    });
  }

  // ---------- Durum ----------

  function applyState(next) {
    state = next;
    if (state.phase === 'lobby') return renderLobby();
    if (state.phase === 'finished' && !inReveal) {
      // Bitmiş bir maça geri dönüldü: sonuç dökümü ayrı bir olayla gelir,
      // o gelene kadar maç ekranını göstermenin anlamı yok.
      return pendingFinal ? renderResult(pendingFinal) : showScreen('loading');
    }
    renderMatch();
  }

  function renderLobby() {
    showScreen('lobby');
    $('invite-link').value = window.location.origin + '/g/' + state.gameId;
    $('lobby-preset').textContent = PRESET_LABELS[state.preset] || state.preset;
  }

  function renderMatch() {
    showScreen('match');
    $('me-name').textContent = state.you.nickname;
    $('opp-name').textContent = state.opponent.nickname || 'Rakip';
    $('my-score').textContent = state.you.score;
    $('opp-banner').classList.toggle(
      'hidden',
      !(state.opponent.joined && !state.opponent.connected),
    );
    renderStrip();
    if (!inReveal) renderArena();
  }

  function renderArena() {
    $('reveal').classList.add('hidden');
    $('choices').classList.remove('hidden');

    const buttons = [$('btn-coop'), $('btn-defect')];
    const picked = state.yourChoice;

    buttons.forEach((btn) => {
      const isPicked = picked && btn.dataset.choice === picked;
      btn.disabled = Boolean(picked);
      btn.classList.toggle('is-picked', Boolean(isPicked));
      btn.classList.toggle('is-dimmed', Boolean(picked) && !isPicked);
    });

    if (!picked) {
      $('prompt').textContent = state.opponentLocked
        ? 'Rakip seçimini yaptı — sıra sende'
        : 'Seçimini yap';
    } else {
      $('prompt').innerHTML = 'Seçimin kilitlendi — rakip bekleniyor<span class="cursor"></span>';
    }
  }

  function renderStrip() {
    const strip = $('strip');
    const size = windowSize(state.roundsPlayed);
    const rounds = state.history.slice(-size);
    const emptySlots = Math.max(0, size - rounds.length);

    strip.innerHTML = '';
    for (let i = 0; i < emptySlots; i++) {
      const col = document.createElement('div');
      col.className = 'strip-col is-empty';
      col.innerHTML = '<div class="dot"></div><div class="dot"></div>';
      strip.appendChild(col);
    }
    for (const r of rounds) {
      const col = document.createElement('div');
      col.className = 'strip-col';
      col.innerHTML =
        `<div class="dot ${moveClass(r.you)}" title="Sen: ${moveName(r.you)}">${moveIcon(r.you)}</div>` +
        `<div class="dot ${moveClass(r.opponent)}" title="Rakip: ${moveName(r.opponent)}">${moveIcon(r.opponent)}</div>`;
      strip.appendChild(col);
    }

    $('window-note').textContent = `son ${size} tur görünür`;
  }

  function showReveal(result) {
    inReveal = true;
    $('choices').classList.add('hidden');
    $('prompt').textContent = 'Sonuç';

    const you = result.yourChoice;
    const opp = result.opponentChoice;

    const youBadge = $('reveal-you-badge');
    youBadge.textContent = moveIcon(you);
    youBadge.classList.toggle('defect', you === 'D');
    $('reveal-you-move').textContent = moveName(you);

    const oppBadge = $('reveal-opp-badge');
    oppBadge.textContent = moveIcon(opp);
    oppBadge.classList.toggle('defect', opp === 'D');
    $('reveal-opp-move').textContent = moveName(opp);

    const pts = $('reveal-you-points');
    pts.textContent = '+' + result.yourPoints;
    pts.classList.toggle('zero', result.yourPoints === 0);

    const reveal = $('reveal');
    reveal.classList.remove('hidden');
    // Animasyonu her turda yeniden tetikle
    reveal.style.animation = 'none';
    void reveal.offsetWidth;
    reveal.style.animation = '';

    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      inReveal = false;
      if (pendingFinal) return renderResult(pendingFinal);
      // renderMatch: açılım sırasında gelmiş durum güncellemeleri
      // (rakibin kopması gibi) de bu noktada ekrana yansısın.
      renderMatch();
    }, REVEAL_MS);
  }

  // ---------- Sonuç ekranı ----------

  function pct(x) {
    return Math.round(x * 100) + '%';
  }

  function renderResult(final) {
    pendingFinal = null;
    showScreen('result');

    const me = final.yourIndex;
    const opp = 1 - me;
    const mine = final.players[me];
    const theirs = final.players[opp];

    const verdict =
      mine.score > theirs.score
        ? 'Daha çok puan sen topladın.'
        : mine.score < theirs.score
          ? 'Daha çok puan rakibin topladı.'
          : 'Berabere bitirdiniz.';
    $('result-summary').textContent = `${final.totalRounds} tur oynandı. ${verdict}`;

    $('final-scores').innerHTML = [me, opp]
      .map((i) => {
        const p = final.players[i];
        return `<div class="final-score ${i === me ? 'is-you' : ''}">
            <div class="name">${escapeHtml(p.nickname)}${i === me ? ' (sen)' : ''}</div>
            <div class="pts">${p.score}</div>
          </div>`;
      })
      .join('');

    renderRatingNote(final);
    renderPersonas(final);
    renderRelationship(final);
    renderChart(final);
    renderFullHistory(final);
  }

  /** Yalnızca "Dünya Çapında Oyna" maçlarında dolu olur — özel maçlarda hiçbir şey göstermez. */
  function renderRatingNote(final) {
    const note = $('rating-note');
    if (!final.ranked || !final.ratingResult) {
      note.classList.add('hidden');
      return;
    }
    const { oldRating, newRating, delta } = final.ratingResult;
    const sign = delta >= 0 ? '+' : '';
    note.innerHTML =
      `Sıralama: ${Math.round(oldRating)} → ${Math.round(newRating)} ` +
      `(${sign}${Math.round(delta)}) — <a href="/siralama">dünya sıralamasını gör</a>`;
    note.classList.remove('hidden');
  }

  function renderPersonas(final) {
    const order = [final.yourIndex, 1 - final.yourIndex];
    $('personas').innerHTML = order
      .map((i) => {
        const report = final.analysis.players[i];
        const a = report.archetype;
        const bars = report.bars
          .map(
            (b) => `<div class="bar-row">
                <div>${escapeHtml(b.label)}</div>
                <div class="bar-track"><div class="bar-fill" data-w="${Math.round(b.value * 100)}"></div></div>
                <div class="bar-val">${pct(b.value)}</div>
              </div>`,
          )
          .join('');
        const runnerUp = a.runnerUp
          ? `<p class="small muted">İkinci en yakın tarz: <strong>${escapeHtml(a.runnerUp)}</strong></p>`
          : '';
        return `<div class="persona">
            <div class="persona-head">
              <div>
                <div class="persona-owner">${i === final.yourIndex ? 'Sen' : 'Rakip'} — ${escapeHtml(report.nickname)}</div>
                <div class="persona-name">${escapeHtml(a.name)}</div>
              </div>
              <div class="persona-conf">uyum ${pct(a.confidence)}</div>
            </div>
            <div class="persona-tagline">${escapeHtml(a.tagline)}</div>
            <p class="persona-desc">${escapeHtml(a.description)}</p>
            <div class="bars">${bars}</div>
            ${runnerUp}
          </div>`;
      })
      .join('');

    // Çubukları bir kare sonra doldur ki geçiş animasyonu çalışsın.
    requestAnimationFrame(() => {
      document.querySelectorAll('.bar-fill').forEach((el) => {
        el.style.width = el.dataset.w + '%';
      });
    });
  }

  function renderRelationship(final) {
    const r = final.analysis.relationship;
    const n = final.totalRounds;
    const me = final.yourIndex;

    let firstDefectText = 'Hiç ihanet yaşanmadı';
    if (r.firstDefectionRound !== null) {
      const who =
        r.firstDefector === 'both'
          ? 'ikiniz aynı anda'
          : r.firstDefector === me
            ? 'sen'
            : 'rakibin';
      firstDefectText = `${r.firstDefectionRound}. tur — ${who}`;
    }

    const stats = [
      { k: 'Karşılıklı işbirliği', v: `${r.mutualCoopRounds} tur`, sub: pct(r.mutualCoopRounds / n) },
      { k: 'Karşılıklı ret', v: `${r.mutualDefectRounds} tur`, sub: pct(r.mutualDefectRounds / n) },
      { k: 'Sen rakibi sömürdün', v: `${r.exploitedBy[me]} tur` },
      { k: 'Rakip seni sömürdü', v: `${r.exploitedBy[1 - me]} tur` },
      { k: 'İlk ihanet', v: firstDefectText },
      { k: 'En uzun güven dönemi', v: `${r.longestTrustStreak} tur` },
      { k: 'Ortak verim', v: pct(r.efficiency), sub: `${r.totalScored} / ${r.bestPossibleTogether} puan` },
      { k: 'Masada kalan puan', v: `${r.pointsBurned}`, sub: 'hep işbirliği yapsaydınız kazanılacaktı' },
    ];

    $('relationship').innerHTML = stats
      .map(
        (s) => `<div class="stat">
          <div class="k">${escapeHtml(s.k)}</div>
          <div class="v">${escapeHtml(String(s.v))}</div>
          ${s.sub ? `<div class="small muted">${escapeHtml(s.sub)}</div>` : ''}
        </div>`,
      )
      .join('');
  }

  function renderChart(final) {
    const [c0, c1] = final.analysis.cumulative;
    const me = final.yourIndex;
    const series = [
      { data: me === 0 ? c0 : c1, color: '#1f6f8b', name: final.players[me].nickname + ' (sen)' },
      { data: me === 0 ? c1 : c0, color: '#c0392b', name: final.players[1 - me].nickname },
    ];

    const W = 640;
    const H = 220;
    const pad = { l: 44, r: 12, t: 12, b: 26 };
    const n = final.totalRounds;
    const maxY = Math.max(1, ...series.map((s) => s.data[s.data.length - 1] || 0));

    const x = (i) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
    const y = (v) => H - pad.b - (v / maxY) * (H - pad.t - pad.b);

    const gridLines = [0, 0.25, 0.5, 0.75, 1]
      .map((f) => {
        const yy = y(maxY * f);
        return `<line x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}" stroke="#2b2018" stroke-opacity="0.18" stroke-width="1"/>
                <text x="${pad.l - 8}" y="${yy + 4}" fill="#7a6857" font-size="11" text-anchor="end">${Math.round(maxY * f)}</text>`;
      })
      .join('');

    const paths = series
      .map((s) => {
        const d = s.data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
        return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>`;
      })
      .join('');

    // Uçtaki etiketler viewBox dışına taşmasın diye hizalamaları kenara çekiliyor.
    const xLabels = [
      { t: 1, anchor: 'start' },
      { t: Math.round(n / 2), anchor: 'middle' },
      { t: n, anchor: 'end' },
    ]
      .map(
        ({ t, anchor }) =>
          `<text x="${x(t - 1)}" y="${H - 6}" fill="#7a6857" font-size="11" text-anchor="${anchor}">${t}. tur</text>`,
      )
      .join('');

    const legend = series
      .map(
        (s) =>
          `<span><i class="swatch" style="background:${s.color}"></i> ${escapeHtml(s.name)}</span>`,
      )
      .join('');

    $('chart').innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Tur tur puan birikimi">
        ${gridLines}${paths}${xLabels}
      </svg>
      <div class="legend">${legend}</div>`;
  }

  function renderFullHistory(final) {
    const me = final.yourIndex;
    $('full-history').innerHTML = final.fullHistory
      .map((h) => {
        const mine = h.moves[me];
        const theirs = h.moves[1 - me];
        return `<div class="fh-col" title="${h.round}. tur — sen: ${moveName(mine)}, rakip: ${moveName(theirs)}">
            <div class="fh-cell ${moveClass(mine)}"></div>
            <div class="fh-cell ${moveClass(theirs)}"></div>
          </div>`;
      })
      .join('');

    const r = final.analysis.relationship;
    const notes = [];
    if (r.firstDefectionRound !== null) notes.push(`İlk ihanet: ${r.firstDefectionRound}. tur.`);
    else notes.push('Baştan sona tam işbirliği — mümkün olan en iyi ortak sonuç.');
    notes.push(`En uzun kesintisiz güven dönemi: ${r.longestTrustStreak} tur.`);
    $('turning-points').textContent = notes.join(' ');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]);
  }

  // ---------- Olaylar ----------

  $('join').addEventListener('click', join);
  $('join-nickname').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });

  $('show-how').addEventListener('click', () => {
    $('how-panel').classList.toggle('hidden');
  });

  $('copy').addEventListener('click', async () => {
    const input = $('invite-link');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    $('copy-hint').textContent = 'Bağlantı kopyalandı — rakibine gönder.';
  });

  document.querySelectorAll('.choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state || state.phase !== 'playing' || state.yourChoice || inReveal) return;
      const choice = btn.dataset.choice;
      state.yourChoice = choice; // anında geri bildirim
      renderArena();
      socket.emit('make_choice', { round: state.round, choice }, (res) => {
        if (!res || !res.ok) {
          state.yourChoice = null;
          renderArena();
          showError((res && res.error) || 'Seçim gönderilemedi.');
        } else {
          clearError();
        }
      });
    });
  });

  socket.on('state', (next) => {
    if (inReveal) {
      state = next; // açılım bitince yansıyacak
      $('my-score').textContent = next.you.score;
      return;
    }
    applyState(next);
  });

  socket.on('round_result', (result) => {
    state = result.state;
    $('my-score').textContent = result.yourTotal;
    renderStrip();
    showReveal(result);
  });

  socket.on('game_over', (final) => {
    pendingFinal = final;
    if (!inReveal) renderResult(final);
  });

  socket.on('opponent_joined', () => clearError());
  socket.on('opponent_disconnected', () => {});
  socket.on('opponent_reconnected', () => {});
  socket.on('superseded', () => {
    showError('Bu maç başka bir sekmede açıldı. Oyuna oradan devam et.');
  });

  socket.on('connect', () => {
    if (state) bootstrapReconnect();
  });

  function bootstrapReconnect() {
    const token = localStorage.getItem(tokenKey);
    if (!token) return;
    socket.emit('resume', { gameId, token }, (res) => {
      if (res && res.ok && !inReveal) applyState(res.state);
    });
  }

  bootstrap();
})();
