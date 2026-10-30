import { describe, expect, it } from 'vitest';
import {
  badge,
  type Category,
  categoryStatus,
  isCertified,
  jobStatus,
  type JunitCase,
  layerModule,
  parseJunitCases,
  renderDashboard,
  testModule,
} from './certification';

const XML = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="5" failures="1" errors="0">
  <testsuite name="apps/api/src/routes/inventory.test.ts" tests="3" failures="1" errors="0">
    <testcase classname="apps/api/src/routes/inventory.test.ts" name="A01 closed route inventory &gt; exposes the routes" time="0.002">
    </testcase>
    <testcase classname="apps/api/src/routes/inventory.test.ts" name="A07 surface absent &gt; no auth route" time="0.001">
      <failure message="expected &quot;/v1/login&quot; not to match">AssertionError</failure>
    </testcase>
    <testcase classname="apps/api/src/routes/inventory.test.ts" name="A07 surface absent &gt; no auth plugin" time="0.001"/>
  </testsuite>
  <testsuite name="lib/cart/cartStore.test.ts" tests="2" failures="0" errors="1">
    <testcase classname="lib/cart/cartStore.test.ts" name="store &gt; keeps lines" time="0.001">
      <skipped/>
    </testcase>
    <testcase classname="lib/cart/cartStore.test.ts" name="store &gt; drops corrupt data" time="0.001">
      <error message="boom"/>
    </testcase>
  </testsuite>
