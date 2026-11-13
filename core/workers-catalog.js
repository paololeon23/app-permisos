/**
 * Catálogo de trabajadores — solo data/trabajadores.json (+ cache local)
 * Sin API / sin Apps Script de trabajadores.
 */
window.AV = window.AV || {};

AV.workers = {
  _list: [],
  _ready: false,
  _bundledCount: 0,

  async init() {
    const cached = AV.storage.get(API_CONFIG.WORKERS_CACHE_KEY, null);
    if (Array.isArray(cached) && cached.length) {
      this._list = this._merge([], cached);
      this._ready = true;
    }

    try {
      const url = API_CONFIG.WORKERS_JSON || './data/trabajadores.json';
      const local = await fetch(url, { cache: 'reload' }).then((r) => r.json());
      const rows = this._fromFile(local);
      if (rows.length) {
        this._bundledCount = rows.length;
        this._list = this._merge(rows, this._list);
        this._persist();
        this._ready = true;
      }
    } catch (e) {
      console.warn('[workers] JSON local no disponible', e);
    }

    this._ready = true;
    this._emit();
    return this._list;
  },

  /** Acepta byDni{} (trabajadores.json) o array (workers.json legado) */
  _fromFile(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (data.byDni && typeof data.byDni === 'object') {
      return Object.keys(data.byDni).map((dni) => {
        const v = data.byDni[dni] || {};
        return {
          dni: String(dni).trim(),
          nombres: String(v.nombre || v.nombres || '').trim(),
          cargo: String(v.cargo || '').trim(),
          fIngreso: String(v.fIngreso || v.fechaIngreso || '2026-01-01').trim() || '2026-01-01',
        };
      });
    }
    return [];
  },

  _emit() {
    document.dispatchEvent(
      new CustomEvent('av:workers-ready', {
        detail: { count: this._list.length },
      })
    );
  },

  _normalize(w) {
    const key = String(w?.dni || w?.DNI || '').trim();
    if (!key) return null;
    return {
      dni: key,
      nombres: String(w.nombres || w.apellidosNombres || w.nombre || w.Nombres || '').trim(),
      cargo: String(w.cargo || w.puesto || w.Cargo || '').trim(),
      fIngreso:
        String(w.fIngreso || w.fechaIngreso || w.f_ingreso || w.FIngreso || '2026-01-01').trim() ||
        '2026-01-01',
    };
  },

  _merge(a, b) {
    const map = new Map();
    [...(a || []), ...(b || [])].forEach((raw) => {
      const w = this._normalize(raw);
      if (!w) return;
      map.set(w.dni, w);
    });
    return [...map.values()].sort((x, y) => AV.norm(x.nombres).localeCompare(AV.norm(y.nombres)));
  },

  _persist() {
    AV.storage.set(API_CONFIG.WORKERS_CACHE_KEY, this._list);
  },

  count() {
    return this._list.length;
  },

  all() {
    return this._list;
  },

  byDni(dni) {
    const k = String(dni || '').trim();
    if (!k) return null;
    return this._list.find((w) => w.dni === k) || null;
  },

  upsertLocal(worker) {
    const w = this._normalize(worker);
    if (!w) return null;
    const idx = this._list.findIndex((x) => x.dni === w.dni);
    if (idx >= 0) this._list[idx] = w;
    else this._list.push(w);
    this._list.sort((x, y) => AV.norm(x.nombres).localeCompare(AV.norm(y.nombres)));
    this._persist();
    this._emit();
    return w;
  },

  search(q, limit = 40) {
    const n = AV.norm(q);
    if (!n) return this._list.slice(0, limit);
    const results = [];
    for (const w of this._list) {
      const hay = AV.norm(`${w.dni} ${w.nombres} ${w.cargo}`);
      if (hay.includes(n) || w.dni.includes(String(q).trim())) {
        results.push(w);
        if (results.length >= limit) break;
      }
    }
    return results;
  },

  async syncIfRemoteHasMore() {
    return { synced: false, reason: 'local-only', local: this.count() };
  },

  async refreshFromApi() {
    return this.init();
  },

  async fetchByDni() {
    return null;
  },

  async resolveByDni(dni) {
    const k = String(dni || '').trim();
    if (k.length < 8) return { worker: null, source: 'missing' };
    const local = this.byDni(k);
    if (local) return { worker: local, source: 'local' };
    return { worker: null, source: 'missing' };
  },
};

/**
 * Supervisores de cosecha — únicos autorizados a dar permiso
 * Fuente: data/supervisores-cosecha.json (byDni)
 */
AV.supervisores = {
  _map: {},
  _ready: false,

  async init() {
    try {
      const url = API_CONFIG.SUPERVISORES_JSON || './data/supervisores-cosecha.json';
      const data = await fetch(url, { cache: 'reload' }).then((r) => r.json());
      const by = data?.byDni && typeof data.byDni === 'object' ? data.byDni : {};
      this._map = {};
      Object.keys(by).forEach((dni) => {
        const k = String(dni).trim();
        const v = by[k] || {};
        if (!k) return;
        this._map[k] = {
          dni: k,
          nombres: String(v.nombre || v.nombres || '').trim(),
          cargo: String(v.cargo || 'SUPERVISOR DE COSECHA').trim(),
        };
      });
      this._ready = true;
      console.info('[supervisores]', Object.keys(this._map).length, 'autorizados');
    } catch (e) {
      console.warn('[supervisores] no se pudo cargar', e);
      this._map = {};
      this._ready = true;
    }
    return this._map;
  },

  count() {
    return Object.keys(this._map).length;
  },

  byDni(dni) {
    const k = String(dni || '').trim();
    return this._map[k] || null;
  },

  /** Solo supervisores de cosecha pueden autorizar */
  resolveByDni(dni) {
    const k = String(dni || '').trim();
    if (k.length < 8) return { supervisor: null, source: 'missing' };
    const s = this.byDni(k);
    if (s) return { supervisor: s, source: 'local' };
    return { supervisor: null, source: 'forbidden' };
  },
};
