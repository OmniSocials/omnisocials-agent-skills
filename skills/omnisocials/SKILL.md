---
name: omnisocials
description: Manage social media across 11 platforms (Instagram, Facebook, LinkedIn Profile + Page, YouTube, TikTok, X, Pinterest, Bluesky, Threads, Mastodon, Google Business). Create posts, stories, reels, upload media, organize folders, view analytics, read and reply to the social inbox (DMs, comments, mentions), and configure webhooks via the OmniSocials API.
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
| "Post a thread to Bluesky" | `posts:create --channels <bluesky_id> --bluesky-thread "part 1 || part 2 || part 3"` |
| "Post a thread to Mastodon" | `posts:create --channels <mastodon_id> --mastodon-thread "part 1 || part 2 || part 3"` |
| "Tag a location on Instagram" | `locations:search "<place name>"`, then `posts:create ... --location-id <id>` |
| "Post a reel with music" | `audio:search "<song or artist>"` (no query = trending), then `posts:create ... --type reel --instagram-audio-id <id>` |
| "How are my posts doing?" | `analytics:overview --period 7d`, or `analytics:posts <id,id,...>` for many posts at once |
| "Any new DMs / comments?" | `inbox:list --unread` (add `--platform` / `--type dm\|comment\|mention` to filter) — needs the `inbox:read` scope |
| "Reply to that message" | `inbox:messages <conversation-id>` to read the thread, then `inbox:reply <conversation-id> --text "..."` — needs `inbox:write` |
| "Mark that conversation read" | `inbox:read <conversation-id>` — needs `inbox:write` |
| "Organize my media" | `folders:list` / `folders:create --name "..."`, then upload with `--folder-id <id>` |
| "Add my usual hashtags" | `hashtag-sets:list` to find the set, then `posts:create ... --hashtag-set "<name>"` (add `--hashtag-placement first_comment` to keep tags out of the caption) |
| "Save these hashtags for reuse" | `hashtag-sets:create --name "Brand" --tags "#a #b #c"` |
| "Delete that post" | Confirm with user, then `posts:delete <id>` |
| "Publish my draft" | Confirm with user, then `posts:publish <id>` |
| "Retry my failed post" | `posts:list --status failed` to find it, then `posts:retry <id>` (retries only the failed platforms; check `posts:get` for the outcome). Note: `posts:publish` refuses failed posts; retry is the correct command |
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
| `posts:recent-platform` | Fetch recent posts **live** from the connected platform APIs, including content published outside OmniSocials. Use when `posts:list` is empty (brand-new workspace). Returns each post's platform-native `id` (the stable de-dupe key for storing posts), a `permalink`, the full caption, format, timestamps, normalized engagement, and every raw metric the platform exposes as an exact integer (Instagram includes reach/views/saves/shares from per-post insights). Records also carry `duration_seconds` (integer, nullable): video length in whole seconds where the platform's listing API reports it — currently TikTok and YouTube; `null` for images and platforms that don't expose it (Instagram's media API has no duration field). Add `--json` for the full, untruncated captions + exact metrics + ids + permalinks (the human table truncates/rounds). LinkedIn personal profiles can't be listed live (LinkedIn grants apps no such permission), so `linkedin` results are posts published through OmniSocials with their latest collected stats; TikTok photo posts are backfilled the same way. Flags: `--limit` (1-50, default 25; X defaults to 10 unless set explicitly — its API bills per returned post), `--platforms` (comma-separated filter). X results may come from a snapshot up to 24h old, refreshed right after publishing to X through OmniSocials. Requires the `analytics:read` scope. |
| `posts:create` | Create a new post. Flags: `--text`, `--channels`, `--schedule`, `--type post\|story\|reel`, `--media-ids`, `--media-urls`, `--link-url` (+`--link-title`/`--link-description`/`--link-thumbnail-url`), `--location-id`, `--collaborators`, `--user-tags`, `--x-thread`, plus platform flags |
| `posts:create-and-publish` | Create and publish immediately. Same flags as `posts:create` except `--schedule` |
| `posts:update <id>` | Update a draft or scheduled post. Same flags as `posts:create` |
| `posts:publish <id>` | Publish a draft/scheduled post now. Refuses posts whose status is `failed` or `warning`; use `posts:retry` for those |
| `posts:retry <id>` | Retry the failed platforms of a failed or partially failed post; succeeded platforms are never re-published; async, max 3 retries per platform. The response means the retry is queued: poll `posts:get` for the outcome. After 3 retries on a platform the API returns `max_retries_reached` and the post must be recreated. Post responses carry `retry_of` (the failed post this one retries) and `retries` (retry posts created from this one); a `published` post with empty `published_urls` and `retries` set is a resolved failure whose live URLs are on the retry post |
| `posts:delete <id>` | Delete a post (cannot be undone) |

