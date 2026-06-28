---
name: omnisocials
description: Manage social media across 11 platforms (Instagram, Facebook, LinkedIn Profile + Page, YouTube, TikTok, X, Pinterest, Bluesky, Threads, Mastodon, Google Business). Create posts, stories, reels, upload media, organize folders, view analytics, and configure webhooks via the OmniSocials API.
---

# OmniSocials Skill

Create, schedule, and publish social media content across 11 platforms using OmniSocials.

OmniSocials is a social media management tool that lets you schedule posts and track analytics across Instagram, Facebook, LinkedIn (personal profile + company page), YouTube, TikTok, X (Twitter), Pinterest, Bluesky, Threads, Mastodon, and Google Business.

> **LinkedIn has two channel ids:** `linkedin` is a personal profile, `linkedin_page` is a company page. Both can be connected to one workspace and post independently. Always check `accounts:list` for which the user has connected.

## Setup

Before using this skill, ensure:

1. **API Key**: Run the setup command to configure your API key securely
   - Get your key at https://app.omnisocials.com/settings/api
   - Run: `<skill-path>/scripts/omnisocials.js setup`
   - Or set environment variable: `export OMNISOCIALS_API_KEY=omsk_live_your_key`

2. **Requirements**: Node.js 18+ (for built-in fetch API). No other dependencies needed.

