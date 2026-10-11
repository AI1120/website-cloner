# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Link settings** for published projects: a title, description and preview image for link previews and search results (the image can be photographed from the page in the browser, or uploaded), applied as pages are served; and an optional password, kept only as a salted hash on the server, with a branded password page that still shows the link preview.
- Animated three.js scenes across the app, built from one shared kit: a page assembling itself while the AI builds, a blueprint waiting to be built, pages tumbling past an empty outline on not-found and error pages, and an original and its copy scanned together while cloning and comparing. They load on demand, pause off screen, follow the theme, and stand still under reduced motion.
- A designed empty state in the preview for projects with nothing built yet: the build in progress, or the original request with **Build it now** (and **Clone {site}** when the request asks to copy a site).
- The start screen offers **Clone it instead** when a prompt asks to copy a site by its address, and `/?clone=<address>` opens Clone Website with the address filled in.
- After the AI changes a project it built, the changed pages are opened in a browser; uncaught errors, console errors and missing files are handed back to the AI for one round of fixes in the same request. Copied sites are skipped.
- **Compare with the original** (preview toolbar and <kbd>Ctrl</kbd>+<kbd>K</kbd>, for copied pages): screenshots the live page and the copy in the same browser at desktop or phone width, scores how closely they match (tolerating content that has only shifted up or down), and shows them side by side, with a slider, or with the differences and missing parts marked.
- Cloning loads each page in the installed Chrome or Edge first (**Load in a browser**, on by default), so content that scripts build, CSS-in-JS styles and web components are copied. Every request the browser makes goes through `safeFetch`; without a browser, pages are copied as the server sends them. `CLONER_BROWSER` picks or turns off the browser.
- A code editor in the Code view (CodeMirror): syntax colours in both themes, line numbers, folding, search and replace, <kbd>Ctrl</kbd>+<kbd>S</kbd> to save, and file-type icons in the file list. It loads only when the Code view opens.
- Clone progress shows its four steps (open, read pages, download files, save) with file counts.
- The SiteCloner logo in the header, browser tab, home-screen icon and beside AI replies; the accent colour now matches the logo's magenta.
- Cloned projects show their site's icon in the sidebar; thumbnails show a placeholder while they load instead of a white box.
- AI replies render formatting (lists, bold, code, links), and the prompts let the AI use a little of it.
- A "What changed" view: each AI turn lists the files it changed, and **View changes** (also in History) compares every file before and after the change, line by line.
- Dark mode, with a light / dark / match-the-device toggle remembered per browser and applied before the page paints.
- A command palette on <kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>⌘</kbd>+<kbd>K</kbd>, including from inside the preview: switch views, open projects, export, publish, undo, rename, change the theme.
- Toast notifications for undo, publish, copying links, deleting and errors, in place of the workspace's notice bar.
- Branded not-found, error and loading screens, including one for a project link that no longer exists.

### Changed
- Rewrote the README for SiteCloner: screenshots of the app, the new features, keyboard shortcuts, Docker storage, and setup steps. Removed the upstream template's badges, demo video and star chart, and credited the template.

### Fixed
- The selected start option keeps its name (with × to clear it) instead of reading "Clear".

### Removed
- The original template's leftovers: its funding file, token-badge workflow, and `/clone-website` references in the contributing guide and issue forms. The package is now named `sitecloner`.

## [0.6.1] - 2026-10-05

### Changed
- Generalize cloning guidance: treat each observation as a sample of a rule found by varying width, height, input, and state; use the source's actual files; and build shared components from every observed state.

## [0.6.0] - 2026-10-05

### Changed
- Simplify the shared website-cloning workflow, improve responsive and motion guidance, and align the project documentation.

## [0.5.1] - 2026-09-26

### Changed
- Recommend Claude Code with Opus 5.5 in the README
- Refreshed the static Star History chart through September 2026
- Removed a redundant note about editing the canonical skill from the README

