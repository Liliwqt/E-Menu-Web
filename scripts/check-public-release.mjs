import { readFileSync } from 'node:fs';
import { PUBLICATION, PUBLIC_PAGES, publicationIssues } from '../src/lib/publicSiteContent.js';

const issues = publicationIssues(PUBLICATION);
const structuralIssues = [];
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
for (const [path] of PUBLIC_PAGES) {
  if (!app.includes(`<Route path="/${path}"`)) structuralIssues.push(`Public /${path} route is missing`);
}
const page = readFileSync(new URL('../src/pages/PublicPage.jsx', import.meta.url), 'utf8');
if (!page.includes("PUBLICATION.status !== 'approved'")) structuralIssues.push('Draft notice is not gated by publication status');

// Explicit operator-authorized live testing is separate from policy publication.
// It must keep draft notices, never silently approve unfinished policies, and
// still rejects missing routes or a missing draft notice.
const liveTest = process.env.TOUCH_LIVE_TEST_DEPLOY === '1' && PUBLICATION.status === 'draft';
if (liveTest && !structuralIssues.length) {
  process.stdout.write(`Live-test deployment allowed; public policies remain DRAFT.\nOutstanding production approval requirements:\n${issues.map(issue => `- ${issue}`).join('\n')}\n`);
} else if (issues.length || structuralIssues.length) {
  process.stderr.write(`Public-site release blocked:\n${[...issues, ...structuralIssues].map(issue => `- ${issue}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Public pages approved on ${PUBLICATION.reviewedAt}; release check passed.\n`);
}
