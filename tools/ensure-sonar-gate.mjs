/**
 * Create or update the SonarQube Cloud project and the "Yekora FC Perfect" gate.
 * Requires SONAR_TOKEN in the environment. Does not print the token.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gate = JSON.parse(fs.readFileSync(path.join(root, 'sonar-quality-gate.json'), 'utf8'));
const token = process.env.SONAR_TOKEN || '';
const host = (process.env.SONAR_HOST_URL || gate.host || 'https://sonarcloud.io').replace(/\/$/, '');

if (!token) {
  console.error('SONAR_TOKEN is not set. The quality gate file is ready; the cloud project is not created.');
  process.exit(1);
}

const orgLine = fs
  .readFileSync(path.join(root, 'sonar-project.properties'), 'utf8')
  .split(/\r?\n/)
  .find((line) => line.startsWith('sonar.organization='));
const organization = orgLine ? orgLine.slice('sonar.organization='.length).trim() : '';

if (!organization) {
  console.error('sonar.organization is not set in sonar-project.properties.');
  process.exit(1);
}

// SonarQube Cloud rejects quality gate calls without the organization, so every call carries it.
async function api(method, apiPath, params) {
  const url = new URL(host + apiPath);
  url.searchParams.set('organization', organization);
  const body = new URLSearchParams({ organization, ...params });
  const res = await fetch(method === 'GET' ? url : host + apiPath, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
    },
    ...(method === 'GET' ? {} : { body }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text: text.slice(0, 400) };
}

function conditionKey(c) {
  return `${c.metric}|${c.op}|${c.error}`;
}

const existing = await api('GET', `/api/qualitygates/show?name=${encodeURIComponent(gate.name)}`);
if (existing.status === 404) {
  const created = await api('POST', '/api/qualitygates/create', { name: gate.name });
  if (created.status >= 300) {
    console.error(`qualitygates/create failed: HTTP ${created.status}`);
    process.exit(1);
  }
  console.log(`created quality gate ${gate.name}`);
} else if (existing.status >= 300) {
  console.error(`qualitygates/show failed: HTTP ${existing.status}`);
  process.exit(1);
} else {
  console.log(`quality gate ${gate.name} already exists`);
}

const shown = await api('GET', `/api/qualitygates/show?name=${encodeURIComponent(gate.name)}`);
if (shown.status >= 300 || !shown.json) {
  console.error(`qualitygates/show failed: HTTP ${shown.status}`);
  process.exit(1);
}
// SonarQube Cloud addresses a gate by its numeric id, not by its name.
const gateId = String(shown.json.id);
const have = new Set(
  (shown.json.conditions || []).map((c) => conditionKey({ metric: c.metric, op: c.op, error: String(c.error) }))
);
for (const c of gate.conditions) {
  if (have.has(conditionKey(c))) continue;
  const added = await api('POST', '/api/qualitygates/create_condition', {
    gateId,
    metric: c.metric,
    op: c.op,
    error: c.error,
  });
  if (added.status >= 300) {
    console.error(`condition ${c.metric} ${c.op} ${c.error} failed: HTTP ${added.status} ${added.text}`);
    process.exit(1);
  }
  console.log(`condition ${c.metric} ${c.op} ${c.error}`);
}

const project = await api('POST', '/api/projects/create', {
  organization,
  name: 'Yekora',
  project: gate.projectKey,
  visibility: 'public',
});
if (project.status === 200 || project.status === 201) {
  console.log(`created project ${gate.projectKey}`);
} else if (/already exists|key already exists/i.test(project.text)) {
  console.log(`project ${gate.projectKey} already exists`);
} else {
  console.error(`projects/create failed: HTTP ${project.status} ${project.text}`);
  process.exit(1);
}

// The free plan only analyzes public projects; an existing project may have been created private.
const visibility = await api('POST', '/api/projects/update_visibility', {
  project: gate.projectKey,
  visibility: 'public',
});
if (visibility.status >= 300) {
  console.error(`projects/update_visibility failed: HTTP ${visibility.status} ${visibility.text}`);
  process.exit(1);
}
console.log(`project ${gate.projectKey} is public`);

const selected = await api('POST', '/api/qualitygates/select', {
  gateId,
  projectKey: gate.projectKey,
});
if (selected.status === 403) {
  console.log(`[NOTE] Free plan does not allow custom quality gate assignment (HTTP 403). Project ${gate.projectKey} uses default ("Sonar way"). Spotless metrics enforced via CI.`);
} else if (selected.status >= 300) {
  console.error(`qualitygates/select failed: HTTP ${selected.status} ${selected.text}`);
  process.exit(1);
} else {
  console.log(`gate ${gate.name} selected for ${gate.projectKey}`);
}
