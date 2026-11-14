import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.wasm', '.svg']);

interface Asset { type: string; cache: string; raw: Buffer; br?: Buffer; gz?: Buffer }

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name));
}

/**
 * Serves the built client from memory, compressed once at startup. Vite's hashed files under
 * /assets are cached for a year; index.html is revalidated so a deploy reaches open laptops on
 * their next reload. Returns null when there is no build, as under `npm run dev`.
 */
export function clientMiddleware(dir: string) {
  if (!existsSync(path.join(dir, 'index.html'))) return null;
  const assets = new Map<string, Asset>();
  for (const file of files(dir)) {
    const ext = path.extname(file);
    const raw = readFileSync(file);
    const url = '/' + path.relative(dir, file).split(path.sep).join('/');
    const asset: Asset = {
      type: TYPES[ext] ?? 'application/octet-stream',
      cache: url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      raw,
    };
    if (COMPRESSIBLE.has(ext) && raw.length > 1024) {
      asset.br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
      asset.gz = gzipSync(raw, { level: 9 });
    }
    assets.set(url, asset);
  }

  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;
    const asset = assets.get(pathname === '/' ? '/index.html' : pathname);
    if (!asset) return next();
    const accept = String(req.headers['accept-encoding'] ?? '');
    const [body, encoding] = asset.br && /\bbr\b/.test(accept) ? [asset.br, 'br']
      : asset.gz && /\bgzip\b/.test(accept) ? [asset.gz, 'gzip']
      : [asset.raw, null];
    res.setHeader('Content-Type', asset.type);
    res.setHeader('Cache-Control', asset.cache);
    res.setHeader('Content-Length', body.length);
    if (asset.br) res.setHeader('Vary', 'Accept-Encoding');
    if (encoding) res.setHeader('Content-Encoding', encoding);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
