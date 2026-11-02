import { describe, expect, it } from 'vitest';
import { remoteFontViolations } from './hermeticBuild';

describe('remoteFontViolations (FC 035 T1.2)', () => {
  it('accepts local fonts', () => {
    expect(
      remoteFontViolations(
        new Map([
          [
            'components/views/SiteShell.tsx',
            "import localFont from 'next/font/local';",
          ],
        ])
      )
    ).toEqual([]);
  });

  it('refuses next/font/google and the Google Fonts hosts', () => {
    expect(
      remoteFontViolations(
        new Map([
          [
            'components/views/SiteShell.tsx',
            "import { Inter } from 'next/font/google';",
          ],
          [
            'app/globals.css.ts',
            "@import url('https://fonts.googleapis.com/css2?family=Inter');",
          ],
          ['lib/head.ts', 'const host = "https://fonts.gstatic.com";'],
        ])
      )
    ).toEqual([
      'components/views/SiteShell.tsx imports next/font/google (fonts must be local)',
      'app/globals.css.ts names a Google Fonts host',
      'lib/head.ts names a Google Fonts host',
    ]);
  });

  it('ignores tests, which may mock the old loader', () => {
    expect(
      remoteFontViolations(
        new Map([
          ['app/page.test.tsx', "vi.mock('next/font/google', () => ({}));"],
        ])
      )
    ).toEqual([]);
  });
});
