import { useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { PUBLICATION, PUBLIC_PAGES } from '../lib/publicSiteContent';
import { PLAN_BASIC, PLAN_STARTER, PLAN_PREMIUM, PLAN_PRICE_PHP } from '../lib/planFeatures';
import '../styles/public.css';

const planCards = [
  { name: 'Basic', price: PLAN_PRICE_PHP[PLAN_BASIC], lines: ['Menu, inventory, orders, team and device management', 'Revenue graphs and standard reports', 'QR Ph payment status when a merchant connection is active'] },
  { name: 'Starter', price: PLAN_PRICE_PHP[PLAN_STARTER], lines: ['Everything in Basic', 'Revenue focused AI assistance, trends, gaps and reports', '300 generated AI responses per branch per billing period'] },
  { name: 'Premium', price: PLAN_PRICE_PHP[PLAN_PREMIUM], lines: ['Everything in Starter', 'Live analysis, shift handoff, simulations and presentations', 'Curated branch insights and 1,000 generated responses per period'] },
];

function ReviewField({ value, label }) {
  return value ? <span>{value}</span> : <span className="pub__review">Review required: {label}</span>;
}

function Section({ title, children }) {
  return <section className="pub__section"><h2>{title}</h2>{children}</section>;
}

function About() {
  return <>
    <p className="pub__lead">E-Menu helps Philippine businesses manage menu or catalog-based ordering, inventory, staff, and daily reporting in one portal, with an Android ordering app. It supports businesses such as cafés, restaurants, food stalls, and other product sellers using this ordering flow.</p>
    <div className="pub__grid pub__grid--two">
      <Section title="Daily operations"><p>Set up products and sizes, track stock, review orders, and manage branch access. When a plan expires, existing records remain visible while new operational writes pause.</p></Section>
      <Section title="Payments"><p>Pay at Counter records are customer or staff reports, not proof of settlement. When a verified QR Ph merchant connection is active, an order is recorded as paid only after the payment provider confirms it.</p></Section>
    </div>
    <Section title="Who operates E-Menu"><p><ReviewField value={PUBLICATION.businessName} label="operator or legal business name" /> · <ReviewField value={PUBLICATION.philippinesAddress} label="Philippine business address" /></p></Section>
  </>;
}

function Pricing() {
  return <>
    <p className="pub__lead">Plans are priced in Philippine pesos per branch per month. Every new branch receives one 14-day Starter trial. Payment and plan activation are arranged with the E-Menu operator; there is no automatic subscription charge.</p>
    <div className="pub__grid pub__grid--three">{planCards.map(plan => <section className="pub__plan" key={plan.name}>
      <h2>{plan.name}</h2><p className="pub__price">₱{plan.price.toLocaleString('en-PH')}<span> / branch / month</span></p>
      <ul>{plan.lines.map(line => <li key={line}>{line}</li>)}</ul>
    </section>)}</div>
    <Section title="Before you subscribe"><p>AI features depend on the AI service being available. Check their current status with E-Menu before paying for Starter or Premium. Verified QR Ph checkout also requires each business’s approved merchant connection. An expired plan preserves existing records in read-only form.</p></Section>
  </>;
}

function Contact() {
  return <>
    <p className="pub__lead">For subscription, account, privacy, or platform support, contact the E-Menu operator.</p>
    <Section title="Support"><p><ReviewField value={PUBLICATION.businessName} label="business name" /></p><p><ReviewField value={PUBLICATION.philippinesAddress} label="Philippine address" /></p><p>{PUBLICATION.supportEmail ? <a href={`mailto:${PUBLICATION.supportEmail}`}>{PUBLICATION.supportEmail}</a> : <ReviewField label="support email" />}</p><p>{PUBLICATION.supportHours}</p></Section>
    <Section title="Customer orders"><p>For an order, product, fulfillment, or order refund request, contact the merchant shown in the ordering app. E-Menu handles the software platform and can help investigate a technical payment-record issue.</p></Section>
  </>;
}

const TERMS_LEAD = PUBLICATION.status === 'approved'
  ? `Effective ${PUBLICATION.reviewedAt}. These terms govern use of E-Menu.`
  : 'These terms are a draft for operator review. They become effective only after the business identity and commercial terms below are completed and approved.';

function Terms() {
  return <>
    <p className="pub__lead">{TERMS_LEAD}</p>
    <Section title="Platform and accounts"><p>E-Menu is an operations and ordering software service. <ReviewField value={PUBLICATION.businessName} label="business name" />. Business owners control their business workspace and assign manager, staff, and device access. Users must protect their credentials and use only branches they are authorized to access.</p></Section>
    <Section title="Plans and access"><p>Plans are per branch per calendar month. Each new branch receives one 14-day Starter trial. Subscription payment is arranged with the operator and access begins after payment is verified. There is no automatic charge in the current service. After expiry, existing operational records remain visible while new operational writes and paid features pause.</p></Section>
    <Section title="Orders and payments"><p>Merchants are responsible for product information, fulfillment, and customer service for their orders. Pay at Counter and legacy customer-reported QR statuses do not establish that money was received. Verified QR Ph status requires provider confirmation. Payment processing fees and settlement are governed by the merchant’s payment-provider agreement.</p></Section>
    <Section title="Cancellation, service, and changes"><p><ReviewField value={PUBLICATION.subscriptionCancellationTerms} label="subscription cancellation terms" />. <ReviewField value={PUBLICATION.platformServiceTerms} label="platform service, suspension, and policy-change terms" />.</p></Section>
  </>;
}

const PRIVACY_LEAD = PUBLICATION.status === 'approved'
  ? `Effective ${PUBLICATION.reviewedAt}. This policy describes data used by E-Menu.`
  : 'This draft explains the data used by the current service. Its retention periods and final privacy contact require review before publication.';

function Privacy() {
  return <>
    <p className="pub__lead">{PRIVACY_LEAD}</p>
    <Section title="Information handled"><p>E-Menu processes account identity and branch membership, menu and stock records, order details including customer names and payment status, device enrollment, subscription entitlements, and operational analytics. Verified QR Ph processing stores provider references and status; payment credentials remain on the server.</p></Section>
    <Section title="How it is used"><p>This information runs authorized business workflows, controls access, checks stock and orders, reports performance, and supports payment confirmation and refunds. AI features may use branch business context when enabled; the service should not receive raw payment credentials.</p></Section>
    <Section title="Services and storage"><p>Firebase provides authentication and the operational database. The Railway backend verifies devices, orders, payments, and AI requests. PayMongo handles verified QR Ph transactions when connected. OpenAI processes AI requests when the AI service is enabled. Browser storage retains sign-in state and local preferences.</p></Section>
    <Section title="Access, retention, and requests"><p>Branch access follows assigned roles. <ReviewField value={PUBLICATION.dataRetentionSummary} label="data retention and deletion practices" />. For access, correction, or privacy questions, contact <ReviewField value={PUBLICATION.privacyEmail} label="privacy email" />.</p></Section>
  </>;
}

function RefundPolicy() {
  return <>
    <p className="pub__lead">E-Menu subscription payments and customer purchases from merchants follow different processes.{PUBLICATION.status !== 'approved' && ' The final commercial rules require operator approval.'}</p>
    <Section title="E-Menu subscriptions"><p>There is no automatic subscription charge. To stop a future renewal, contact the E-Menu operator. <ReviewField value={PUBLICATION.subscriptionCancellationTerms} label="cancellation timing and effect" />. <ReviewField value={PUBLICATION.subscriptionRefundTerms} label="subscription refund eligibility and timing" />.</p></Section>
    <Section title="Customer orders"><p><ReviewField value={PUBLICATION.merchantOrderRefundResponsibility} label="merchant order cancellation and refund responsibility" />. Customers should first contact the merchant about fulfillment or an order dispute. A QR Ph refund request may be pending until the provider confirms its outcome; the order record must not be shown as refunded before confirmation.</p></Section>
    <Section title="How to ask"><p>For E-Menu subscriptions or technical payment issues, contact <ReviewField value={PUBLICATION.supportEmail} label="support email" />. Include the business or branch and relevant reference, but do not send card details or passwords.</p></Section>
  </>;
}

const pages = {
  about: { title: 'About E-Menu', content: <About /> },
  pricing: { title: 'Plans and pricing', content: <Pricing /> },
  contact: { title: 'Contact', content: <Contact /> },
  terms: { title: 'Terms and Conditions', content: <Terms /> },
  privacy: { title: 'Privacy Policy', content: <Privacy /> },
  'refund-policy': { title: 'Cancellation and Refund Policy', content: <RefundPolicy /> },
};

export default function PublicPage() {
  const { pathname } = useLocation();
  const { theme, toggleTheme } = useTheme();
  const page = pages[pathname.slice(1)] || pages.about;
  useEffect(() => {
    const previous = document.title;
    document.title = `${page.title} | E-Menu`;
    return () => { document.title = previous; };
  }, [page.title]);
  return <div className="pub">
    <header className="pub__header"><div className="pub__headerInner">
      <Link className="pub__brand" to="/about">E-Menu</Link>
      <nav className="pub__nav" aria-label="Public pages">{PUBLIC_PAGES.map(([path, label]) => <NavLink key={path} to={`/${path}`}>{label}</NavLink>)}</nav>
      <div className="pub__actions"><button type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}>{theme === 'light' ? 'Dark' : 'Light'}</button><Link to="/">Sign in</Link></div>
    </div></header>
    <main className="pub__main">{PUBLICATION.status !== 'approved' && <div className="pub__notice" role="status">Draft for review · These pages are not approved for publication.</div>}<h1>{page.title}</h1>{page.content}</main>
    <footer className="pub__footer"><Link to="/">Portal sign in</Link><span>·</span><Link to="/contact">Contact</Link><span>·</span><Link to="/privacy">Privacy</Link></footer>
  </div>;
}
