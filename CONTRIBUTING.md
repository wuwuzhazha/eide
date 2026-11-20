# Contributing

EIDE Pro is maintained on the `dev` branch. Open issues and pull requests at
the repository URL listed in `README.md`.

## Before you start

- For a behavior change or new feature, open an issue first so the approach can
  be agreed before implementation.
- Keep each pull request focused on one problem. Do not mix refactors,
  formatting-only changes, and feature work.
- Follow the project rules in `AGENTS.md`.

## Development

Requirements: Node.js 18 and the `lib/node-utility` submodule.

```bash
git clone --recursive <repository-url>
cd eide-pro
npm install
npm test
```

Useful commands:

```bash
npm run compile           # Type-check src
npm run compile:test      # Compile test scripts
npm run webpack           # Build the extension in development mode
npm run webpack:headless  # Build dist/eide_cli.js and dist/eide_mcp.js
npm run vscode:prepublish # Production build used by VSIX packaging
```

## Pull requests

1. Branch from `dev`.
2. Make a small, self-contained change with tests where behavior changes.
3. Run the relevant verification locally.
4. Open a pull request describing the problem, the change, and the commands and
   results used to verify it.

Use conventional commit-style subjects where practical, for example
`fix(headless): ...`, `feat(debug): ...`, or `docs: ...`.

## Generated files

Do not commit `dist/`, `out/`, `node_modules/`, or packaged VSIX files. Release
artifacts are published through GitHub Releases. See `docs/release.md`.
