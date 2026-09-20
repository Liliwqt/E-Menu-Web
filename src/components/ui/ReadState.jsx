export default function ReadState({ resource, label }) {
  if (!resource || resource.status === 'ready') return null;
  if (resource.status === 'error') return (
    <div className="read-state card card--pad" role="alert">
      <strong>Could not load {label}.</strong>
      <p>Your data has not been changed. Check your connection and try again.</p>
      <button className="btn btn--secondary" onClick={resource.retry}>Retry {label}</button>
    </div>
  );
  return <p className="read-state" role="status">Loading {label}…</p>;
}
