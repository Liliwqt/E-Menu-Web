/**
 * Kiosk bridge helpers.
 *
 * The Android kiosk app embeds this web app inside a WebView and injects a
 * `window.AndroidKiosk` JavaScript interface (see Android `KioskWebBridge`).
 * These helpers let the web UI safely detect that environment and trigger the
 * Android side to switch from the dashboard WebView into the native locked
 * kiosk menu mode.
 *
 * In a normal desktop/mobile browser this object is absent and every helper
 * no-ops, so the web app behaves exactly as before.
 */

function androidKioskInterface() {
  if (typeof window === 'undefined') return null;
  return window.AndroidKiosk || null;
}

/** True when this web app is running inside the Android kiosk WebView. */
export function isEmbeddedInKiosk() {
  return androidKioskInterface() !== null;
}

/**
 * The device's anonymous Firebase Auth UID, or '' when not available
 * (e.g. normal browser, or bridge without a signed-in anonymous session).
 * Used to register the kiosk under the account that is signed in on the web app.
 */
export function getDeviceUid() {
  const bridge = androidKioskInterface();
  if (!bridge || typeof bridge.getDeviceUid !== 'function') return '';
  try {
    return String(bridge.getDeviceUid() || '');
  } catch (e) {
    console.error('[kioskBridge] getDeviceUid failed:', e);
    return '';
  }
}

/**
 * Ask the Android shell to switch into the native locked kiosk menu mode.
 * The company/branch IDs from the web workspace are handed to Android so the
 * native menu can be provisioned to the right branch without re-enrollment.
 * Safe to call in any browser: resolves false when no bridge exists.
 */
export function enterKioskMode({ companyId, branchId } = {}) {
  const bridge = androidKioskInterface();
  if (!bridge || typeof bridge.enterKioskMode !== 'function') {
    console.warn('[kioskBridge] No Android bridge available — ignored.');
    return false;
  }
  try {
    bridge.enterKioskMode(companyId || '', branchId || '');
    return true;
  } catch (e) {
    console.error('[kioskBridge] enterKioskMode failed:', e);
    return false;
  }
}