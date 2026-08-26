# Project instructions

## Deployment preference

- The user uses Vercel for this project. Interpret an unqualified request to "deploy" or "publish" as a Vercel request.
- Do not switch hosting providers without the user's explicit request.
- Prefer the existing Vercel project and domain. Verify the account, project link, and intended environment before deploying; never guess a project ID or create a replacement project just because access is missing.
- Use `npm run deploy:setup` for one-time login/linking to the existing project. Use `npm run deploy` for an authorized production release; it runs tests, pulls production settings, builds locally, then deploys the build output. See README.md.
- Confirm deployment success and check the resulting URL before reporting completion.
- A build alone is not a deployment. Do not commit, push, or publish merely because the user asks a deployment question.

## Build and credentials

- `npm run build` compiles TypeScript and builds the static Vite app into `dist`. `vercel.json` defines the build settings and SPA route fallback.
- Keep Vercel credentials and `.vercel/` out of Git. Only public Supabase browser values belong in `VITE_*` variables; never expose a service-role key.
