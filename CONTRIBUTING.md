# Contributing

Thanks for your interest in improving **SiteCloner**, a studio for cloning websites by URL and building or changing sites with AI.

## Ways to contribute

- **Cloning** — pages that copy badly, missing assets or fonts, sites that need a browser to render
- **AI editing** — prompts, tools, and providers in `src/lib/ai/`
- **The studio** — the start screen and workspace in `src/components/cloner/`
- **Export and publish** — the ZIP, React and Vue exporters, published links
- **Documentation** — the README and `AGENTS.md`

Browse the [open issues](https://github.com/AI1120/website-cloner/issues) for something to pick up. For substantial or potentially breaking changes, open an issue first so the approach can be agreed before significant work begins.

## Development setup

**Prerequisites:** [Node.js](https://nodejs.org/) 24+. Google Chrome or Microsoft Edge lets the cloner render pages that build their content with JavaScript; without one it copies what the server sends.

```bash
git clone https://github.com/AI1120/website-cloner.git
cd website-cloner
npm ci
cp .env.example .env.local   # add an AI key to use the AI features
npm run dev
```

Before opening a PR, make sure the project is green:

```bash
npm run check   # lint + typecheck + build
```

## Ground rules

`AGENTS.md` describes how the app is put together. A few rules matter most:

- Every outbound request for a user-supplied URL goes through `safeFetch`, which blocks private and local addresses. That includes requests made by the cloning browser.
- Project pages are untrusted content: they are always served with a `sandbox` Content-Security-Policy, and mutating API routes check the request origin.
- Changes to project files go through `ChangeRecorder`, so they can be undone.

## Submitting a pull request

1. **Fork** the repo and create a branch off `master` (e.g. `fix/srcset-rewrite` or `docs/clarify-setup`).
2. Make one focused change.
3. Run `npm run check` and make sure it passes.
4. Write a clear commit message that describes the change. Prefixes such as `fix:`, `feat:`, or `docs:` are welcome but not required.
5. Open a PR against `master`, fill out the PR template, and link a relevant issue when one exists (for example, `Closes #123`).
