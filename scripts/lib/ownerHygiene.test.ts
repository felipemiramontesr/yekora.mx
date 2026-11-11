import { describe, expect, it } from 'vitest';
import { ownerEmailViolations } from './ownerHygiene';

/** Built in pieces so this file itself gives the variable no address. */
const assign = (address: string) => `OWNER_${'EMAIL'}=${address}`;

describe('ownerEmailViolations (FC 044 T2.3)', () => {
  it('accepts the provisioning service, its script, their tests and files that never name the variable', () => {
    const files = new Map([
      [
        'apps/api/src/services/ownerProvision.ts',
        'z.object({ OWNER_EMAIL: z.email() })',
      ],
      [
        'apps/api/src/services/ownerProvision.test.ts',
        "readOwnerRequest({ OWNER_EMAIL: 'Owner@Example.TEST' }, [])",
      ],
      ['scripts/provisionOwner.ts', '// plus OWNER_EMAIL at run time'],
      [
        'apps/api/src/routes/auth.ts',
        'const email = canonicalEmail(body.email);',
      ],
      [
        '.github/workflows/owner.yml',
        'OWNER_EMAIL: ${{ secrets.OWNER_EMAIL }}',
      ],
    ]);
    expect(ownerEmailViolations(files)).toEqual([]);
  });

  it('flags any other TypeScript module that names the variable', () => {
    const files = new Map([
      ['apps/api/src/config.ts', 'OWNER_EMAIL: z.string().optional(),'],
      ['components/account/Owner.tsx', 'process.env.OWNER_EMAIL'],
    ]);
    expect(ownerEmailViolations(files)).toEqual([
      'apps/api/src/config.ts names OWNER_EMAIL (only the owner provisioning service and script may)',
      'components/account/Owner.tsx names OWNER_EMAIL (only the owner provisioning service and script may)',
    ]);
  });

  it('flags an address given to the variable in any committed file, quoted or not', () => {
    const files = new Map([
      ['.env.example', assign('someone@yekora.example')],
      [
        'scripts/provisionOwner.ts',
        `const fallback = { OWNER_${'EMAIL'}: 'someone@yekora.example' };`,
      ],
      ['migrations/009_note.sql', `-- ${assign('"a@b.example"')}`],
    ]);
    expect(ownerEmailViolations(files)).toEqual([
      '.env.example gives OWNER_EMAIL an address (it comes from the environment at run time)',
      'scripts/provisionOwner.ts gives OWNER_EMAIL an address (it comes from the environment at run time)',
      'migrations/009_note.sql gives OWNER_EMAIL an address (it comes from the environment at run time)',
    ]);
  });
});
