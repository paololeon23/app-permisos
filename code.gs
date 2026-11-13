/**
 * ============================================================
 * PERMISOS · Q Berries — code.gs (único backend)
 * Spreadsheet: BD-PERMISOS · hoja «Hoja 1»
 * ============================================================
 *
 * SETUP
 * 1) Abre el Google Sheet BD-PERMISOS
 * 2) Extensiones → Apps Script → pega ESTE archivo completo
 * 3) Edita DEFAULT_API_TOKEN abajo (o Propiedades → API_TOKEN)
 * 4) Guardar → Implementar → Nueva versión → Aplicación web
 *    - Ejecutar como: Yo
 *    - Quién tiene acceso: Cualquier persona
 * 5) Copia la URL …/exec → pégala en core/api-config.js → PERMISOS_URL
 *
 * ENDPOINTS
 *  POST { action:"crearPermiso", data:{...}, token|password }
 *  GET  ?action=listarPermisos&token=...&fecha=yyyy-MM-dd
 *  GET  ?action=listarPermisos&token=...&todas=1
 *  GET  ?action=obtenerPermiso&token=...&id=...
 *  GET  ?action=existePaseHoy&token=...&dni=...&fecha=...
 *  GET  ?action=ping&token=...
 *
 * GET listar/obtener → data alineada al PDF «INCIDENCIAS DEL PERSONAL» (QU-GH-FR-16)
 * Si la contraseña no coincide → { ok:false, code:"UNAUTHORIZED", message:"Contraseña incorrecta" }
 * NOTA: trabajadores NO van aquí — la app lee data/trabajadores.json
 */

var SHEET_NAME = 'Hoja 1';

/** Contraseña fija (misma en api-config.js → API_TOKEN y login del dashboard) */
var DEFAULT_API_TOKEN = 'Permisos2026';

/**
 * Columnas de BD-PERMISOS (pase de salida).
 * - Sin device / syncStatus (no aportan al negocio).
 * - horaGuardado = hora exacta en que el servidor escribió la fila (Lima).
 */
var HEADERS = [
  'id',
  'fechaRegistro',
  'horaRegistro',
  'horaGuardado',
  'dni',
  'nombres',
  'cargo',
  'fIngreso',
  'motivo',
  'fechaSalida',
  'horaSalida',
  'observacion',
  'responsable',
  'dniResponsable',
  'puestoResponsable',
  'carnetVerificado',
  'carnetDniEscaneado',
  'carnetVerificadoAt'
];

var _jsonpCb = '';

function doGet(e) {
  e = e || { parameter: {} };
  var p = e.parameter || {};
  _jsonpCb = String(p.callback || '').trim();
  var action = String(p.action || 'ping').trim();

  try {
    assertToken_(p);
    if (action === 'ping') {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      return jsonOut_({
        ok: true,
        api: 'permisos',
        sheet: SHEET_NAME,
        spreadsheet: ss ? ss.getName() : '',
        ts: nowIso_()
      });
    }
    if (action === 'existePaseHoy') {
      var chk = existePaseHoy_(p.dni, p.fecha || '');
      return jsonOut_({
        ok: true,
        exists: !!chk,
        data: chk || null,
        dni: clean_(p.dni),
        fecha: clean_(p.fecha) || hoyLima_()
      });
    }
    if (action === 'listarPermisos') {
      return jsonOut_(responderListado_(p));
    }
    if (action === 'obtenerPermiso') {
      var one = obtenerPermiso_(p.id);
      if (!one) return jsonOut_({ ok: false, message: 'No encontrado' });
      return jsonOut_({ ok: true, api: 'permisos', data: toIncidenciaPdf_(one) });
    }
    return jsonOut_({ ok: false, message: 'Acción GET no válida: ' + action });
  } catch (err) {
    var msgGet = String(err && err.message ? err.message : err).replace(/^Error:\s*/i, '');
    return jsonOut_({
      ok: false,
      code: authCode_(msgGet),
      message: msgGet
    });
  }
}

