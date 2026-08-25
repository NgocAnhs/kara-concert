export function createStaticHandler() {
  return {
    fetch(request, env) {
      return env.ASSETS.fetch(request);
    },
  };
}
