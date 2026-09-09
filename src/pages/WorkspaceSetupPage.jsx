import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, MapPin, Sparkles, Store } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { PLAN_FREE, PLAN_SUBSCRIPTION } from '../lib/planFeatures';
import '../styles/onboarding.css';

const PLANS = [
  {
    id: PLAN_FREE,
    name: 'Free',
    price: '₱0',
    description: 'Run the daily restaurant operation without AI.',
    features: [
      'Menu and inventory management',
      'Live kiosk orders',
      'Basic sales dashboard',
      'Order history',
    ],
  },
  {
    id: PLAN_SUBSCRIPTION,
    name: 'Subscription',
    price: '14-day AI trial',
    description: 'Everything in Free, plus AI operations intelligence.',
    features: [
      'AI Operations Analyst and chat',
      'AI reports and executive presentation',
      'Proactive AI insights',
      'Multi-kiosk management',
    ],
  },
];

export default function WorkspaceSetupPage() {
  const navigate = useNavigate();
  const { user, completeWorkspace, loading, logout } = useAuth();
  const [plan, setPlan] = useState(PLAN_FREE);
  const [companyName, setCompanyName] = useState('');
  const [branchName, setBranchName] = useState('');
  const [location, setLocation] = useState('');
  const [serviceType, setServiceType] = useState('cafe');
  const [contactPhone, setContactPhone] = useState('');
  const [currency, setCurrency] = useState('PHP');
  const [timezone, setTimezone] = useState('Asia/Manila');
  const [operatingHours, setOperatingHours] = useState('');
  const [error, setError] = useState('');

  async function finish(event) {
    event.preventDefault();
    setError('');
    try {
      const workspace = await completeWorkspace({
        companyName,
        branchName,
        location,
        serviceType,
        contactPhone,
        currency,
        timezone,
        operatingHours,
        plan,
      });
      navigate(`/home/${workspace.branchId}`, { replace: true });
    } catch (setupError) {
      setError(setupError.message || 'Unable to create the workspace. Please try again.');
    }
  }

  return (
    <main className="onboard">
      <section className="onboard__card">
        <header className="onboard__header">
          <div className="onboard__mark"><Store size={22} /></div>
          <div>
            <p className="onboard__eyebrow">
              Welcome{user?.displayName ? `, ${user.displayName}` : user?.email ? `, ${user.email}` : ''}
            </p>
            <h1>Set up your restaurant workspace</h1>
            <p>
              Choose your plan and add the operating details your team needs. You can start managing
              orders as soon as setup is complete.
            </p>
          </div>
        </header>

        <form onSubmit={finish} className="onboard__form">
          <fieldset>
            <legend>Choose your plan</legend>
            <div className="onboard__plans">
              {PLANS.map((option) => (
                <label className={`onboard__plan ${plan === option.id ? 'is-selected' : ''}`} key={option.id}>
                  <input
                    type="radio"
                    name="plan"
                    value={option.id}
                    checked={plan === option.id}
                    onChange={() => setPlan(option.id)}
                  />
                  <div className="onboard__planHead">
                    <strong>{option.name}</strong>
                    <span>{option.price}</span>
                  </div>
                  <p>{option.description}</p>
                  <ul>
                    {option.features.map((feature) => (
                      <li key={feature}><Check size={14} /> {feature}</li>
                    ))}
                  </ul>
                  {option.id === PLAN_SUBSCRIPTION && (
                    <small>
                      <Sparkles size={13} /> AI trial starts immediately; no charge until the trial ends.
                    </small>
                  )}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Branch details</legend>
            <label>
              Company name
              <input
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="e.g. Sugar Cafe Group"
                autoComplete="organization"
                required
                maxLength={80}
              />
            </label>
            <label>
              First branch name
              <input
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                placeholder="e.g. Sugar Cafe – Nivel Hills"
                autoComplete="organization"
                required
                maxLength={80}
              />
            </label>
            <label>
              <span><MapPin size={14} /> Branch location</span>
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Street, barangay, city"
                autoComplete="street-address"
                required
                maxLength={160}
              />
            </label>
            <label>
              Restaurant type
              <select value={serviceType} onChange={(event) => setServiceType(event.target.value)}>
                <option value="cafe">Café</option>
                <option value="restaurant">Restaurant</option>
                <option value="quick-service">Quick-service restaurant</option>
                <option value="bakery">Bakery</option>
              </select>
            </label>
            <label>
              Contact phone
              <input
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                placeholder="e.g. +63 917 123 4567"
                autoComplete="tel"
                maxLength={30}
              />
            </label>
            <label>
              Currency
              <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                <option value="PHP">Philippine peso (PHP)</option>
                <option value="USD">US dollar (USD)</option>
                <option value="SGD">Singapore dollar (SGD)</option>
              </select>
            </label>
            <label>
              Timezone
              <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                <option value="Asia/Manila">Asia/Manila</option>
                <option value="Asia/Singapore">Asia/Singapore</option>
                <option value="America/Los_Angeles">America/Los Angeles</option>
                <option value="America/New_York">America/New York</option>
              </select>
            </label>
            <label>
              Operating hours
              <input
                value={operatingHours}
                onChange={(event) => setOperatingHours(event.target.value)}
                placeholder="e.g. Mon-Sun, 7:00 AM-9:00 PM"
                maxLength={120}
              />
            </label>
          </fieldset>

          {error && <div className="onboard__error" role="alert">{error}</div>}

          <div className="onboard__actions">
            <button type="button" className="btn btn--ghost" onClick={logout} disabled={loading}>
              Sign out
            </button>
            <button type="submit" className="btn btn--primary" disabled={loading}>
              {loading ? 'Creating workspace…' : 'Create workspace and open dashboard'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