function doPost(e) {
  _jsonpCb = '';
  try {
    var body = parseBody_(e);
    // Obligatorio: sin contraseña correcta el POST no llega a guardar
    assertToken_(body);
    var action = String(body.action || 'crearPermiso').trim();
    var data = body.data || body;

    if (action === 'crearPermiso' || action === 'guardarPermiso') {
      var saved = crearPermiso_(data);
      return jsonOut_({ ok: true, api: 'permisos', id: saved.id, data: saved });
    }
    if (action === 'listarPermisos') {
      return jsonOut_(responderListado_(body));
    }
    return jsonOut_({ ok: false, message: 'Acción POST no válida: ' + action });
  } catch (err) {
    var msg = String(err && err.message ? err.message : err).replace(/^Error:\s*/i, '');
    var code = /ya tiene un pase/i.test(msg)
      ? 'DUPLICATE'
      : authCode_(msg) === 'UNAUTHORIZED'
        ? 'UNAUTHORIZED'
        : 'ERROR';
    return jsonOut_({ ok: false, code: code, message: msg });
  }
}

function expectedToken_() {
  try {
    var fromProps = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (fromProps && String(fromProps).trim()) return String(fromProps).trim();
  } catch (_) {}
  return String(DEFAULT_API_TOKEN || '').trim();
}

function authCode_(msg) {
  return /contrase[nñ]a incorrecta|no autorizado|token|password/i.test(String(msg || ''))
    ? 'UNAUTHORIZED'
    : 'ERROR';
}

/** Lee contraseña desde token / password / contraseña (body o query) */
function readPassword_(src) {
  src = src || {};
  return clean_(
    src.token ||
      src.password ||
      src.contraseña ||
      src.contrasena ||
      src.pass ||
      src.apiToken ||
      src.API_TOKEN ||
      ''
  );
}

function assertToken_(src) {
  src = src || {};
  var got = readPassword_(src);
  // A veces el cliente manda el token dentro de data
  if (!got && src.data && typeof src.data === 'object') {
    got = readPassword_(src.data);
  }
  var need = expectedToken_();
  if (!need) throw new Error('Configure la contraseña (DEFAULT_API_TOKEN) en code.gs');
  if (!got) throw new Error('Contraseña incorrecta');
  if (got !== need) throw new Error('Contraseña incorrecta');
}

function crearPermiso_(data) {
  data = data || {};
  var lock = LockService.getScriptLock();
  var got = false;
  try {
    got = lock.tryLock(30000);
    if (!got) throw new Error('El servidor está ocupado. Intente de nuevo.');

    var sh = sheet_();
    var id = String(data.id || uid_()).trim();

    var fechaRegistro = clean_(data.fechaRegistro);
    var horaRegistro = clean_(data.horaRegistro);
    if (!fechaRegistro || !horaRegistro) {
      fechaRegistro = Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');
      horaRegistro = Utilities.formatDate(new Date(), 'America/Lima', 'HH:mm:ss');
    }

    var dni = clean_(data.dni);
    if (!dni) throw new Error('DNI requerido');

    var ya = existePaseHoy_(dni, fechaRegistro);
    if (ya) {
      throw new Error(
        'Este trabajador ya tiene un pase de salida hoy (' +
          (ya.horaSalida || ya.horaRegistro || '') +
          '). No se puede registrar otro el mismo día.'
      );
    }

    // Idempotencia: mismo id ya guardado
    var prevId = obtenerPermiso_(id);
    if (prevId) {
      return {
        id: id,
        fechaRegistro: prevId.fechaRegistro,
        horaRegistro: prevId.horaRegistro,
        horaGuardado: prevId.horaGuardado || '',
        dni: prevId.dni,
        nombres: prevId.nombres,
        motivo: prevId.motivo,
        fechaSalida: prevId.fechaSalida,
        horaSalida: prevId.horaSalida,
        reused: true
      };
    }

    // Hora exacta en que se guarda en el Sheet (Lima) — esencial si hubo cola offline
    var horaGuardado = Utilities.formatDate(new Date(), 'America/Lima', 'HH:mm:ss');

    appendByHeaders_(sh, {
      id: id,
      fechaRegistro: fechaRegistro,
      horaRegistro: horaRegistro,
      horaGuardado: horaGuardado,
      dni: dni,
      nombres: clean_(data.nombres),
      cargo: clean_(data.cargo),
      fIngreso: clean_(data.fIngreso),
      motivo: clean_(data.motivo),
      fechaSalida: clean_(data.fechaSalida),
      horaSalida: clean_(data.horaSalida),
      observacion: clean_(data.observacion),
      responsable: clean_(data.responsable),
      dniResponsable: clean_(data.dniResponsable),
      puestoResponsable: clean_(data.puestoResponsable),
      carnetVerificado: data.carnetVerificado ? 'SI' : 'NO',
      carnetDniEscaneado: clean_(data.carnetDniEscaneado),
      carnetVerificadoAt: clean_(data.carnetVerificadoAt)
    });

    return {
      id: id,
      fechaRegistro: fechaRegistro,
      horaRegistro: horaRegistro,
      horaGuardado: horaGuardado,
      dni: dni,
      nombres: clean_(data.nombres),
      motivo: clean_(data.motivo),
      fechaSalida: clean_(data.fechaSalida),
      horaSalida: clean_(data.horaSalida)
    };
  } finally {
    if (got) {
      try {
        lock.releaseLock();
      } catch (_) {}
    }
  }
}

