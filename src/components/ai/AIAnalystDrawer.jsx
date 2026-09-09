import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, SendHorizonal, X, Sunrise, SearchCheck, FlaskConical, Radio } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useBranchData } from '../../context/BranchDataContext';
import { AUTH_CONFIG } from '../../config/authConfig';
import { generateAIAnalysis } from '../../lib/aiAnalystService';
import '../../styles/ai.css';

/**
 * Executive AI Business Analyst.
 * One conversational surface for: work chat (opschat), shift briefing,
 * revenue-leak detection and what-if decision simulation — all V1 AI modes,
 * unified.
 */

let msgId = 0;
const nextId = () => `m${msgId += 1}`;

function timeOfDayLabel() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function AiMessage({ msg }) {
  if (msg.role === 'user') {
    return (
      <div className="ai-msg ai-msg--user">
        <div className="ai-msg__bubble">{msg.text}</div>
      </div>
    );
  }

  const { data } = msg;
  return (
    <div className="ai-msg ai-msg--ai">
      <div className="ai-msg__bubble">
        {msg.text && <p style={{ margin: 0 }}>{msg.text}</p>}

        {data?.keyPoints?.length > 0 && (
          <div className="ai-msg__points">
            {data.keyPoints.map((p, i) => <div className="ai-msg__point" key={i}><span>{p}</span></div>)}
          </div>
        )}

        {data?.leaks?.length > 0 && (
          <div className="ai-msg__points">
            {data.leaks.map((l, i) => (
              <div className="ai-msg__point" key={i}>
                <span><strong>{l.category}:</strong> {l.finding} {l.estimatedLoss && l.estimatedLoss !== 'Insufficient data' ? `(~${l.estimatedLoss})` : ''} — {l.recommendedAction}</span>
              </div>
            ))}
          </div>
        )}

        {data?.shiftHandoff && (
          <div className="ai-msg__points">
            {[
              ['Yesterday', data.shiftHandoff.yesterdayRevenue],
              ['Top product', data.shiftHandoff.topProduct],
              ['Trending', data.shiftHandoff.fastestGrowingProduct],
              ['Insight', data.shiftHandoff.operationalInsight],
              ['Opportunity', data.shiftHandoff.potentialRevenueOpportunity],
            ].filter(([, v]) => v).map(([k, v], i) => (
              <div className="ai-msg__point" key={i}><span><strong>{k}:</strong> {v}</span></div>
            ))}
            {data.shiftHandoff.inventoryRisks?.length > 0 && (
              <div className="ai-msg__point"><span><strong>Inventory risks:</strong> {data.shiftHandoff.inventoryRisks.join('; ')}</span></div>
            )}
          </div>
        )}

        {data?.simulation?.scenario && (
          <div className="ai-sim">
            <div className="ai-sim__row"><b>Revenue</b><span>{data.simulation.revenueImpact || '—'}</span></div>
            <div className="ai-sim__row"><b>Stockout risk</b><span>{data.simulation.stockoutRisk || '—'}</span></div>
            <div className="ai-sim__row"><b>Customers</b><span>{data.simulation.customerSatisfaction || '—'}</span></div>
            <div className="ai-sim__row"><b>Op. risk</b><span>{data.simulation.operationalRisk || '—'}</span></div>
          </div>
        )}

        {(data?.recommendation || data?.insight?.action) && (
          <div className="ai-msg__rec">
            → {typeof data.recommendation === 'string' ? data.recommendation : data.insight?.action || data.shiftHandoff?.recommendation || ''}
          </div>
        )}

        {typeof data?.confidenceScore === 'number' && data.confidenceScore > 0 && (
          <div style={{ marginTop: 8 }}>
            <span className="pill pill--neutral num">{data.confidenceScore}% confidence</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Conversational memory: chat survives closing/reopening the drawer within the session, so the
// analyst keeps context. sessionStorage only — no backend, cleared on logout with the other keys.
const CHAT_KEY = (branchId) => `emp_ai_chat_${branchId}`;
const MAX_STORED_TURNS = 12;   // persisted
const MAX_CONTEXT_TURNS = 10;  // sent to the AI

function loadChat(branchId) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CHAT_KEY(branchId)));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export default function AIAnalystDrawer({ open, onClose, initialAction = null }) {
  const { nickname, user } = useAuth();
  const { branchId, aiAnalyticsData, hasOrders } = useBranchData();
  const [messages, setMessages] = useState(() => loadChat(branchId));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);

  const USAGE_LIMIT = 10;
  const COOLDOWN_MS = 60 * 60 * 1000;

  const getUsageState = () => {
    try {
      const data = JSON.parse(localStorage.getItem(`emp_ai_usage_${branchId}`)) || { count: 0, cooldownUntil: null };
      if (data.cooldownUntil && Date.now() > data.cooldownUntil) {
        return { count: 0, cooldownUntil: null };
      }
      return data;
    } catch {
      return { count: 0, cooldownUntil: null };
    }
  };

  const incrementUsage = () => {
    const state = getUsageState();
    state.count += 1;
    if (state.count >= USAGE_LIMIT) {
      state.cooldownUntil = Date.now() + COOLDOWN_MS;
    }
    localStorage.setItem(`emp_ai_usage_${branchId}`, JSON.stringify(state));
    return state;
  };

  const [usageState, setUsageState] = useState(getUsageState());
  const [cooldownRemaining, setCooldownRemaining] = useState('');

  useEffect(() => {
    if (!usageState.cooldownUntil) return;
    const update = () => {
      const remaining = usageState.cooldownUntil - Date.now();
      if (remaining <= 0) {
        setUsageState({ count: 0, cooldownUntil: null });
        localStorage.removeItem(`emp_ai_usage_${branchId}`);
        setCooldownRemaining('');
      } else {
        const m = Math.ceil(remaining / 60000);
        setCooldownRemaining(`${m} minute${m !== 1 ? 's' : ''}`);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [usageState.cooldownUntil, branchId]);

  const isCooldown = !!usageState.cooldownUntil;

  const branchLabel = AUTH_CONFIG.branches[branchId]?.name || branchId;
  const managerNickname = nickname || user?.email?.split('@')[0] || 'Manager';

  useEffect(() => {
    if (open) {
      setMessages((prev) => prev.length > 0 ? prev : [{
        id: nextId(),
        role: 'ai',
        text: `${timeOfDayLabel()}, ${managerNickname}. I'm your business analyst for ${branchLabel}. Ask me anything about sales, inventory, staffing or menu performance — or run one of the tools below.`,
      }]);
      setTimeout(() => inputRef.current?.focus(), 250);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-run a module action when opened from an AI suite card.
  useEffect(() => {
    if (open && initialAction?.mode && hasOrders) {
      runMode(initialAction.mode, {
        userText: initialAction.userText,
        scenario: initialAction.scenario || initialAction.userText,
      });
    }
  }, [open, initialAction]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  // Persist the conversation (last N turns) for this session so reopening continues it.
  useEffect(() => {
    if (!branchId) return;
    try {
      const keep = messages.filter((m) => m.role === 'user' || m.role === 'ai').slice(-MAX_STORED_TURNS);
      sessionStorage.setItem(CHAT_KEY(branchId), JSON.stringify(keep));
    } catch { /* storage full or unavailable — memory silently degrades to this session view */ }
  }, [messages, branchId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function reportContext(extra = {}) {
    return {
      asOfLabel: new Date().toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }),
      managerNickname,
      branchLabel,
      timeOfDayLabel: timeOfDayLabel(),
      ...extra,
    };
  }

  async function runMode(mode, { userText, scenario } = {}) {
    if (busy) return;
    
    const currentUsage = getUsageState();
    if (currentUsage.cooldownUntil) {
      const m = Math.ceil((currentUsage.cooldownUntil - Date.now()) / 60000);
      setMessages((prev) => [...prev, { id: nextId(), role: 'ai', text: `Usage limit reached to prevent token overuse. Please try again in ${m} minute${m !== 1 ? 's' : ''}.` }]);
      return;
    }

    if (userText) {
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: userText }]);
    }
    setBusy(true);
    setUsageState(incrementUsage());
    try {
      // Chat modes carry recent turns so follow-ups resolve in context; one-click reports don't.
      const isChat = mode === 'opschat' || mode === 'simulation';
      const conversation = isChat
        ? messages
          .filter((m) => (m.role === 'user' || m.role === 'ai') && m.text)
          .slice(-MAX_CONTEXT_TURNS)
          .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text }))
        : undefined;
      const extra = { ...(scenario ? { scenario } : {}), ...(conversation ? { conversation } : {}) };
      const payload = { ...aiAnalyticsData, reportContext: reportContext(extra) };
      // Question-specific modes (chat/simulation) are always fresh; the fixed one-click modes
      // (live/briefing/leak) are cache-first — the service cooldown guards repeat clicks.
      const result = await generateAIAnalysis(payload, branchId, isChat, mode);
      const text = result.answer
        || result.summary
        || result.greeting
        || (result.insight?.message)
        || '';
      setMessages((prev) => [...prev, { id: nextId(), role: 'ai', text, data: result }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: nextId(),
        role: 'ai',
        text: err.message?.includes('API key')
          ? 'The AI service is not configured — the OpenAI key is missing.'
          : 'I hit a problem reaching the AI service. Try again in a moment.',
      }]);
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    runMode('opschat', { userText: text, scenario: text });
  }

  if (!open) return null;

  return createPortal(
    <>
      <div className="ai-drawer__scrim" onClick={onClose} />
      <aside className="ai-drawer" role="dialog" aria-modal="true" aria-label="AI Business Analyst">
        <header className="ai-drawer__head">
          <div className="ai-drawer__title">
            <div className="shell__brandMark" style={{ width: 34, height: 34, borderRadius: 10 }}>
              <Sparkles size={17} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: '0.98rem' }}>AI Business Analyst</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', fontWeight: 600 }}>{branchLabel} · live data</div>
            </div>
          </div>
          <button className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Close analyst">
            <X size={18} />
          </button>
        </header>

        <div className="ai-drawer__body" ref={bodyRef}>
          {messages.map((m) => <AiMessage key={m.id} msg={m} />)}
          {busy && (
            <div className="ai-msg ai-msg--ai">
              <div className="ai-msg__bubble ai-typing" aria-label="Analyst is thinking">
                <span /><span /><span />
              </div>
            </div>
          )}
        </div>

        <div className="ai-drawer__tools">
          <button
            className="ai-tool"
            disabled={busy || !hasOrders || isCooldown}
            onClick={() => runMode('live', { userText: 'Give me a live operations update.' })}
          >
            <Radio size={13} /> Live ops pulse
          </button>
          <button
            className="ai-tool"
            disabled={busy || !hasOrders || isCooldown}
            onClick={() => runMode('briefing', { userText: 'Give me my shift briefing.' })}
          >
            <Sunrise size={13} /> Shift briefing
          </button>
          <button
            className="ai-tool"
            disabled={busy || !hasOrders || isCooldown}
            onClick={() => runMode('leak', { userText: 'Where am I losing revenue?' })}
          >
            <SearchCheck size={13} /> Find revenue leaks
          </button>
          <button
            className="ai-tool"
            disabled={busy || !hasOrders || isCooldown}
            onClick={() => {
              setInput('What happens if ');
              inputRef.current?.focus();
            }}
          >
            <FlaskConical size={13} /> What-if simulator
          </button>
        </div>

        <div className="ai-drawer__input">
          <input
            ref={inputRef}
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={isCooldown ? `Cooldown active (${cooldownRemaining})` : hasOrders ? 'Ask about sales, staffing, inventory…' : 'AI unlocks after the first order'}
            disabled={busy || !hasOrders || isCooldown}
            aria-label="Message the AI analyst"
          />
          <button className="btn btn--primary btn--icon" onClick={send} disabled={busy || !input.trim() || isCooldown} aria-label="Send">
            <SendHorizonal size={17} />
          </button>
        </div>
      </aside>
    </>,
    document.body
  );
}
