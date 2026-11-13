/**
 * Capa de red → Apps Script directo
 * GET: JSONP (CORS-safe) · POST: text/plain + JSON body
 */
window.AV = window.AV || {};

AV.network = {
  _ensureUrl(url) {
    if (!url || String(url).includes('PEGAR_AQUI')) {
      const err = new Error('API no configurada: pegue PERMISOS_URL en api-config.js');
      err.code = 'NO_CONFIG';
      throw err;
    }
  },

  _isSameOriginProxy(url) {
    const u = String(url || '');
    return u.startsWith('/') || u.startsWith(location.origin);
  },

  _token() {
    return String(window.API_CONFIG?.API_TOKEN || '').trim();
  },

  /**
   * GET vía JSONP — solo para Apps Script directo (legado)
   */
  jsonp(url, params = {}, timeout) {
    this._ensureUrl(url);
    const ms = timeout ?? (window.API_CONFIG?.TIMEOUT_MS ?? 15000);

    return new Promise((resolve, reject) => {
      const cbName = '_avJsonp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const script = document.createElement('script');
      let done = false;

      const cleanup = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          delete window[cbName];
        } catch (_) {
          window[cbName] = undefined;
        }
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      const timer = setTimeout(() => {
        cleanup();
        const err = new Error('Tiempo de espera agotado');
        err.code = 'TIMEOUT';
        reject(err);
      }, ms);

      window[cbName] = (data) => {
        cleanup();
        resolve(data);
      };

      script.onerror = () => {
        cleanup();
        const err = new Error('No se pudo conectar con el servidor');
        err.code = 'NETWORK';
        reject(err);
      };

      const q = new URLSearchParams({ ...(params || {}), callback: cbName }).toString();
      script.src = url + (url.includes('?') ? '&' : '?') + q;
      document.head.appendChild(script);
    });
  },

  async fetchJson(url, { method = 'GET', body = null, params = null, timeout } = {}) {
    this._ensureUrl(url);
    const ms = timeout ?? (window.API_CONFIG?.TIMEOUT_MS ?? 15000);
    let finalUrl = url;
    if (params && typeof params === 'object') {
      const q = new URLSearchParams(params).toString();
      finalUrl += (url.includes('?') ? '&' : '?') + q;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);

    try {
      const opts = {
        method: String(method).toUpperCase(),
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { Accept: 'application/json' },
      };
      if (opts.method !== 'GET' && opts.method !== 'HEAD') {
        opts.headers['Content-Type'] = 'application/json;charset=utf-8';
        opts.body = typeof body === 'string' ? body : JSON.stringify(body || {});
      }

      const res = await fetch(finalUrl, opts);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { ok: false, raw: text, message: 'Respuesta no JSON' };
      }
      if (!res.ok && data && data.ok !== false) {
        const err = new Error(data.message || `HTTP ${res.status}`);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') {
        const err = new Error('Tiempo de espera agotado');
        err.code = 'TIMEOUT';
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },

  async request(url, { method = 'GET', body = null, params = null, timeout } = {}) {
    // Proxy Netlify (mismo sitio): fetch JSON — el token lo pone el servidor
    if (this._isSameOriginProxy(url)) {
      return this.fetchJson(url, { method, body, params, timeout });
    }

    // GET externo → JSONP (CORS-safe con Apps Script)
    if (String(method).toUpperCase() === 'GET') {
      return this.jsonp(url, params || {}, timeout);
    }

    this._ensureUrl(url);
    const ms = timeout ?? (window.API_CONFIG?.TIMEOUT_MS ?? 15000);
    let finalUrl = url;
    if (params && typeof params === 'object') {
      const q = new URLSearchParams(params).toString();
      finalUrl += (url.includes('?') ? '&' : '?') + q;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);

    try {
      const opts = {
        method: 'POST',
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      };

      const res = await fetch(finalUrl, opts);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        if (/doGet|doPost|Script function not found/i.test(text)) {
          const err = new Error('La API no está implementada. Vuelve a implementar el code.gs.');
          err.code = 'NO_DEPLOY';
          throw err;
        }
        data = { raw: text, ok: res.ok };
      }

      if (!res.ok) {
        const err = new Error(data?.message || `HTTP ${res.status}`);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') {
        const err = new Error('Tiempo de espera agotado');
        err.code = 'TIMEOUT';
        throw err;
      }
      if (e.message && /Failed to fetch|CORS|NetworkError/i.test(e.message)) {
        try {
          await fetch(finalUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: typeof body === 'string' ? body : JSON.stringify(body),
          });
          const err = new Error('No se pudo confirmar el envío. Queda pendiente de subir.');
          err.code = 'OPAQUE';
          throw err;
        } catch (e2) {
          if (e2.code === 'OPAQUE') throw e2;
        }
      }
      if (!navigator.onLine) {
        const err = new Error('Sin conexión');
        err.code = 'OFFLINE';
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },

  get(url, params) {
    return this.request(url, { method: 'GET', params });
  },

  post(url, body, timeout) {
    return this.request(url, { method: 'POST', body, timeout });
  },

  /**
   * Calidad de red (Network Information API).
   * En Android, H+ / HSPA suele reportarse como effectiveType "3g".
   * 3g+ = 3g o mejor (incluye H+ y 4g).
   */
  getLinkInfo() {
    const online = !!navigator.onLine;
    const c =
      navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    const raw = String(c?.effectiveType || '').toLowerCase();
    const type = String(c?.type || '').toLowerCase();
    let tier = 'unknown';
    if (!online) tier = 'offline';
    else if (raw === 'slow-2g' || raw === '2g') tier = '2g';
    else if (raw === '3g') tier = '3g'; // incluye H / H+ en muchos Android
    else if (raw === '4g') tier = '4g';
    else if (online) tier = 'unknown';

    const is3gPlus = online && (tier === '3g' || tier === '4g' || tier === 'unknown');
    const label =
      tier === 'offline'
        ? 'Sin conexión'
        : tier === '2g'
          ? '2G'
          : tier === '3g'
            ? type === 'cellular' || !type
              ? '3G / H+'
              : '3G'
            : tier === '4g'
              ? '4G'
              : 'En línea';

    // En 2G/lenta: timeout más largo; en 3G+/H+/4G: estable
    const postTimeoutMs =
      tier === '2g' ? 60000 : tier === '3g' ? 50000 : tier === '4g' ? 45000 : 48000;

    return {
      online,
      tier,
      effectiveType: raw || 'unknown',
      connectionType: type || 'unknown',
      downlink: Number(c?.downlink) || 0,
      rtt: Number(c?.rtt) || 0,
      saveData: !!c?.saveData,
      is3gPlus,
      canSync: online,
      label,
      postTimeoutMs,
    };
  },
};
