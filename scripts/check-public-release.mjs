import { readFileSync } from 'node:fs';
import { PUBLICATION, PUBLIC_PAGES, publicationIssues } from '../src/lib/publicSiteContent.js';

const issues = publicationIssues(PUBLICATION);
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
for (const [path] of PUBLIC_PAGES) {
  if (!app.includes(`<Route path="/${path}"`)) issues.push(`Public /${path} route is missing`);
}
const page = readFileSync(new URL('../src/pages/PublicPage.jsx', import.meta.url), 'utf8');
if (!page.includes("PUBLICATION.status !== 'approved'")) issues.push('Draft notice is not gated by publication status');

if (issues.length) {
  process.stderr.write(`Public-site release blocked:\n${issues.map(issue => `- ${issue}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Public pages approved on ${PUBLICATION.reviewedAt}; release check passed.\n`);
}
