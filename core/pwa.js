/**
 * Registro PWA + Service Worker + auto-sync al recuperar internet
 * Detecta 3G+/H+/4G y sube pendientes sin duplicar.
 */
window.AV = window.AV || {};

AV.pwa = {
  _syncTimer: null,
  _syncing: false,
  _watchTimer: null,
  _lastLinkTier: '',
  _connBound: false,

  async register() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      console.info('[pwa] SW registered', reg.scope);
      this.bindConnectionWatch();
      this.requestNotifyPermission();
      return reg;
    } catch (e) {
      console.warn('[pwa] SW fail', e);
      this.bindConnectionWatch();
      this.requestNotifyPermission();
      return null;
    }
  },

  /** Pide permiso de notificaciones (una vez) para avisar al subir */
  requestNotifyPermission() {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'default') {
        // Tras un gesto del usuario suele ir mejor; reintento suave al primer click
        const once = () => {
          Notification.requestPermission().catch(() => {});
          document.removeEventListener('click', once);
          document.removeEventListener('touchend', once);
        };
        document.addEventListener('click', once, { passive: true });
        document.addEventListener('touchend', once, { passive: true });
      }
    } catch (_) {}
  },

  /**
   * Notificación del sistema al subir pendientes (y toast en app).
   */
  notifyUpload(sent, detail = '') {
    const title = sent === 1 ? 'Pase enviado' : `${sent} pases enviados`;
    const body = detail || 'Los pendientes se subieron correctamente.';
    try {
      AV.toast?.('success', 'Sincronizado', `${sent} pase(s) enviados` + (detail ? ` · ${detail}` : ''));
    } catch (_) {}
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const icon = './icons/icon-192.png';
      if (navigator.serviceWorker?.ready) {
        navigator.serviceWorker.ready
          .then((reg) =>
            reg.showNotification(title, {
              body,
              icon,
              badge: icon,
              tag: 'av-permisos-sync',
              renotify: true,
            })
          )
          .catch(() => {
            new Notification(title, { body, icon });
          });
      } else {
        new Notification(title, { body, icon });
      }
    } catch (e) {
      console.warn('[notify]', e);
    }
  },

  /** Escucha cambios de red (2G → 3G/H+ → 4G) */
  bindConnectionWatch() {
    if (this._connBound) return;
    this._connBound = true;
    const c =
      navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    if (!c || typeof c.addEventListener !== 'function') return;
    c.addEventListener('change', () => {
      const info = AV.network.getLinkInfo();
      this.updateNetPill();
      const improved =
        info.online &&
        info.is3gPlus &&
        this._lastLinkTier &&
        this._lastLinkTier !== info.tier &&
        (this._lastLinkTier === 'offline' || this._lastLinkTier === '2g');
      this._lastLinkTier = info.tier;
      if (improved || (info.is3gPlus && AV.queue?.pendingCount?.() > 0)) {
        this.scheduleAutoSync('link-' + info.tier, info.tier === '3g' ? 1200 : 700);
      }
    });
  },

  updateNetPill() {
    const pill = document.getElementById('netPill');
    if (!pill) return;
    const info = AV.network?.getLinkInfo?.() || {
      online: navigator.onLine,
      label: navigator.onLine ? 'En línea' : 'Sin conexión',
      tier: navigator.onLine ? 'unknown' : 'offline',
    };
    this._lastLinkTier = info.tier || this._lastLinkTier;
    const online = !!info.online;
    pill.classList.toggle('offline', !online);
    pill.classList.toggle('is-offline', !online);
    pill.classList.toggle('is-online', online);
    pill.title = info.effectiveType
      ? `Red: ${info.label} (${info.effectiveType})`
      : info.label;
    pill.innerHTML =
      `<span class="status-dot"></span><span class="status-text">${info.label}</span>`;
  },

  updateQueuePill() {
    const pill = document.getElementById('queuePill');
    const count = document.getElementById('queueCount');
    if (!pill) return;
    const n = AV.queue.pendingCount();
    if (count) count.textContent = String(n);
    else {
      pill.innerHTML = `<i data-lucide="cloud-upload"></i><span class="status-text"><span id="queueCount">${n}</span> pendientes</span>`;
      if (window.lucide) lucide.createIcons({ nodes: [pill] });
    }
    pill.hidden = n === 0;
  },

  maybeShowInstallHint() {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const hint = document.getElementById('installHint');
    if (hint && !standalone) hint.classList.add('show');
  },

  /** Bloquea zoom por gestos (pinch iOS / multi-touch) */
  lockZoom() {
    const blockMulti = (e) => {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    };
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', blockMulti, { passive: false });
  },

  /**
   * Sube pendientes automáticamente al detectar red (3G+/H+/4G).
   * Reintenta porque "online" a veces llega antes de tener datos reales.
   */
  scheduleAutoSync(reason = 'online', delayMs = 800) {
    if (!navigator.onLine) return;
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => {
      this.runAutoSync(reason);
    }, delayMs);
  },

  async runAutoSync(reason = 'online') {
    if (!navigator.onLine) return;
    if (!AV.queue) return;

    AV.queue.recoverStuck();
    AV.queue.dedupePending?.();
    AV.queue.pruneLocalHistory?.(48);
    const pending = AV.queue.pendingCount();
    if (!pending) {
      this.updateQueuePill();
      document.dispatchEvent(new CustomEvent('av:historial-changed'));
      return;
    }

    if (this._syncing) return;
    this._syncing = true;

    const link = AV.network.getLinkInfo();
    console.info('[auto-sync]', reason, link.label, 'pending=', pending);

    try {
      // Verificar red real contra el proxy (no solo navigator.onLine)
      const probe = await AV.api.ping();
      if (!probe || probe.ok !== true || probe.api !== 'permisos') {
        console.warn('[auto-sync] ping falló', reason, probe);
        this.updateNetPill();
        this.updateQueuePill();
        return;
      }

      let last = { sent: 0, failed: 0, error: '' };
      const maxAttempts = link.tier === '2g' ? 2 : 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (!navigator.onLine) break;
        AV.queue.recoverStuck();
        AV.queue.dedupePending?.();
        if (AV.queue.pendingCount() === 0) break;

        last = await AV.queue.flush();
        if (last.sent > 0 && AV.queue.pendingCount() === 0) break;
        if (last.error && /no autorizado|UNAUTHORIZED|WRONG_API/i.test(last.error)) break;
        if (attempt < maxAttempts && (last.failed || AV.queue.pendingCount() > 0)) {
          const wait = (link.tier === '3g' || link.tier === '2g' ? 2200 : 1500) * attempt;
          await new Promise((r) => setTimeout(r, wait));
        }
      }

      this.updateNetPill();
      this.updateQueuePill();
      document.dispatchEvent(new CustomEvent('av:historial-changed'));

      if (last.sent > 0) {
        this.notifyUpload(last.sent, link.label || '');
      } else if (last.failed && last.error) {
        console.warn('[auto-sync]', reason, last.error);
        AV.toast?.('warning', 'No se pudo subir', last.error);
      }
    } catch (e) {
      console.warn('[auto-sync] fail', reason, e);
    } finally {
      this._syncing = false;
      this.ensurePendingWatch();
    }
  },

  /** Mientras haya pendientes y esté en línea, reintenta (más frecuente en 3G+/H+) */
  ensurePendingWatch() {
    clearInterval(this._watchTimer);
    this._watchTimer = setInterval(() => {
      if (!navigator.onLine) return;
      if (!AV.queue) return;
      AV.queue.recoverStuck();
      const n = AV.queue.pendingCount();
      if (n > 0 && !this._syncing) {
        const info = AV.network.getLinkInfo();
        // En 3G+/H+/4G subir pronto; en 2G también intenta pero con más margen
        this.scheduleAutoSync('watch-' + info.tier, info.tier === '2g' ? 800 : 0);
      }
    }, 18000);
  },
};

window.addEventListener('online', () => {
  AV.pwa.updateNetPill();
  // Esperar: el móvil marca "online" un poco antes de tener datos reales
  const delay = AV.network.getLinkInfo().tier === '3g' ? 1400 : 1000;
  AV.pwa.scheduleAutoSync('online', delay);
});

window.addEventListener('offline', () => {
  AV.pwa.updateNetPill();
  AV.toast?.(
    'info',
    'Sin conexión',
    'Puede seguir registrando. Los pases quedan pendientes y se subirán solos.'
  );
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    AV.pwa.updateNetPill();
    AV.queue?.pruneLocalHistory?.(48);
    AV.pwa.updateQueuePill();
    if (navigator.onLine) AV.pwa.scheduleAutoSync('visible', 500);
    document.dispatchEvent(new CustomEvent('av:historial-changed'));
  }
});

window.addEventListener('pageshow', () => {
  if (navigator.onLine) AV.pwa.scheduleAutoSync('pageshow', 400);
});

document.addEventListener('av:queue-updated', () => {
  AV.pwa.updateQueuePill();
  if (navigator.onLine) AV.pwa.scheduleAutoSync('queued', 600);
});
