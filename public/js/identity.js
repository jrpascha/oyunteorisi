/**
 * Hesap yok — bu tarayıcıya özel, kalıcı bir anonim kimlik. İlk ihtiyaç
 * anında üretilir ve localStorage'da saklanır. Hem özel maçlarda hem dünya
 * çapında oyna'da takma ad rezervasyonunu bu kimliğe bağlamak için kullanılır.
 */
(function () {
  function fallbackId() {
    const bytes = new Uint8Array(16);
    (window.crypto || {}).getRandomValues?.(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') || String(Date.now());
  }

  function worldId() {
    let id = localStorage.getItem('gt:worldId');
    if (!id) {
      id = window.crypto?.randomUUID ? window.crypto.randomUUID() : fallbackId();
      localStorage.setItem('gt:worldId', id);
    }
    return id;
  }

  window.OTIdentity = { worldId };
})();
