# OmniSocials Agent Skills

AI agent skills for managing social media across 13 platforms (14 channels) via [OmniSocials](https://omnisocials.com). Give your AI agent the ability to create, schedule, and publish posts directly from your IDE or terminal.

Works with Claude Code, Cursor, Windsurf, GitHub Copilot, Codex, Gemini CLI, and many others.

## Supported Platforms

Instagram, Facebook, LinkedIn (personal profile + company page), YouTube, TikTok, X (Twitter), Pinterest, Bluesky, Threads, Mastodon, Google Business, Telegram (channels and groups), Discord (channels)

## Setup

### 1. Install the skill

```bash
npx skills add OmniSocials/omnisocials-agent-skills
```

This installs the skill (including the CLI at `<skill-path>/scripts/omnisocials.js`) into your agent's skills directory. Alternatively, clone the repo and run the CLI from `skills/omnisocials/scripts/omnisocials.js` (the old `scripts/omnisocials.js` path still works as a shim).

### 2. Copy your API Key

Get your API key from [Settings > API](https://app.omnisocials.com/settings/api) in the OmniSocials app.

### 3. Run the setup command

Ask your agent "Help me set up the OmniSocials skill", or run the setup yourself from the install location:

```bash
./skills/omnisocials/scripts/omnisocials.js setup
```

### 4. Start using it

Ask your AI agent things like:

- "Show my connected social accounts"
- "Create a post for Instagram and LinkedIn with this image"
- "Schedule a reel for TikTok tomorrow at 9am"
- "Show my scheduled posts"
- "How are my posts performing this week?"
- "Upload this image and create a Pinterest pin"

## Commands

56 commands covering the full v1 API:

| Category | Commands |
|----------|----------|
| **Setup** | `setup`, `config:show` |
| **Posts** | `posts:list`, `posts:get`, `posts:recent-platform`, `posts:create`, `posts:create-and-publish`, `posts:update`, `posts:publish`, `posts:retry`, `posts:approve`, `posts:reject`, `posts:approval`, `posts:delete` |
| **Approval workflows** | `approval-workflows:list` |
| **Media** | `media:list`, `media:upload`, `media:upload-base64`, `media:check`, `media:delete` |
| **Folders** | `folders:list`, `folders:create` |
| **Hashtag sets** | `hashtag-sets:list`, `hashtag-sets:create`, `hashtag-sets:update`, `hashtag-sets:delete` |
| **Automations (comment to DM)** | `automations:list`, `automations:get`, `automations:create`, `automations:update`, `automations:delete`, `automations:events` |
| **Accounts** | `accounts:list`, `accounts:get` |
| **Locations & audio** | `locations:search`, `audio:search` |
| **Pinterest products** | `pinterest:products`, `pinterest:validate` |
| **Analytics** | `analytics:post`, `analytics:posts`, `analytics:overview`, `analytics:accounts`, `analytics:best-times` |
| **Inbox** | `inbox:list`, `inbox:next`, `inbox:messages`, `inbox:read`, `inbox:reply`, `inbox:hide`, `inbox:like`, `inbox:delete` |
| **Webhooks** | `webhooks:list`, `webhooks:create`, `webhooks:get`, `webhooks:update`, `webhooks:delete`, `webhooks:rotate-secret` |

## Features

- **13 platforms (14 channels)** from one tool
- **Posts, Stories, and Reels** with platform-specific options
- **Platform-specific controls**: Pinterest boards and product tags, YouTube metadata, TikTok privacy, Instagram covers, X reply settings
- **Per-platform media**: Different images/videos for different platforms in the same post
- **Image fit per channel** (unreleased): a feed image outside what a channel shows uncropped is cropped or kept per channel (`--media-fit instagram=keep,pinterest=crop`); `media:check` shows how each channel would show it first
- **Alt text**: Per-media accessibility descriptions, delivered to Mastodon, Bluesky, X, Pinterest, Instagram (images) and LinkedIn (images)
- **Analytics**: Post-level, bulk, workspace overview, account-level metrics, and best posting times
- **Social inbox**: Read and reply to DMs, comments, and mentions
- **Comment to DM**: answer a keyword in an Instagram or Facebook Page comment with a DM, once per person, with a public reply under the comment; on a new post (`--dm-keywords`, `--dm-message`) or an existing one (`automations:create`), with the activity per person (`automations:events`). On X (`--platform x`) an automation answers a keyword in a DM to the account
- **Approvals**: Send a post through an approval workflow, approve or reject it, and read the review (who decided, the reason, the comments)
- **Webhooks**: Get notified when posts are scheduled, published, fail, or are approved or rejected in an approval workflow
- **Zero dependencies**: Uses Node.js 18+ built-in fetch

## Alternative: MCP Server

For agents that call tools instead of shell commands, add the hosted OmniSocials MCP server. It signs in with OAuth (no API key) and has every tool. In Claude Code:

```bash
claude mcp add --transport http --scope user omnisocials https://mcp.omnisocials.com
claude mcp login omnisocials
```

Setup for other agents: [omnisocials.com/mcp](https://omnisocials.com/mcp). The [@omnisocials/mcp-server](https://www.npmjs.com/package/@omnisocials/mcp-server) npm package runs a local copy with an API key, with fewer tools than the hosted server.

## Claude Code and Grok Build plugin

This repo is also an installable plugin marketplace for Claude Code and Grok Build. The plugin bundles the skill plus the hosted OmniSocials MCP server.

- **Claude Code:** `/plugin marketplace add OmniSocials/omnisocials-agent-skills`, then `/plugin install omnisocials@omnisocials-skills`.
- **Grok Build:** `grok plugin install OmniSocials/omnisocials-agent-skills --trust`, or `grok plugin marketplace add OmniSocials/omnisocials-agent-skills` and install it from `/plugins`. It is not in xAI's official marketplace.

On first use, sign in to OmniSocials and approve the workspaces the agent can access.

The MCP connection uses OAuth. No API key is needed for it.

## Network endpoints and credentials

For transparency and security review, this plugin only calls OmniSocials services:

- `https://api.omnisocials.com/v1` (skill CLI; authenticated with the OmniSocials API key you provide during setup, stored in your local config)
- `https://mcp.omnisocials.com` (hosted MCP server; OAuth 2.1 sign-in, no key stored by the plugin)

The plugin sends no telemetry and reads no credentials other than its own API key.

## Links

- [OmniSocials](https://omnisocials.com)
- [API Documentation](https://docs.omnisocials.com)
- [Integrations Guide](https://docs.omnisocials.com/integrations/agent-skills)
- [MCP Server](https://www.npmjs.com/package/@omnisocials/mcp-server)
- [llms.txt](https://docs.omnisocials.com/llms.txt) (docs index for AI agents)

## License

MIT