### Media

| Command | Description |
|---|---|
| `media:list` | List uploaded media files. Flags: `--limit`, `--offset` |
| `media:upload` | Upload media from a URL — image, video, or PDF. Flags: `--url` (required), `--filename` |
| `media:upload-base64` | Upload a local file or base64 data (image, video, or PDF). Flags: `--file <path>` (auto-encodes + infers MIME, incl. `.pdf`) OR `--data` + `--mime-type`; plus `--filename`, `--name` (findable label), `--folder`, `--folder-id` |
| PDF carousels | Upload a **PDF** and it is split into one image slide per page (max 20). The response lists a media ID for every slide — pass **all** of them to `posts:create --media-ids` to post the deck as a carousel. On LinkedIn the slides post as a native swipeable **document**; on Instagram, TikTok, Threads and Pinterest as an image carousel. Lets you post an existing deck (Canva/PowerPoint/Figma exported to PDF) without exporting each slide by hand. |
| `media:check` | Check whether media fits target platforms before posting. Flags: `--url`, or `--media-id`, or `--size-bytes` + `--mime` |
| `media:delete <id>` | Delete a media file |

### Folders

| Command | Description |
|---|---|
| `folders:list` | List media folders (id, name, parent, item count). Use folder ids with `media:upload-base64 --folder-id`. |
| `folders:create` | Create a folder. Flags: `--name` (required), `--parent-id` (nest under another folder) |

### Hashtag sets

Saved, reusable groups of hashtags per workspace. Apply one at post-create time with `posts:create --hashtag-set "<name>"` — the tags are merged into the captions ONCE (the post stores plain text; editing the set later never changes existing posts). Tags already present in a caption are skipped, and Instagram's 30-hashtag cap fails fast with `hashtag_limit_exceeded`. Add `--hashtag-placement first_comment` to post the tags as the automatic first comment on Instagram / Facebook / LinkedIn / LinkedIn Page / YouTube instead (other channels fall back to the caption), and `--hashtag-platforms instagram,tiktok` to only tag a subset of the post's channels.

| Command | Description |
|---|---|
| `hashtag-sets:list` | List saved sets (id, name, tag count, preview). |
| `hashtag-sets:create` | Save a set. Flags: `--name` (required, unique per workspace), `--tags` (required, e.g. `"#fitness #gym workout"` — `#` optional, deduped case-insensitively, max 100) |
| `hashtag-sets:update <id>` | Rename and/or replace tags. `--tags` replaces the FULL list — pass the complete new list. |
| `hashtag-sets:delete <id>` | Delete a set. Posts that already used it keep their hashtags. |

### Locations

| Command | Description |
|---|---|
| `locations:search "<name>"` | Search Facebook Places for taggable locations (min 2 chars). Returns `location_id` values to pass to `posts:create --location-id` for Instagram place tags. |

### Audio (Instagram Reel music)

| Command | Description |
|---|---|
| `audio:search ["<song/artist>"]` | Search Meta's licensed music catalog for Instagram Reels. No query = currently trending audio; `--type original_sound` searches original sounds. Returns `audio_id` values for `posts:create --instagram-audio-id`. Only tracks licensed for third-party publishing appear (selection can differ from the IG app); needs a Facebook account connected whose Page links the Instagram account. |

### Accounts

| Command | Description |
|---|---|
| `accounts:list` | List all connected social media accounts with channel IDs, platforms, content types, and Pinterest boards |
| `accounts:get <id>` | Get full account details including platform-specific info |

### Analytics