Config priority (highest to lowest):
1. `OMNISOCIALS_API_KEY` environment variable
2. `./.omnisocials/config.json` (project-local, in user's working directory)
3. `~/.config/omnisocials/config.json` (user-global)

### Handling "API key not found" errors

CRITICAL: When you receive an "API key not found" error from the CLI:

1. Tell the user to run the setup command. The setup is interactive and requires user input, so you cannot run it on their behalf.
2. Stop and wait. Do not continue with the task. Wait for the user to complete setup and confirm before proceeding.

Note: All script paths in this document are relative to the skill directory where this SKILL.md file is located. Resolve them accordingly based on where the skill is installed.

## Safety Rules

IMPORTANT: Follow these rules at all times.

1. **NEVER publish a post without explicit user confirmation.** Creating a draft is safe; publishing is irreversible and goes public instantly.
2. **NEVER delete posts, media, or webhooks without explicit user confirmation.**
3. **Always list accounts first** before creating posts, to get valid channel IDs. Do not guess channel IDs.
4. **Always verify media requirements** before creating posts:
   - Stories: ALWAYS require an image or video
   - Reels: ALWAYS require a video
   - Instagram posts: ALWAYS require at least one image or video
   - TikTok posts: ALWAYS require at least one image or video
   - Pinterest posts: ALWAYS require an image AND a `--pinterest-board-id`
   - Other platforms (LinkedIn Profile, LinkedIn Page, X, Facebook posts, Bluesky, Threads, Mastodon, Google Business): Media is optional
   - **Per-platform media caps** (exceeding returns a 400 validation_error stating the exact limit): max items — X/Bluesky/Mastodon ≤4, Instagram/Threads ≤10, TikTok ≤35 photos (no photo/video mix). Video duration/size — **X 140s (2min 20s) / 512MB** (a tweet is either 1 video OR up to 4 images, never mixed), Bluesky 180s, Threads 5min, Instagram 15min, TikTok 10min, YouTube Short 3min. If the user's video is over the cap, tell them the limit so they can trim it.
   - **Pinterest board — auto-default to first**: If the user wants to post to Pinterest but hasn't specified a board, do NOT block on asking and do NOT skip Pinterest. Run `accounts:get <pinterest_account_id>` — its output lists each board's name and ID. Use the FIRST board automatically. After the post is created, mention to the user which board was used (e.g. "Posted to your 'Marketing' board on Pinterest — let me know if you'd prefer a different one and I'll move it."). If the user named a specific board in the request, match it case-insensitively against the list and use that one instead.
5. **No duplicate content** across posts unless explicitly requested.
6. **Always confirm timezone/datetime** with the user when scheduling posts.
7. **For bulk operations**, process one at a time and confirm between actions.

## Common Actions

| User says... | Action |
|---|---|
| "Post this to Instagram" | `accounts:list` to find Instagram channel ID, then `posts:create --text "..." --channels <id>` |
| "Schedule a post for tomorrow" | `posts:create --text "..." --channels <ids> --schedule "2026-04-07T09:00:00Z"` |
| "Show my scheduled posts" | `posts:list --status scheduled` |
| "Upload this image" | `media:upload --url "https://..."` (or `media:upload-base64 --file ./img.jpg` for a local file) |
| "Create a reel for TikTok" | `posts:create --text "..." --channels <tiktok_id> --type reel --media-urls "https://video.mp4"` |
| "Post to all platforms" | `accounts:list`, then `posts:create --text "..." --channels <all_ids>` |
| "Post a thread to X" | `posts:create --channels <x_id> --x-thread "part 1 || part 2 || part 3"` |
| "Tag a location on Instagram" | `locations:search "<place name>"`, then `posts:create ... --location-id <id>` |
| "How are my posts doing?" | `analytics:overview --period 7d`, or `analytics:posts <id,id,...>` for many posts at once |
| "Organize my media" | `folders:list` / `folders:create --name "..."`, then upload with `--folder-id <id>` |
| "Delete that post" | Confirm with user, then `posts:delete <id>` |
| "Publish my draft" | Confirm with user, then `posts:publish <id>` |
| "Set up a webhook" | `webhooks:create --url "https://..." --events post.published,post.failed` |

## Workflow

Follow this workflow when creating posts:

1. **List accounts** to find available channel IDs:
   ```
   ./scripts/omnisocials.js accounts:list
   ```

2. **Upload media** if needed (required for stories, reels, Instagram, TikTok, Pinterest):
   ```
   ./scripts/omnisocials.js media:upload --url "https://example.com/image.jpg"
   ```
   Note the returned `media_id`.

3. **Create the post** with appropriate channels, media, and platform options:
   ```
   ./scripts/omnisocials.js posts:create --text "..." --channels <id1>,<id2> --media-ids <media_id>
   ```

4. **Schedule or publish** as needed:
   - Add `--schedule "2026-04-10T14:00:00Z"` to schedule
   - Use `posts:create-and-publish` to publish immediately
   - Or create as draft first, then `posts:publish <id>` after confirmation

## Commands Reference

### Setup & Configuration

| Command | Description |
|---|---|
| `setup` | Interactive setup - prompts for API key, validates, and saves |
| `setup --api-key <key> --global` | Non-interactive setup to global config |
| `config:show` | Show current config, API key source |

### Posts

| Command | Description |
|---|---|
| `posts:list` | List posts. Flags: `--status draft\|scheduled\|published\|failed`, `--limit`, `--offset` |
| `posts:get <id>` | Get full post details |
| `posts:create` | Create a new post. Flags: `--text`, `--channels`, `--schedule`, `--type post\|story\|reel`, `--media-ids`, `--media-urls`, `--link-url` (+`--link-title`/`--link-description`/`--link-thumbnail-url`), `--location-id`, `--collaborators`, `--user-tags`, `--x-thread`, plus platform flags |
| `posts:create-and-publish` | Create and publish immediately. Same flags as `posts:create` except `--schedule` |
| `posts:update <id>` | Update a draft or scheduled post. Same flags as `posts:create` |
| `posts:publish <id>` | Publish a draft/scheduled post now |
| `posts:delete <id>` | Delete a post (cannot be undone) |

### Media

| Command | Description |
|---|---|
| `media:list` | List uploaded media files. Flags: `--limit`, `--offset` |
| `media:upload` | Upload media from URL (max 50MB). Flags: `--url` (required), `--filename` |
| `media:upload-base64` | Upload a local file or base64 data. Flags: `--file <path>` (auto-encodes + infers MIME) OR `--data` + `--mime-type`; plus `--filename`, `--name` (findable label), `--folder`, `--folder-id` |
| `media:check` | Check whether media fits target platforms before posting. Flags: `--url`, or `--media-id`, or `--size-bytes` + `--mime` |
| `media:delete <id>` | Delete a media file |

### Folders

| Command | Description |
|---|---|
| `folders:list` | List media folders (id, name, parent, item count). Use folder ids with `media:upload-base64 --folder-id`. |
| `folders:create` | Create a folder. Flags: `--name` (required), `--parent-id` (nest under another folder) |

### Locations

| Command | Description |
|---|---|
| `locations:search "<name>"` | Search Facebook Places for taggable locations (min 2 chars). Returns `location_id` values to pass to `posts:create --location-id` for Instagram place tags. |

### Accounts

| Command | Description |
|---|---|
| `accounts:list` | List all connected social media accounts with channel IDs, platforms, content types, and Pinterest boards |
| `accounts:get <id>` | Get full account details including platform-specific info |

### Analytics

| Command | Description |
|---|---|
| `analytics:post <post-id>` | Get post analytics: impressions, engagements, likes, comments, shares, per-platform stats |
| `analytics:posts <id,id,...>` | Get analytics for up to 100 posts in one call (bulk). Use this instead of looping `analytics:post` to avoid the rate limit. |
| `analytics:overview` | Workspace analytics overview. Flags: `--period 7d\|30d\|90d`, `--start-date YYYY-MM-DD`, `--end-date YYYY-MM-DD` |
| `analytics:accounts` | Account-level analytics (followers, subscribers). Flags: `--platform`, `--date YYYY-MM-DD` |

### Webhooks

| Command | Description |
|---|---|
| `webhooks:list` | List all webhooks |
| `webhooks:create` | Create a webhook. Flags: `--url` (required), `--events` (required, comma-separated: `post.scheduled`, `post.published`, `post.failed`) |
| `webhooks:get <id>` | Get webhook details |
| `webhooks:update <id>` | Update webhook. Flags: `--url`, `--events`, `--active true\|false` |
| `webhooks:delete <id>` | Delete a webhook |
| `webhooks:rotate-secret <id>` | Rotate webhook signing secret (save the new secret immediately) |

### Global Flags

All commands support these flags:

| Flag | Description |
|---|---|
| `--json` | Output raw JSON response (useful for parsing) |
| `--api-key <key>` | Override API key for this command |
| `--base-url <url>` | Override API base URL |
| `--help` | Show help |

## Platform-Specific Reference

### Content Type Support Matrix

| Platform | Post | Story | Reel | Media Required |
|---|---|---|---|---|
| Instagram | Yes | Yes | Yes | Always (image or video) |
| Facebook | Yes | Yes | Yes | Optional for posts, required for stories/reels |
| LinkedIn (`linkedin`) | Yes | No | No | Optional |
| LinkedIn Page (`linkedin_page`) | Yes | No | No | Optional |
| YouTube | No | No | Yes (Shorts) | Always (video) |
| TikTok | Yes | No | Yes | Always (image or video) |
| X (Twitter) | Yes | No | No | Optional |
| Pinterest | Yes | No | No | Always (image or video + board_id) |
| Bluesky | Yes | No | No | Optional |
| Threads | Yes | No | No | Optional |
| Mastodon | Yes | No | No | Optional |
| Google Business | Yes | No | No | Optional |

### Platform-Specific Flags

#### Pinterest
| Flag | Description |
|---|---|
| `--pinterest-board-id` | **Required** for Pinterest. Get board IDs from `accounts:get <pinterest_account_id>` |
| `--pinterest-title` | Pin title |
| `--pinterest-link` | Link URL attached to the pin |
| `--pinterest-video-cover` | Cover image URL for a video pin |
| `--pinterest-alt-text` | Alt text for the pin |

#### YouTube (Shorts)
| Flag | Description |
|---|---|
| `--youtube-title` | Video title |
| `--youtube-privacy` | Privacy: `public`, `private`, or `unlisted` |
| `--youtube-tags` | Tags (comma-separated) |
| `--youtube-category-id` | YouTube category ID |
| `--youtube-made-for-kids` | Made for kids flag |

#### Instagram
| Flag | Description |
|---|---|
| `--instagram-share-to-feed` | Share reel to feed |
| `--instagram-cover-url` | Reel cover image URL |
| `--instagram-thumbnail-type` | Thumbnail type: `from-video` or `from-library` |

#### TikTok
| Flag | Description |
|---|---|
| `--tiktok-privacy` | Privacy: `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR`, `SELF_ONLY` |
| `--tiktok-disable-comment` | Disable comments |
| `--tiktok-disable-duet` | Disable duets |
| `--tiktok-disable-stitch` | Disable stitches |
| `--tiktok-is-aigc` | Mark as AI-generated content |

#### X (Twitter)
| Flag | Description |
|---|---|
| `--x-reply-settings` | Who can reply: `following` or `mentionedUsers` (empty string = everyone) |
| `--x-thread "a \|\| b \|\| c"` | Post a thread. Parts are split on `\|\|` (2–25 parts). For per-tweet media, build the post with `--json` and a full `x.thread_parts` array instead. |

#### Link preview (LinkedIn / Facebook)
| Flag | Description |
|---|---|
| `--link-url` | URL to attach as a link-preview card |
| `--link-title` | Override the preview title |
| `--link-description` | Override the preview description |
| `--link-thumbnail-url` | Override the preview thumbnail image |

#### Instagram place tag & people tags
| Flag | Description |
|---|---|
| `--location-id` | Facebook Place ID to tag (find one with `locations:search`) |
| `--collaborators` | Up to 3 public Instagram usernames invited as co-authors (comma-separated) |
| `--user-tags` | JSON array of photo tags: `[{"username":"name","x":0.5,"y":0.5,"image_index":0}]` (x/y are 0–1 from top-left) |

### Per-Platform Media

Media can be the same across all platforms or different per platform:

**Same media for all platforms:**
```
./scripts/omnisocials.js posts:create --text "..." --channels <ig>,<li> --media-urls "https://example.com/photo.jpg"
```

**Different media per platform** (use `--json` flag and API directly for per-platform media objects):
The API supports `media_urls` as an object: `{ "default": ["url1"], "instagram": ["url2"], "pinterest": ["url3"] }`. The `default` key is the fallback for platforms without their own key. Pass an empty array to opt a platform out of media.

## Examples

### List connected accounts
```
./scripts/omnisocials.js accounts:list
```

### Create a text post to LinkedIn and X
```
./scripts/omnisocials.js posts:create --text "Excited to announce our new feature!" --channels <linkedin_id>,<x_id>
```

### Create an Instagram reel with cover image
```
./scripts/omnisocials.js posts:create --text "Check this out" --channels <instagram_id> --type reel --media-urls "https://example.com/video.mp4" --instagram-share-to-feed --instagram-cover-url "https://example.com/cover.jpg"
```

### Schedule a post for next week
```
./scripts/omnisocials.js posts:create --text "Happy Monday!" --channels <id1>,<id2> --schedule "2026-04-13T09:00:00Z"
```

### Create a Pinterest pin
```
./scripts/omnisocials.js posts:create --text "Beautiful design inspiration" --channels <pinterest_id> --media-urls "https://example.com/pin.jpg" --pinterest-board-id <board_id> --pinterest-title "Design Inspiration" --pinterest-link "https://example.com"
```

### Upload media and create a post with it
```
./scripts/omnisocials.js media:upload --url "https://example.com/photo.jpg"
# Returns: ID: media_abc123

./scripts/omnisocials.js posts:create --text "New photo!" --channels <id> --media-ids media_abc123
```

### Create a YouTube Short
```
./scripts/omnisocials.js posts:create --text "Quick tip" --channels <youtube_id> --type reel --media-urls "https://example.com/short.mp4" --youtube-title "Quick Tip #1" --youtube-privacy public --youtube-tags "tips,tutorial"
```

### Create a TikTok video
```
./scripts/omnisocials.js posts:create --text "Watch this" --channels <tiktok_id> --type reel --media-urls "https://example.com/video.mp4" --tiktok-privacy PUBLIC_TO_EVERYONE
```

### Post an X thread
```
./scripts/omnisocials.js posts:create --text "Kicking off a thread" --channels <x_id> --x-thread "First point || Second point || Wrapping up"
```

### Tag an Instagram location
```
./scripts/omnisocials.js locations:search "Blue Bottle Coffee"
# Returns: location_id: 1234567890  Blue Bottle Coffee  — 1 Ferry Building, San Francisco

./scripts/omnisocials.js posts:create --text "Coffee time" --channels <instagram_id> --media-urls "https://example.com/photo.jpg" --location-id 1234567890
```

### Upload a local file into a folder
```
./scripts/omnisocials.js folders:create --name "Summer Campaign"
# Returns: ID: 42

./scripts/omnisocials.js media:upload-base64 --file ./promo.jpg --name "summer-hero" --folder-id 42
```

### Bulk analytics for many posts (one request)
```
./scripts/omnisocials.js analytics:posts 1024,1025,1026
```

### Post to a LinkedIn company page
```
./scripts/omnisocials.js posts:create --text "Company update" --channels linkedin_page
```

### View scheduled posts as JSON
```
./scripts/omnisocials.js posts:list --status scheduled --json
```

### Get analytics for the last 30 days
```
./scripts/omnisocials.js analytics:overview --period 30d
```

### Get analytics for a specific date range
```
./scripts/omnisocials.js analytics:overview --start-date 2026-03-01 --end-date 2026-03-31
```

### Create a webhook for post notifications
```
./scripts/omnisocials.js webhooks:create --url "https://yoursite.com/webhook" --events post.published,post.failed
```

### Setup (interactive)
```
./scripts/omnisocials.js setup
```

### Setup (non-interactive)
```
./scripts/omnisocials.js setup --api-key omsk_live_xxx --global
```

## Error Handling

### Common Errors

| Error | Cause | Fix |
|---|---|---|
| `API key not found` | No API key configured | Run `setup` or set `OMNISOCIALS_API_KEY` |
| `unauthorized` / `invalid_api_key` | Invalid or expired API key | Check key at Settings > API |
| `insufficient_scope` | API key missing required scope | Create a new key with needed scopes |
| `rate_limit_exceeded` | Too many requests (100/min limit) | Wait and retry after the reset time |
| `validation_error` | Missing required fields or invalid data | Check required media/fields for the platform |
| `not_found` | Resource doesn't exist | Verify the ID is correct |

### Rate Limits

The API allows 100 requests per minute per API key. Response headers include:
- `X-RateLimit-Limit`: Max requests per window
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Unix timestamp when the window resets

## Tips

- **Always start with `accounts:list`** to discover channel IDs and platform capabilities
- **Use `--json`** when you need to parse the output programmatically
- **Check content types**: Use `accounts:list` to see what content types each account supports (post, story, reel)
- **Pinterest boards**: Run `accounts:get <pinterest_id>` to see available boards and their IDs
- **Scheduling**: Use ISO 8601 format for dates (e.g., `2026-04-10T14:00:00Z`)
- **Media upload**: Supports JPEG, PNG, GIF, WebP images and MP4, MOV, AVI videos (max 50MB)
- **Draft first**: When unsure, create as draft (no `--schedule`), review, then publish with `posts:publish`
