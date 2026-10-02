/**
 * Browser regression checks for the sign-in page and the nine public pages.
 *
 * These exist because the source-inspection tests in
 * `src/lib/publicSiteRedesign.test.js` all passed while seven real defects were
 * present and visible on screen. Reading source proves the code says what the
 * test claims; it cannot prove the browser lays it out, computes a contrast
 * ratio, wraps a line, resolves a sticky offset, or carries a colour through a
 * theme switch. Every check here is a rendered measurement or an observed
 * state transition, The focused regressions are also run against the pre-fix build.
 *
 * Runs against `vite preview` (a production build) or `vite dev`. Anonymous
 * pages only: no sign-in, no Firebase write, no production access. The script
 * refuses to talk to anything but loopback.
 *
 *   npm run build
 *   npx vite preview --port 4173 &
 *   PLAYWRIGHT_MODULE=<path-to-playwright> \
 *   BROWSER_PATH=/snap/bin/brave npm run verify:public-pages
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// ESM will not resolve a bare directory, so PLAYWRIGHT_MODULE must point at the
// package's entry file (…/playwright/index.js) rather than the folder. That file
// is CommonJS, so a named import yields nothing useful and the real exports arrive
// on `default` — accept either shape.
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const { chromium } = playwright.chromium ? playwright : playwright.default;

const ORIGIN = process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:4173';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(ORIGIN)) {
  throw new Error(`Refusing to verify against a non-loopback origin: ${ORIGIN}`);
}

const OUT = process.env.PUBLIC_ARTIFACTS || '/tmp/e-menu-public-pages';
await mkdir(OUT, { recursive: true });

const PUBLIC_ROUTES = [
  '/about', '/pricing', '/help', '/contact',
  '/terms', '/privacy', '/cookies', '/acceptable-use', '/refund-policy',
];

const results = [];
let failures = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures += 1;
    results.push({ name, ok: false, detail: error.message });
    console.log(`  FAIL ${name}\n       ${error.message.split('\n')[0]}`);
  }
}

/** WCAG relative luminance, inlined so it can run inside the page. */
const CONTRAST_FN = `
  (fgColor, fgBgColor) => {
    const parse = (value) => {
      const m = String(value).match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      const parts = m[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    // Composite a translucent foreground over its backdrop.
    const flatten = (fg, back) => ({
      r: fg.r * fg.a + back.r * (1 - fg.a),
      g: fg.g * fg.a + back.g * (1 - fg.a),
      b: fg.b * fg.a + back.b * (1 - fg.a),
      a: 1,
    });
    const lum = (c) => {
      const ch = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
    };
    let back = parse(fgBgColor) || { r: 255, g: 255, b: 255, a: 1 };
    let fore = parse(fgColor);
    if (!fore) return null;
    if (back.a < 1) back = flatten(back, { r: 255, g: 255, b: 255, a: 1 });
    if (fore.a < 1) fore = flatten(fore, back);
    const l1 = lum(fore); const l2 = lum(back);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
`;

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH || undefined,
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
// Never contact Firebase or send email during public-page verification.
let mockedResetRequests = 0;
await context.route('**/*', (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.hostname === 'identitytoolkit.googleapis.com'
      && url.pathname.endsWith('/accounts:sendOobCode') && request.method() === 'POST') {
    const body = request.postDataJSON();
    if (body?.email !== 'review@example.test' || body?.requestType !== 'PASSWORD_RESET') return route.abort();
    mockedResetRequests += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: body.email }) });
  }
  return url.origin === ORIGIN && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort();
});
const page = await context.newPage();

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

const setTheme = async (theme) => {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForTimeout(120);
};

