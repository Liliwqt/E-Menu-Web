/**
 * Device bridge helpers.
 *
 * The Android app embeds this web app inside a WebView and injects a
 * `window.AndroidKiosk` JavaScript interface (see Android `DeviceWebBridge`).
 * That interface OBJECT name, and the `enterKioskMode` method inside it, are a
 * cross-app contract shared with the shipped Android app, so they deliberately
 * keep their original spelling. Only the JavaScript helpers below were renamed.
 *
 * These helpers let the web UI safely detect that environment and trigger the
 * Android side to switch from the dashboard WebView into the native menu mode.
 *
 * In a normal desktop/mobile browser this object is absent and every helper
 * no-ops, so the web app behaves exactly as before.
 */

function androidBridgeInterface() {
  if (typeof window === 'undefined') return null;
  return window.AndroidKiosk || null;
}

/** True when this web app is running inside the Android app WebView. */
export function isEmbeddedInApp() {
  return androidBridgeInterface() !== null;
}

/**
 * The device's anonymous Firebase Auth UID, or '' when not available
 * (e.g. normal browser, or bridge without a signed-in anonymous session).
 * Used to register the device under the account that is signed in on the web app.
 */
export function getDeviceUid() {
  const bridge = androidBridgeInterface();
  if (!bridge || typeof bridge.getDeviceUid !== 'function') return '';
  try {
    return String(bridge.getDeviceUid() || '');
  } catch (e) {
    console.error('[deviceBridge] getDeviceUid failed:', e);
    return '';
  }
}

/**
 * Ask the Android shell to switch into the native menu mode.
 * The company/branch IDs from the web workspace are handed to Android so the
 * native menu can be provisioned to the right branch without re-enrollment.
 * Safe to call in any browser: resolves false when no bridge exists.
 */
export function enterMenuMode({ companyId, branchId } = {}) {
  const bridge = androidBridgeInterface();
  // `enterKioskMode` is the Android @JavascriptInterface method name and part of
  // the cross-app contract; renaming it requires shipping Android in lockstep.
  if (!bridge || typeof bridge.enterKioskMode !== 'function') {
    console.warn('[deviceBridge] No Android bridge available — ignored.');
    return false;
  }
  try {
    bridge.enterKioskMode(companyId || '', branchId || '');
    return true;
  } catch (e) {
    console.error('[deviceBridge] enterKioskMode failed:', e);
    return false;
  }
}
