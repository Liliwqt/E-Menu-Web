import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLICATION, PUBLIC_PAGES, PUBLIC_NAV } from './publicSiteContent.js';

/**
 * Guards the public-site redesign.
 *
 * Three defects motivated these:
 *
 * 1. The sign-in page carried three hand-rolled dialogs (Cookie Notice, Acceptable
 *    Use, Help) that duplicated policies and were reachable *only* from a modal.
 *    They had no focus trap, no Escape handling and no focus return, and read
 *    "your restaurant administrator" while the product serves any ordering
 *    business. The full policies now live at real routes.
 *
 * 2. The Cookie Notice claimed "theme choice and AI Analyst cache may be saved in
 *    the browser". That became false when the AI session moved to memory-only —
 *    only sign-in state and theme are stored. Publishing a privacy page that
 *    misdescribes storage is worse than publishing none.
 *
 * 3. Operator names were appearing on more than Contact. The operator asked for
 *    them on Contact only.
 *
 * These source guards supplement scripts/verify-public-pages.mjs, which checks
 * actual contrast, article surfaces, route transitions and enlarged-text anchors.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');

const read = (relative) => fs.readFileSync(path.join(srcRoot, relative), 'utf8');
const loginPage = read('pages/LoginPage.jsx');
const publicPage = read('pages/PublicPage.jsx');
const appJsx = read('App.jsx');
const loginCss = read('styles/login.css');
const publicCss = read('styles/public.css');

/** Removes comments so prose about a pattern is not mistaken for using it. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const loginCode = stripComments(loginPage);
const publicCode = stripComments(publicPage);
const loginCssCode = stripComments(loginCss);
const publicCssCode = stripComments(publicCss);

test('the sign-in page uses the shared accessible dialog, not a hand-rolled one', () => {
  assert.match(loginCode, /import Modal from '\.\.\/components\/ui\/Modal'/, 'Help must use the shared Modal');
  // Modal owns focus trap, Escape, focus return and scroll lock. A bespoke overlay
  // here previously provided none of them.
  assert.doesNotMatch(loginCode, /aria-modal/, 'the page must not hand-roll a dialog role');
  assert.doesNotMatch(loginCode, /lg__modalOverlay|lg__modalHead|lg__modalClose/, 'dead modal markup must be removed');
  assert.doesNotMatch(stripComments(loginCss), /lg__modalOverlay|lg__modalHead|lg__modalClose/, 'dead modal CSS must be removed');
});

test('the three former footer dialogs are gone from the sign-in page', () => {
  // Checked against comment-stripped source: this file's own header explains what
  // was removed, and a naive grep of the page would match that prose instead.
  for (const label of ['Cookie Notice', 'activeFooterContent']) {
    assert.doesNotMatch(loginCode, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label} should no longer appear in the sign-in page`);
  }
  // "Acceptable Use Policy" survives only as a disclosure link label, which is intended.
  assert.match(loginCode, /to="\/acceptable-use"/, 'Acceptable Use must remain reachable as a page link');
});

test('help is a single short overlay that links to the full page', () => {
  assert.match(loginCode, /Need help\?/, 'a Need help? trigger must exist');
  assert.match(loginCode, /to="\/help"/, 'the overlay must link to the full Help page');
  // The old overlay was a wall of policy text. The short version answers the three
  // things someone blocked at sign-in actually needs.
  assert.match(loginCode, /Forgot Password/i, 'password reset guidance belongs in the overlay');
  assert.match(loginCode, /owner or a manager/, 'branch access guidance belongs in the overlay');
  assert.match(loginCode, /mailto:/, 'the support address must be a mailto link');
  assert.match(loginCode, /Nothing is sent until you send it/, 'the overlay must say it does not send anything');
});

test('closing help preserves the form, the mode and the reset cooldown', () => {
  // Help is an overlay over a half-filled form. Remounting or resetting on open
  // would cost someone their typed password.
  //
  // The credential/mode setters legitimately appear in the file — the page has
  // login, register, forgot-password and back-to-login transitions. What must not
  // exist is any of them wired to opening the overlay, so the guard is on the
  // showHelp handler itself, not on the presence of the setters.
  const openHandler = (loginCode.match(/onClick=\{\(\) => setShowHelp\(true\)\}/g) || []).length;
  assert.equal(openHandler, 1, 'the Need help trigger must only open the overlay');
  const helpHandlers = loginCode.slice(loginCode.indexOf('setShowHelp(true)'));
  const immediate = helpHandlers.match(/setShowHelp\(true\)[^;]{0,200}/)[0];
  for (const setter of ['setEmail(', 'setPassword(', 'setMode(', 'setResetCooldown(']) {
    assert.ok(!immediate.includes(setter), `opening help must not call ${setter}`);
  }
  // The overlay is a sibling of the form, not a branch that replaces it.
  assert.match(loginCode, /<Modal/, 'help must be an overlay, not a replacement view');
  assert.match(loginCode, /\{!isForgotPassword && \(/, 'the form must remain mounted behind the overlay');
  // The cooldown starts at a real duration when a reset is requested and is never zeroed.
  assert.match(loginCode, /setResetCooldown\(180\)/);
  assert.doesNotMatch(loginCode, /setResetCooldown\(0\)/, 'the cooldown must never be reset to zero');
});

test('the secondary destinations sit behind a keyboard-accessible disclosure', () => {
  assert.match(loginCode, /aria-expanded=\{showMore\}/, 'the disclosure must report its state');
  assert.match(loginCode, /aria-controls="lg-more-links"/, 'the disclosure must reference the list it controls');
  assert.match(loginCode, /<button[\s\S]{0,200}lg__moreToggle/, 'the disclosure must be a real button, not a link');
  for (const path of ['/about', '/pricing', '/help', '/contact', '/refund-policy', '/cookies', '/acceptable-use']) {
    assert.ok(loginCode.includes(`to="${path}"`), `${path} must be reachable from the disclosure`);
  }
});

test('every public page is a direct, titled, bookmarkable route', () => {
  for (const [pagePath, label] of PUBLIC_PAGES) {
    assert.ok(appJsx.includes(`<Route path="/${pagePath}"`), `/​${pagePath} needs a route`.replace('/​', '/'));
    assert.ok(label, `${pagePath} needs a navigation label`);
  }
  // A descriptive document title per page, not one shared string.
  assert.match(publicCode, /document\.title = `\$\{page\.title\} \| E-Menu`/);
});

test('the browser-storage page describes storage accurately', () => {
  // The regression: it claimed the AI Analyst cache was saved in the browser.
  // `aiSession` is memory-only, so that statement became false. Assert the claim is
  // gone AND that the correction is present, so it cannot silently return.
  assert.doesNotMatch(loginCode, /AI Analyst cache/i, 'the stale AI cache claim must not return to the sign-in page');
  assert.match(publicCode, /AI results and AI conversations are <strong>not<\/strong>\s*saved in your browser/, 'the Cookies page must say AI results are not stored');
  assert.match(publicCode, /sign-in state/i, 'the Cookies page must say what IS stored');
  assert.match(publicCode, /Theme/, 'the Cookies page must name the theme preference');
  // And it must not introduce a consent mechanism. "no consent banner" is the
  // existing negative statement in the copy, so the guard matches the mechanism
  // rather than the word: no banner element, and no claim that one exists.
  assert.doesNotMatch(publicCode, /<[^>]*className="[^"]*(consent|cookie-banner)/i, 'no consent banner element may be introduced');
  assert.doesNotMatch(publicCssCode, /consent|cookie-banner/i, 'no consent banner styling may be introduced');
  assert.match(publicCode, /no consent banner/i, 'the page should explain why none is needed');
});

test('operator names appear on Contact and nowhere else', () => {
  for (const name of PUBLICATION.operatorContacts) {
    const others = [
      ['pages/PublicPage.jsx', publicPage],
    ];
    for (const [file, source] of others) {
      // PublicPage renders every page, so the guard is that the name is only ever
      // passed through inside the Contact section.
      const contactStart = source.indexOf('function Contact()');
      const contactEnd = source.indexOf('function Help()');
      assert.ok(contactStart >= 0 && contactEnd > contactStart, 'Contact must be a distinct section');
      const outside = source.slice(0, contactStart) + source.slice(contactEnd);
      assert.ok(!outside.includes(name), `${name} must not appear outside the Contact section in ${file}`);
    }
  }
});

test('public copy is not restaurant-only', () => {
  // The sign-in overlay used to say "your restaurant administrator" while the
  // product serves cafés, shops and any ordering business.
  assert.doesNotMatch(stripComments(loginPage), /restaurant administrator/i);
  assert.match(publicPage, /cafés, restaurants, food stalls, shops/i, 'About must name the range of supported businesses');
});

test('public layout never relies on viewport height units', () => {
  // The Android WebView resolves vh/dvh/svh/lvh to 0px, which silently collapses
  // any max-height built on them. Checked against comment-stripped CSS, because
  // these files carry long warnings that *name* the units on purpose.
  for (const [file, source] of [['public.css', publicCssCode], ['login.css', loginCssCode]]) {
    for (const unit of ['vh', 'dvh', 'svh', 'lvh']) {
      assert.doesNotMatch(source, new RegExp(`\\d${unit}\\b`), `${file} must not use ${unit}`);
    }
  }
  // The sidebar height is bounded by a percentage of its sticky ancestor instead.
  assert.match(publicCssCode, /max-height: calc\(100% - var\(--pub-header-h\) - 12px\)/, 'the sticky contents sidebar must use its measured header height without viewport units');
});

test('interactive targets are at least 44px and focus is visible', () => {
  assert.match(publicCss, /min-height:\s*44px/, 'public controls need a 44px minimum target');
  assert.match(publicCss, /:focus-visible/, 'focus must be visible');
  assert.match(loginCss, /:focus-visible/, 'sign-in focus must be visible');
  assert.match(publicCss, /prefers-reduced-motion/, 'reduced motion must be honoured');
});

test('the contents navigation cannot drift from the article', () => {
  // It is derived from the rendered [data-chapter] sections rather than a parallel
  // slug list, so a heading cannot be added to the article and missed here.
  assert.match(publicCode, /data-chapter/, 'chapters must be marked in the article');
  assert.match(publicCode, /querySelectorAll\('\[data-chapter\]'\)/, 'contents must read the chapters from the DOM');
  assert.doesNotMatch(publicCode, /const CHAPTERS = \[/, 'contents must not keep a duplicated slug table');
});
test('the contents navigation is given the ref it reads from', () => {
  // The regression: `Contents` created its own `useRef` and never attached it, so
  // `layoutRef.current` was permanently null, the effect found no chapters, and the
  // whole navigation silently rendered nothing. The build passed, all tests passed,
  // and the page looked plausible — only a browser showed the empty sidebar.
  //
  // A component cannot discover a ref it was not handed, so the ref must arrive as
  // a prop and be the same one the parent attaches to the layout element.
  const contentsSignature = publicCode.slice(publicCode.indexOf('function Contents('), publicCode.indexOf('export default function PublicPage'));
  assert.match(contentsSignature, /function Contents\(\{[^}]*layoutRef/, 'Contents must receive the layout ref as a prop');
  assert.doesNotMatch(contentsSignature, /useRef\(null\)/, 'Contents must not create an unattached ref of its own');
  assert.match(publicCode, /<Contents[^>]*layoutRef=\{layoutRef\}/, 'the parent must pass the ref it attached');
  assert.match(publicCode, /<div className="pub__layout" ref=\{layoutRef\}>/, 'the parent must attach the ref it passes');
});

test('the contents navigation is rebuilt when the route changes', () => {
  // React Router reuses the component across routes, so nothing else changes
  // identity when the reader moves from /cookies to /terms. Depending only on the
  // ref left the previous page's headings on screen — a contents list pointing at
  // sections that no longer exist, and clicking one lands nowhere.
  //
  // Note this is a *source* guard only. Whether the effect actually re-fires in
  // the browser is covered by `scripts/verify-public-pages.mjs`, which navigates
  // through an in-app link and compares the rendered entries against the headings.
  const contentsSignature = publicCode.slice(publicCode.indexOf('function Contents('), publicCode.indexOf('export default function PublicPage'));
  // Slice to the dependency array only. Cutting at the first `]` would stop inside
  // `querySelectorAll('[data-chapter]')` and never reach the deps.
  const effect = contentsSignature.slice(contentsSignature.indexOf('useEffect('));
  const depsStart = effect.lastIndexOf('}, [');
  assert.ok(depsStart > 0, 'the chapter scan must be a useEffect with a dependency array');
  const deps = effect.slice(depsStart, effect.indexOf(']', depsStart) + 1);
  assert.match(
    deps,
    /pathname/,
    `the chapter scan must depend on the current route, but its deps are ${deps}`,
  );
  assert.match(publicCode, /<Contents[^>]*pathname=\{pathname\}/, 'the parent must pass the current route down');
});

test('operator-supplied text is never case-folded on the way to the page', () => {
  // The regression: the Help page interpolated `supportHours.toLowerCase()`, which
  // published "monday–friday ... philippine time (asia/manila)". Support hours are
  // operator-supplied copy in publicSiteContent.js and must reach the page verbatim.
  assert.doesNotMatch(
    publicCode,
    /PUBLICATION\.[A-Za-z]+\s*\.toLowerCase\(\)/,
    'a PUBLICATION value must never be case-folded before it is displayed',
  );
  assert.doesNotMatch(
    publicCode,
    /PUBLICATION\.[A-Za-z]+\s*\.toUpperCase\(\)/,
    'a PUBLICATION value must never be case-folded before it is displayed',
  );
});
test('the More information disclosure controls an element that exists', () => {
  // The regression: the list was conditionally rendered, so while collapsed
  // `aria-controls="lg-more-links"` named an element that was not in the DOM and a
  // screen reader announced a relationship to nothing. It is now always mounted and
  // hidden with the `hidden` attribute, which the CSS must not override.
  const loginSource = loginCode;
  const css = read('styles/login.css');

  assert.match(loginSource, /aria-controls="lg-more-links"/, 'the toggle must name the panel it controls');
  assert.match(
    loginSource,
    /<ul[^>]*id="lg-more-links"[^>]*hidden=\{!showMore\}/,
    'the controlled list must stay mounted and toggle via hidden',
  );
  assert.doesNotMatch(
    loginSource,
    /\{showMore\s*&&\s*\(\s*<ul[^>]*id="lg-more-links"/,
    'the controlled list must not be unmounted while collapsed',
  );
  // A `display` declaration on the class would beat the UA `[hidden]` rule, so the
  // panel would stay visible even with the attribute set.
  const panelRule = css.match(/\.lg__moreList\s*\{([^}]*)\}/);
  assert.ok(panelRule, '.lg__moreList rule must exist');
  assert.doesNotMatch(
    panelRule[1],
    /\bdisplay\s*:\s*(?!none)/,
    '.lg__moreList must not set a display value, or it overrides [hidden]',
  );
});

test('the draft notice is still gated on publication status', () => {
  // check:public-release greps for this exact expression and blocks a Hosting
  // deploy without it. It must survive the redesign.
  assert.ok(publicPage.includes("PUBLICATION.status !== 'approved'"), 'the draft notice gate must remain');
  assert.match(publicCode, /pub__notice/);
  assert.ok(PUBLICATION.status === 'draft', 'policies must still be DRAFT — this redesign does not approve them');
});

test('no false claims about payments, deletion or approval', () => {
  // The redesign must not imply verified payments or automatic deletion.
  assert.match(publicPage, /not yet enabled in the current release/i, 'QR Ph must be described as not enabled');
  assert.match(publicPage, /nothing is deleted automatically/i, 'expiry must not imply automatic deletion');
  // "verified QR Ph" is required wording — a connection becomes verified only after
  // the provider confirms it. "access begins after payment is verified" is also
  // correct and must stay. What must not appear is a claim that the *service* is
  // already taking verified payments, so the guard is scoped to that.
  assert.doesNotMatch(publicCode, /E-Menu accepts payments|payments? (are|is) enabled|verified payments are (available|live)/i, 'no page may imply payments are live and verified');
  assert.match(PUBLICATION.customerPaymentNotice, /only after the payment provider confirms it/i, 'settlement must be described as provider-confirmed');
});

test('the header carries the agreed destinations and the footer is grouped', () => {
  assert.deepEqual(PUBLIC_NAV.map(([p]) => p), ['about', 'pricing', 'help', 'contact']);
  assert.match(publicCode, /FOOTER_GROUPS/);
  for (const heading of ['Product', 'Support', 'Policies']) {
    assert.ok(publicPage.includes(`heading: '${heading}'`), `the footer needs a ${heading} group`);
  }
  assert.match(publicCode, /aria-label="Public pages"/, 'navigation needs an accessible name');
  assert.match(publicCode, /pub__skip/, 'a skip link is required');
});
