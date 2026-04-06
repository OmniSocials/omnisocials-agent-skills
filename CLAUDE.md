# CLAUDE.md

## Project Overview

This is the OmniSocials agent-skills package. It provides a CLI tool and SKILL.md for AI agents to manage social media across 10 platforms via the OmniSocials API.

## Structure

- `scripts/omnisocials.js` - Zero-dependency Node.js CLI (the tool agents call)
- `skills/omnisocials/SKILL.md` - Instructions for AI agents (the brain)
- `.claude-plugin/marketplace.json` - Claude Code plugin discovery
- `tests/` - vitest test files

## Development

```bash
npm install        # Install vitest
npm test           # Run tests
npm run test:watch # Watch mode
```

## Testing locally

```bash
npx skills add .   # Install from local repo
```

## Key Design Decisions

- Single-file CLI with zero dependencies (Node 18+ built-in fetch)
- SKILL.md is the primary deliverable - it's what makes agents effective
- Not published to npm - distributed via `npx skills add` only
- Config priority: CLI flag > env var > project config > global config