const goto = async (route, width = 390) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`${ORIGIN}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
};

console.log('\n1. Help overlay contrast in both themes');
// Guarded for the same reason as section 2: an old build may not have the overlay
// at all, and an unguarded click would abort before any later section ran.
let overlayOpen = false;
await check('the Need help overlay opens', async () => {
  await goto('/');
  await page.getByRole('button', { name: /need help/i }).first().click({ timeout: 10000 });
  await page.waitForTimeout(300);
  overlayOpen = true;
  return 'dialog present';
});

for (const theme of ['light', 'dark']) {
  if (!overlayOpen) break;
  await setTheme(theme);
  // The dialog is portalled to <body> and inherits the document theme, so the
  // overlay body text must resolve against the themed surface, not a fixed hex.
  await check(`help overlay body text is readable (${theme})`, async () => {
    const ratio = await page.evaluate(`(() => {
      const contrast = ${CONTRAST_FN};
      const panel = document.querySelector('.modal-panel');
      const panelBg = getComputedStyle(panel).backgroundColor;
      const worst = [];
      for (const el of panel.querySelectorAll('p, h3, a, span, strong')) {
        const style = getComputedStyle(el);
        const r = contrast(style.color, panelBg);
        if (r === null) continue;
        worst.push({ text: el.textContent.trim().slice(0, 40), ratio: Math.round(r * 100) / 100 });
      }
      worst.sort((a, b) => a.ratio - b.ratio);
      return { worst: worst[0], all: worst };
    })()`);
    assert.ok(ratio.worst, 'expected measurable text in the overlay');
    assert.ok(
      ratio.worst.ratio >= 4.5,
      `lowest contrast in the overlay is ${ratio.worst.ratio}:1 for "${ratio.worst.text}" (needs 4.5:1)`,
    );
    return `lowest ${ratio.worst.ratio}:1`;
  });

  await check(`support hours meet normal-text contrast (${theme})`, async () => {
    const ratio = await page.evaluate(`(() => {
      const contrast = ${CONTRAST_FN};
      const hours = document.querySelector('.lg__helpHours');
      const panel = document.querySelector('.modal-panel');
      return hours ? contrast(getComputedStyle(hours).color, getComputedStyle(panel).backgroundColor) : null;
    })()`);
    assert.ok(ratio >= 4.5, `support hours contrast ${ratio?.toFixed(2)}:1 is below 4.5:1`);
    return `${ratio.toFixed(2)}:1`;
  });
}

await setTheme('light');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

console.log('\n2. Contents list rebuilds on route change');
// The navigation itself sits outside `check()` so the two assertions below can
// compare before/after. If the link is missing (an older layout, say) that would
// abort the whole run and hide every later failure, so it is guarded here and the
// remainder of this section is skipped instead.
let firstLabels = null;
await check('the previous page rendered a contents list to compare against', async () => {
  await goto('/cookies');
  firstLabels = (await page.locator('.pub__contentsList a').allTextContents()).map((s) => s.trim());
  assert.ok(firstLabels.length > 0, 'no contents entries were rendered on /cookies');
  return `${firstLabels.length} entries`;
});

if (firstLabels) {
  await check('a reader can reach another policy from the footer', async () => {
    // Navigate the way a reader does — an in-app link, so React Router handles it
    // and the page component is reused rather than remounted. A full page load would
    // remount everything and pass whether or not the effect re-runs on a route change.
    await page.locator('.pub__footer a[href="/terms"]').first().click({ timeout: 10000 });
    await page.waitForURL('**/terms', { timeout: 10000 });
    await page.waitForTimeout(300);
    return 'reached /terms without a reload';
  });

  await check('contents list is rebuilt after a client-side route change', async () => {
    const labels = (await page.locator('.pub__contentsList a').allTextContents()).map((s) => s.trim());
    assert.notDeepEqual(
      labels, firstLabels,
      `the contents still shows the previous page's entries: ${labels.join(', ')}`,
    );
    const articles = (await page.locator('[data-chapter] h2').allTextContents()).map((s) => s.trim());
    assert.deepEqual(
      labels, articles,
      'contents entries do not match the headings actually rendered',
    );
    return `${labels.length} entries match the new article`;
  });
}

