import { readFile } from 'node:fs/promises';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function contentTypeFor(pathname) {
  const extension = pathname.slice(pathname.lastIndexOf('.'));
  return contentTypes[extension] ?? 'application/octet-stream';
}

export function createStaticHandler(assetDirectory) {
  return async function handler(request) {
    const requestUrl = new URL(request.url);
    const relativePath = requestUrl.pathname === '/'
      ? 'index.html'
      : requestUrl.pathname.replace(/^\/+/, '');
    const assetUrl = new URL(relativePath, assetDirectory);

    if (!assetUrl.href.startsWith(assetDirectory.href)) {
      return new Response(null, { status: 404 });
    }

    try {
      const content = await readFile(assetUrl);
      return new Response(request.method === 'HEAD' ? null : content, {
        headers: { 'content-type': contentTypeFor(assetUrl.pathname) },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
}
