/**
 * Warms up a page the person is likely to open next (FC 053 T1.2): the browser fetches it, and
 * where it can, renders it in the background, so the click lands on a page that is already there.
 * Used by the language switch, which is a full document load between the two root layouts.
 *
 * @module
 */

/**
 * Asks the browser to fetch `href` ahead of time (`<link rel="prefetch">`) and, when it supports
 * speculation rules, to prerender it. It never throws and does nothing the second time for the
 * same page. It sends no data of the person: it is a plain `GET` of a public, static page.
 *
 * @param href - Same-origin path of the page, e.g. `/en/account/`.
 */
export function prefetchPage(href: string): void {
  try {
    const doc = globalThis.document;
    // The head is the record of what was asked for: each page is asked for once per document.
    const asked = [...doc.head.querySelectorAll('link[rel="prefetch"]')];
    if (asked.some((link) => link.getAttribute('href') === href)) return;
    const link = doc.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    link.as = 'document';
    doc.head.append(link);
    if (globalThis.HTMLScriptElement?.supports?.('speculationrules')) {
      const rules = doc.createElement('script');
      rules.type = 'speculationrules';
      rules.textContent = JSON.stringify({
        prerender: [{ source: 'list', urls: [href] }],
      });
      doc.head.append(rules);
    }
  } catch {
    // No document, or the browser refused: the click still works, only a little later.
  }
}
