import { cp, mkdir, writeFile } from 'node:fs/promises';

await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });

await writeFile(
  'dist/server/index.js',
  `import { createStaticHandler } from './static-site-handler.js';

export default createStaticHandler();
`,
);

await cp('scripts/static-site-handler.mjs', 'dist/server/static-site-handler.js');
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
