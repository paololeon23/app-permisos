/**
 * Configuración — Q Berries · Pase de salida
 * Trabajadores: data/trabajadores.json (sin Apps Script de trabajadores)
 * Permisos: URL …/exec de code.gs (mismo backend que el dashboard)
 */
window.API_CONFIG = {
  /**
   * Pega aquí la URL de Apps Script (Implementar → …/exec)
   * Ejemplo: 'https://script.google.com/macros/s/XXXX/exec'
   */
  PERMISOS_URL: 'https://script.google.com/macros/s/AKfycbxQre7Ki-Jjim_FjseSOP8kblB34EZE_dkusx_DxlVIcC85S6Q86o1K5y9FinQERGjM/exec',

  /** Mismo valor que DEFAULT_API_TOKEN en code.gs / contraseña del dashboard */
  API_TOKEN: 'Permisos2026',

  /** Catálogo local (no hay API de trabajadores) */
  WORKERS_JSON: './data/trabajadores.json',

  /** Solo estos DNI pueden autorizar (dar permiso) */
  SUPERVISORES_JSON: './data/supervisores-cosecha.json',

  TIMEOUT_MS: 45000,

  WORKERS_CACHE_KEY: 'av_permisos_workers_v1',
  QUEUE_KEY: 'av_permisos_queue_v1',
  HISTORY_KEY: 'av_permisos_historial_v1',

  APP_NAME: 'Pase de salida Q Berries',
  APP_VERSION: '1.3.1',
  COMPANY: 'Q Berries',
  YEAR: 2026,
  TIMEZONE: 'America/Lima',
  PUBLIC_URL: 'https://pasessalida-qberries.netlify.app/',
  INSTALL_URL: 'https://pasessalida-qberries.netlify.app/instalar.html',
  LAUNCH_URL: 'https://pasessalida-qberries.netlify.app/abrir.html',
};
