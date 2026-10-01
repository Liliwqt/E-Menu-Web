import { fetchWithAppCheck } from './firebase';
import { API_BASE } from './apiBase';

async function paymentRequest(path, options = {}) {
  const response = await fetchWithAppCheck(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Payment service unavailable (${response.status})`);
  return payload;
}

export function loadMerchantStatus(companyId, branchId) {
  const query = new URLSearchParams({ companyId, branchId });
  return paymentRequest(`/api/payments/merchant/status?${query}`);
}

export function requestMerchantOnboarding({ companyId, branchId, email }) {
  return paymentRequest('/api/payments/merchant/onboarding', {
    method: 'POST', body: JSON.stringify({ companyId, branchId, email }),
  });
}

export function refundQrOrder({ companyId, branchId, orderId, reason = 'requested_by_customer' }) {
  return paymentRequest('/api/payments/refunds', {
    method: 'POST', body: JSON.stringify({ companyId, branchId, orderId, reason }),
  });
}
