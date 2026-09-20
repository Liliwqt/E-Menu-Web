/**
 * Content-area placeholder shown while a page's lazy chunk downloads.
 *
 * The shell (sidebar, header, nav) is rendered by the route wrapper in App.jsx,
 * above the Suspense boundary, so this fills only the part of the screen that is
 * actually changing. Before that change the shell lived inside each lazily loaded
 * page, so every first visit to a panel replaced the entire screen with a spinner.
 *
 * Blocks mirror the sizes pages already use for their own data loading (see
 * DashboardPage), so the hand-off from chunk-loading to data-loading looks steady.
 */
export default function ContentSkeleton() {
  const block = (height, extra) => ({ height, borderRadius: 'var(--r-lg)', ...extra });

  return (
    <div aria-hidden="true" style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <div className="skeleton" style={block(28, { width: '40%', maxWidth: 280 })} />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 'var(--sp-3)',
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={block(148)} />
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--sp-3)',
        }}
      >
        {[0, 1].map((i) => (
          <div key={i} className="skeleton" style={block(280)} />
        ))}
      </div>
    </div>
  );
}
