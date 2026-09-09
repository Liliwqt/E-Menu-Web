import { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X } from 'lucide-react';
import { useLiveAnalyst } from '../../context/LiveAnalystProvider';
import '../../styles/ai.css';

/**
 * AI Live Notification Panel — Bottom notification bar.
 *
 * Matches V1's AIFloatingChat (AILiveNotificationBar) design:
 * fixed to the bottom of the viewport, auto-opens on new analyses,
 * scrollable body, close button.
 *
 * ALL lifecycle management (timers, briefing logic) lives in
 * LiveAnalystProvider. This component only reads from context and renders.
 */

function AnalysisMessages({ analysis }) {
  if (!analysis) return null;

  // Preparing state (loading dots + greeting)
  if (analysis.mode === 'briefing-preparing') {
    return (
      <div className="np__bubble np__bubble--preparing">
        <div className="np__header-tag">
          <span className="np__bullet" />
          <span>AI Shift Handoff</span>
        </div>
        {analysis.greeting && (
          <p className="np__greeting">{analysis.greeting}</p>
        )}
        {analysis.branchWelcome && (
          <p className="np__welcome">{analysis.branchWelcome}</p>
        )}
        <p className="np__text">{analysis.message}</p>
        <div className="np__dots" aria-hidden="true">
          <span /><span /><span />
        </div>
      </div>
    );
  }

  // Shift Handoff result
  if (analysis.mode === 'briefing') {
    const handoff = analysis.shiftHandoff || {};
    const highPriority = handoff.recommendation || analysis.recommendedActions?.high?.[0];
    const riskText = Array.isArray(handoff.inventoryRisks)
      ? handoff.inventoryRisks.join(' ')
      : handoff.inventoryRisks;
    const handoffRows = [
      ['Yesterday Revenue', handoff.yesterdayRevenue],
      ['Top Product', handoff.topProduct],
      ['Fastest Growing', handoff.fastestGrowingProduct],
      ['Inventory Risks', riskText],
      ['Operational Insight', handoff.operationalInsight],
      ['Recommendation', highPriority],
      ['Revenue Opportunity', handoff.potentialRevenueOpportunity],
    ].filter(([, value]) => value);

    return (
      <>
        <div className="np__bubble">
          <div className="np__header-tag">
            <span className="np__bullet" />
            <span>AI Shift Handoff</span>
          </div>
          {(analysis.greeting || analysis.branchWelcome) && (
            <div style={{ marginBottom: 10 }}>
              {analysis.greeting && <p className="np__greeting">{analysis.greeting}</p>}
              {analysis.branchWelcome && <p className="np__welcome">{analysis.branchWelcome}</p>}
            </div>
          )}
          {handoffRows.length > 0 ? (
            <div className="np__grid">
              {handoffRows.map(([label, value]) => (
                <div key={label} className="np__metric">
                  <span className="np__metric-label">{label}</span>
                  <span className="np__metric-value">{value}</span>
                </div>
              ))}
            </div>
          ) : analysis.executiveSummary ? (
            <p className="np__text">{analysis.executiveSummary}</p>
          ) : null}
          {typeof analysis.confidenceScore === 'number' && analysis.confidenceScore > 0 && (
            <p className="np__confidence">Confidence {analysis.confidenceScore}%</p>
          )}
        </div>
        {analysis.generatedAt && (
          <div className="np__time">
            {analysis.fromCache ? 'Cached handoff' : 'Fresh handoff'} — {new Date(analysis.generatedAt).toLocaleTimeString()}
          </div>
        )}
      </>
    );
  }

  // Live insight
  if (analysis.insight) {
    const priorityClass =
      analysis.insight.priority === 'HIGH' ? 'np__bullet--high' :
      analysis.insight.priority === 'MEDIUM' ? 'np__bullet--medium' :
      analysis.insight.priority === 'LOW' ? 'np__bullet--low' : '';

    return (
      <>
        <div className="np__bubble">
          <div className="np__header-tag">
            <span className={`np__bullet ${priorityClass}`} />
            <span>{analysis.insight.priority || 'Live Update'}</span>
          </div>
          {analysis.insight.message && (
            <p className="np__text">{analysis.insight.message}</p>
          )}
          {analysis.insight.action && (
            <p className="np__action">
              <span className="np__action-label">Action:</span> {analysis.insight.action}
            </p>
          )}
        </div>
        {analysis.generatedAt && (
          <div className="np__time">
            {analysis.fromCache ? 'Cached' : 'Fresh'} — {new Date(analysis.generatedAt).toLocaleTimeString()}
          </div>
        )}
      </>
    );
  }

  // Generic sections fallback
  const sections = [];
  if (analysis.greeting) sections.push({ content: analysis.greeting });
  if (analysis.overallHealth) sections.push({ title: 'Business Health', content: analysis.overallHealth });
  if (analysis.topPerformers) sections.push({ title: 'Top Performers', content: analysis.topPerformers });
  if (analysis.concerns) sections.push({ title: 'Watch Out For', content: analysis.concerns });
  if (analysis.quickWins?.length > 0) sections.push({ title: 'Quick Actions', list: analysis.quickWins });
  if (analysis.closingNote) sections.push({ content: analysis.closingNote });

  if (sections.length === 0 && analysis.executiveSummary) {
    sections.push({ content: analysis.executiveSummary });
  }

  return (
    <>
      {sections.map((section, i) => (
        <div key={i} className="np__bubble" style={{ animationDelay: `${i * 0.08}s` }}>
          {section.title && (
            <div className="np__section-title">{section.title}</div>
          )}
          {section.content && <p className="np__text">{section.content}</p>}
          {section.list && (
            <ul className="np__list">
              {section.list.map((item, j) => (
                <li key={j} className="np__list-item">
                  <span className="np__bullet" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {analysis.generatedAt && (
        <div className="np__time">
          {analysis.fromCache ? 'Cached' : 'Fresh'} — {new Date(analysis.generatedAt).toLocaleTimeString()}
        </div>
      )}
    </>
  );
}

export default function AINotificationPanel() {
  const {
    latestAnalysis: analysis,
    generating,
    error,
    notificationOpen,
    hasData,
    setNotificationOpen,
  } = useLiveAnalyst();

  const bodyRef = useRef(null);
  const panelVisible = notificationOpen;

  // Scroll to top on new content
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [analysis, generating]);

  return createPortal(
    <div aria-live="polite">
      <div className={`np ${panelVisible ? 'np--open' : ''}`}>
        <div className="np__head">
          <div className="np__avatar">
            <Sparkles size={16} />
          </div>
          <div className="np__info">
            <p className="np__name">Live Operations AI</p>
            <p className="np__status">
              <span className="np__status-dot" />
              {analysis?.mode === 'briefing-preparing'
                ? 'Preparing shift handoff'
                : analysis?.mode === 'briefing'
                ? 'Shift handoff ready'
                : analysis?.mode === 'live'
                ? 'AI Live Operations Feed active'
                : 'Listening for operations changes'}
            </p>
          </div>
          <button
            className="np__close"
            onClick={() => setNotificationOpen(false)}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="np__body" ref={bodyRef}>
          {!hasData && !analysis && !generating && (
            <div className="np__empty">
              <Sparkles size={28} style={{ opacity: 0.4 }} />
              <p style={{ fontWeight: 600 }}>No Data Yet</p>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)' }}>
                Once orders start arriving, the AI will analyze your operations automatically.
              </p>
            </div>
          )}

          {hasData && !analysis && !generating && !error && (
            <div className="np__system-msg">
              Live Operations AI is ready. Shift handoffs and hourly updates will appear here.
            </div>
          )}

          {generating && analysis?.mode !== 'briefing-preparing' && (
            <div className="np__dots">
              <span /><span /><span />
            </div>
          )}

          {error && !generating && (
            <div className="np__bubble">
              <p className="np__text" style={{ color: 'var(--danger)' }}>{error}</p>
            </div>
          )}

          {analysis && <AnalysisMessages analysis={analysis} />}
        </div>
      </div>
    </div>,
    document.body
  );
}
