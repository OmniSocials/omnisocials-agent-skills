# OmniSocials Agent Skills

AI agent skills for managing social media across 10 platforms via [OmniSocials](https://omnisocials.com). Give your AI agent the ability to create, schedule, and publish posts directly from your IDE or terminal.

Works with Claude Code, Cursor, Windsurf, GitHub Copilot, Codex, Gemini CLI, and many others.

## Supported Platforms

Instagram, Facebook, LinkedIn, YouTube, TikTok, X (Twitter), Pinterest, Bluesky, Threads, Mastodon

## Setup

### 1. Install the skill

```bash
npx skills add omnisocials/agent-skills
```

### 2. Copy your API Key

Get your API key from [Settings > API](https://app.omnisocials.com/settings/api) in the OmniSocials app.

### 3. Run the setup command

```bash
./scripts/omnisocials.js setup
```

The path depends on how you installed it, but you can ask your agent "Help me set up the OmniSocials skill" to get the correct path.

### 4. Start using it

Ask your AI agent things like:

- "Show my connected social accounts"
- "Create a post for Instagram and LinkedIn with this image"
- "Schedule a reel for TikTok tomorrow at 9am"
- "Show my scheduled posts"
- "How are my posts performing this week?"
- "Upload this image and create a Pinterest pin"

## Commands

| Category | Commands |
|----------|----------|
| **Setup** | `setup`, `config:show` |
| **Posts** | `posts:list`, `posts:get`, `posts:create`, `posts:create-and-publish`, `posts:update`, `posts:publish`, `posts:delete` |
| **Media** | `media:list`, `media:upload`, `media:delete` |
| **Accounts** | `accounts:list`, `accounts:get` |
| **Analytics** | `analytics:post`, `analytics:overview`, `analytics:accounts` |
| **Webhooks** | `webhooks:list`, `webhooks:create`, `webhooks:get`, `webhooks:update`, `webhooks:delete`, `webhooks:rotate-secret` |

## Features

- **10 platforms** from one tool
- **Posts, Stories, and Reels** with platform-specific options
- **Platform-specific controls**: Pinterest boards, YouTube metadata, TikTok privacy, Instagram covers, X reply settings
- **Per-platform media**: Different images/videos for different platforms in the same post
- **Analytics**: Post-level, workspace overview, and account-level metrics
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
- [Integrations Guide](https://docs.omnisocials.com/integrations#agent-skills)
- [MCP Server](https://www.npmjs.com/package/@omnisocials/mcp-server)

## License

MIT
# omnisocials-agent-skills
