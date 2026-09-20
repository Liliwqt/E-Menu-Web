import { useCallback, useEffect, useState } from 'react';
import { watchResource } from '../lib/liveResource';

// The provider is keyed by account/company/branch; each retry owns its listener.
export function useLiveResource(subscribe, branchId, emptyValue) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ data: emptyValue, status: 'loading', error: null });
  const retry = useCallback(() => {
    setState({ data: emptyValue, status: 'loading', error: null });
    setAttempt((n) => n + 1);
  }, [emptyValue]);
  useEffect(() => watchResource(subscribe, branchId, emptyValue, setState), [subscribe, branchId, attempt, emptyValue]);
  return { ...state, retry };
}
