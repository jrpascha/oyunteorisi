(function () {
  const socket = io();
  const $ = (id) => document.getElementById(id);

  const startPanel = $('start-panel');
  const worldPanel = $('world-panel');
  const howPanel = $('how-panel');
  const purposePanel = $('purpose-panel');
  const panels = [startPanel, worldPanel, howPanel, purposePanel];

  const nicknameInput = $('nickname');
  const createBtn = $('create');
  const errorBox = $('error');
  const presetInputs = Array.from(document.querySelectorAll('input[name="preset"]'));

  const worldNicknameInput = $('world-nickname');
  const worldForm = $('world-form');
  const worldWaiting = $('world-waiting');
  const findMatchBtn = $('find-match');
  const cancelMatchBtn = $('cancel-match');
  const worldErrorBox = $('world-error');

  nicknameInput.value = localStorage.getItem('gt:nickname') || '';
  worldNicknameInput.value = localStorage.getItem('gt:nickname') || '';

  function syncPresetCards() {
    presetInputs.forEach((input) => {
      input.closest('.duration-card').classList.toggle('is-selected', input.checked);
    });
  }
  presetInputs.forEach((input) => input.addEventListener('change', syncPresetCards));
  syncPresetCards();

  function selectedPreset() {
    return presetInputs.find((i) => i.checked)?.value || 'medium';
  }

  /** Aynı anda tek panel açık kalır. */
  function togglePanel(panel) {
    const willOpen = panel.classList.contains('hidden');
    panels.forEach((p) => p.classList.add('hidden'));
    if (willOpen) panel.classList.remove('hidden');
    return willOpen;
  }

  $('show-start').addEventListener('click', () => {
    // preventScroll: odaklanma sayfayı kaydırıp başlığı ekran dışına itmesin.
    if (togglePanel(startPanel)) nicknameInput.focus({ preventScroll: true });
  });

  $('show-world').addEventListener('click', () => {
    if (togglePanel(worldPanel)) worldNicknameInput.focus({ preventScroll: true });
  });

  $('show-how').addEventListener('click', () => togglePanel(howPanel));
  $('show-purpose').addEventListener('click', () => togglePanel(purposePanel));

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
  }

  function create() {
    const nickname = nicknameInput.value.trim();
    if (!nickname) {
      showError('Önce bir takma ad yaz.');
      nicknameInput.focus({ preventScroll: true });
      return;
    }

    errorBox.classList.add('hidden');
    createBtn.disabled = true;
    createBtn.textContent = 'Oluşturuluyor…';

    socket.emit('create_game', { nickname, preset: selectedPreset(), worldId: OTIdentity.worldId() }, (res) => {
      if (!res || !res.ok) {
        showError((res && res.error) || 'Oyun oluşturulamadı. Tekrar dene.');
        createBtn.disabled = false;
        createBtn.textContent = 'Bağlantı Oluştur';
        return;
      }
      localStorage.setItem('gt:nickname', nickname);
      localStorage.setItem('gt:token:' + res.gameId, res.token);
      window.location.href = '/g/' + res.gameId;
    });
  }

  createBtn.addEventListener('click', create);
  nicknameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') create();
  });

  // ---------- Dünya çapında oyna ----------

  function showWorldError(message) {
    worldErrorBox.textContent = message;
    worldErrorBox.classList.remove('hidden');
  }

  function setWaiting(isWaiting) {
    worldForm.classList.toggle('hidden', isWaiting);
    worldWaiting.classList.toggle('hidden', !isWaiting);
  }

  function findMatch() {
    const nickname = worldNicknameInput.value.trim();
    if (!nickname) {
      showWorldError('Önce bir takma ad yaz.');
      worldNicknameInput.focus({ preventScroll: true });
      return;
    }

    worldErrorBox.classList.add('hidden');
    localStorage.setItem('gt:nickname', nickname);

    socket.emit('queue_join', { nickname, worldId: OTIdentity.worldId() }, (res) => {
      if (!res || !res.ok) {
        showWorldError((res && res.error) || 'Eşleşme aranamadı. Tekrar dene.');
        return;
      }
      setWaiting(true);
    });
  }

  function cancelMatch() {
    socket.emit('queue_leave');
    setWaiting(false);
  }

  findMatchBtn.addEventListener('click', findMatch);
  cancelMatchBtn.addEventListener('click', cancelMatch);
  worldNicknameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') findMatch();
  });

  // Eşleşme hem kuyrukta bekleyen hem az önce katılan tarafa aynı olaydan gelir.
  socket.on('matched', (payload) => {
    localStorage.setItem('gt:token:' + payload.gameId, payload.token);
    window.location.href = '/g/' + payload.gameId;
  });

  // Sayfadan ayrılırken kuyrukta unutulmuş olma ihtimaline karşı temizlik.
  window.addEventListener('beforeunload', () => {
    if (!worldWaiting.classList.contains('hidden')) socket.emit('queue_leave');
  });
})();
