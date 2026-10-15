/**
 * SonarSpotless guard (FC 001). The Free plan cannot assign the custom "Yekora FC Perfect"
 * gate, so CI enforces the same bar here, after the scan, against the project measures.
 * Fails (exit 1) when the token is missing, the analysis of this commit never shows up,
 * the gate status is NONE, or any measure is off the bar below.
 * Requires SONAR_TOKEN. Uses GITHUB_SHA, when present, to wait for this commit's analysis.
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

if (!token) fail('SONAR_TOKEN is not set');
const projectKey = property('sonar.projectKey');
const organization = property('sonar.organization');
if (!projectKey || !organization)
  fail('sonar.projectKey or sonar.organization missing');

// Wait until the newest analysis is the one for this commit (or any analysis outside CI).
let analysisFound = false;
for (
  let attempt = 1;
  attempt <= POLL_ATTEMPTS && !analysisFound;
  attempt += 1
) {
  const { analyses = [] } = await get('/api/project_analyses/search', {
    project: projectKey,
    ps: '1',
  });
  const latest = analyses[0];
  analysisFound = Boolean(latest) && (!sha || latest.revision === sha);
  if (!analysisFound) {
    console.log(
      `[SonarSpotless] waiting for the analysis of ${sha || 'the project'} (${attempt}/${POLL_ATTEMPTS})`
    );
    await sleep(POLL_DELAY_MS);
  }
}
if (!analysisFound) fail(`no analysis found for ${sha || projectKey}`);

const { projectStatus } = await get('/api/qualitygates/project_status', {
  projectKey,
  organization,
});
if (!projectStatus || projectStatus.status === 'NONE')
  fail('quality gate status is NONE');

const { component } = await get('/api/measures/component', {
  component: projectKey,
  metricKeys: Object.keys(BAR).join(','),
});
const values = new Map(
  (component?.measures ?? []).map((m) => [m.metric, Number(m.value)])
);

const offBar = [];
for (const [metric, ok] of Object.entries(BAR)) {
  const value = values.get(metric);
  const status = value !== undefined && ok(value) ? 'OK  ' : 'FAIL';
  console.log(`[SonarSpotless] ${status} ${metric} = ${value ?? 'missing'}`);
  if (status === 'FAIL') offBar.push(metric);
}
if (offBar.length > 0) fail(`off the bar: ${offBar.join(', ')}`);
console.log(
  `[OK] SonarSpotless: ${projectKey} is spotless (gate ${projectStatus.status}).`
);
