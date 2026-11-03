/**
 * Daily expiry watch of SECURITY_AUTOFIX_TOKEN (FC 038; rules in scripts/lib/tokenExpiration.ts).
 *   - Calls GET /repos/{repo} with the watched token (TOKEN_TO_CHECK) and reads its status and
 *     `github-authentication-token-expiration`. The token is sent only to api.github.com.
 *   - With the repository token (GITHUB_TOKEN, issues: write) it creates the alert issue,
 *     comments on the open one, or closes it once the rotated token is healthy.
 * Env: TOKEN_TO_CHECK, GITHUB_TOKEN, REPO (owner/name). It prints days and dates, never a token.
 * CLI: `bun scripts/checkTokenExpiration.ts` — exit 0 = handled · exit 1 = GitHub could not be told.
 */
import {
  ALERT_TITLE,
  alertAction,
  alertText,
  judgeToken,
} from './lib/tokenExpiration';

const API = 'https://api.github.com';
const repo = process.env.REPO ?? '';
const watched = process.env.TOKEN_TO_CHECK ?? '';
const issuesToken = process.env.GITHUB_TOKEN ?? '';

/** One bounded call to the GitHub REST API. */
function github(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

/** Sends a write and stops the run if GitHub refuses it. */
async function write(path: string, method: string, body: object) {
  const response = await github(issuesToken, path, {
    method,
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${method} ${path}: HTTP ${response.status}`);
  return response;
}

let answer = { status: 0, expiration: null as string | null };
if (watched !== '') {
  const response = await github(watched, `/repos/${repo}`);
  answer = {
    status: response.status,
    expiration: response.headers.get('github-authentication-token-expiration'),
  };
}
const status = judgeToken(answer, new Date());

const open = (await (
  await github(
    issuesToken,
    `/repos/${repo}/issues?state=open&labels=security&per_page=100`
  )
).json()) as { number: number; title: string; pull_request?: unknown }[];
const issue =
  open.find((item) => item.title === ALERT_TITLE && !item.pull_request)
    ?.number ?? null;
const action = alertAction(status, issue);
const text = alertText(status);

if (action === 'create') {
  await write(`/repos/${repo}/issues`, 'POST', {
    title: ALERT_TITLE,
    body: text,
    labels: ['security', 'urgent'],
  });
} else if (action === 'comment') {
  await write(`/repos/${repo}/issues/${issue}/comments`, 'POST', {
    body: text,
  });
} else if (action === 'close') {
  await write(`/repos/${repo}/issues/${issue}/comments`, 'POST', {
    body: text,
  });
  await write(`/repos/${repo}/issues/${issue}`, 'PATCH', { state: 'closed' });
}

const summary =
  status.state === 'broken'
    ? `broken (${status.reason})`
    : `${status.state}, expires ${status.expiresAt.toISOString().slice(0, 10)}, ${status.daysLeft} days left`;
console.log(
  `[TokenExpiry] SECURITY_AUTOFIX_TOKEN: ${summary} · issue: ${action}`
);
