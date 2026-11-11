/**
 * Hygiene of the owner's e-mail (FC 044 T2.3): the address of the owner account is given to
 * scripts/provisionOwner.ts through `OWNER_EMAIL` at run time and is never written in the
 * repository. Two rules keep it so, applied by scripts/checkPlatformGuards.ts:
 *   1. Only the provisioning service, its script and this rule name `OWNER_EMAIL` in TypeScript,
 *      so no other module can read, default or log it.
 *   2. No committed file gives `OWNER_EMAIL` an address, except the reserved `.test` domain the
 *      tests use.
 *
 * @module
 */

/** TypeScript files allowed to name `OWNER_EMAIL` (their `.test.ts` included). */
const OWNER_EMAIL_FILES = [
  'apps/api/src/services/ownerProvision',
  'scripts/provisionOwner',
  'scripts/lib/ownerHygiene',
  'scripts/checkPlatformGuards',
];

/** `OWNER_EMAIL`, then `=` or `:`, then an address, quoted or not. */
const ASSIGNED_ADDRESS =
  /OWNER_EMAIL\s*[:=]\s*['"`]?([^\s'"`,}@]+@[^\s'"`,}]+)/g;

/**
 * Finds every place where the owner's e-mail could be read or fixed outside its run-time
 * variable.
 *
 * @param files - Committed files by repository path (forward slashes).
 * @returns One message per breach; empty when the address can only come from the environment.
 */
export function ownerEmailViolations(
  files: ReadonlyMap<string, string>
): string[] {
  const violations: string[] = [];
  for (const [path, source] of files) {
    if (!source.includes('OWNER_EMAIL')) continue;
    const module = path.replace(/(?:\.test)?\.tsx?$/, '');
    if (module !== path && !OWNER_EMAIL_FILES.includes(module))
      violations.push(
        `${path} names OWNER_EMAIL (only the owner provisioning service and script may)`
      );
    for (const [, address] of source.matchAll(ASSIGNED_ADDRESS)) {
      if (!/\.test$/i.test(address))
        violations.push(
          `${path} gives OWNER_EMAIL an address (it comes from the environment at run time)`
        );
    }
  }
  return violations;
}
