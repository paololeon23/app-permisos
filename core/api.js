/**
 * API de permisos → code.gs (Apps Script)
 * Token en cada request (mismo que el dashboard)
 */
window.AV = window.AV || {};

AV.api = {
  _tokenPayload(extra = {}) {
    const token = String(API_CONFIG.API_TOKEN || '').trim();
    return { ...extra, token };
  },

  _assertPermisosRes(res) {
    if (res && res.ok === false) {
      const err = new Error(res.message || 'No se pudo registrar');
      err.code = res.code || 'API_ERROR';
      err.data = res;
      throw err;
    }
    if (!res || res.opaque) {
      const err = new Error('El servidor no confirmó el registro');
      err.code = 'NO_CONFIRM';
      throw err;
    }
    if (res.code === 'UNAUTHORIZED' || /no autorizado/i.test(res.message || '')) {
      const err = new Error('No autorizado. Revise API_TOKEN en api-config.js');
      err.code = 'UNAUTHORIZED';
      throw err;
    }
    if (res.api && res.api !== 'permisos') {
      const err = new Error('Respuesta inválida: no es la API de permisos');
      err.code = 'WRONG_API';
      throw err;
    }
    if (!(res.id || res.data?.id || (res.ok === true && res.api === 'permisos'))) {
      const err = new Error('El servidor no confirmó el registro');
      err.code = 'NO_CONFIRM';
      throw err;
    }
    return res;
  },

  async crearPermiso(data) {
    const url = API_CONFIG.PERMISOS_URL;
    const res = await AV.network.post(
      url,
      this._tokenPayload({ action: 'crearPermiso', data })
    );
    return this._assertPermisosRes(res);
  },

  async ping() {
    try {
      return await AV.network.get(
        API_CONFIG.PERMISOS_URL,
        this._tokenPayload({ action: 'ping' })
      );
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  /** Lista remota (dashboard / consulta). Forma: count, motivos, porDia, data */
  async listarPermisosRemoto(params = {}) {
    return AV.network.get(
      API_CONFIG.PERMISOS_URL,
      this._tokenPayload({
        action: 'listarPermisos',
        fecha: params.fecha || '',
        todas: params.todas ? '1' : '',
        dni: params.dni || '',
        limit: params.limit || '',
      })
    );
  },

  async listarPermisos() {
    return { ok: true, data: AV.queue.history(), localOnly: true };
  },

  async existePaseHoy(dni, fecha) {
    const day = fecha || AV.today();
    const local = AV.queue.findPaseHoy(dni, day);
    return { ok: true, exists: !!local, data: local || null, localOnly: true };
  },

  /**
   * Guarda permiso: online → POST a code.gs; offline / fallo → cola local
   */
  async guardarPermiso(permiso) {
    const record = {
      id: permiso.id || AV.uid(),
      ...permiso,
      createdAt: permiso.createdAt || new Date().toISOString(),
      device: navigator.userAgent.slice(0, 120),
    };

    if (AV.queue.findPaseHoy(record.dni)) {
      const err = new Error('Este trabajador ya tiene un pase de salida hoy en este dispositivo.');
      err.code = 'DUPLICATE';
      throw err;
    }

    if (!navigator.onLine) {
      const queued = AV.queue.enqueue(record);
      AV.toast?.(
        'info',
        'Guardado sin internet',
        'Quedó pendiente y se subirá solo al recuperar conexión.'
      );
      return { ok: true, offline: true, data: queued || record };
    }

    try {
      const res = await this.crearPermiso(record);
      AV.queue.dropMatching?.(record);
      AV.queue.addHistory({
        ...record,
        syncStatus: 'synced',
        remoteId: res?.id || res?.data?.id,
      });
      return { ok: true, offline: false, data: record, remote: res };
    } catch (e) {
      if (e.code === 'DUPLICATE' || /ya (tiene|registr[oó])/i.test(e.message || '')) {
        AV.queue.dropMatching?.(record);
        AV.queue.addHistory({ ...record, syncStatus: 'synced' });
        throw e;
      }
      if (e.code === 'UNAUTHORIZED' || e.code === 'NO_CONFIG' || e.code === 'WRONG_API') {
        throw e;
      }
      const queued = AV.queue.enqueue(record);
      return { ok: true, offline: true, data: queued || record, error: e.message };
    }
  },
};
