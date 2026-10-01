/** Publication inputs. Keep status as draft until the operator reviews every policy. */
export const PUBLICATION = Object.freeze({
  status: 'draft',
  reviewedAt: '',
  draftReviewedAt: '2026-10-01',
  reviewerName: 'Patrick Fitzroy Hofer',
  businessName: 'Touch is an unregistered brand operated by Patrick Fitzroy Hofer',
  philippinesAddress: 'Online service operating from Apas, Cebu City, Cebu, Philippines; no physical office',
  supportEmail: 'touch.support1@gmail.com',
  privacyEmail: 'touch.support1@gmail.com',
  supportHours: 'Monday–Friday, 8:00 AM–9:00 PM Philippine time (Asia/Manila)',
  subscriptionCancellationTerms: 'Owners request cancellation using the in-app button, which opens an email to touch.support1@gmail.com. Send the email to submit the request; opening it does not cancel access. Once the operator processes cancellation and confirms it by email, subscription benefits and new operational writes stop immediately. Existing records remain viewable, subject to the retention policy, and access returns after reactivation. Cancellation does not automatically grant a refund. Cancellation processing time is not yet defined, and operator processing remains to be implemented and verified.',
  subscriptionRefundTerms: 'Send subscription refund requests within 14 days of payment for duplicate charges, incorrect charges, or paid access not provided. Include the payment reference, date, amount, account or branch identifier, reason, and relevant evidence. Do not send passwords, OTPs, or full card details. Touch support reviews requests and responds by email within 5 business days. Requests do not guarantee approval. The response deadline does not guarantee when refunded funds arrive.',
  platformServiceTerms: 'Maintenance and outages may occur; uninterrupted availability is not promised. Report issues to touch.support1@gmail.com during the stated support hours. Accounts may be restricted for misuse or security threats. Material policy changes will be communicated before taking effect, except urgent security or legal changes. Notification and restriction procedures remain to be verified. There is no general support response-time guarantee; the subscription-refund response commitment is separate.',
  merchantOrderRefundResponsibility: 'Customers contact the merchant that sold the products for wrong, missing, or cancelled orders. The merchant decides cancellations and refunds under its policy and applicable obligations. Touch support handles technical platform and payment-integration issues. Confirmed QR Ph refunds are requested from the merchant and processed through the provider, without guaranteed approval or timing. Live QR Ph payments and refunds are not yet enabled or provider-verified in this implementation.',
  dataRetentionSummary: 'Proposed policy, not current automated behavior: after 12 consecutive months without an owner/manager sign-in or recorded business operation, Touch warns the owner by email and an in-app notice before full deletion. Records remain available for one additional month, during which owners are encouraged to download their data or resume activity. Deletion would occur after that warning period if inactivity continues. A complete export, activity tracking, warning, and deletion workflow still require implementation. Backup handling, required retention exceptions, and account-closure handling remain undecided. Premium curated AI insights have a separate retention limit of up to 90 days.',
  releaseBlockers: Object.freeze([
    'Complete physical address and provider acceptance are unresolved',
    'Cancellation processing deadline and operator cancellation workflow are unverified',
    'Activity tracking, email/in-app warnings, complete export and deletion are unimplemented',
    'Backup retention, required record exceptions and account-closure handling are unresolved',
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
