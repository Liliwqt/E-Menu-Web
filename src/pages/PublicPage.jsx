import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { PUBLICATION, PUBLIC_NAV } from '../lib/publicSiteContent';
import { PLAN_BASIC, PLAN_STARTER, PLAN_PREMIUM, PLAN_PRICE_PHP } from '../lib/planFeatures';
import '../styles/public.css';

/**
 * Public pages: /about /pricing /contact /help /terms /privacy /cookies
 * /acceptable-use /refund-policy
 *
 * One page component driven by a table, because nine near-identical routes would
 * drift apart. Policy pages are continuous articles with anchored contents
 * navigation rather than a grid of cards: a reader looking for "how long do you
 * keep my data" should see a contents list and one continuous document.
 *
 * Three rules this file must not break, all enforced by tests:
 *   - The draft notice is gated on PUBLICATION.status. `check:public-release`
 *     greps for this exact expression and blocks a Hosting deploy without it.
 *   - Content comes from PUBLICATION, never hardcoded here.
 *   - Operator names appear on Contact only. Every other page uses a neutral
 *     label, because the operator asked for exactly that.
 */

const planCards = [
  { name: 'Basic', price: PLAN_PRICE_PHP[PLAN_BASIC], lines: ['Menu, inventory, orders, team and device management', 'Recorded payment-status labels, revenue graphs and standard reports', 'QR Ph checkout requires separate merchant approval and service activation'] },
  { name: 'Starter', price: PLAN_PRICE_PHP[PLAN_STARTER], lines: ['Everything in Basic', 'Revenue focused AI assistance, trends, gaps and reports', '300 generated AI responses per branch per billing period'] },
  { name: 'Premium', price: PLAN_PRICE_PHP[PLAN_PREMIUM], lines: ['Everything in Starter', 'Live analysis, shift handoff, simulations and presentations', 'Curated branch insights and 1,000 generated responses per period'] },
];

function ReviewField({ value, label }) {
  return value ? <span>{value}</span> : <span className="pub__review">Review required: {label}</span>;
}