</testsuites>`;

const pass = (file: string, name: string): JunitCase => ({
  file,
  name,
  outcome: 'passed',
});

describe('parseJunitCases', () => {
  it('reads every case with its file, decoded name and outcome', () => {
    expect(parseJunitCases(XML)).toEqual([
      pass(
        'apps/api/src/routes/inventory.test.ts',
        'A01 closed route inventory > exposes the routes'
      ),
      {
        file: 'apps/api/src/routes/inventory.test.ts',
        name: 'A07 surface absent > no auth route',
        outcome: 'failed',
      },
      pass(
        'apps/api/src/routes/inventory.test.ts',
        'A07 surface absent > no auth plugin'
      ),
      {
        file: 'lib/cart/cartStore.test.ts',
        name: 'store > keeps lines',
        outcome: 'skipped',
      },
      {
        file: 'lib/cart/cartStore.test.ts',
        name: 'store > drops corrupt data',
        outcome: 'failed',
      },
    ]);
  });

  it('decodes every XML entity and tolerates missing attributes', () => {
    const [entities, bare] = parseJunitCases(
      '<testcase classname="a&amp;b.test.ts" name="&lt;x&gt; &quot;y&quot; &apos;z&apos;"/><testcase/>'
    );
    expect(entities).toEqual(pass('a&b.test.ts', `<x> "y" 'z'`));
    expect(bare).toEqual(pass('', ''));
  });
});

const INVENTORY = 'apps/api/src/routes/inventory.test.ts';
const greenCases: JunitCase[] = [
  pass(INVENTORY, 'A01 closed route inventory > exposes the routes'),
  pass(INVENTORY, 'A07 surface absent > no auth route'),
  pass('apps/api/src/services/logging.test.ts', 'A09 > logs'),
];

const a01: Category = {
  id: 'A01',
  label: 'Broken Access Control',
  method: 'computed',
  evidence: [
    { type: 'junit', path: INVENTORY, describe: 'A01 closed route inventory' },
  ],
};
const a07: Category = {
  id: 'A07',
  label: 'Identification/Auth Failures',
  method: 'reserved',
  evidence: [
    { type: 'junit', path: INVENTORY, describe: 'A07 surface absent' },
  ],
};

describe('T1.1 · CategoryPassed ⟺ E ∧ F', () => {
  it('E ⊤ F ⊤: wired evidence, all green → PASSED', () => {
    expect(categoryStatus(a01, greenCases, {})).toBe('PASSED');
  });

  it('E ⊤ F ⊥: one red case of the describe block → FAILED', () => {
    const red: JunitCase[] = [
      ...greenCases,
      {
        file: INVENTORY,
        name: 'A01 closed route inventory > 404',
        outcome: 'failed',
      },
    ];
    expect(categoryStatus(a01, red, {})).toBe('FAILED');
  });

  it('E ⊥: the mapped file did not run, or the map lists no evidence → NOT_VERIFIED', () => {
    expect(categoryStatus(a01, [], {})).toBe('NOT_VERIFIED');
    expect(categoryStatus({ ...a01, evidence: [] }, greenCases, {})).toBe(
      'NOT_VERIFIED'
    );
  });

  it('a skipped case proves nothing → NOT_VERIFIED', () => {
    const skipped: JunitCase[] = [
      {
        file: INVENTORY,
        name: 'A01 closed route inventory > routes',
        outcome: 'skipped',
      },
    ];
    expect(categoryStatus(a01, skipped, {})).toBe('NOT_VERIFIED');
  });

  it('a whole file, a script exit code and a job result count as evidence', () => {
    const mixed: Category = {
      id: 'A02',
      label: 'Cryptographic Failures',
      method: 'computed',
      evidence: [
        { type: 'junit', path: 'apps/api/src/services/logging.test.ts' },
        {
          type: 'script',
          path: 'scripts/checkNoRawSql.ts',
          exitEnv: 'A03_EXIT',
        },
        { type: 'job', job: 'security-scan', resultEnv: 'SECURITY_RESULT' },
      ],
    };
    const env = { A03_EXIT: '0', SECURITY_RESULT: 'success' };
    expect(categoryStatus(mixed, greenCases, env)).toBe('PASSED');
    expect(categoryStatus(mixed, greenCases, { ...env, A03_EXIT: '1' })).toBe(
      'FAILED'
    );
    expect(categoryStatus(mixed, greenCases, { ...env, A03_EXIT: '' })).toBe(
      'NOT_VERIFIED'
    );
    expect(categoryStatus(mixed, greenCases, { A03_EXIT: '0' })).toBe(
      'NOT_VERIFIED'
    );
    // A red piece wins over a missing one: the row is FAILED, not merely unverified.
    expect(categoryStatus(mixed, [], { A03_EXIT: '2' })).toBe('FAILED');
  });
});

describe('T1.2 · ReservedValid ⟺ S ∧ C', () => {
  it('S ⊤ C ⊤: the guard passes → RESERVED SLOT', () => {
    expect(categoryStatus(a07, greenCases, {})).toBe('RESERVED');
  });

  it('S ⊥: the surface appeared and the guard fails → FAILED, the slot expires', () => {
    const auth: JunitCase[] = [
      {
        file: INVENTORY,
        name: 'A07 surface absent > no auth route',
        outcome: 'failed',
      },
    ];
    expect(categoryStatus(a07, auth, {})).toBe('FAILED');
  });

  it('the guard did not run → NOT_VERIFIED, never RESERVED', () => {
    expect(categoryStatus(a07, [], {})).toBe('NOT_VERIFIED');
  });
});

describe('jobStatus and badges', () => {
  it('maps job results', () => {
    expect(jobStatus('success')).toBe('PASSED');
    expect(jobStatus('failure')).toBe('FAILED');
    expect(jobStatus('cancelled')).toBe('FAILED');
    expect(jobStatus('skipped')).toBe('NOT_VERIFIED');
    expect(jobStatus(undefined)).toBe('NOT_VERIFIED');
  });

  it('labels every status as the dashboard shows it', () => {
    expect(badge('PASSED')).toBe('✅ PASSED');
    expect(badge('FAILED')).toBe('❌ FAILED');
    expect(badge('RESERVED')).toBe('⏸️ RESERVED SLOT');
    expect(badge('NOT_VERIFIED')).toBe('⚠️ NOT_VERIFIED');
  });
});

describe('testModule', () => {
  const api = (file: string) => file.startsWith('apps/api/');

  it('counts only the cases of its own files', () => {
    expect(testModule('🛡️ Backend', greenCases, api)).toEqual({
      name: '🛡️ Backend',
      status: 'PASSED',
      totals: { passed: 3, total: 3 },
    });
  });

  it('is FAILED with one red case and NOT_VERIFIED without cases', () => {
    const red: JunitCase[] = [
      ...greenCases,
      { file: 'apps/api/x.test.ts', name: 'x', outcome: 'failed' },
    ];
    expect(testModule('🛡️ Backend', red, api)).toMatchObject({
      status: 'FAILED',
      totals: { passed: 3, total: 4 },
    });
    expect(testModule('🛡️ Backend', [], api).status).toBe('NOT_VERIFIED');
  });
});

describe('FC 025 T1.3 · layerModule: the layer job and its own tests, both green', () => {
  const api = (file: string) => file.startsWith('apps/api/');
  const red: JunitCase[] = [
    ...greenCases,
    { file: 'apps/api/x.test.ts', name: 'x', outcome: 'failed' },
  ];

  it.each([
    ['green tests in a green job', greenCases, 'success', 'PASSED'],
    ['green tests in a failed job', greenCases, 'failure', 'FAILED'],
    ['a red test in a green job', red, 'success', 'FAILED'],
    ['green tests in a skipped job', greenCases, 'skipped', 'NOT_VERIFIED'],
    [
      'a green job whose tests never reached the report',
      [],
      'success',
      'NOT_VERIFIED',
    ],
  ] as const)('%s → %s', (_case, cases, result, status) => {
    expect(layerModule('🛡️ Backend', cases, api, result)).toMatchObject({
      name: '🛡️ Backend',
      status,
    });
  });

  it('keeps the counts of its own cases', () => {
    expect(
      layerModule('🛡️ Backend', greenCases, api, 'success').totals
    ).toEqual({
      passed: 3,
      total: 3,
    });
  });
});

describe('T1.4 · Certified ⟺ M ∧ O', () => {
  const modules = [
    {
      name: '🎨 Frontend',
      status: 'PASSED' as const,
      totals: { passed: 2, total: 2 },
    },
    {
      name: '🏛️ Database',
      status: 'RESERVED' as const,
      detail: 'no migration in this run',
    },
    { name: '🔍 Sonar', status: 'PASSED' as const },
  ];
  const categories = [
    { id: 'A01', label: 'Broken Access Control', status: 'PASSED' as const },
    {
      id: 'A07',
      label: 'Identification/Auth Failures',
      status: 'RESERVED' as const,
    },
  ];

  it('M ⊤ O ⊤: PASSED and RESERVED SLOT rows certify', () => {
    expect(isCertified({ modules, categories })).toBe(true);
  });

  it('M ⊥: one module that is not PASSED nor RESERVED blocks the certificate', () => {
    const failing = [...modules, { name: '🧪 E2E', status: 'FAILED' as const }];
    expect(isCertified({ modules: failing, categories })).toBe(false);
  });

  it('O ⊥: one NOT_VERIFIED or FAILED category blocks the certificate', () => {
    for (const status of ['NOT_VERIFIED', 'FAILED'] as const) {
      const open = [...categories, { id: 'A09', label: 'Logging', status }];
      expect(isCertified({ modules, categories: open })).toBe(false);
    }
  });

  it('renders the certified dashboard with totals, integrity and the OWASP table', () => {
    expect(renderDashboard({ modules, categories })).toBe(
      [
        '### 🔱 YEKORA CERTIFICATION DASHBOARD',
        '',
        '| Módulo | Estado | Tests Pasados | Integridad |',
        '| :--- | :---: | :---: | :---: |',
        '| 🎨 Frontend | ✅ PASSED | 2 / 2 | 100% |',
        '| 🏛️ Database | ⏸️ RESERVED SLOT | no migration in this run | — |',
        '| 🔍 Sonar | ✅ PASSED | — | — |',
        '| **TOTAL** | **CERTIFICADO** | **2 / 2** | **100%** |',
        '',
        '### 🛡️ OWASP SECURITY CERTIFICATION (TOP 10)',
        '',
        '| Categoría | Riesgo | Estado |',
        '| :--- | :--- | :---: |',
        '| **A01** | Broken Access Control | ✅ PASSED |',
        '| **A07** | Identification/Auth Failures | ⏸️ RESERVED SLOT |',
      ].join('\n')
    );
  });

  it('renders a failed run as NO CERTIFICADO with 0 % and partial integrity', () => {
    const markdown = renderDashboard({
      modules: [
        {
          name: '🎨 Frontend',
          status: 'FAILED',
          totals: { passed: 1, total: 3 },
        },
        {
          name: '🛡️ Backend',
          status: 'NOT_VERIFIED',
          totals: { passed: 0, total: 0 },
        },
      ],
      categories,
    });
    expect(markdown).toContain('| 🎨 Frontend | ❌ FAILED | 1 / 3 | 33% |');
    expect(markdown).toContain('| 🛡️ Backend | ⚠️ NOT_VERIFIED | 0 / 0 | 0% |');
    expect(markdown).toContain(
      '| **TOTAL** | **NO CERTIFICADO** | **1 / 3** | **0%** |'
    );
  });
});
