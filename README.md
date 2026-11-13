# Pase de salida · Q Berries

App PWA + dashboard. Un solo backend: **Apps Script `code.gs`** (hoja BD-PERMISOS).

## Config rápida

1. Pega `code.gs` en Apps Script del Sheet BD-PERMISOS e implementa Web App.
2. En `core/api-config.js`:
   - `PERMISOS_URL` = URL `…/exec`
   - `API_TOKEN` = mismo que `DEFAULT_API_TOKEN` en `code.gs`
3. Trabajadores: `data/trabajadores.json` (sin API).

## Archivos clave

| Archivo | Rol |
|---------|-----|
| `code.gs` | Backend único (crear + listar para dashboard) |
| `core/api-config.js` | URL + token |
| `data/trabajadores.json` | Catálogo DNI |
| `dashboard.html` | Panel de consulta |
| `index.html` | App de registro |

## Offline

Sin red, los pases quedan **Pendiente** y se suben solos al recuperar conexión (3G+/H+/4G).
# app-permisos
# permisos-web