| Command | Description |
|---|---|
| `analytics:post <post-id>` | Get post analytics: impressions, engagements, likes, comments, shares, per-platform stats (thread posts on X/Bluesky/Mastodon are summed across their parts) |
| `analytics:best-times` | Recommended posting slots (day + hour) for one platform, computed from the workspace's own posting history (recency-weighted, outlier-damped, in the account's timezone). Top 3 slots + per-day scores. Under 15 analyzed posts it returns clearly-labeled industry defaults with `posts_needed` — tell the user that. Use before scheduling when no time was specified. Flags: `--platform` (required), `--timezone` (IANA override). Requires `analytics:read`. |
| `analytics:posts <id,id,...>` | Get analytics for up to 100 posts in one call (bulk). Use this instead of looping `analytics:post` to avoid the rate limit. |
| `analytics:overview` | Workspace analytics overview. Flags: `--period 7d\|30d\|90d`, `--start-date YYYY-MM-DD`, `--end-date YYYY-MM-DD` |
| `analytics:accounts` | Account-level analytics (followers, subscribers). Flags: `--platform`, `--date YYYY-MM-DD`. **Metric scope varies by platform — read each row's `note`.** LinkedIn (profile + page) `impressions` are LIFETIME totals across ALL of the account's content (including posts published outside OmniSocials) as of the snapshot date — never compare them to a windowed export like LinkedIn's native 90-day analytics; diff two snapshot dates to measure a window. Some platforms (e.g. Instagram) report no account-level impressions at all. |

### Inbox (Social Inbox)

Read and reply to DMs, comments, and mentions across connected accounts. TikTok is supported for video comments only (no DMs or mentions); TikTok replies are text-only, capped at 150 characters. **Requires the opt-in `inbox:read` / `inbox:write` scopes** — the user enables "Social Inbox access" when creating the API key. If a call returns `insufficient_scope`, tell the user to create a new key with Social Inbox access. `conversation_id` values can contain `:` and `()` (LinkedIn URNs); pass them exactly as returned by `inbox:list` (the CLI URL-encodes them for you). Results are cursor-paginated: when more exist, the CLI prints the `--cursor` value to fetch the next page.

| Command | Description |
|---|---|
| `inbox:list` | List conversations (latest message per conversation). Flags: `--platform instagram\|facebook\|linkedin\|tiktok\|x`, `--type dm\|comment\|mention`, `--unread` (only conversations with unread messages), `--limit`, `--cursor`. Shows participant, unread count, last message, and the related post for comments/mentions. Requires `inbox:read`. |
| `inbox:messages <conversation-id>` | Full message history for one conversation, oldest→newest, each with direction, timestamp, and read/replied state. Flags: `--limit`, `--cursor`. Requires `inbox:read`. |
| `inbox:read <conversation-id>` | Mark a conversation's messages as read. Requires `inbox:write`. |
| `inbox:reply <conversation-id>` | Send a reply. Flags: `--text` (required), `--attachment-url`, `--attachment-type`. Requires `inbox:write`. |

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
| `--instagram-cover-url` | Reel cover image URL (with `--instagram-thumbnail-type from-library`) |
| `--instagram-thumbnail-type` | Thumbnail type: `from-video` or `from-library` |
| `--instagram-thumb-offset` | Reel cover frame timestamp in **milliseconds** from the video start (e.g. `3000` = 0:03; with `--instagram-thumbnail-type from-video`). `posts:get` reads it back |
| `--instagram-audio-id` | Licensed music for the reel — an `audio_id` from `audio:search`. **Reels only** (Meta's API can't add music to feed posts/carousels/stories). Needs a Facebook account connected whose Page links this Instagram account. |
| `--instagram-audio-volume` | Music volume 0–100 (default 100). Only with `--instagram-audio-id` |
| `--instagram-video-volume` | Video's own audio volume 0–100 (default 100; `0` = music-only reel) |
| `--instagram-trial-reel` | Publish the reel as a **Trial Reel** — shown to non-followers first to test performance. ONLY use when the user explicitly asks for a Trial Reel. **Reels only.** Not available on every account: Instagram requires roughly 1,000+ followers and enables the feature per account; ineligible accounts fail at publish with a clear error. |
| `--instagram-trial-graduation-strategy` | How a Trial Reel graduates to all followers: `MANUAL` (default — the user decides in the Instagram app) or `SS_PERFORMANCE` (Instagram shares it automatically if it performs well). Only with `--instagram-trial-reel` |

