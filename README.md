# OmniSocials Agent Skills

AI agent skills for managing social media across 11 platforms (12 channels) via [OmniSocials](https://omnisocials.com). Give your AI agent the ability to create, schedule, and publish posts directly from your IDE or terminal.

Works with Claude Code, Cursor, Windsurf, GitHub Copilot, Codex, Gemini CLI, and many others.

## Supported Platforms

Instagram, Facebook, LinkedIn (personal profile + company page), YouTube, TikTok, X (Twitter), Pinterest, Bluesky, Threads, Mastodon, Google Business

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

40 commands covering the full v1 API:

| Category | Commands |
|----------|----------|
| **Setup** | `setup`, `config:show` |
| **Posts** | `posts:list`, `posts:get`, `posts:recent-platform`, `posts:create`, `posts:create-and-publish`, `posts:update`, `posts:publish`, `posts:retry`, `posts:delete` |
| **Media** | `media:list`, `media:upload`, `media:upload-base64`, `media:check`, `media:delete` |
| **Folders** | `folders:list`, `folders:create` |
| **Hashtag sets** | `hashtag-sets:list`, `hashtag-sets:create`, `hashtag-sets:update`, `hashtag-sets:delete` |
| **Accounts** | `accounts:list`, `accounts:get` |
| **Locations & audio** | `locations:search`, `audio:search` |
| **Analytics** | `analytics:post`, `analytics:posts`, `analytics:overview`, `analytics:accounts`, `analytics:best-times` |
| **Inbox** | `inbox:list`, `inbox:messages`, `inbox:read`, `inbox:reply` |
| **Webhooks** | `webhooks:list`, `webhooks:create`, `webhooks:get`, `webhooks:update`, `webhooks:delete`, `webhooks:rotate-secret` |

## Features

- **11 platforms (12 channels)** from one tool
- **Posts, Stories, and Reels** with platform-specific options
- **Platform-specific controls**: Pinterest boards, YouTube metadata, TikTok privacy, Instagram covers, X reply settings
- **Per-platform media**: Different images/videos for different platforms in the same post
- **Alt text**: Per-media accessibility descriptions, delivered to Mastodon, Bluesky, X, Pinterest, Instagram (images) and LinkedIn (images)
- **Analytics**: Post-level, bulk, workspace overview, account-level metrics, and best posting times
- **Social inbox**: Read and reply to DMs, comments, and mentions
- **Webhooks**: Get notified when posts are scheduled, published, or fail
- **Zero dependencies**: Uses Node.js 18+ built-in fetch

## Alternative: MCP Server

For deeper integration with Claude Code and Claude Desktop, you can also use the OmniSocials MCP Server:

```bash
claude mcp add omnisocials -- npx -y @omnisocials/mcp-server
```

See [@omnisocials/mcp-server on npm](https://www.npmjs.com/package/@omnisocials/mcp-server) for details.

## Links

- [OmniSocials](https://omnisocials.com)
- [API Documentation](https://docs.omnisocials.com)
- [Integrations Guide](https://docs.omnisocials.com/integrations/agent-skills)
- [MCP Server](https://www.npmjs.com/package/@omnisocials/mcp-server)
- [llms.txt](https://docs.omnisocials.com/llms.txt) (docs index for AI agents)

## License

MIT