console.log('\n3. 200% text does not overflow horizontally');
for (const route of ['/', ...PUBLIC_ROUTES]) {
  await goto(route);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.waitForTimeout(250);
  await check(`no horizontal scroll at 200% text (${route})`, async () => {
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const offenders = [...document.querySelectorAll('body *')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.right > doc.clientWidth + 1)
        .map(({ el, r }) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} right=${Math.round(r.right)}`);
      return {
        overflow: doc.scrollWidth > doc.clientWidth,
        clientWidth: doc.clientWidth,
        scrollWidth: doc.scrollWidth,
        offenders: offenders.slice(0, 4),
      };
    });
    assert.ok(
      !m.overflow,
      `scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}; widest: ${m.offenders.join(' | ') || 'unknown'}`,
    );
    return `fits in ${m.clientWidth}px`;
  });
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
}

console.log('\n3b. Long unbroken strings wrap');
for (const route of ['/contact', '/help', '/terms']) {
  await goto(route);
  await check(`long unbroken strings wrap (${route})`, async () => {
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      // A URL, an email address or an ID has no spaces, so it only wraps when the
      // element declares a break rule. `word-break: break-word` is the legacy alias
      // of `overflow-wrap: anywhere` and does wrap; both count.
      const wraps = (el) => {
        const s = getComputedStyle(el);
        return s.overflowWrap === 'anywhere' || s.overflowWrap === 'break-word'
          || s.wordBreak === 'break-all' || s.wordBreak === 'break-word';
      };
      const candidates = [...document.querySelectorAll('.pub__main a, .pub__main p, .pub__main li, .pub__main h1, .pub__main h2, .pub__contactEmail, .pub__list a')];
      const unwrapped = candidates
        .filter((el) => !wraps(el))
        .filter((el) => {
          // Only a problem if the element really can exceed its container.
          const style = getComputedStyle(el);
          return style.whiteSpace !== 'nowrap' && style.display !== 'inline-block';
        })
        .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
      return {
        total: candidates.length,
        unwrapped: [...new Set(unwrapped)],
        fits: doc.scrollWidth <= doc.clientWidth,
      };
    });
    assert.deepEqual(
      m.unwrapped, [],
      `these text elements have no break rule, so an unbroken string will scroll sideways: ${m.unwrapped.join(', ')}`,
    );
    assert.ok(m.fits, 'the page still scrolls sideways');
    return `${m.total} elements carry a break rule`;
  });
}

console.log('\n4. Anchored headings clear the sticky header');
// The header wraps to two rows on a narrow phone, so the offset that keeps a
// jumped-to heading visible is width-dependent. Actually jump, then measure —
// merely measuring an unscrolled page proves nothing, because every heading is
// already below the header in normal flow.
for (const width of [320, 390, 768, 1280]) {
 for (const textScale of [100, 200]) {
  await goto('/privacy', width);
  await page.evaluate((scale) => { document.documentElement.style.fontSize = `${scale}%`; }, textScale);
  await page.waitForTimeout(150);
  await check(`a jumped-to heading is not hidden behind the sticky header (${width}px, ${textScale}% text)`, async () => {
    const ids = await page.locator('.pub__contentsList a').evaluateAll(
      (as) => as.map((a) => a.getAttribute('href').slice(1)),
    );
    const worst = [];
    for (const id of ids) {
      await page.evaluate((target) => {
        document.getElementById(target)?.scrollIntoView();
      }, id);
      await page.waitForTimeout(150);
      const m = await page.evaluate((target) => {
        const el = document.getElementById(target);
        if (!el) return null;
        const heading = el.querySelector('h2') || el;
        const box = heading.getBoundingClientRect();
        const header = document.querySelector('.pub__header').getBoundingClientRect();
        return {
          top: Math.round(box.top),
          headerBottom: Math.round(header.bottom),
          hidden: box.top < header.bottom - 1,
        };
      }, id);
      if (!m) throw new Error(`no element with id "${id}" — the contents link is broken`);
      if (m.hidden) worst.push(`${id}: heading top ${m.top} is under the header bottom ${m.headerBottom}`);
    }
    assert.equal(worst.length, 0, worst.join('; '));
    const offset = await page.locator('[data-chapter]').first().evaluate((section) => ({
      margin: Number.parseFloat(getComputedStyle(section).scrollMarginTop),
      header: Math.ceil(document.querySelector('.pub__header').getBoundingClientRect().height),
    }));
    assert.ok(Math.abs(offset.margin - offset.header - 16) <= 1,
      `consumed scroll margin ${offset.margin}px does not track header ${offset.header}px + 16px`);
    return `${ids.length} anchors stay visible after the jump`;
  });
 }
}

console.log('\n5. Wording');
// The product serves any business whose customers order from a product list, so
// "restaurant" may appear as one example among others but never as the category
// the product belongs to. "Restaurant Operations Management Platform" is the
// defect: it names one vertical as the whole market.
await goto('/');
await check('the sign-in tagline does not name a single vertical as the whole product', async () => {
  const tagline = (await page.locator('.lg__tagline').innerText()).trim();
  const generic = /operations management platform|business management platform|ordering platform|management platform/i;
  assert.ok(
    generic.test(tagline),
    `the tagline still scopes the product to one vertical: "${tagline}"`,
  );
  assert.ok(
    !/restaurant/i.test(tagline),
    `the tagline says "restaurant": "${tagline}"`,
  );
  return tagline;
});
await check('the sign-in blurb does not scope the product to restaurants', async () => {
  const blurb = (await page.locator('.lg__box').innerText()).trim();
  const sentence = blurb.split('\n').find((l) => /sign in with your google account/i.test(l)) || '';
  assert.ok(!/restaurant/i.test(sentence), `still restaurant-only: "${sentence}"`);
  return sentence.slice(0, 60);
});
await goto('/about');
await check('About positions the product across business types, not one', async () => {
  const lead = await page.locator('.pub__lead').first().innerText();
  assert.ok(
    /cafés|restaurants|food stalls|shops|retail|services/i.test(lead),
    'the About lead should name several kinds of ordering business',
  );
  assert.ok(!/only for restaurants|for restaurants only/i.test(lead), 'About scopes the product to restaurants');
  return null;
});
await goto('/refund-policy');
await check('cancellation directs owners to the in-app control', async () => {
  const chapter = await page.locator('#cancellation').innerText();
  assert.ok(
    !/not deployed|not yet deployed|implemented and tested locally|not yet available/i.test(chapter),
    `the cancellation terms still say this is undeployed: "${chapter.slice(-140)}"`,
  );
  assert.match(chapter, /owner.*cancel.*Subscription page/is);
  assert.match(chapter, /immediately ends subscription benefits/i);
  assert.doesNotMatch(chapter, /to stop a future renewal, contact|email to cancel/i);
  return 'owner action and immediate effect shown';
});
await check('automatic inactivity deletion is not claimed', async () => {
  const chapter = await page.locator('#cancellation').innerText();
  assert.ok(!/automatically (deleted|removed)/i.test(chapter), 'the page promises automatic deletion');
  return null;
});
await check('subscription and customer-order refunds stay distinct', async () => {
  const subscription = await page.locator('#subscriptions').innerText();
  const customer = await page.locator('#customer-orders').innerText();
  assert.match(subscription, /within 14 days after payment/i);
  assert.match(subscription, /within five business days/i);
  assert.match(customer, /contact the merchant/i);
  assert.match(customer, /not proof that funds were received/i);
  assert.match(customer, /QR Ph checkout is not yet enabled/i);
  return null;
});
await goto('/privacy');
await check('retention copy separates live features from disabled ones', async () => {
  const chapter = await page.locator('#retention').innerText();
  assert.match(chapter, /Owner-requested business closure/i, 'describe the released closure control');
  assert.doesNotMatch(chapter, /available now: record download/i, 'do not promise an unverified export service');
  assert.match(chapter, /exports require private storage to be configured/i, 'explain the export storage requirement');
  assert.ok(
    /not yet active|remains disabled|stays disabled/i.test(chapter),
    'the retention text no longer says automatic deletion is inactive',
  );
  assert.ok(
    !/tested locally/i.test(chapter),
    'the retention text still describes shipped behaviour as only tested locally',
  );
  return null;
});
await check('privacy notice identifies open review decisions', async () => {
  const review = await page.locator('#review').innerText();
  for (const topic of ['controller or processor', 'lawful basis', 'cross-border transfers', 'retention exception']) {
    assert.ok(review.includes(topic), `privacy review is missing ${topic}`);
  }
  const ai = await page.locator('#ai').innerText();
  assert.match(ai, /user may nevertheless type personal information/i);
  return null;
});
for (const route of PUBLIC_ROUTES) {
  await goto(route);
  await check(`operator names appear only on Contact (${route})`, async () => {
    const text = await page.locator('.pub__main').innerText();
    const names = ['Patrick Fitzroy Hofer', 'Jhonryl Pamaybay'];
    for (const name of names) assert.equal(text.includes(name), route === '/contact', `${name} placement is wrong on ${route}`);
    return null;
  });
}
for (const route of ['/terms', '/privacy', '/cookies', '/acceptable-use']) {
  await goto(route);
  await check(`no vertical-only positioning (${route})`, async () => {
    const text = await page.locator('.pub__main').innerText();
    assert.ok(
      !/only for restaurants|for restaurants only|restaurant administrator/i.test(text),
      'the page scopes the product to restaurants',
    );
    return null;
  });
}

console.log('\n6. Long policies are continuous articles');
for (const route of ['/terms', '/privacy', '/cookies', '/acceptable-use', '/refund-policy', '/help', '/contact']) {
  await goto(route);
  await check(`policy page is one continuous article (${route})`, async () => {
    const m = await page.evaluate(() => {
      const chapters = [...document.querySelectorAll('[data-chapter]')];
      return {
        total: chapters.length,
        boxed: chapters.filter((el) => {
          const style = getComputedStyle(el);
          return Number.parseFloat(style.borderTopWidth) > 0 || Number.parseFloat(style.borderRadius) > 0
            || style.boxShadow !== 'none' || !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor);
        }).map((el) => el.dataset.chapter),
        inGrid: chapters.filter((el) => el.closest('.pub__grid')).map((el) => el.dataset.chapter),
        // A continuous article stacks its sections; a card layout puts them in a
        // multi-column grid, which is what a reader scanning for one clause does
        // not want.
        columns: (() => {
          const main = document.querySelector('.pub__main');
          return main ? getComputedStyle(main).columnCount : null;
        })(),
      };
    });
    assert.ok(m.total > 0, 'expected sections on this page');
    assert.deepEqual(m.boxed, [], `sections still have card surfaces: ${m.boxed.join(', ')}`);
    assert.deepEqual(m.inGrid, [], `these sections are in a card grid: ${m.inGrid.join(', ')}`);
    assert.ok(!['2', '3'].includes(String(m.columns)), `the article is set in ${m.columns} columns`);
    return `${m.total} sections stacked`;
  });
}
for (const route of ['/about', '/pricing']) {
  await goto(route);
  await check(`cards are retained where they belong (${route})`, async () => {
    const cards = await page.locator('.pub__grid > *').count();
    assert.ok(cards > 0, 'expected cards on About/Pricing');
    return `${cards} cards`;
  });
}

console.log('\n7. Password-reset cooldown survives the overlay');
// Start a real UI countdown using an intercepted success response; no email is sent.
await goto('/');
await page.getByRole('button', { name: /sign in with email and password/i }).click();
await page.waitForTimeout(250);
await page.locator('input[type="email"]').fill('review@example.test');
await page.getByRole('button', { name: /forgot password/i }).click();
await page.getByRole('button', { name: 'Send Reset Link', exact: true }).click();
await page.getByRole('button', { name: /Resend in/ }).waitFor();

const readResetState = () => page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /resend|send reset|reset link/i.test(b.textContent));
  return {
    // The reset view is identified by its own controls, not by a heading: the
    // trigger reads "Forgot Password?" but the screen that opens is a bare
    // "Send Reset Link" button plus a way back.
    onResetScreen: !!btn && /back to login/i.test(document.body.innerText),
    emailKept: document.querySelector('input[type="email"]')?.value ?? null,
    cooldown: btn ? { label: btn.textContent.trim(), disabled: btn.disabled,
      seconds: (() => { const match = btn.textContent.match(/Resend in (\d+):(\d+)/); return match ? Number(match[1]) * 60 + Number(match[2]) : null; })(),
    } : null,
  };
});

const before = await readResetState();
await check('the forgot-password view is showing before the overlay', async () => {
  assert.ok(before.cooldown, 'no reset button was rendered, so the cooldown cannot be observed');
  assert.ok(before.onResetScreen, `the form did not switch to the reset screen (button "${before.cooldown.label}")`);
  assert.equal(before.emailKept, 'review@example.test', 'the address was not carried into the reset form');
  assert.equal(mockedResetRequests, 1, 'exactly one reset request must be intercepted');
  assert.ok(before.cooldown.disabled && before.cooldown.seconds > 0, 'the countdown must actually be running');
  return `"${before.cooldown.label}"`;
});

await page.getByRole('button', { name: /need help/i }).first().click();
await page.waitForTimeout(1200);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

await check('the reset form and running cooldown survive opening and closing Help', async () => {
  const after = await readResetState();
  assert.equal(after.emailKept, before.emailKept);
  assert.equal(after.onResetScreen, true);
  assert.ok(after.cooldown.disabled && after.cooldown.seconds > 0, 'resending remains disabled');
  assert.ok(after.cooldown.seconds < before.cooldown.seconds && after.cooldown.seconds >= before.cooldown.seconds - 5,
    'the timer must continue instead of restarting or disappearing');
  assert.equal(mockedResetRequests, 1, 'Help must not send another reset request');
  return `stable: "${after.cooldown.label}", address kept`;
});

console.log('\n8. Baseline behaviour still holds');
await goto('/cookies');
await check('draft notice is shown while policies are DRAFT', async () => {
  const notice = await page.locator('.pub__notice').count();
  assert.ok(notice === 1, 'the draft notice must be visible before operator approval');
  return null;
});
await check('contents links navigate to a real section', async () => {
  await page.getByRole('button', { name: /on this page/i }).click();
  await page.waitForTimeout(200);
  const href = await page.locator('.pub__contentsList a').first().getAttribute('href');
  await page.locator('.pub__contentsList a').first().click();
  await page.waitForTimeout(300);
  assert.ok(page.url().includes(href), `expected the URL to reach ${href}, got ${page.url()}`);
  return href;
});

await check('no uncaught page errors', () => {
  assert.deepEqual(pageErrors, [], `uncaught errors: ${pageErrors.join(' | ')}`);
  return null;
});

console.log('\n9. Every public page at phone and desktop widths in both themes');
for (const route of PUBLIC_ROUTES) {
  for (const width of [390, 1280]) {
    await goto(route, width);
    for (const theme of ['light', 'dark']) {
      await setTheme(theme);
      await check(`${route} renders at ${width}px (${theme})`, async () => {
        const state = await page.evaluate(`(() => {
          const contrast = ${CONTRAST_FN};
          const root = document.documentElement;
          const canvas = document.querySelector('.pub');
          const lead = document.querySelector('.pub__lead');
          const headings = [...document.querySelectorAll('[data-chapter] h2')].map((el) => el.textContent.trim());
          const contents = [...document.querySelectorAll('.pub__contentsList a')].map((el) => el.textContent.trim());
          return {
            title: document.querySelector('.pub__main h1')?.textContent.trim(),
            overflow: root.scrollWidth > root.clientWidth,
            headings, contents,
            contrast: contrast(getComputedStyle(lead).color, getComputedStyle(canvas).backgroundColor),
            draftNotice: !!document.querySelector('.pub__notice'),
            badLinks: [...document.querySelectorAll('.pub__main a[href]')]
              .map((el) => el.getAttribute('href'))
              .filter((href) => href === '#' || !(href.startsWith('/') || href.startsWith('mailto:'))),
          };
        })()`);
        assert.ok(state.title, 'missing page title');
        assert.ok(!state.overflow, 'page overflows horizontally');
        assert.ok(state.contrast >= 4.5, `lead text contrast is ${state.contrast?.toFixed(2)}:1`);
        assert.deepEqual(state.contents, state.headings, 'contents links differ from headings');
        assert.deepEqual(state.badLinks, [], 'a page link has no valid destination');
        assert.ok(state.draftNotice, 'draft notice is missing');
        return `lead contrast ${state.contrast.toFixed(2)}:1`;
      });
    }
  }
}

// Screenshots for the record.
await goto('/cookies', 1280);
await page.screenshot({ path: `${OUT}/public-policy-desktop.png` });
await goto('/cookies');
await page.getByRole('button', { name: /on this page/i }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/public-policy-mobile-contents.png` });
await goto('/');
await page.getByRole('button', { name: /need help/i }).first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/login-help-light.png` });
await setTheme('dark');
await page.screenshot({ path: `${OUT}/login-help-dark.png` });
await setTheme('light');

await browser.close();

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${results.length - failures}/${results.length} checks passed`);
console.log(`screenshots: ${OUT}`);
if (failures > 0) {
  console.log('\nfailures:');
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
  process.exit(1);
}