/** A policy section with a stable id, so the contents list can link to it. */
function Chapter({ id, title, children }) {
  return (
    <section className="pub__section" id={id} data-chapter={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function About() {
  return <>
    <p className="pub__lead">E-Menu provides ordering and operations software for Philippine businesses that sell from a menu or product catalog. It serves cafés, restaurants, food stalls, shops, and other merchants with similar ordering needs.</p>
    <div className="pub__grid pub__grid--two">
      <Chapter id="who" title="Businesses and branches"><p>A business may operate one or more branches. Each branch has its own product listings, inventory, orders, reporting, subscription, and assigned users. The owner manages access for managers, staff, and ordering devices.</p></Chapter>
      <Chapter id="daily" title="How the service is used"><p>The web portal manages products, stock, orders, team access, and reports. The Android ordering app presents a merchant’s catalog and submits customer orders through the authorized checkout service. The merchant remains responsible for its products, fulfillment, and customer service.</p></Chapter>
    </div>
    <Chapter id="payments" title="Payment records"><p>{PUBLICATION.customerPaymentNotice}</p><p>For customer order or product refund requests, contact the selling merchant. For a platform or payment-record issue, see <Link to="/contact">Contact</Link>.</p></Chapter>
    <Chapter id="operator" title="Service operator"><p><ReviewField value={PUBLICATION.businessName} label="operator identity" />. The operating address is <ReviewField value={PUBLICATION.philippinesAddress} label="Philippine operating address" />. Operator names and contact details appear on the <Link to="/contact">Contact page</Link>.</p></Chapter>
  </>;
}

function Pricing() {
  return <>
    <p className="pub__lead">The prices below are in Philippine pesos per branch per calendar month. A new branch receives one 14-day Starter trial. Paid access is arranged with the operator and activated after its payment reference is verified; the service does not automatically charge a subscription.</p>
    <div className="pub__grid pub__grid--three">{planCards.map(plan => <section className="pub__plan" key={plan.name}>
      <h2>{plan.name}</h2><p className="pub__price">₱{plan.price.toLocaleString('en-PH')}<span> / branch / month</span></p>
      <ul>{plan.lines.map(line => <li key={line}>{line}</li>)}</ul>
    </section>)}</div>
    <Chapter id="activation" title="Trial and paid activation"><p>The trial is issued once for each new branch. An owner may arrange a paid Basic, Starter, or Premium plan through the operator; a payment instruction is not an automatic charge or an immediate activation. Paid periods begin or renew when the operator verifies and records the payment. There is no automatic renewal or prorated tier change in the current service.</p></Chapter>
    <Chapter id="access" title="Expiry and cancellation"><p>When a plan expires or the owner cancels it, existing records remain available for authorized reading, while new operational writes and subscription features stop. Plan expiry alone does not delete records; nothing is deleted automatically under the currently disabled inactivity process. See the <Link to="/refund-policy">Cancellation and Refund Policy</Link> for the separate refund process.</p></Chapter>
    <Chapter id="availability" title="Feature availability"><p>AI features require an active Starter or Premium entitlement, an available AI service, and the applicable branch response allowance. Check service availability before arranging paid AI access. Verified QR Ph checkout also requires an approved merchant connection and is not yet enabled in the current release; it is not included merely by buying a plan.</p></Chapter>
  </>;
}

function Contact() {
  return <>
    <p className="pub__lead">For account access, subscriptions, privacy requests, or platform faults, contact the operators using the address below. For a product, fulfillment, or customer-order refund, contact the merchant that made the sale.</p>
    <div className="pub__contactCard">
      <p className="pub__contactLabel">Email support</p>
      {PUBLICATION.supportEmail
        ? <a className="pub__contactEmail" href={`mailto:${PUBLICATION.supportEmail}`}>{PUBLICATION.supportEmail}</a>
        : <ReviewField label="support email" />}
      <p className="pub__contactHours">{PUBLICATION.supportHours}</p>
      <p className="pub__contactNote">Opening this link opens your email app. Nothing is sent until you send it.</p>
    </div>
    <Chapter id="responsibilities" title="Where to direct a request"><p>The selling merchant handles its product listings, fulfillment, order cancellations, and customer-order refunds. Touch support handles E-Menu account and subscription matters, privacy requests, and technical platform or payment-record errors. Touch does not decide a merchant’s product-refund request.</p></Chapter>
    <Chapter id="details" title="Information to provide"><p>Identify the business or branch, your account email if applicable, the relevant order or payment reference, and a concise description of the issue. For privacy requests, describe the information or right involved. Do not send passwords, one-time codes, complete card numbers, or other unnecessary customer details.</p></Chapter>
    <Chapter id="operators" title="Operators"><ul className="pub__list">{PUBLICATION.operatorContacts.map(name => <li key={name}>{name} — Operator</li>)}</ul></Chapter>
    <Chapter id="address" title="Operating address"><p><ReviewField value={PUBLICATION.philippinesAddress} label="Philippine operating address" /></p><p>Touch is an unregistered brand. This address identifies where its operators currently operate; it is not presented as a registered office.</p></Chapter>
  </>;
}

function Help() {
  return <>
    <p className="pub__lead">Use these steps for common access and order-record questions. For other platform issues, contact <Link to="/contact">support</Link>.</p>
    <Chapter id="sign-in" title="Sign-in or branch access"><p>Confirm that your email address and password are correct and that the device is online. A business owner or manager must assign your account to a branch before you can access that branch. If an assigned role or branch does not appear, sign out and sign in again after the change is made.</p></Chapter>
    <Chapter id="reset" title="Password reset"><p>Select <strong>Forgot password</strong> on the sign-in page. The reset link is sent to the address associated with your account and expires. Check your spam folder if it does not arrive. The form may require you to wait before sending another request. Do not forward the reset link to anyone.</p></Chapter>
    <Chapter id="mode" title="Sign-in in the Android app"><p>The embedded portal uses email and password sign-in. Google popup sign-in is unavailable inside the Android WebView; you may use it in a supported external browser instead.</p></Chapter>
    <Chapter id="billing" title="Plans, records, and exports"><p>Owners may review branch plans, cancel a subscription, or request an export under Records and access. Cancellation stops new writes immediately but does not issue a refund. Exports require configured private storage and may be unavailable at present. Managers and staff may view plan information but cannot change billing.</p></Chapter>
    <Chapter id="orders" title="Orders and payment records"><p>Contact the selling merchant about products, fulfillment, cancellations, or an order refund. If a payment status appears incorrect or the ordering app has a technical fault, contact Touch support with the order reference. A Pay at Counter or customer-reported QR status is not proof that payment settled.</p></Chapter>
    <Chapter id="still-stuck" title="Contact support"><p>Email <a href={`mailto:${PUBLICATION.supportEmail}`}>{PUBLICATION.supportEmail}</a>. Support hours are {PUBLICATION.supportHours}. Include the branch and a short description, but never include a password or one-time code.</p></Chapter>
  </>;
}

const TERMS_LEAD = PUBLICATION.status === 'approved'
  ? `Effective ${PUBLICATION.reviewedAt}. These terms govern use of E-Menu.`
  : 'Draft for operator and legal review. These terms have no approved effective date and must not be treated as a final customer agreement.';

function Terms() {
  return <>
    <p className="pub__lead">{TERMS_LEAD}</p>
    <Chapter id="definitions" title="1. Service and parties"><p>“E-Menu” means the web portal and Android ordering software operated under the Touch brand. <ReviewField value={PUBLICATION.businessName} label="operator identity" />. “Merchant” means a business using E-Menu to list and sell its own products. “Customer” means a person ordering from a merchant. “Branch” means a merchant location or operating unit with its own records and subscription. “Owner,” “manager,” and “staff” refer to the account roles assigned in the service. Operator identities and contact details are provided on the <Link to="/contact">Contact page</Link>.</p></Chapter>
    <Chapter id="accounts" title="2. Accounts and authorized access"><p>The merchant owner administers the business workspace and assigns branch access to managers, staff, and devices. Each user must use their own authorized account, keep credentials confidential, and report suspected unauthorized access. An account or enrolled device may be used only for branches and actions permitted by its assigned role. The merchant is responsible for the accuracy of its product listings, prices, stock settings, and instructions given to its personnel.</p></Chapter>
    <Chapter id="plans" title="3. Branch plans, trial, and expiry"><p>Basic, Starter, and Premium are priced per branch per calendar month as shown on <Link to="/pricing">Pricing</Link>. Each new branch may receive one 14-day Starter trial. Paid activation and renewal are arranged with the operator and take effect after the payment reference is verified and recorded; the service does not automatically charge or renew a subscription. A tier change takes effect when activated and starts a new paid period; no proration is offered in the current process.</p><p>When a trial or paid period expires, authorized users may still read existing operational records, but new operational writes and paid features stop until an active plan is recorded. Expiry itself does not delete records. AI features also depend on the applicable response allowance and service availability.</p></Chapter>
    <Chapter id="orders" title="4. Merchant orders and payment records"><p>The merchant, rather than Touch, sells the listed products and is responsible for fulfillment, customer service, and remedies for its orders. E-Menu records order details and payment status for the merchant’s operations. {PUBLICATION.customerPaymentNotice}</p><p>Verified QR Ph processing, if later enabled for an approved merchant connection, would require confirmation from the payment provider. Provider processing, fees, settlement, and merchant onboarding are subject to the merchant’s separate provider arrangements. No current plan purchase alone enables QR Ph checkout.</p></Chapter>
    <Chapter id="ai" title="5. AI-assisted features"><p>Starter and Premium include the AI features and response allowances stated on Pricing while the relevant service is available. AI output is generated from selected branch information and may be incomplete or inaccurate. Merchants remain responsible for reviewing recommendations, reports, and decisions before acting on them. Users must not enter passwords, payment credentials, or unnecessary customer information into AI questions. The <Link to="/privacy">Privacy Policy</Link> explains the associated data flow.</p></Chapter>
    <Chapter id="cancellation" title="6. Subscription cancellation and refunds"><p><ReviewField value={PUBLICATION.subscriptionCancellationTerms} label="subscription cancellation terms" /> The owner-confirmed in-app action, rather than an email request, is the method that changes subscription access. A refund is a separate request governed by the <Link to="/refund-policy">Cancellation and Refund Policy</Link>.</p></Chapter>
    <Chapter id="closure" title="7. Business closure and records"><p>Business closure is separate from subscription cancellation. An owner may request closure in the portal after recent authentication. Closure immediately blocks new operational writes across the business and permits owner recovery for 30 days; recovery does not extend any subscription. Authorized read and export access remain subject to the lifecycle process. Export availability depends on configured private storage. The <Link to="/privacy">Privacy Policy</Link> describes current and planned retention behavior.</p></Chapter>
    <Chapter id="service" title="8. Availability, restrictions, and changes"><p><ReviewField value={PUBLICATION.platformServiceTerms} label="platform service and policy-change terms" /> Users must also comply with the <Link to="/acceptable-use">Acceptable Use Policy</Link>. Contact <Link to="/contact">support</Link> if you wish to report a problem or question a restriction.</p></Chapter>
  </>;
}

const PRIVACY_LEAD = PUBLICATION.status === 'approved'
  ? `Effective ${PUBLICATION.reviewedAt}. This policy describes data used by E-Menu.`
  : 'Draft privacy notice for operator and legal review. It describes the current data flow and identifies decisions that remain open before approval.';

function Privacy() {
  return <>
    <p className="pub__lead">{PRIVACY_LEAD}</p>
    <Chapter id="operator" title="1. Operator and scope"><p>E-Menu is operated under the Touch brand. <ReviewField value={PUBLICATION.businessName} label="operator identity" />. The operating address is <ReviewField value={PUBLICATION.philippinesAddress} label="Philippine operating address" />. Operator names are listed on <Link to="/contact">Contact</Link>. This notice covers the portal, its Android ordering app, and their supporting service. The allocation of privacy responsibilities between Touch and each merchant for customer-order records requires final review; it is not settled by this draft.</p></Chapter>
    <Chapter id="handled" title="2. Categories of information"><p>The service handles account identifiers and contact details; business, branch, role and device assignments; product, stock and order records, which may include a customer name; reported payment method and status; subscription, support and audit records; and operational analytics. If verified QR Ph later becomes available, provider references and payment status will also be handled. Payment-provider credentials and webhook secrets are held server-side, not in the portal or Android client.</p></Chapter>
    <Chapter id="purposes" title="3. Purposes and access"><p>Information is used to authenticate users and devices, enforce branch permissions and entitlements, display products, process orders and stock changes, prepare reports, respond to support requests, and protect the service. The owner controls membership for the business; managers and staff see only information permitted by their assigned role and branch. Backend services use authenticated, branch-scoped access for protected operations. The precise legal basis for each purpose remains a review item; this draft does not characterize every use as consent-based.</p></Chapter>
    <Chapter id="ai" title="4. AI processing"><p>For an authorized AI request, the backend prepares bounded figures, product names, inventory data and, for Premium, curated branch insights, then sends the selected context and the user’s question to the AI provider. The automated context excludes customer identities, payment references, and raw order records. A user may nevertheless type personal information into a question; users should not do so. Chat turns and results are held in application memory for the current session, while limited Premium business insights may be retained separately. The provider key remains on the backend.</p></Chapter>
    <Chapter id="recipients" title="5. Service providers and disclosures"><p>Firebase supplies authentication and the operational database. The Railway-hosted backend verifies protected requests and runs order, lifecycle, and AI services. OpenAI processes authorized AI requests. Gmail handles messages sent to the support address; planned warning emails require separate SMTP configuration. Private Google Cloud Storage would hold exports and managed backups if configured. PayMongo would process connected QR Ph payments and refunds if that service is enabled. The data disclosed depends on the function used. Provider processing locations, cross-border transfers, and contractual safeguards must be confirmed before this notice is approved.</p></Chapter>
    <Chapter id="storage" title="6. Storage and safeguards"><p>Authentication uses Firebase browser persistence; the portal also stores limited account state and a theme preference on the device. The app does not intentionally save AI chat or generated reports in browser storage. The backend applies identity, role, branch, and subscription checks to protected requests. No security control can eliminate all risk; users should protect their devices and credentials. See <Link to="/cookies">Cookies and browser storage</Link> for current local-storage behavior.</p></Chapter>
    <Chapter id="retention" title="7. Retention, export, and deletion"><p><ReviewField value={PUBLICATION.dataRetentionSummary} label="data retention and deletion practices" /></p><p>Subscription cancellation does not itself delete operational records. An owner’s business-closure request follows a separate 30-day recovery process. Live records deleted through the lifecycle service may remain in inaccessible managed backups until those backups expire. Other backup copies and legally required holds require final review before a comprehensive deletion promise is made.</p></Chapter>
    <Chapter id="rights" title="8. Requests and rights"><p>To ask about access, correction, objection, deletion or blocking, portability, or a privacy concern, email <a href={`mailto:${PUBLICATION.privacyEmail}`}>{PUBLICATION.privacyEmail}</a>. Identify the relevant account or merchant and the information concerned, without sending a password or one-time code. Touch may need to verify your authority and coordinate with the merchant responsible for a customer order. You may also bring an unresolved privacy concern to the Philippine National Privacy Commission.</p></Chapter>
    <Chapter id="review" title="9. Matters requiring final review"><ul className="pub__list">{PUBLICATION.privacyReviewItems.map(item => <li key={item}>{item}</li>)}</ul><p>These items are not represented as completed compliance decisions. This page remains a draft until they are resolved and the operators approve an effective date.</p></Chapter>
  </>;
}

function Cookies() {
  return <>
    <p className="pub__lead">This notice describes storage used by the current portal on your device. “Browser storage” includes local storage and storage managed by Firebase Authentication; it is broader than HTTP cookies.</p>
    <Chapter id="what" title="1. Storage used by the portal"><ul className="pub__list">
      <li><strong>Sign-in state:</strong> Firebase Authentication uses persistent browser storage to keep a signed-in session. The portal also saves limited account state so it can restore the workspace view.</li>
      <li><strong>Theme preference:</strong> the portal saves the selected light or dark appearance in local storage for later visits.</li>
      <li><strong>Previous AI-session keys:</strong> older browser-storage entries are removed by the current app when the relevant session loads or ends; they are not the current AI conversation store.</li>
    </ul></Chapter>
    <Chapter id="not-stored" title="2. AI content"><p>AI results and AI conversations are <strong>not</strong> saved in your browser by the current portal. They are held in application memory and cleared on account or branch changes, sign-out, or tab closure. Separate curated Premium branch insights may be stored on the backend under the <Link to="/privacy">Privacy Policy</Link>.</p></Chapter>
    <Chapter id="control" title="3. Your controls"><p>Signing out ends the current Firebase session and removes the portal’s account-state entry; it does not necessarily erase every item of site storage. Clearing this site’s browser data removes the saved theme and other local entries, and may require you to sign in again. On a shared device, sign out when finished.</p></Chapter>
    <Chapter id="review" title="4. Tracking and consent review"><p>The current portal code does not add an advertising tracker or a consent banner. No consent banner is displayed. Firebase and other service providers may use technical storage required by their services; their precise browser behavior and the treatment of the optional theme preference require review before this notice is approved. Direct questions to <a href={`mailto:${PUBLICATION.privacyEmail}`}>{PUBLICATION.privacyEmail}</a>.</p></Chapter>
  </>;
}

function AcceptableUse() {
  return <>
    <p className="pub__lead">This policy applies to owners, managers, staff, and authorized operators of enrolled ordering devices. It supplements the <Link to="/terms">Terms and Conditions</Link> and protects business records, customer information, and service availability.</p>
    <Chapter id="authorized" title="1. Authorized use"><p>Use only your own assigned account and the branches, data, and actions permitted by your role. Do not share a password, lend an enrolled device for unauthorized access, impersonate another user, or attempt to bypass branch or subscription controls. Report a lost device or suspected compromise promptly to the owner and <Link to="/contact">support</Link>.</p></Chapter>
    <Chapter id="records" title="2. Accurate records"><p>Enter products, prices, stock changes, orders, and payment statuses in good faith. Do not fabricate a payment confirmation, conceal an order, or alter records to misstate revenue or inventory. Use the available correction and audit processes instead of removing history that must be retained.</p></Chapter>
    <Chapter id="customer-data" title="3. Customer and confidential data"><p>Access and share customer or merchant records only for an authorized business purpose. Do not export data to an unrelated party or enter passwords, one-time codes, full card numbers, provider secrets, or unnecessary customer details in support messages or AI questions. The merchant remains responsible for instructions it gives its personnel concerning customer records.</p></Chapter>
    <Chapter id="security" title="4. Prohibited interference"><p>Do not probe another branch, scrape or overload the service, interfere with checkout or payment verification, introduce malicious code, or use the platform to distribute unlawful or harmful content. Security testing requires prior written authorization from the operator.</p></Chapter>
    <Chapter id="response" title="5. Response to misuse"><p>A credible breach of this policy may lead to a proportionate restriction of the affected account, device, or branch while the issue is reviewed. Report a suspected error or appeal a restriction through <Link to="/contact">Contact</Link>. Notification and restriction procedures remain subject to operator review before these draft terms are approved.</p></Chapter>
  </>;
}

function RefundPolicy() {
  return <>
    <p className="pub__lead">This policy distinguishes a merchant’s customer sale from a branch subscription to E-Menu.{PUBLICATION.status !== 'approved' && ' The commercial wording remains a draft for operator review.'}</p>
    <Chapter id="cancellation" title="1. Cancel a branch subscription"><p><ReviewField value={PUBLICATION.subscriptionCancellationTerms} label="cancellation timing and effect" /> There is no automatic subscription charge or renewal in the current service. Business closure is a different action with a 30-day recovery period. Neither action is a request for a refund.</p></Chapter>
    <Chapter id="subscriptions" title="2. Request a subscription refund"><p><ReviewField value={PUBLICATION.subscriptionRefundTerms} label="subscription refund eligibility and timing" /> A cancellation alone is not a refund ground. Any applicable legal right remains unaffected by this draft request procedure.</p></Chapter>
    <Chapter id="customer-orders" title="3. Customer-order cancellations and refunds"><p><ReviewField value={PUBLICATION.merchantOrderRefundResponsibility} label="merchant order cancellation and refund responsibility" /> {PUBLICATION.customerPaymentNotice} If provider-backed refunds later become available, a request may remain pending until the provider confirms the result; the order record must not be presented as refunded before confirmation.</p></Chapter>
    <Chapter id="ask" title="4. Where to send a request"><p>Send E-Menu subscription or technical payment-record requests to <a href={`mailto:${PUBLICATION.supportEmail}`}>{PUBLICATION.supportEmail}</a>. For a purchase from a merchant, contact that merchant first. Include the relevant reference and branch, but do not provide passwords, one-time codes, or full card details. See <Link to="/contact">Contact</Link> for support hours and operator details.</p></Chapter>
  </>;
}

const pages = {
  about: { title: 'About E-Menu', content: <About /> },
  pricing: { title: 'Plans and pricing', content: <Pricing /> },
  contact: { title: 'Contact', content: <Contact /> },
  help: { title: 'Help', content: <Help /> },
  terms: { title: 'Terms and Conditions', content: <Terms /> },
  privacy: { title: 'Privacy Policy', content: <Privacy /> },
  cookies: { title: 'Cookies and browser storage', content: <Cookies /> },
  'acceptable-use': { title: 'Acceptable Use Policy', content: <AcceptableUse /> },
  'refund-policy': { title: 'Cancellation and Refund Policy', content: <RefundPolicy /> },
};

const FOOTER_GROUPS = [
  { heading: 'Product', links: [['about', 'About'], ['pricing', 'Pricing'], ['contact', 'Contact']] },
  { heading: 'Support', links: [['help', 'Help'], ['acceptable-use', 'Acceptable Use Policy'], ['refund-policy', 'Cancellation and Refund Policy']] },
  { heading: 'Policies', links: [['terms', 'Terms and Conditions'], ['privacy', 'Privacy Policy'], ['cookies', 'Cookies and browser storage']] },
];

/**
 * Anchored contents navigation.
 *
 * Desktop shows a fixed sidebar; phones get a disclosure, because nine links in a
 * row would either wrap badly or scroll sideways. Either way the policy text
 * stays visible — the disclosure only adds navigation above it.
 *
 * The list is read back from the rendered sections rather than kept as a parallel
 * slug table, so a heading cannot be added to the article without appearing here.
 */
function Contents({ layoutRef, pathname }) {
  const [open, setOpen] = useState(false);
  const [chapters, setChapters] = useState([]);

  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    const found = [...layout.querySelectorAll('[data-chapter]')].map((section) => ({
      id: section.dataset.chapter,
      label: section.querySelector('h2')?.textContent?.trim() || section.dataset.chapter,
    }));
    setChapters(found);
    // `pathname` is the dependency that matters: React Router reuses this component
    // across routes, so nothing else changes identity when the reader moves from
    // /cookies to /terms. Depending only on the ref left the previous page's
    // headings on screen — a contents list pointing at sections that no longer
    // exist. An unsubscribed reader clicking one lands nowhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutRef, pathname]);

  if (!chapters.length) return null;

  return <nav className="pub__contents" data-open={open ? 'true' : 'false'} aria-label="On this page">
    <button type="button" className="pub__contentsToggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      On this page
    </button>
    <ul className={`pub__contentsList${open ? ' pub__contentsList--open' : ''}`}>
      {chapters.map(({ id, label }) => <li key={id}><a href={`#${id}`} onClick={() => setOpen(false)}>{label}</a></li>)}
    </ul>
  </nav>;
}

export default function PublicPage() {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const page = pages[pathname.slice(1)] || pages.about;
  const pageRef = useRef(null);
  const layoutRef = useRef(null);
  const headerRef = useRef(null);

  // The sticky header wraps to two rows on a narrow phone and one row on a
  // desktop, so its height is not a constant — measured at 124px vs 126px in the
  // browser. A hardcoded `scroll-margin-top: 88px` left every jumped-to heading
  // sitting under the header. Publishing the measured height keeps the CSS offset
  // and the real layout in agreement, including after a rotation or a font-size
  // change, neither of which a literal can follow.
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return undefined;
    const publish = () => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      pageRef.current?.style.setProperty('--pub-header-h', `${height}px`);
    };
    publish();
    // `ResizeObserver` on the header itself: fires when it wraps or unwraps.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null;
    observer?.observe(header);
    window.addEventListener('resize', publish);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
    };
  }, []);

  useEffect(() => {
    const previous = document.title;
    document.title = `${page.title} | E-Menu`;
    // Returning via Back should not restore the previous page's scroll offset.
    window.scrollTo(0, 0);
    return () => { document.title = previous; };
  }, [page.title, pathname]);

  return <div ref={pageRef} className={`pub${['about', 'pricing'].includes(pathname.slice(1)) ? '' : ' pub--article'}`}>
    <a className="pub__skip" href="#pub-main">Skip to content</a>
    <header className="pub__header" ref={headerRef}><div className="pub__headerInner">
      <Link className="pub__brand" to="/about">E-Menu</Link>
      <nav className="pub__nav" aria-label="Public pages">{PUBLIC_NAV.map(([path, label]) => <NavLink key={path} to={`/${path}`}>{label}</NavLink>)}</nav>
      <div className="pub__actions">
        <button type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>{theme === 'light' ? 'Dark' : 'Light'}</button>
        <Link to="/">Sign in</Link>
      </div>
    </div></header>
    <div className="pub__layout" ref={layoutRef}>
      <Contents layoutRef={layoutRef} pathname={pathname} />
      <main className="pub__main" id="pub-main">
        {PUBLICATION.status !== 'approved' && <div className="pub__notice" role="status">Draft for review · These pages are not approved for publication.</div>}
        <h1>{page.title}</h1>
        {page.content}
      </main>
    </div>
    <footer className="pub__footer">
      <div className="pub__footerGrid">
        {FOOTER_GROUPS.map(group => <div key={group.heading} className="pub__footerGroup">
          <h2>{group.heading}</h2>
          <ul>{group.links.map(([path, label]) => <li key={path}><Link to={`/${path}`}>{label}</Link></li>)}</ul>
        </div>)}
      </div>
      <p className="pub__footerBase">Powered by Touch</p>
    </footer>
  </div>;
}
