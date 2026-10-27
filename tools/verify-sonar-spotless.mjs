/**
 * SonarSpotless guard (FC 001). The Free plan cannot assign the custom "Yekora FC Perfect"
 * gate, so CI enforces the same bar here, after the scan, against the project measures.
 * Fails (exit 1) when the token is missing, the analysis of this commit never shows up,
 * the gate status is NONE, or any measure is off the bar below.
 * Requires SONAR_TOKEN. Uses GITHUB_SHA, when present, to wait for this commit's analysis.
 *
 * FC 016 Enmienda 1 (pull requests): SonarCloud files a PR's analysis under the PR, measures only
 * its New Code, and records the PR's head commit, not GitHub's merge commit. On a
 * `pull_request` event the guard therefore waits for the PR's head commit, asks the gate and the
 * measures with `pullRequest`, reads New Code values from `periods[0].value`, and applies the
 * same bar to New Code. A push to main keeps the whole-project bar exactly as before.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.SONAR_TOKEN || '';
const host = (process.env.SONAR_HOST_URL || 'https://sonarcloud.io').replace(
  /\/$/,
  ''
);
const sha = process.env.GITHUB_SHA || '';
const POLL_ATTEMPTS = 30;
const POLL_DELAY_MS = 10_000;

// metric → predicate the value must satisfy. Ratings: 1 is A.
const BAR = {
  reliability_rating: (v) => v === 1,
  security_rating: (v) => v === 1,
  sqale_rating: (v) => v === 1,
  security_review_rating: (v) => v === 1,
  bugs: (v) => v === 0,
  vulnerabilities: (v) => v === 0,
  code_smells: (v) => v === 0,
  security_hotspots_reviewed: (v) => v === 100,
  duplicated_lines_density: (v) => v === 0,
  coverage: (v) => v === 100,
};

// Pull requests: the same bar on New Code. These must always be present.
const PR_BAR = {
  new_reliability_rating: (v) => v === 1,
  new_security_rating: (v) => v === 1,
  new_maintainability_rating: (v) => v === 1,
  new_security_review_rating: (v) => v === 1,
  new_bugs: (v) => v === 0,
  new_vulnerabilities: (v) => v === 0,
  new_code_smells: (v) => v === 0,
  new_security_hotspots_reviewed: (v) => v === 100,
};

// SonarCloud omits these when the PR has no new lines to measure (a lockfile-only update): an
// absence passes only when the metric that counts those lines is 0 or absent too.
const PR_CONDITIONAL = [
  {
    metric: 'new_coverage',
    ok: (v) => v === 100,
    waivedBy: 'new_lines_to_cover',
  },
  {
    metric: 'new_duplicated_lines_density',
    ok: (v) => v === 0,
    waivedBy: 'new_lines',
  },
];

function fail(message) {
  console.error(`[FAIL] SonarSpotless: ${message}`);
  process.exit(1);
}

function property(name) {
  const line = fs
    .readFileSync(path.join(root, 'sonar-project.properties'), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : '';
}

async function get(apiPath, params) {
  const url = new URL(host + apiPath);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) fail(`${apiPath} answered HTTP ${res.status}`);
  return res.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The PR this run checks (number and head commit), or null on any other event. */
function pullRequestOfEvent() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return null;
  let payload = {};
  if (process.env.GITHUB_EVENT_PATH) {
    payload = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')
    );
  }
  const fromRef = /^refs\/pull\/(\d+)\/merge$/.exec(
    process.env.GITHUB_REF || ''
  )?.[1];
  const number = String(payload.pull_request?.number ?? fromRef ?? '');
  const headSha = payload.pull_request?.head?.sha ?? '';
  if (!/^\d+$/.test(number) || !headSha) {
    fail('pull_request event without its number or head commit');
  }
  return { number, headSha };
}

/** Whether SonarCloud already has the analysis this run must check. */
async function analysisIsReady(pr) {
  if (pr) {
    // project_analyses/search ignores pullRequest on SonarCloud (it answers the main branch), so
    // the PR's own entry tells which commit was analysed.
    const { pullRequests = [] } = await get('/api/project_pull_requests/list', {
      project: projectKey,
    });
    const entry = pullRequests.find((p) => p.key === pr.number);
    return Boolean(entry?.analysisDate) && entry.commit?.sha === pr.headSha;
  }
  const { analyses = [] } = await get('/api/project_analyses/search', {
    project: projectKey,
    ps: '1',
  });
  const latest = analyses[0];
  return Boolean(latest) && (!sha || latest.revision === sha);
}

/** Checks one metric; logs it and returns whether it is off the bar. */
function offTheBar(metric, value, ok, note = '') {
  const status = value !== undefined && ok(value) ? 'OK  ' : 'FAIL';
  console.log(
    `[SonarSpotless] ${status} ${metric} = ${value ?? 'missing'}${note}`
  );
  return status === 'FAIL';
}

if (!token) fail('SONAR_TOKEN is not set');
const projectKey = property('sonar.projectKey');
const organization = property('sonar.organization');
if (!projectKey || !organization)
  fail('sonar.projectKey or sonar.organization missing');
const pr = pullRequestOfEvent();
const target = pr ? `PR #${pr.number} at ${pr.headSha}` : sha || 'the project';

// Wait until the analysis of this commit (or of this PR's head) shows up.
let analysisFound = false;
for (
  let attempt = 1;
  attempt <= POLL_ATTEMPTS && !analysisFound;
  attempt += 1
) {
  analysisFound = await analysisIsReady(pr);
  if (!analysisFound) {
    console.log(
      `[SonarSpotless] waiting for the analysis of ${target} (${attempt}/${POLL_ATTEMPTS})`
    );
    await sleep(POLL_DELAY_MS);
  }
}
if (!analysisFound) fail(`no analysis found for ${target}`);

const scope = pr ? { pullRequest: pr.number } : {};
const { projectStatus } = await get('/api/qualitygates/project_status', {
  projectKey,
  organization,
  ...scope,
});
if (!projectStatus || projectStatus.status === 'NONE')
  fail('quality gate status is NONE');

const metricKeys = pr
  ? [
      ...Object.keys(PR_BAR),
      ...PR_CONDITIONAL.flatMap((c) => [c.metric, c.waivedBy]),
    ]
  : Object.keys(BAR);
const { component } = await get('/api/measures/component', {
  component: projectKey,
  metricKeys: metricKeys.join(','),
  ...scope,
});
// New Code values live in periods[0].value; whole-project values in value.
const values = new Map(
  (component?.measures ?? []).map((m) => [
    m.metric,
    Number(m.periods?.[0]?.value ?? m.value),
  ])
);

const offBar = [];
for (const [metric, ok] of Object.entries(pr ? PR_BAR : BAR)) {
  if (offTheBar(metric, values.get(metric), ok)) offBar.push(metric);
}
if (pr) {
  for (const { metric, ok, waivedBy } of PR_CONDITIONAL) {
    const value = values.get(metric);
    const lines = values.get(waivedBy);
    if (value === undefined && (lines === undefined || lines === 0)) {
      console.log(
        `[SonarSpotless] OK   ${metric} = missing (no new lines: ${waivedBy} = ${lines ?? 'missing'})`
      );
    } else if (offTheBar(metric, value, ok)) {
      offBar.push(metric);
    }
  }
}
if (offBar.length > 0) fail(`off the bar: ${offBar.join(', ')}`);
const checked = pr ? `${projectKey} PR #${pr.number}` : projectKey;
console.log(
  `[OK] SonarSpotless: ${checked} is spotless (gate ${projectStatus.status}).`
);
