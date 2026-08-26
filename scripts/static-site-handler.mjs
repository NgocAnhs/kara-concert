export function createStaticHandler() {
  return {
    async fetch(request, env) {
      const response = await env.ASSETS.fetch(request);
      const url = new URL(request.url);
      const isPageNavigation = (request.method === 'GET' || request.method === 'HEAD')
        && request.headers.get('Accept')?.includes('text/html')
        && !url.pathname.startsWith('/assets/')
        && !/\.[^/]+$/.test(url.pathname);

      if (response.status !== 404 || !isPageNavigation) return response;

      url.pathname = '/index.html';
      url.search = '';
      return env.ASSETS.fetch(new Request(url, request));
    },
  };
}
