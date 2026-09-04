(function () {
  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c]);
  }

  function winRate(row) {
    return row.matches === 0 ? '—' : Math.round((row.wins / row.matches) * 100) + '%';
  }

  function renderRows(players, ownWorldId) {
    return players
      .map((p) => {
        const isYou = ownWorldId && p.world_id === ownWorldId;
        return `<tr class="${isYou ? 'is-you' : ''}">
            <td>${p.rank}</td>
            <td>${escapeHtml(p.nickname)}${isYou ? ' <span class="small muted">(sen)</span>' : ''}</td>
            <td>${Math.round(p.rating)}</td>
            <td>${p.matches}</td>
            <td>${p.wins}</td>
            <td>${p.losses}</td>
            <td>${p.draws}</td>
          </tr>`;
      })
      .join('');
  }

  async function load() {
    const ownWorldId = localStorage.getItem('gt:worldId');

    let players;
    try {
      const res = await fetch('/api/leaderboard?limit=50');
      if (!res.ok) throw new Error('İstek başarısız: ' + res.status);
      ({ players } = await res.json());
    } catch (err) {
      $('loading').classList.add('hidden');
      $('error').textContent = 'Sıralama yüklenemedi. Sayfayı yenilemeyi dene.';
      $('error').classList.remove('hidden');
      return;
    }

    $('loading').classList.add('hidden');
    $('board-wrap').classList.remove('hidden');

    if (players.length === 0) {
      $('board-wrap').querySelector('.chart-wrap').classList.add('hidden');
      $('empty-note').classList.remove('hidden');
      return;
    }

    $('board-body').innerHTML = renderRows(players, ownWorldId);

    const inTop = ownWorldId && players.some((p) => p.world_id === ownWorldId);
    if (!ownWorldId || inTop) return;

    try {
      const res = await fetch('/api/rank/' + encodeURIComponent(ownWorldId));
      const data = await res.json();
      // matches > 0: bir takma ad claim etmiş ama hiç sıralamalı maç bitirmemiş
      // biri (ör. sadece özel maç oynamış) "sıralamada" gösterilmemeli.
      if (data.found && data.matches > 0) {
        // textContent kullanılıyor; HTML kaçışına gerek yok (escapeHtml burada yanlış olurdu).
        $('your-rank-value').textContent =
          `${data.rank}. — ${data.nickname} (${Math.round(data.rating)} ELO, ${data.matches} maç)`;
        $('your-rank').classList.remove('hidden');
      }
    } catch {
      // sıralama zaten göründü, "senin sıralaman" kutusu isteğe bağlı bir ek — sessizce geç
    }
  }

  load();
})();
