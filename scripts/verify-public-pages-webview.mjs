/**
 * The public-page checks, run inside the REAL Android WebView.
 *
 * Why this is separate from `verify-public-pages.mjs`: a desktop browser is not the
 * environment the portal mostly runs in. This project's own history records that
 * `vh`/`dvh`/`svh`/`lvh` all resolve to `0px` in the Android WebView while
 * `innerHeight` is correct — a class of bug that no desktop check and no build can
 * catch, because the CSS is valid and a desktop browser lays it out correctly.
 *
 * How it reaches the page: it attaches to a WebView already open in the installed
 * debug app over CDP and fulfils every request from the local `dist`. Nothing is
 * installed, no app data is cleared, no PIN is needed, and no business data is
 * written — the public pages are anonymous and the routes only issue GET/HEAD.
 *
 * Serving through CDP rather than pointing the device at the laptop avoids two
 * traps. The app sets `usesCleartextTraffic=false`, so an http:// preview fails with
 * ERR_CLEARTEXT_NOT_PERMITTED; and `adb reverse` to a self-signed HTTPS origin
 * needs either a trusted certificate on the device or a CDP override. Intercepting
 * requests sidesteps both and still measures the real WebView on the real build.
 *
 * That first trap is worth dwelling on: an error page has no header, no paragraphs
 * and no horizontal overflow, so the first version of this script "passed" every
 * layout check while measuring a browser error. Hence the assertions that the app
 * actually rendered before anything is measured.
 *
 * Usage:
 *   npm run build
 *   adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>
 *   PLAYWRIGHT_MODULE=<path-to-playwright/index.js> npm run verify:public-pages-webview
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const OUT = process.env.PUBLIC_ARTIFACTS || '/tmp/e-menu-public-webview';
const CDP = process.env.WEBVIEW_CDP_URL || 'http://127.0.0.1:9223';
await fs.mkdir(OUT, { recursive: true });

const playwright = await import(process.env.PLAYWRIGHT_MODULE);
const { chromium } = playwright.chromium ? playwright : playwright.default;

const ROUTES = ['/', '/about', '/pricing', '/help', '/contact', '/terms', '/privacy', '/cookies', '/acceptable-use', '/refund-policy'];

let failures = 0;
const results = [];
function report(name, ok, detail) {
  if (!ok) failures += 1;
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp' };

let browser;
try {
  browser = await chromium.connectOverCDP(CDP, { noDefaults: true });
} catch (error) {
  console.error(`Could not attach to the app WebView at ${CDP}.\n`);
  console.error('  Check the device and forward the port:\n');
  console.error('    adb devices\n');
  console.error('    adb forward tcp:9223 localabstract:webview_devtools_remote_$(adb shell pidof com.example.androidkiosk)\n');
  console.error(`  Underlying error: ${error.message}`);
  process.exit(2);
}

const context = browser.contexts()[0];
const page = context.pages()[0];

if (!page) {
  // `MainActivity` swaps between three surfaces: the native Compose menu and two
  // WebView surfaces (SETUP_WEB and ADMIN_WEB). Only the WebView surfaces expose a
  // devtools target, and on this build both are reached through the PIN-locked
  // admin panel — so an app sitting on the native menu has no target at all.
  //
  // This is a real gate, not something to work around: the portal WebView may hold
  // a signed-in Firebase session, and driving it without the operator unlocking it
  // would be reaching past a deliberate control. Report it and stop.
  console.error('Attached to the app, but it has no WebView open.\n');
  console.error('  The portal only runs inside the PIN-locked admin panel. On the native');
  console.error('  menu there is no WebView target to measure.\n');
  console.error('  To run this check, unlock the admin panel on the device (Admin button,');
  console.error('  top-right of the menu), then re-run with the app left on that screen.\n');
  console.error('  Nothing is installed and no app data is cleared either way.');
  await browser.close().catch(() => {});
  process.exit(2);
}

page.setDefaultTimeout(20000);
const originalUrl = page.url();
const pageErrors = [];

if (!(await fs.readFile(path.join(dist, 'index.html'), 'utf8').catch(() => null))) {
  console.error('dist/index.html is missing — run `npm run build` first.');
  process.exit(2);
}

try {
  console.log('0. Attaching to the installed app WebView');
  const env = await page.evaluate(() => ({
    ua: navigator.userAgent,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    bridge: typeof window.AndroidKiosk,
    hasResizeObserver: typeof ResizeObserver === 'function',
  }));
  console.log(`       UA ${env.ua}`);
  report('this is the Android WebView, not a desktop browser', /\bwv\)|Android/.test(env.ua), env.ua.match(/Chrome\/[\d.]+/)?.[0]);
  report('the portal is really embedded (device bridge present)', env.bridge === 'object', `window.AndroidKiosk is ${env.bridge}`);
  report('ResizeObserver exists, so the header offset can be measured', env.hasResizeObserver === true);
  report('viewport height is non-zero', env.innerHeight > 0, `innerHeight ${env.innerHeight}px`);

  console.log('\n1. The viewport-height trap, confirmed on this device');
  // If a future stylesheet reintroduces 100vh, this reports the collapse instead of
  // the suite silently shipping it.
  const vh = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:100vh';
    document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    probe.remove();
    return { height, innerHeight: window.innerHeight };
  });
  console.log(`       100vh computed to ${vh.height}px while innerHeight is ${vh.innerHeight}px`);
  report('100vh is still collapsed to 0 here (the trap this suite guards)', vh.height === 0, `100vh = ${vh.height}px`);

  console.log('\n2. Serving the local build through the device WebView');
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return route.abort();
    // The public pages are client-side routes, so anything that is not a real file
    // falls back to index.html exactly as the hosting rewrite does.
    const file = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/branding/')
      ? path.join(dist, url.pathname)
      : path.join(dist, 'index.html');
    try {
      const body = await fs.readFile(file);
      return route.fulfill({
        status: 200,
        body,
        contentType: MIME[path.extname(file)] || 'text/plain',
        headers: { 'cache-control': 'no-store' },
      });
    } catch {
      return route.fulfill({ status: 404, body: '' });
    }
  });

  // Navigate through the app's own origin so relative asset paths resolve as they do
  // in production, then assert the app really rendered. Without this an error page
  // satisfies every "no overflow" check.
  const goto = async (route) => {
    await page.goto(`http://127.0.0.1:4173${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root > *', { timeout: 15000 });
    const probe = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
      text: document.body.innerText.slice(0, 200),
    }));
    if (/ERR_|error code|can't (load|reach)/i.test(probe.text + probe.url)) {
      throw new Error(`the WebView showed an error page: ${probe.text.slice(0, 80)}`);
    }
    return probe;
  };

  const first = await goto('/cookies');
  report('the local build renders inside the device WebView', first.rootChildren > 0, `"${first.title}"`);

  console.log('\n3. The sticky header offset is measured, not guessed');
  // --pub-header-h is published by a ResizeObserver. If that silently failed it
  // would keep the CSS fallback and anchored headings would hide behind the header
  // on exactly the devices that wrap it to two rows.
  for (const route of ['/cookies', '/terms', '/privacy']) {
    try {
      await goto(route);
      await page.waitForSelector('.pub__header', { timeout: 10000 });
      const header = await page.evaluate(() => {
        const el = document.querySelector('.pub__header');
        const chapter = document.querySelector('[data-chapter]');
        return {
          realHeight: Math.ceil(el.getBoundingClientRect().height),
          cssVar: getComputedStyle(document.querySelector('.pub')).getPropertyValue('--pub-header-h').trim(),
          offset: chapter ? getComputedStyle(chapter).scrollMarginTop : null,
        };
      });
      const declared = Number.parseFloat(header.cssVar);
      const tracks = Number.isFinite(declared) && Math.abs(declared - header.realHeight) <= 1
        && Math.abs(Number.parseFloat(header.offset) - header.realHeight - 16) <= 1;
      report(
        `sticky offset tracks the real header (${route})`,
        tracks,
        `header ${header.realHeight}px, --pub-header-h ${header.cssVar}, scroll-margin ${header.offset}`,
      );
    } catch (error) {
      report(`sticky offset tracks the real header (${route})`, false, error.message.split('\n')[0]);
    }
  }

  console.log('\n4. Anchored headings clear the header on the device');
  for (const route of ['/cookies', '/help']) {
    try {
      await goto(route);
      await page.waitForSelector('[data-chapter]', { timeout: 10000 });
      const anchors = await page.evaluate(() => {
        const header = document.querySelector('.pub__header');
        const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
        const ids = [...document.querySelectorAll('[data-chapter]')].map((s) => s.dataset.chapter);
        let worst = Infinity;
        for (const id of ids) {
          location.hash = `#${id}`;
          const section = document.getElementById(id);
          if (!section) continue;
          const heading = section.querySelector('h2') || section;
          const gap = heading.getBoundingClientRect().top - headerBottom;
          if (gap < worst) worst = gap;
        }
        location.hash = '';
        return { worst: Math.round(worst), count: ids.length };
      });
      report(
        `every anchored heading sits below the header (${route})`,
        anchors.count > 0 && anchors.worst >= 0,
        `tightest gap ${anchors.worst}px across ${anchors.count} anchors`,
      );
    } catch (error) {
      report(`every anchored heading sits below the header (${route})`, false, error.message.split('\n')[0]);
    }
  }

  console.log('\n5. No horizontal overflow at the device viewport');
  for (const route of ROUTES) {
    try {
      await goto(route);
      const fit = await page.evaluate(() => {
        const de = document.documentElement;
        let widest = 0;
        for (const el of document.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width > 0) widest = Math.max(widest, r.right);
        }
        return { scrollW: de.scrollWidth, clientW: de.clientWidth, widest: Math.round(widest) };
      });
      report(`no horizontal scroll (${route})`, fit.scrollW <= fit.clientW + 1, `content ${fit.scrollW}px in ${fit.clientW}px`);
    } catch (error) {
      report(`no horizontal scroll (${route})`, false, error.message.split('\n')[0]);
    }
  }

  console.log('\n6. Long text and email addresses wrap on the device');
  for (const route of ['/contact', '/help', '/privacy']) {
    try {
      await goto(route);
      await page.waitForSelector('.pub__main', { timeout: 10000 });
      const wrap = await page.evaluate(() => {
        const targets = [...document.querySelectorAll('.pub__main p, .pub__main a, .pub__main li, .pub__main h2')];
        const ruleOf = (el) => {
          const s = getComputedStyle(el);
          return s.overflowWrap || s.wordWrap;
        };
        const breaking = targets.filter((el) => /break-word|break-all|anywhere/.test(ruleOf(el)));
        // The support address is the longest unbroken string on these pages.
        const email = [...document.querySelectorAll('.pub__main a')]
          .find((a) => /^mailto:/.test(a.getAttribute('href') || ''));
        const overflowing = email
          ? email.getBoundingClientRect().right > document.documentElement.clientWidth + 1
          : false;
        return {
          total: targets.length,
          breaking: breaking.length,
          rule: email ? ruleOf(email) : null,
          emailFound: !!email,
          emailOverflows: overflowing,
        };
      });
      report(
        `long strings can break (${route})`,
        wrap.total > 0 && wrap.breaking > 0,
        `${wrap.breaking}/${wrap.total} elements carry a break rule`,
      );
      report(
        `the support address stays inside the viewport (${route})`,
        !wrap.emailOverflows,
        wrap.emailFound ? `overflow-wrap: ${wrap.rule}` : 'no mailto link on this page',
      );
    } catch (error) {
      report(`long strings can break (${route})`, false, error.message.split('\n')[0]);
    }
  }

  console.log('\n7. The draft notice is shown on the device');
  try {
    await goto('/privacy');
    await page.waitForSelector('.pub__notice', { timeout: 10000 });
    const draft = await page.evaluate(() => document.querySelector('.pub__notice')?.textContent?.trim() ?? null);
    report('policies still show the draft notice', !!draft && /draft/i.test(draft), draft || 'no notice found');
  } catch (error) {
    report('policies still show the draft notice', false, error.message.split('\n')[0]);
  }

  console.log('\n8. The sign-in overlay is readable on the device');
  try {
    await goto('/');
    await page.getByRole('button', { name: /need help/i }).first().click({ timeout: 10000 });
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    const overlay = await page.evaluate(() => {
      const panel = document.querySelector('.modal-panel');
      if (!panel) return null;
      const rect = panel.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        fitsViewport: rect.right <= window.innerWidth + 1 && rect.left >= -1,
        texts: [...new Set([...panel.querySelectorAll('p, h3, a')].map((el) => getComputedStyle(el).color))],
      };
    });
    report('the help overlay fits the device viewport', !!overlay?.fitsViewport, overlay ? `${overlay.width}px wide` : 'no panel');
    report(
      'the overlay uses themed colours, not fixed hex',
      !!overlay && overlay.texts.length > 0 && overlay.texts.every((c) => /^rgba?\(/.test(c)),
      overlay ? `${overlay.texts.length} distinct colours` : '',
    );
  } catch (error) {
    report('the help overlay renders on the device', false, error.message.split('\n')[0]);
  }

  console.log('\n9. Nothing errored while rendering');
  report('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'clean');

  for (const [name, route] of [['webview-cookies', '/cookies'], ['webview-terms', '/terms'], ['webview-login', '/']]) {
    try {
      await goto(route);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    } catch {
      // A screenshot is evidence, not a check; a failure here must not mask results.
    }
  }
} finally {
  await context.unroute('**/*').catch(() => {});
  await page.goto(originalUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await browser.close().catch(() => {});
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${results.filter((r) => r.ok).length}/${results.length} device checks passed`);
console.log(`screenshots: ${OUT}`);
if (failures) {
  console.log('\nfailures:');
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
}
process.exit(failures === 0 ? 0 : 1);