function existePaseHoy_(dni, fecha) {
  dni = clean_(dni);
  if (!dni) return null;
  var day = clean_(fecha) || hoyLima_();
  var rows = listarPermisos_({ dni: dni, fecha: day, limit: 500 });
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var fr = fechaCelda_(r.fechaRegistro);
    var fs = fechaCelda_(r.fechaSalida);
    if (fr === day || fs === day) return r;
  }
  return null;
}

function hoyLima_() {
  return Utilities.formatDate(new Date(), 'America/Lima', 'yyyy-MM-dd');
}

function fechaCelda_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, 'America/Lima', 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s.substring(0, 10);
}

function quiereTodasFechas_(params) {
  params = params || {};
  var v = String(
    params.todas != null
      ? params.todas
      : params.todasFechas != null
        ? params.todasFechas
        : params.all != null
          ? params.all
          : ''
  )
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'si' || v === 'sí' || v === 'yes';
}

function fechaFiltro_(params) {
  params = params || {};
  var f = clean_(params.fecha);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
  return hoyLima_();
}

function responderListado_(params) {
  params = params || {};
  var todas = quiereTodasFechas_(params);
  var fecha = todas ? '' : fechaFiltro_(params);
  var rows = listarPermisos_({
    dni: params.dni,
    fecha: fecha,
    todas: todas ? '1' : '',
    limit: params.limit
  });
  var stats = statsPermisos_(rows);
  // Solo GET: alinea cada fila de la hoja al PDF de incidencias
  var dataPdf = [];
  for (var i = 0; i < rows.length; i++) {
    dataPdf.push(toIncidenciaPdf_(rows[i]));
  }
  return {
    ok: true,
    api: 'permisos',
    formulario: 'QU-GH-FR-16',
    rango: { modo: todas ? 'todas' : 'dia', fecha: todas ? null : fecha, todas: todas },
    count: stats.count,
    motivos: stats.motivos,
    topMotivo: stats.topMotivo,
    porDia: stats.porDia,
    data: dataPdf
  };
}

/** Parte «APELLIDO APELLIDO NOMBRES…» (formato Perú en la hoja) */
function splitNombre_(full) {
  var parts = clean_(full).split(/\s+/).filter(function (p) {
    return !!p;
  });
  if (parts.length >= 3) {
    return {
      apellidoPaterno: parts[0],
      apellidoMaterno: parts[1],
      nombres: parts.slice(2).join(' ')
    };
  }
  if (parts.length === 2) {
    return { apellidoPaterno: parts[0], apellidoMaterno: '', nombres: parts[1] };
  }
  return { apellidoPaterno: '', apellidoMaterno: '', nombres: clean_(full) };
}

function fechaPdf_(v) {
  var iso = fechaCelda_(v);
  if (!iso || iso.length < 10) return clean_(v) || '';
  return iso.substring(8, 10) + '/' + iso.substring(5, 7) + '/' + iso.substring(0, 4);
}

/**
 * Mapeo hoja → PDF INCIDENCIAS DEL PERSONAL (solo lectura GET)
 * Incluye alias para dashboard (cargo, responsable, fechaSalida…).
 */
