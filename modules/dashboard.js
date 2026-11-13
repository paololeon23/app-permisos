/**
 * Dashboard de permisos — lee listarPermisos de code.gs
 * Misma URL/token que la app (api-config.js)
 */
(() => {
  const SESSION_KEY = 'av_dash_ok_v1';
  let rows = [];

  const $ = (id) => document.getElementById(id);

  function isAuthed() {
    try {
      return sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      return false;
    }
  }

  function setAuthed(ok) {
    try {
      if (ok) sessionStorage.setItem(SESSION_KEY, '1');
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (_) {}
  }

  function showApp(show) {
    $('loginGate').hidden = show;
    $('dashApp').hidden = !show;
  }

  function todayInput() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function motivoKey(m) {
    return String(m || '')
      .trim()
      .toLowerCase();
  }

  function renderStats(list) {
    const total = list.length;
    let salud = 0;
    let carnet = 0;
    list.forEach((r) => {
      if (/salud/i.test(motivoKey(r.motivo))) salud++;
      if (String(r.carnetVerificado || '').toUpperCase() === 'SI' || r.carnetVerificado === true) {
        carnet++;
      }
    });
    $('statTotal').textContent = String(total);
    $('statSalud').textContent = String(salud);
    $('statCarnet').textContent = String(carnet);
    $('statOk').textContent = String(total);
  }

  function filtered() {
    const q = String($('filtroQ').value || '')
      .trim()
      .toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const blob = [r.dni, r.nombres, r.motivo, r.responsable, r.cargo]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return blob.includes(q);
    });
  }

  function renderList() {
    const list = filtered();
    renderStats(list);
    const box = $('dashList');
    if (!list.length) {
      box.innerHTML = '<p class="helper">No hay pases para este filtro.</p>';
      return;
    }
    box.innerHTML = list
      .map((r) => {
        const carnet =
          String(r.carnetVerificado || '').toUpperCase() === 'SI' || r.carnetVerificado === true
            ? 'Carnet OK'
            : 'Sin carnet';
        return `<article class="dash-item card">
          <div class="dash-item-main">
            <strong>${escapeHtml(r.nombres || '—')}</strong>
            <span class="helper">DNI ${escapeHtml(r.dni || '—')} · ${escapeHtml(r.motivo || '—')}</span>
            <span class="helper">${escapeHtml(r.fechaSalida || r.fechaRegistro || '')} ${escapeHtml(r.horaSalida || '')} · ${carnet}</span>
          </div>
          <button type="button" class="btn btn-secondary dash-btn-sm" data-pdf="${escapeHtml(r.id || '')}">PDF</button>
        </article>`;
      })
      .join('');

    box.querySelectorAll('[data-pdf]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-pdf');
        const row = rows.find((x) => String(x.id) === String(id)) || null;
        if (row && AV.pdf?.preview) AV.pdf.preview(row);
      });
    });
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function load() {
    const status = $('dashStatus');
    status.textContent = 'Cargando…';
    const todas = $('filtroTodas').checked;
    const fecha = $('filtroFecha').value || todayInput();
    try {
      const token = String(API_CONFIG.API_TOKEN || '').trim();
      const res = await AV.network.get(API_CONFIG.PERMISOS_URL, {
        action: 'listarPermisos',
        token,
        fecha: todas ? '' : fecha,
        todas: todas ? '1' : '',
        limit: todas ? '2000' : '500',
      });
      if (!res || res.ok === false) {
        throw new Error(res?.message || 'No se pudo listar');
      }
      rows = Array.isArray(res.data) ? res.data : [];
      status.textContent = todas
        ? `${res.count ?? rows.length} pases (todas las fechas)`
        : `${res.count ?? rows.length} pases del ${fecha}`;
      if (res.topMotivo?.motivo) {
        status.textContent += ` · Top: ${res.topMotivo.motivo} (${res.topMotivo.count})`;
      }
      renderList();
    } catch (e) {
      rows = [];
      renderList();
      status.textContent = e.message || 'Error al cargar';
    }
    if (window.lucide) lucide.createIcons();
  }

  function boot() {
    $('filtroFecha').value = todayInput();

    $('loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const pass = String($('dashPass').value || '');
      const need = String(API_CONFIG.API_TOKEN || '');
      if (pass && pass === need) {
        $('loginError').hidden = true;
        setAuthed(true);
        showApp(true);
        load();
      } else {
        $('loginError').hidden = false;
      }
    });

    $('btnLogout')?.addEventListener('click', () => {
      setAuthed(false);
      showApp(false);
    });
    $('btnRefresh')?.addEventListener('click', () => load());
    $('filtroFecha')?.addEventListener('change', () => {
      if (!$('filtroTodas').checked) load();
    });
    $('filtroTodas')?.addEventListener('change', () => load());
    $('filtroQ')?.addEventListener('input', () => renderList());

    $('pdfModalClose')?.addEventListener('click', () => {
      $('pdfModal').hidden = true;
    });
    $('pdfModalCancel')?.addEventListener('click', () => {
      $('pdfModal').hidden = true;
    });

    if (isAuthed()) {
      showApp(true);
      load();
    } else {
      showApp(false);
    }
    if (window.lucide) lucide.createIcons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
