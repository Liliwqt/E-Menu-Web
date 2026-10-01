/** Publication inputs. Keep status as draft until the operator reviews every policy. */
export const PUBLICATION = Object.freeze({
  status: 'draft',
  reviewedAt: '',
  draftReviewedAt: '2026-10-01',
  reviewerName: 'The operator',
  businessName: 'Touch is an unregistered brand managed by its operators',
  operatorContacts: Object.freeze(['Patrick Fitzroy Hofer', 'Jhonryl Pamaybay']),
  philippinesAddress: 'Apas, Cebu City, Cebu, Philippines',
  supportEmail: 'touch.support1@gmail.com',
  privacyEmail: 'touch.support1@gmail.com',
  supportHours: 'Monday–Friday, 8:00 AM–9:00 PM Philippine time (Asia/Manila)',
  subscriptionCancellationTerms: 'Owners can cancel a branch subscription in Records and access after confirming their password. Confirmed cancellation stops subscription benefits and new operational writes immediately; records remain readable subject to retention. Cancellation does not automatically issue a refund. This workflow is implemented and tested locally, but is not deployed yet.',
  subscriptionRefundTerms: 'Send subscription refund requests within 14 days of payment for duplicate charges, incorrect charges, or paid access not provided. Include the payment reference, date, amount, account or branch identifier, reason, and relevant evidence. Do not send passwords, OTPs, or full card details. Touch support reviews requests and responds by email within 5 business days. Requests do not guarantee approval. The response deadline does not guarantee when refunded funds arrive.',
  platformServiceTerms: 'Maintenance and outages may occur; uninterrupted availability is not promised. Report issues to touch.support1@gmail.com during the stated support hours. Accounts may be restricted for misuse or security threats. Material policy changes will be communicated before taking effect, except urgent security or legal changes. Notification and restriction procedures remain to be verified. There is no general support response-time guarantee; the subscription-refund response commitment is separate.',
  merchantOrderRefundResponsibility: 'Customers contact the merchant that sold the products for wrong, missing, or cancelled orders. The merchant decides cancellations and refunds under its policy and applicable obligations. Touch support handles technical platform and payment-integration issues. Confirmed QR Ph refunds are requested from the merchant and processed through the provider, without guaranteed approval or timing. Live QR Ph payments and refunds are not yet enabled or provider-verified in this implementation.',
  dataRetentionSummary: 'Branch-scoped policy: after 12 consecutive calendar months without an authorized owner/manager visit or confirmed operational activity, Touch queues an owner email and displays an in-app warning. The additional calendar-month grace starts only when the email service accepts the warning. Download records or resume activity before the displayed deletion date. Owner-requested closure stops writes immediately and permits export or recovery for 30 days. Private encrypted exports expire after 24 hours; managed encrypted backups expire after 30 days. Unresolved payment/refund issues retain minimal operator-reviewed records; resolved holds are removed within 30 days unless a documented requirement applies. Premium insights retain their separate 90-day maximum. These workflows are tested locally; scheduled deletion remains disabled pending email, storage, restore rehearsal and release verification.',
  releaseBlockers: Object.freeze([
    'PayMongo acceptance of operator identity and address is unverified',
    'Lifecycle clients and rules require coordinated deployment and final operator review',
    'Gmail delivery, private storage and scheduled lifecycle processing require configuration and verification',
    'A real encrypted backup/restore rehearsal and documented payment retention requirements are pending',
    'Policy-change notification and account-restriction procedures are unverified',
    'Final public-page approval is pending',
  ]),
});

export const PUBLIC_PAGES = Object.freeze([
  ['about', 'About'],
  ['pricing', 'Pricing'],
  ['contact', 'Contact'],
  ['terms', 'Terms and Conditions'],
  ['privacy', 'Privacy Policy'],
  ['refund-policy', 'Cancellation and Refund Policy'],
]);

export function publicationIssues(details = PUBLICATION) {
  const issues = [];
  if (details.status !== 'approved') issues.push('Policies have not been approved');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(details.reviewedAt)) issues.push('Policy review date is missing');
  if (!Array.isArray(details.releaseBlockers)) issues.push('Publication blockers have not been reviewed');
  else for (const blocker of details.releaseBlockers) issues.push(blocker);
  for (const [field, label] of [
    ['businessName', 'Business name'],
    ['philippinesAddress', 'Philippine business address'],
    ['supportEmail', 'Support email'],
    ['privacyEmail', 'Privacy email'],
    ['subscriptionCancellationTerms', 'Subscription cancellation terms'],
    ['subscriptionRefundTerms', 'Subscription refund terms'],
    ['platformServiceTerms', 'Platform service and policy-change terms'],
    ['merchantOrderRefundResponsibility', 'Merchant order refund responsibility'],
    ['dataRetentionSummary', 'Data retention summary'],
  ]) {
    if (!details[field]?.trim()) issues.push(`${label} is missing`);
    else if (/\b(tbd|todo|placeholder|review required|to be provided)\b/i.test(details[field])) issues.push(`${label} still contains draft text`);
  }
  if (details.supportEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.supportEmail)) issues.push('Support email is invalid');
  if (details.privacyEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(details.privacyEmail)) issues.push('Privacy email is invalid');
  return issues;
}

export function subscriptionCancellationEmail(companyId, branchId) {
  const subject = 'E-Menu subscription cancellation request';
  const body = `Please cancel the subscription for:\nCompany ID: ${companyId}\nBranch ID: ${branchId}\n\nPlease confirm when cancellation has been processed. I understand opening this email does not cancel my subscription.`;
  return `mailto:${PUBLICATION.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
