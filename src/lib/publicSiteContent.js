/** Publication inputs. Keep status as draft until the operator reviews every policy. */
export const PUBLICATION = Object.freeze({
  status: 'draft',
  reviewedAt: '',
  draftReviewedAt: '2026-10-01',
  reviewerName: 'The operator',
  businessName: 'Touch is an unregistered brand operated by the individuals identified on the Contact page',
  operatorContacts: Object.freeze(['Patrick Fitzroy Hofer', 'Jhonryl Pamaybay']),
  philippinesAddress: 'Apas, Cebu City, Cebu, Philippines',
  supportEmail: 'touch.support1@gmail.com',
  privacyEmail: 'touch.support1@gmail.com',
  supportHours: 'Monday–Friday, 8:00 AM–9:00 PM Philippine time (Asia/Manila)',
  subscriptionCancellationTerms: 'A branch owner may cancel that branch’s subscription in the Subscription page under Records and access. The owner must confirm the action after recent authentication. Once confirmed, cancellation immediately ends subscription benefits and prevents new operational writes. Existing records remain readable subject to the applicable retention process. Cancellation does not itself issue a refund.',
  subscriptionRefundTerms: 'Request a subscription refund by email within 14 days after payment if you were charged twice, charged an incorrect amount, or did not receive paid access. Provide the payment reference, payment date and amount, account or branch identifier, reason, and relevant evidence. Do not send a password, one-time code, or complete card number. Touch support will respond by email within five business days. A request does not guarantee approval, and the response period does not determine when an approved refund will reach the original payment method.',
  platformServiceTerms: 'The service may be interrupted for maintenance, faults, or events outside the operators’ control. Report a service issue through the support address on the Contact page. Misuse or a credible security threat may lead to an access restriction proportionate to the issue, subject to review. Material policy changes are intended to be communicated before they take effect, except where an urgent security or legal change requires otherwise. The notice and restriction procedures still require operator verification. No general support response-time guarantee is offered; the subscription-refund response period is separate.',
  merchantOrderRefundResponsibility: 'For an incorrect, missing, or cancelled customer order, contact the merchant that sold the products. The merchant determines the appropriate remedy under its policy and applicable obligations. Touch support handles platform and payment-record problems; it does not approve a merchant’s product refund. Verified QR Ph refunds, when that service becomes available, require the merchant’s request and provider processing. Live QR Ph payments and refunds are not yet enabled or provider-verified.',
  customerPaymentNotice: 'Pay at Counter and legacy customer-reported QR statuses record a reported payment method or claim, not proof that funds were received. A verified QR Ph order would be recorded as paid only after the payment provider confirms it; QR Ph checkout is not yet enabled in the current release.',
  dataRetentionSummary: 'The planned inactivity process is branch-scoped: after 12 calendar months without a qualifying owner or manager visit or successful operational activity, the owner would receive an in-app warning and an email. The additional calendar-month grace period would begin only after the email service accepts that warning. Qualifying activity during that period would cancel the scheduled deletion. Automatic inactivity deletion is not yet active; email delivery, private storage, backup restoration, and operator review remain outstanding. Owner-requested business closure is a separate in-app action: it stops writes immediately and permits recovery for 30 days without extending a subscription. Owner ZIP exports require private storage to be configured and may presently return a service-unavailable error. If configured, private exports expire after 24 hours and managed encrypted backups after 30 days. Premium branch insights have a separate 90-day maximum retention period. Unresolved payment or refund matters may require limited records to be held for operator review; applicable retention exceptions remain under review.',
  privacyReviewItems: Object.freeze([
    'Identify and document which party acts as controller or processor for merchant customer records.',
    'Confirm the lawful basis for each processing purpose and any required notices or permissions.',
    'Confirm provider recipients, processing locations, cross-border transfers, and contractual safeguards.',
    'Confirm retention periods for account, support, and security records in addition to branch data.',
    'Document any applicable legal or payment-provider retention exception before live payments are enabled.',
  ]),
  releaseBlockers: Object.freeze([
    'PayMongo acceptance of operator identity and address is unverified',
    'Final operator review of the deployed lifecycle controls is pending',
    'Gmail delivery, private storage and scheduled lifecycle processing require configuration and verification',
    'A real encrypted backup/restore rehearsal and documented payment retention requirements are pending',
    'Policy-change notification and account-restriction procedures are unverified',
    'Privacy roles, lawful bases, provider transfers and retention exceptions require final review',
    'Final public-page approval is pending',
  ]),
});

export const PUBLIC_PAGES = Object.freeze([
  ['about', 'About'],
  ['pricing', 'Pricing'],
  ['contact', 'Contact'],
  ['help', 'Help'],
  ['terms', 'Terms and Conditions'],
  ['privacy', 'Privacy Policy'],
  ['cookies', 'Cookies and browser storage'],
  ['acceptable-use', 'Acceptable Use Policy'],
  ['refund-policy', 'Cancellation and Refund Policy'],
]);

/** Header destinations. Not every public page belongs here — /refund-policy and
 *  /acceptable-use are reached from the footer and the login page's secondary list. */
export const PUBLIC_NAV = Object.freeze([
  ['about', 'About'],
  ['pricing', 'Pricing'],
  ['help', 'Help'],
  ['contact', 'Contact'],
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
