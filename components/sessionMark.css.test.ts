import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('app/globals.css', 'utf8');

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return start < 0
    ? ''
    : css.slice(css.indexOf('{', start), css.indexOf('}', start));
}

// FC 053 T1.1: what the stylesheet does with the mark `<html data-session>`.
describe('the stylesheet reads the session mark', () => {
  it('keeps the skeleton out of sight until the document is marked, and then shows it', () => {
    expect(rule('[data-session-skeleton]')).toContain('display: none');
    expect(rule('html[data-session] [data-session-skeleton]')).toContain(
      'display: flex'
    );
  });

  it('hides the prerendered sign-in form of whoever holds a session hint', () => {
    expect(rule('html[data-session] [data-visitor-prerender]')).toContain(
      'display: none'
    );
  });

  it('keeps the space of the visitor words of the header and hides them (no layout shift)', () => {
    const body = rule('html[data-session] [data-visitor]');
    expect(body).toContain('visibility: hidden');
    expect(body).not.toContain('display');
  });
});