### Security
- Update Next.js and eslint-config-next to 16.3.5 with exact version pins, and refresh vulnerable transitive dependencies. Thanks to @atahan150 for the report in [#117](https://github.com/JCodesMore/ai-website-cloner-template/issues/117) and proposed fix in [#118](https://github.com/JCodesMore/ai-website-cloner-template/pull/118).

## [0.5.0] - 2026-09-17

### Added
- Repository ranking badges in the README

### Changed
- Simplified Quick Start with a copyable agent setup prompt, a template button, and one cloning command example
- Consolidated Claude Code, Codex, Cursor, and OpenCode support around one canonical Agent Skill in `.agents/skills/clone-website/`
- Reduced the Claude Code integration to a thin command bridge that forwards arguments to the canonical skill without creating a duplicate skill in other agents
- Moved the website inspection guide into the canonical skill's on-demand references

### Removed
- Expired sponsor integrations
- Japanese and Simplified Chinese READMEs; the English README is the single maintained entry point
- Redundant workflow diagrams from the READMEs
- Generated skill and instruction copies for unsupported or redundant agent platforms
- The agent-rule and skill synchronization scripts and their generated-file CI gate

## [0.4.0] - 2026-08-10

### Added
- Docker workflows for local development and multi-stage production builds
- Kiro support through a generated workspace `/clone-website` skill
- Complete generated workspace skills for Cline and Roo Code, including a Roo slash-command bridge
- Simplified Chinese and Japanese READMEs with the same onboarding and workflow guidance as the English documentation
- Contributor and security policies, including a private vulnerability-reporting path
- CI enforcement that generated agent rules and skills remain synchronized with their source files
- Compact pipeline diagrams and a static Star History chart in every README

### Changed
- Raised the project Node.js baseline to 24 across local development, CI, Docker, and contributor-facing documentation
- Refreshed Next.js to 16.3, React to 19.2.4, and related dependencies
- Updated `/clone-website` so later runs preserve existing pages and isolate routes, research, components, assets, and downloaders for each target
- Improved multi-origin and query/fragment planning with collision-resistant output namespaces and explicit route verification
- Redesigned README onboarding around the template workflow, Opus 5 recommendation, supported platforms, and community links
- Hardened the rule and skill generators for current platform schemas and deterministic output

### Fixed
- Gemini CLI command validation by adding the required name and flattening the prompt schema
- Cline and Roo Code invocation, frontmatter, and argument handling
- Next.js documentation resolution in generated agent rules
- Vulnerable framework dependencies and generated-file consistency checks

### Removed
- Aider from the officially supported-platform list because its current capabilities cannot run the complete browser and subagent workflow reliably; `.aider.conf.yml` remains available for loading general project context

### Security
- Documented responsible vulnerability disclosure through GitHub private vulnerability reporting
- Updated vulnerable dependencies to patched releases

## [0.3.1] - 2026-03-29

### Fixed
- `sync-agent-rules.sh` failing to resolve `@file` imports on Windows due to CRLF line endings — platform instruction files now correctly inline the Inspection Guide content

## [0.3.0] - 2026-03-29

### Added
- Multi-URL support for `/clone-website` — clone multiple sites in a single command with parallel processing and isolated output
- CI quality gates via GitHub Actions — automated lint, typecheck, and build on every push and PR
- `npm run typecheck` and `npm run check` scripts for local quality validation
- `.gitattributes` for cross-platform line ending normalization
- `.nvmrc` to pin Node.js 20 for contributor consistency

### Changed
- Streamlined PR template — removed redundant checklist items and screenshots section
- Improved project description and README — clearer use cases, limitations, and modern wording
- Refined documentation and agent rules across all platforms for clarity and consistency
- Fixed CRLF handling in `sync-skills.mjs` for reliable Windows operation

### Removed
- Outdated use case from README documentation

## [0.2.0] - 2026-03-28

### Added
- Multi-platform AI agent support: Claude Code, Codex CLI, OpenCode, GitHub Copilot, Cursor, Windsurf, Gemini CLI, Cline/Roo Code, Continue, Amazon Q, Augment Code, Aider
- Platform-specific instruction files and `/clone-website` skill for each supported agent
- `scripts/sync-agent-rules.sh` to regenerate platform instruction files from AGENTS.md
- `scripts/sync-skills.mjs` to regenerate `/clone-website` skill across all platforms
- GEMINI.md for Gemini CLI configuration
- Supported Platforms table in README
- "Updating for Other Platforms" documentation section in README

### Changed
- README now describes the project as multi-agent (Claude Code recommended, not required)
- AGENTS.md updated with sync script reminders

## [0.1.1] - 2026-03-28

### Added
- Bug report and feature request issue templates
- Pull request template with checklist
- CHANGELOG.md following Keep a Changelog format
- Package.json metadata (description, repository, homepage, keywords, engines)

### Fixed
- LICENSE copyright holder now attributed to JCodesMore

## [0.1.0] - 2026-03-28

### Added
- Initial template scaffold for website reverse-engineering with Claude Code
- `/clone-website` skill for full-site cloning pipeline
- `/build-from-spec` and `/customize` skills
- Parallel builder agents with git worktree isolation
- Chrome MCP integration for design token extraction
- Comprehensive inspection guide and project structure documentation
- Next.js 16 + shadcn/ui + Tailwind CSS v4 base scaffold
- MIT license
- README with badges, demo section, quick start, and star history

[Unreleased]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/JCodesMore/ai-website-cloner-template/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/JCodesMore/ai-website-cloner-template/releases/tag/v0.1.0
