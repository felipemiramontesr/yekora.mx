/**
 * Local static server for the E2E suite (FC 003 F2). Serves the static export in out/ the way
 * Hostinger's Apache serves plain files: a folder answers with its index.html and an unknown
 * path answers with 404.html and status 404.
 * The .htaccess rules are not reimplemented here: CI runs the same suite against httpd:2.4.
 * CLI: `bun scripts/serveStatic.ts [port]` (default 3100, bound to localhost only).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const root = join(process.cwd(), 'out');
const port = Number(process.argv[2] ?? 3100);
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

// Absolute path of the file a URL path asks for, or undefined when it is missing or leaves out/.
function resolveFile(pathname: string): string | undefined {
  const path = normalize(decodeURIComponent(pathname));
  const file = join(root, path, path.endsWith(sep) ? 'index.html' : '');
  if (!file.startsWith(root + sep) || !existsSync(file)) return undefined;
  return statSync(file).isFile() ? file : undefined;
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const file = resolveFile(url.pathname);
  const served = file ?? join(root, '404.html');
  response.writeHead(file === undefined ? 404 : 200, {
    'Content-Type':
      CONTENT_TYPES[extname(served)] ?? 'application/octet-stream',
  });
  createReadStream(served).pipe(response);
}).listen(port, 'localhost', () => {
  console.log(`[OK] serving out/ on http://localhost:${port}`);
});
