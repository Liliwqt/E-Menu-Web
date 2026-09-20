// Once a read fails or is cancelled, queued callbacks belong to a retired
// subscription. Only a new subscription (retry) may publish data again.
export function watchResource(subscribe, branchId, emptyValue, publish) {
  let active = true;
  let stop;
  publish({ data: emptyValue, status: 'loading', error: null });
  const fail = (error) => {
    if (!active) return;
    active = false;
    publish({ data: emptyValue, status: 'error', error });
  };
  try {
    stop = subscribe(branchId, (data) => {
      if (active) publish({ data, status: 'ready', error: null });
    }, fail);
  } catch (error) { fail(error); }
  return () => { active = false; stop?.(); };
}