function toIncidenciaPdf_(r) {
  r = r || {};
  var fullName = clean_(r.nombres);
  var nom = splitNombre_(fullName);
  var fSal = fechaCelda_(r.fechaSalida) || fechaCelda_(r.fechaRegistro);
  var fSalPdf = fechaPdf_(fSal);
  var horaSal = clean_(r.horaSalida) || '-';
  return {
    id: clean_(r.id),
    // —— PDF QU-GH-FR-16 ——
    apellidoPaterno: nom.apellidoPaterno,
    apellidoMaterno: nom.apellidoMaterno,
    nombres: nom.nombres,
    nombresCompletos: fullName,
    dni: clean_(r.dni),
    area: clean_(r.area) || '',
    puesto: clean_(r.cargo),
    cargo: clean_(r.cargo),
    fechaIngreso: fechaPdf_(r.fIngreso),
    fIngreso: clean_(r.fIngreso),
    suspension: '',
    amonestacion: '',
    permiso: 'X',
    descansoTemporal: '',
    licenciaCGH: '',
    licenciaSGH: '',
    licencia: '',
    otros: '',
    cantidadDias: 1,
    fechaDel: fSalPdf,
    fechaAl: fSalPdf,
    fechaSalida: fSal || clean_(r.fechaSalida),
    horaIngreso: '-',
    horaSalida: horaSal,
    observaciones: clean_(r.observacion) || 'PERMISO',
    observacion: clean_(r.observacion),
    motivo: clean_(r.motivo),
    fecha: fechaPdf_(r.fechaRegistro || fSal),
    fechaRegistro: fechaCelda_(r.fechaRegistro) || clean_(r.fechaRegistro),
    horaRegistro: clean_(r.horaRegistro),
    horaGuardado: clean_(r.horaGuardado),
    jefeDirecto: clean_(r.responsable),
    responsable: clean_(r.responsable),
    dniResponsable: clean_(r.dniResponsable),
    puestoResponsable: clean_(r.puestoResponsable),
    carnetVerificado: clean_(r.carnetVerificado)
  };
}

function statsPermisos_(rows) {
  rows = rows || [];
  var byMotivo = {};
  var byDia = {};
  var i;
  for (i = 0; i < rows.length; i++) {
    var r = rows[i];
    var mot = clean_(r.motivo) || '(Sin motivo)';
    byMotivo[mot] = (byMotivo[mot] || 0) + 1;
    var day = fechaCelda_(r.fechaRegistro) || fechaCelda_(r.fechaSalida) || '(Sin fecha)';
    byDia[day] = (byDia[day] || 0) + 1;
  }
  var motivos = Object.keys(byMotivo)
    .map(function (k) {
      return { motivo: k, count: byMotivo[k] };
    })
    .sort(function (a, b) {
      return b.count - a.count;
    });
  var porDia = Object.keys(byDia)
    .map(function (k) {
      return { fecha: k, count: byDia[k] };
    })
    .sort(function (a, b) {
      if (a.fecha < b.fecha) return 1;
      if (a.fecha > b.fecha) return -1;
      return 0;
    });
  return {
    count: rows.length,
    motivos: motivos,
    topMotivo: motivos.length ? { motivo: motivos[0].motivo, count: motivos[0].count } : null,
    porDia: porDia
  };
}

function listarPermisos_(params) {
  params = params || {};
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var key = String(headers[c] || '').trim();
      if (!key) continue;
      var val = values[i][c];
      if (key === 'fechaRegistro' || key === 'fechaSalida' || key === 'fIngreso') {
        obj[key] = fechaCelda_(val) || clean_(val);
      } else {
        obj[key] = val;
      }
    }
    out.push(fixShiftedRow_(obj));
  }
  out.reverse();

  var dni = clean_(params.dni);
  if (dni) {
    out = out.filter(function (r) {
      return String(r.dni || '') === dni;
    });
  }

  if (!quiereTodasFechas_(params)) {
    var day = fechaFiltro_(params);
    out = out.filter(function (r) {
      var fr = fechaCelda_(r.fechaRegistro);
      var fs = fechaCelda_(r.fechaSalida);
      return fr === day || fs === day;
    });
  }

  var limit = parseInt(params.limit, 10);
  if (!limit || limit < 1) limit = quiereTodasFechas_(params) ? 2000 : 500;
  if (limit > 5000) limit = 5000;
  return out.slice(0, limit);
}

function obtenerPermiso_(id) {
  id = clean_(id);
  if (!id) return null;
  var rows = listarPermisos_({ limit: 5000, todas: '1' });
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === id) return rows[i];
  }
  return null;
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No hay spreadsheet activo. Abre BD-PERMISOS y pega el script allí.');
  var sh = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  if (!sh) throw new Error('El archivo no tiene hojas');
  ensureHeaders_(sh);
  return sh;
}