#### Auto first comment (Instagram, Facebook, LinkedIn, YouTube)
Posts the given text as the first comment automatically, right after the post publishes. Common for keeping hashtags or a link out of the main caption. One flag per channel, so you can set a different first comment per platform in the same call. Not posted for stories.

| Flag | Description |
|---|---|
| `--instagram-first-comment` | First comment on the Instagram post/reel (max 2200 chars) |
| `--facebook-first-comment` | First comment on the Facebook post. **Page posts only** (the API cannot comment on personal profiles) |
| `--linkedin-first-comment` | First comment on the LinkedIn profile post (max 1250 chars). Handy for "link in first comment" |
| `--linkedin-page-first-comment` | First comment on the LinkedIn company page post (max 1250 chars) |
| `--youtube-first-comment` | First comment on the YouTube video (max 10000 chars). The video must allow comments |

#### LinkedIn poll
Non-sponsored poll (LinkedIn's Poll API) — a question with 2-4 answer options and a duration, **independent per channel**: `linkedin` (personal profile) and `linkedin_page` (company page) can each carry their own poll, or none. Mutually exclusive with media and a link share on that channel's post: if the channel's post also has media/a link, the poll silently wins at publish time, so don't combine them.

| Flag | Description |
|---|---|
| `--linkedin-poll-json` | Full `linkedin_poll` JSON object keyed by channel: `{"linkedin": {"question": "...", "options": ["...", "..."], "duration": "ONE_DAY\|THREE_DAYS\|SEVEN_DAYS\|FOURTEEN_DAYS"}, "linkedin_page": {...}}`. Each poll's `question` max 140 chars; `options` needs 2-4 entries, each max 30 chars. Omit a channel's key (or set it to `null`) to leave that channel a normal post. |

Also works on `posts:update <id>` — the stored `linkedin_poll` object is replaced wholesale (both channels), so send the full desired state. Set a channel's key to `null` (or pass `--linkedin-poll-json 'null'` for the whole flag) to clear that channel's poll and revert it to a normal post.

```bash
# Same poll on the profile only
omnisocials posts:create \
  --content "What should we build next?" \
  --accounts your-linkedin-account-id \
  --linkedin-poll-json '{"linkedin":{"question":"What should we build next?","options":["Mobile app","Public API","More integrations"],"duration":"SEVEN_DAYS"}}'

# A DIFFERENT poll on the profile and the page in one call
omnisocials posts:create \
  --content "What should we build next?" \
  --accounts your-linkedin-profile-account-id,your-linkedin-page-account-id \
  --linkedin-poll-json '{"linkedin":{"question":"What should WE build?","options":["A","B"],"duration":"SEVEN_DAYS"},"linkedin_page":{"question":"What should our COMPANY build?","options":["A","B","C"],"duration":"FOURTEEN_DAYS"}}'
```

#### TikTok
| Flag | Description |
|---|---|
| `--tiktok-privacy` | Privacy: `PUBLIC_TO_EVERYONE`, `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR`, `SELF_ONLY` |
| `--tiktok-disable-comment` | Disable comments |
| `--tiktok-disable-duet` | Disable duets |
| `--tiktok-disable-stitch` | Disable stitches |
| `--tiktok-video-cover-timestamp-ms` | Video only. Timestamp (ms) of the frame to use as the cover |
| `--tiktok-is-aigc` | Mark as AI-generated content |
| `--tiktok-brand-content-toggle` | Paid partnership promoting a third-party brand |
| `--tiktok-brand-organic-toggle` | Promoting your own business / brand |
| `--tiktok-auto-add-music` | Photo carousels only. TikTok auto-selects a soundtrack |

#### Google Business Profile
| Flag | Description |
|---|---|
| `--google-business-cta-action` | CTA button under the post: `LEARN_MORE`, `BOOK`, `ORDER`, `SHOP`, `SIGN_UP`, `CALL`. **GBP captions reject inline links and phone numbers** — the CTA button is the ONLY way to attach either, so when the user wants a link on a Google Business post, use this |
| `--google-business-cta-url` | CTA target URL, `http(s)://`. Required for every action except `CALL` (which uses the location's phone number from the business profile) |
| `--google-business-topic-type` | Post type: `STANDARD` (default), `EVENT`, `OFFER` |
| `--google-business-json` | Full `google_business` JSON object for the EVENT/OFFER shapes (`event.title` + `event.schedule` with Google's split `{year,month,day}`/`{hours,minutes}` dates; `offer.couponCode`/`redeemOnlineUrl`/`termsConditions`). Merged over the other `--google-business-*` flags |

All four also work on `posts:update <id>` to add or change the CTA on a draft/scheduled post (the stored `google_business` object is replaced wholesale, so send the full shape).

#### X (Twitter)
| Flag | Description |
|---|---|
| `--x-reply-settings` | Who can reply: `following` or `mentionedUsers` (empty string = everyone) |
| `--x-thread "a \|\| b \|\| c"` | Post a thread. Parts are split on `\|\|` (2–25 parts). For per-tweet media, build the post with `--json` and a full `x.thread_parts` array instead. |
| `--bluesky-thread "a \|\| b \|\| c"` | Post a Bluesky thread. Parts are split on `\|\|` (2–25 parts, each ≤ 300 chars). Links, mentions and hashtags become clickable automatically. For per-post media, build the post with `--json` and a full `bluesky.thread_parts` array instead. |
| `--mastodon-thread "a \|\| b \|\| c"` | Post a Mastodon thread. Parts are split on `\|\|` (2–25 parts, each ≤ 500 chars). Each toot replies to the previous one natively. For per-toot media, build the post with `--json` and a full `mastodon.thread_parts` array instead. |

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

**PDF by URL:** a PDF passed via `--media-urls` (or `media_urls` in the API) is rasterized into one image slide per page (max 20, in order) — on LinkedIn it publishes as a swipeable document, elsewhere as an image carousel. Same behaviour as uploading the PDF via `media:upload`.

**Alt text (accessibility descriptions):** any `media_urls` entry can be an object `{ "url": "...", "alt": "..." }` (and any `media_ids` entry `{ "id": "...", "alt": "..." }`, including thread-part media) instead of a bare string — max 1500 chars. Delivered to Mastodon (media description — the Mastodon community strongly values alt text), Bluesky (embed alt), X (photos/GIFs only, clamped to 1000), Pinterest (fallback for `pinterest.alt_text`), Instagram (`alt_text` on image posts and carousel image slides; not Reels/Stories; clamped to 1000) and LinkedIn (`altText` on images only, single and multi-image; not video/documents); other platforms ignore it. The `--media-urls` flag takes bare URLs only, so call the API directly for alt entries, e.g. a Mastodon post: `{"content": {"default": "Morning ride 🐘"}, "accounts": ["<mastodon_id>"], "media_urls": [{"url": "https://example.com/bike.jpg", "alt": "A red bicycle leaning against a brick wall"}]}`. `posts:get --json` reads alt back on each media item.

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

### Reel with hashtags and a link in the auto first comment
```
./scripts/omnisocials.js posts:create --text "New drop is live" --channels <instagram_id> --type reel --media-urls "https://example.com/reel.mp4" --instagram-first-comment "#reels #newdrop #marketing
link: https://example.com/shop"
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

### Post a Bluesky thread
```
./scripts/omnisocials.js posts:create --channels <bluesky_id> --bluesky-thread "First point || Second point || Wrapping up"
```

### Post a Mastodon thread
```
./scripts/omnisocials.js posts:create --channels <mastodon_id> --mastodon-thread "First point || Second point || Wrapping up"
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

### Triage the social inbox and reply
```
./scripts/omnisocials.js inbox:list --unread --platform instagram
# Returns each conversation with its Conversation: <conversation_id>

./scripts/omnisocials.js inbox:messages "<conversation_id>"
./scripts/omnisocials.js inbox:reply "<conversation_id>" --text "Thanks so much for the kind words!"
./scripts/omnisocials.js inbox:read "<conversation_id>"
```

### Audit a brand-new workspace's existing content (nothing posted via OmniSocials yet)
```
./scripts/omnisocials.js posts:recent-platform --limit 25
./scripts/omnisocials.js posts:recent-platform --platforms instagram,tiktok --json
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
| `max_retries_reached` | A platform on this post already failed 3 retries | Recreate the post with `posts:create` |

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