function headerNames_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  return sh
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .map(function (c) {
      return String(c || '').trim();
    });
}

function paintHeaders_(sh) {
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#1b6b3a')
    .setFontColor('#ffffff');
}

/** Escribe una fila alineada a los encabezados REALES de la hoja */
function appendByHeaders_(sh, fields) {
  fields = fields || {};
  var headers = headerNames_(sh);
  if (!headers.length || !headers[0]) {
    paintHeaders_(sh);
    headers = HEADERS.slice();
  }
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var key = headers[i];
    if (!key) {
      row.push('');
      continue;
    }
    row.push(fields[key] != null ? fields[key] : '');
  }
  sh.appendRow(row);
}

/**
 * Si alguien renombró encabezados sin insertar columna, el DNI queda en horaGuardado.
 * Repara la fila en memoria para el GET/PDF.
 */
function fixShiftedRow_(obj) {
  obj = obj || {};
  var dni = clean_(obj.dni);
  if (/^\d{8,12}$/.test(dni)) return obj;
  var maybe = clean_(obj.horaGuardado);
  if (!/^\d{8,12}$/.test(String(maybe))) return obj;
  return {
    id: obj.id,
    fechaRegistro: obj.fechaRegistro,
    horaRegistro: obj.horaRegistro,
    horaGuardado: '',
    dni: String(maybe),
    nombres: obj.dni,
    cargo: obj.nombres,
    fIngreso: obj.cargo,
    motivo: obj.fIngreso,
    fechaSalida: obj.motivo,
    horaSalida: obj.fechaSalida,
    observacion: obj.horaSalida,
    responsable: obj.observacion,
    dniResponsable: obj.responsable,
    puestoResponsable: obj.dniResponsable,
    carnetVerificado: obj.puestoResponsable,
    carnetDniEscaneado: obj.carnetVerificado,
    carnetVerificadoAt: obj.carnetDniEscaneado
  };
}

function ensureHeaders_(sh) {
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();

  if (lastRow === 0 || lastCol === 0) {
    paintHeaders_(sh);
    return;
  }

  var current = headerNames_(sh);
  var first = String(current[0] || '').toLowerCase();
  var lower = current.map(function (c) {
    return String(c || '').toLowerCase();
  });

  // Solo encabezado / hoja casi vacía
  if (first !== 'id' && first !== 'fecharegistro' && first !== 'dni' && lastRow <= 1) {
    sh.clear();
    paintHeaders_(sh);
    return;
  }

  // NUNCA renombrar a ciegas con datos: insertar columna horaGuardado si falta
  var idxHg = lower.indexOf('horaguardado');
  var idxHr = lower.indexOf('horaregistro');
  if (idxHg < 0 && idxHr >= 0 && lastRow >= 1) {
    sh.insertColumnAfter(idxHr + 1);
    sh.getRange(1, idxHr + 2).setValue('horaGuardado');
    sh.getRange(1, idxHr + 2).setFontWeight('bold').setBackground('#1b6b3a').setFontColor('#ffffff');
    current = headerNames_(sh);
    lower = current.map(function (c) {
      return String(c || '').toLowerCase();
    });
  }

  // Quitar columnas device / syncStatus (desde el final para no desalinear índices)
  for (var i = lower.length - 1; i >= 0; i--) {
    if (lower[i] === 'device' || lower[i] === 'syncstatus') {
      sh.deleteColumn(i + 1);
    }
  }
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    var out = {};
    var parts = String(e.postData.contents).split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv.length >= 2) {
        out[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('=').replace(/\+/g, ' '));
      }
    }
    return out;
  }
}

function jsonOut_(obj) {
  var out = JSON.stringify(obj);
  if (_jsonpCb) {
    return ContentService.createTextOutput(_jsonpCb + '(' + out + ')').setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

function nowIso_() {
  return new Date().toISOString();
}

function uid_() {
  return 'P' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();
}

function clean_(v) {
  if (v == null) return '';
  return String(v).trim();
}

function myFunction() {
  testPing();
}

function testPing() {
  Logger.log(doGet({ parameter: { action: 'ping', token: expectedToken_() } }).getContent());
}

function testListarHoy() {
  Logger.log(
    doGet({ parameter: { action: 'listarPermisos', token: expectedToken_() } }).getContent()
  );
}
