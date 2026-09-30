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
   - Stories: ALWAYS require an image or video. A story takes 1 to 10 media items; EACH item is one slide, published as its own story on Instagram/Facebook in the order given (more than 10 returns 400). Story videos are max 60s per slide. Ask the user which media and in what order.
   - Reels: ALWAYS require a video
   - Instagram posts: ALWAYS require at least one image or video
   - TikTok posts: ALWAYS require at least one image or video
   - Pinterest posts: ALWAYS require an image AND a `--pinterest-board-id`
   - Other platforms (LinkedIn Profile, LinkedIn Page, X, Facebook posts, Bluesky, Threads, Mastodon, Google Business): Media is optional
   - **Per-platform media caps** (exceeding returns a 400 validation_error stating the exact limit): max items — X/Bluesky/Mastodon ≤4, Instagram/Threads ≤10, TikTok ≤35 photos; the same caps apply per part of a thread (4 per part on X/Bluesky/Mastodon, 10 per part on Threads). Mixing images + video in one post: allowed on Instagram/Threads (mixed carousels), rejected on Facebook/LinkedIn/LinkedIn Page/X/Bluesky/Mastodon/TikTok (images only, or a single video). Video duration/size — **X 140s (2min 20s) / 512MB on free/Basic accounts; 125min / 16GB when the connected X account has Premium or Premium+** (tier auto-detected from the connection; reconnect X after upgrading), Bluesky 180s, Threads 5min, Instagram 15min, TikTok 10min, YouTube Short 3min. If the user's video is over the cap, tell them the limit so they can trim it.
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
| "Post a thread to Threads" | `posts:create --channels <threads_id> --threads-thread "part 1 || part 2 || part 3"` |
| "Tag a location on Instagram" | `locations:search "<place name>"`, then `posts:create ... --location-id <id>` |
| "Tag a location on Threads" | `locations:search "<place name>" --platform threads`, then `posts:create ... --threads-location-id <id>` (rolling out) |
| "Post a reel with music" | `audio:search "<song or artist>"` (no query = trending), then `posts:create ... --type reel --instagram-audio-id <id>` |
| "How are my posts doing?" | `analytics:overview --period 7d`, or `analytics:posts <id,id,...>` for many posts at once |
| "Any new DMs / comments?" | `inbox:list --unread` (add `--platform` / `--type dm\|comment\|mention` to filter; `--unanswered` for only the ones still waiting for a reply). Needs the `inbox:read` scope |
| "Work through what needs answering" / "Answer my inbox" | The `inbox:next` loop: `inbox:next` hands you the next unanswered item (DMs that can still be answered first, then Instagram/Facebook DMs whose 24-hour window has closed, then comments and mentions oldest first) with its thread, the post it is on and its `reply_window`; draft a reply from that and send it with `inbox:reply <conversation-id> --text "..." --next`, whose response already carries the next item. On a comment or mention always add `--message-id <message-id>` (the "Message to answer" id) so the reply lands under that person's comment. When `reply_window.open` is false the DM cannot be answered through the API: tell the user to answer it in the Instagram/Facebook app, or skip it with `inbox:read`. Skip one for good with `inbox:read <conversation-id>`, skip it for this call only with `--exclude <conversation-id>`. Stops when it prints "Nothing is waiting for an answer." Needs `inbox:read` (+ `inbox:write` to reply) |
| "Reply to that message" | `inbox:messages <conversation-id>` to read the thread, then `inbox:reply <conversation-id> --text "..."`. For a comment or mention add `--message-id <message-id>` (the id of the comment being answered, from `inbox:messages` or `inbox:next`): all comments on a post share one conversation and without it the reply goes under the newest comment, which may be a different person. Needs `inbox:write` |
| "Mark that conversation read" | `inbox:read <conversation-id>`. Needs `inbox:write` |
| "Hide that comment" | `inbox:hide <message-id>` (message id from `inbox:messages` or `inbox:next`; Facebook, Instagram, TikTok, YouTube, Threads; `--unhide` reverses; needs `inbox:write`) |
| "Delete that comment" | `inbox:delete <message-id>` (Facebook, Instagram, TikTok comments; cannot be undone, so confirm with the user first; YouTube: use `inbox:hide`; needs `inbox:write`) |
| "Organize my media" | `folders:list` / `folders:create --name "..."`, then upload with `--folder-id <id>` |
| "Add my usual hashtags" | `hashtag-sets:list` to find the set, then `posts:create ... --hashtag-set "<name>"` (add `--hashtag-placement first_comment` to keep tags out of the caption) |
| "Save these hashtags for reuse" | `hashtag-sets:create --name "Brand" --tags "#a #b #c"` |
| "Delete that post" | Confirm with user, then `posts:delete <id>` |
| "Publish my draft" | Confirm with user, then `posts:publish <id>` |
| "Retry my failed post" | `posts:list --status failed` to find it, then `posts:retry <id>` (retries only the failed platforms; check `posts:get` for the outcome). Note: `posts:publish` refuses failed posts; retry is the correct command |
| "Approve/reject that pending post" | `posts:list --status in_approval` to find it, then `posts:approve <id>` or `posts:reject <id> --comment "..."`. Only works if the connected user is a listed approver for the post's current workflow step (returns `forbidden` otherwise) |
| "I want to review posts before they go out" / "Send it to me for approval" | `approval-workflows:list` to find the workflow id, then `posts:create ... --schedule <ISO8601> --approval-workflow <id>`. The post lands as `in_approval`, the approvers are notified, and it publishes at the scheduled time once the last step approves (Approvals page in the dashboard, or `posts:approve`). If no workflow exists, tell the user to create one in the dashboard under Approvals |
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
| `posts:list` | List posts. Flags: `--status draft\|in_approval\|scheduled\|posting\|published\|failed\|warning` (`in_approval` = waiting for a reviewer in an approval workflow), `--limit`, `--offset` |
| `posts:get <id>` | Get full post details |
| `posts:recent-platform` | Fetch recent posts **live** from the connected platform APIs, including content published outside OmniSocials. Use when `posts:list` is empty (brand-new workspace). Returns each post's platform-native `id` (the stable de-dupe key for storing posts), a `permalink`, the full caption, format, timestamps, normalized engagement, and every raw metric the platform exposes as an exact integer (Instagram includes reach/views/saves/shares from per-post insights; TikTok includes average_time_watched/full_video_watched_rate/total_time_watched/favorites/reach when the workspace enabled TikTok comments). Records also carry `duration_seconds` (integer, nullable): video length in whole seconds where the platform's listing API reports it — currently TikTok and YouTube; `null` for images and platforms that don't expose it (Instagram's media API has no duration field). Add `--json` for the full, untruncated captions + exact metrics + ids + permalinks (the human table truncates/rounds). LinkedIn personal profiles can't be listed live (LinkedIn grants apps no such permission), so `linkedin` results are posts published through OmniSocials with their latest collected stats; TikTok photo posts are backfilled the same way. Flags: `--limit` (1-50, default 25; X defaults to 10 unless set explicitly — its API bills per returned post), `--platforms` (comma-separated filter). X results may come from a snapshot up to 24h old, refreshed right after publishing to X through OmniSocials. Requires the `analytics:read` scope. |
| `posts:create` | Create a new post. Flags: `--text`, `--channels`, `--schedule`, `--type post\|story\|reel`, `--media-ids`, `--media-urls`, `--link-url` (+`--link-title`/`--link-description`/`--link-thumbnail-url`), `--location-id`, `--collaborators`, `--user-tags`, `--x-thread`, `--bluesky-thread`, `--mastodon-thread`, `--threads-thread`, `--threads-location-id`, `--video-cover-json`, plus platform flags |
| `posts:create-and-publish` | Create and publish immediately. Same flags as `posts:create` except `--schedule` |
| `posts:update <id>` | Update a draft or scheduled post. Same flags as `posts:create`. `--schedule` on a post pending approval (`in_approval`) moves only the time and does not change its status |
| `posts:publish <id>` | Publish a draft/scheduled post now. Refuses posts whose status is `failed` or `warning`; use `posts:retry` for those |
| `posts:retry <id>` | Retry the failed platforms of a failed or partially failed post; succeeded platforms are never re-published; async, max 3 retries per platform. The response means the retry is queued: poll `posts:get` for the outcome. After 3 retries on a platform the API returns `max_retries_reached` and the post must be recreated. Post responses carry `retry_of` (the failed post this one retries) and `retries` (retry posts created from this one); a `published` post with empty `published_urls` and `retries` set is a resolved failure whose live URLs are on the retry post |
| `posts:approve <id>` | Approve the current step of a post's approval workflow (`approval_status: "pending"`, post `status: "in_approval"`). The connected user must be a listed approver for the CURRENT step — steps approve in order, so being an approver on a later step returns `forbidden` until earlier steps clear. If this is the last step, the post finalizes immediately (`scheduled` or `posting`); otherwise it stays `in_approval` and the next step's approvers are notified |
| `posts:reject <id>` | Reject a post's approval workflow. Same approver requirement as `posts:approve`. Unlike approval, this stops the WHOLE workflow immediately (not just the current step) — the post becomes `rejected`. Flag: `--comment "..."` (optional, shown to the requester and other approvers) |
| `approval-workflows:list` | List the approval workflows this workspace can use (id, name, steps with named approvers; `workspace_id` null = company-wide). Workflows are created in the dashboard (Approvals). Pass an id to `posts:create --approval-workflow <id>` (requires `--schedule`, not allowed with `--publish-now`): the post is created as `in_approval`, approvers are notified, and it publishes at the scheduled time once the last step approves. Errors: `404 workflow_not_found`, `400 validation_error` (no `--schedule`, or the workflow has no approvers on step 1) |
| `posts:delete <id>` | Remove a post from OmniSocials (cannot be undone). Never deletes the live post on a platform |

### Media

| Command | Description |
|---|---|
| `media:list` | List uploaded media files. Flags: `--limit`, `--offset` |
| `media:upload` | Upload media from a URL — image, video, or PDF. Flags: `--url` (required), `--filename`, `--name` (findable label), `--folder`, `--folder-id`, `--pdf-mode` |
| `media:upload-base64` | Upload a local file or base64 data (image, video, or PDF). Flags: `--file <path>` (auto-encodes + infers MIME, incl. `.pdf`) OR `--data` + `--mime-type`; plus `--filename`, `--name` (findable label), `--folder`, `--folder-id`, `--pdf-mode` |
| `--pdf-mode` | PDF uploads only. `slides` (default): one image media item per page, one ID each; pass **all** of them to `posts:create --media-ids`. `document`: ONE media item for the whole PDF (`type: document`, pages in `pdf.pages`); pass its single ID in `--media-ids` and the post gets every page in order. Both keep the original file, which LinkedIn receives. Prefer `document` when the user wants one library item for the deck. `media:list --json` shows document items as `type: "document"` |
| PDF carousels | Upload a **PDF** and it is split into one image slide per page (max 20). The response lists a media ID for every slide — pass **all** of them to `posts:create --media-ids` to post the deck as a carousel. The original file is kept (`pdf.id`, `pdf.name`, `pdf.url` in the response; each slide carries `pdf: { id, page, total_pages, ... }`). On LinkedIn the slides post as a native swipeable **document made from that original PDF** (text stays sharp, in-document links work, viewers download the real file, every page is included even past the 20-slide cap) as long as the slides are posted unchanged and in order; on Instagram, TikTok, Threads and Pinterest as an image carousel. Lets you post an existing deck (Canva/PowerPoint/Figma exported to PDF) without exporting each slide by hand. |
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
| `locations:search "<name>"` | Search taggable locations (min 2 chars). Default `--platform instagram` searches Facebook Places and returns `location_id` values for `posts:create --location-id`. `--platform threads` searches Threads locations and returns ids for `posts:create --threads-location-id`; it also accepts `--latitude` + `--longitude` instead of a name. The two id namespaces are DIFFERENT: never pass an Instagram `location_id` as a Threads one or vice versa. Threads location search is rolling out; until Meta approves the permission the API answers `not_available`, and older Threads connections answer `threads_reauth_required` until reconnected. |

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
| `analytics:post <post-id>` | Get post analytics: impressions, reach, engagements, likes, comments, shares, saves, clicks, per-platform stats (thread posts on X/Bluesky/Mastodon/Threads are summed across their parts; rates and averages are averaged). Per platform the raw `metrics` carry everything it reports: link_clicks, profile_visits, follows (follows gained from the post), reactions by type, video keys (video_views, avg_watch_time, total_watch_time, watch_time_percentage, completion_rate, skip_rate, replays, engaged_views), YouTube traffic_sources, TikTok impression_sources/audience_types, Pinterest pin_clicks/outbound_clicks, Instagram story navigation and completion. Items a platform cannot measure (Google Business posts, deleted videos) carry `metrics_unavailable: true` and a `note` instead of zeros. `reach` is absent, never 0, on X, Pinterest, YouTube, Threads, Bluesky, Mastodon and Facebook (Meta retired Facebook post reach in June 2026; its replacement metric returns no data): sum reach only over the platforms that carry it. |
| `analytics:best-times` | Recommended posting slots (day + hour) for one platform, computed from the workspace's own posting history (recency-weighted, outlier-damped, in the account's timezone), blended with when the audience is online where the platform provides it (Instagram, TikTok Business; `basis: own_data_and_audience`, response carries `audience_online`). Top 3 slots + per-day scores. Under 15 analyzed posts it uses the audience-online profile alone (`basis: audience`) or returns clearly-labeled industry defaults with `posts_needed` — tell the user that. Use before scheduling when no time was specified. Flags: `--platform` (required), `--timezone` (IANA override). Requires `analytics:read`. |
| `analytics:posts <id,id,...>` | Get analytics for up to 100 posts in one call (bulk). Use this instead of looping `analytics:post` to avoid the rate limit. |
| `analytics:overview` | Workspace analytics overview. Flags: `--period 7d\|30d\|90d`, `--start-date YYYY-MM-DD`, `--end-date YYYY-MM-DD` |
| `analytics:accounts` | Account-level analytics: followers, following, posts, plus the day values the platform reports for the snapshot date (impressions/views, reach, engagement, profile_views, link_clicks, follows_gained, follows_lost; Google Business calls, direction_requests, website_clicks, average_rating, review_count; Pinterest monthly_views). Rows with day values carry `period: "daily"`. Audience objects when available: `demographics` (+ `demographics_unit`) and `online_followers` (UTC hour to followers online; Instagram and TikTok Business, 100+ followers). Flags: `--platform`, `--date YYYY-MM-DD`. **Metric scope varies by platform — read each row's `note`.** LinkedIn profiles keep a lifetime total under `impressions_lifetime` (all content ever, including posts published outside OmniSocials) and carry `period: "lifetime"` when no daily breakdown is served; never compare a lifetime total to a windowed export. A missing key means the platform does not report it (Bluesky and Mastodon have no views; YouTube day values need the YouTube Analytics scope; TikTok day values need the Business authorization). |

### Inbox (Social Inbox)

Read and reply to DMs, comments, and mentions across connected accounts. Every comment/mention thread carries the post it is on (`post`: id, caption, thumbnail, url, media_type); the CLI prints it above the thread so a reply can be drafted with the post in view. All comments on one post share one conversation, so a reply to a comment or mention must name the comment with `--message-id <message-id>`; without it the API posts the reply under the newest incoming comment on the post, which may be a different person. Instagram and Facebook DMs can only be answered through the API inside Meta's 24-hour messaging window (24 hours after the customer's last message): every served item carries `reply_window` (`open`, `closes_at`), and a reply to a DM whose window has closed answers `422 outside_messaging_window` without sending anything, so that DM is answered from the Instagram/Facebook app or skipped with `inbox:read`. Replies typed in the native apps (the Instagram app, Messenger) are mirrored into the inbox as outgoing messages and count as answers, so a thread a colleague answered on their phone is not served as unanswered, and a DM answered in the app after its window closed is cleared the same way. TikTok is supported for video comments only (no DMs or mentions); TikTok replies are text-only, capped at 150 characters. YouTube is supported for video comments only (no DMs or mentions); YouTube channels are checked for new comments once per day, so a new YouTube comment can take up to a day to appear. Threads is supported for replies on the user's posts (`type: comment`) and mentions (no DMs); replies publish as native Threads replies. Threads connections made before the inbox permissions were added need a one-time reconnect in the dashboard; until then Threads conversations do not appear and Threads replies/hides answer 401 `reauth_required`. Comments on the user's own posts can be hidden with `inbox:hide` on Facebook, Instagram, TikTok, YouTube (moderation status rejected) and Threads (top-level replies only), and deleted for good with `inbox:delete` on Facebook, Instagram and TikTok. **Requires the opt-in `inbox:read` / `inbox:write` scopes**: the user enables "Social Inbox access" when creating the API key. If a call returns `insufficient_scope`, tell the user to create a new key with Social Inbox access. `conversation_id` values can contain `:` and `()` (LinkedIn URNs); pass them exactly as returned by `inbox:list` (the CLI URL-encodes them for you). Results are cursor-paginated: when more exist, the CLI prints the `--cursor` value to fetch the next page.

**Answering the inbox (the `inbox:next` loop).** `inbox:next` returns one item that needs an answer, with the whole thread (oldest first), the post it is on and its `reply_window`, plus how many more are waiting. An item needs an answer when it is the customer's latest DM with no reply after it, or a comment/mention that has not been replied to and is not hidden. The queue is served in three groups: first DMs that can still be answered (Instagram/Facebook DMs inside Meta's 24-hour window, the one whose window closes soonest first, and X DMs, which have no window), then Instagram/Facebook DMs whose 24-hour window has closed (`reply_window.open` is false; the customer is still waiting, but the API cannot answer them: tell the user to reply from the Instagram/Facebook app, or skip the item with `inbox:read`), then comments and mentions, oldest first. `--order newest` reverses the order inside each group. Only unread items are served by default, so `inbox:read <conversation-id>` is the durable way to skip one (it will not come back); `--exclude <id,id>` leaves conversations out of a single call (temporary skip, up to 100); `--include-read` also serves items that were read but never answered. Looks back 30 days. Reply with `inbox:reply <conversation-id> --text "..." --next` and the response already carries the next item, so working through the inbox is one call per answer. On a comment or mention always add `--message-id <message-id>` with the served message id ("Message to answer"): every comment on a post shares one conversation, and without it the reply is posted under the newest comment on the post, which may be a different person than the one you drafted for. The loop ends when the CLI prints "Nothing is waiting for an answer." Two ids matter: the `conversation_id` (what `inbox:reply` / `inbox:read` take) and the message `id` of the unanswered item (what `--message-id`, `inbox:hide` and `inbox:delete` take); the CLI labels both.

| Command | Description |
|---|---|
| `inbox:list` | List conversations (latest message per conversation). Flags: `--platform instagram\|facebook\|linkedin\|tiktok\|youtube\|x\|threads`, `--type dm\|comment\|mention`, `--unread` (only conversations with unread messages), `--unanswered` (only conversations that still need an answer: the customer's latest DM with no reply after it, including Instagram/Facebook DMs whose 24-hour window has closed (they cannot be answered through the API, but the customer is still waiting; `inbox:next` flags them with `reply_window`), or an unreplied, not-hidden comment/mention; native-app replies count as answers; read state is ignored), `--limit`, `--cursor`. Shows participant, unread count, last message, and the related post for comments/mentions. Requires `inbox:read`. |
| `inbox:next` | The next conversation that needs an answer, with its thread (oldest first, every message with its id and direction), the post it is on and its `reply_window` (`{ open, closes_at }`; only Instagram/Facebook DMs have a window, everything else is `open: true, closes_at: null`), plus how many more are waiting. Served in this order: DMs that can still be answered (Meta DMs inside the 24-hour window, soonest to close first, and X DMs), then Instagram/Facebook DMs whose window has closed (`open: false`, `closes_at` says when; the CLI prints "Reply window closed ..." and tells you to answer it in the native app or skip it with `inbox:read`), then comments and mentions oldest first. The served message id is what `--message-id` takes on `inbox:reply`; the CLI prints it with that hint. Flags: `--platform`, `--type dm\|comment\|mention`, `--order oldest\|newest` (reverses the order inside each group), `--include-read` (also serve items marked read but never answered), `--exclude <conversation-id,...>` (leave these out of this call; temporary skip, max 100). Only unread items by default, so `inbox:read` is the durable skip. Looks back 30 days. Prints "Nothing is waiting for an answer." when the queue is empty. Requires `inbox:read`. |
| `inbox:messages <conversation-id>` | Full message history for one conversation, oldest to newest, each with its message id, direction, timestamp, and read/replied/hidden state. Comment threads print the post block (caption, url, thumbnail) first. Flags: `--limit`, `--cursor`. Requires `inbox:read`. |
| `inbox:read <conversation-id>` | Mark a conversation's messages as read. Also the durable skip for `inbox:next` (a read conversation is not served again unless `--include-read`). Requires `inbox:write`. |
| `inbox:reply <conversation-id>` | Send a reply. Flags: `--text` (required), `--message-id <message-id>` (the inbox id of the comment or mention being answered: the "Message to answer" id from `inbox:next`, or a message id from `inbox:messages`; always pass it on comment threads, since every comment on a post shares one conversation and without it the reply is posted under the newest incoming comment, which may be a different person than the one you drafted for; ignored for DMs; `404 not_found` when it is not an incoming message of this conversation, `400 validation_error` when it is not numeric), `--attachment-url`, `--attachment-type`, `--next` (the response also carries the next conversation that needs an answer, printed like `inbox:next` including its `reply_window`, plus the remaining count). Requires `inbox:write`. A `422 outside_messaging_window` means the Instagram/Facebook DM is past Meta's 24-hour window; the API checks this before calling the platform, so nothing was sent: tell the user to answer that DM from the Instagram/Facebook app (native replies are mirrored into the inbox and clear the item) or mark the conversation read with `inbox:read` to skip it; do not retry. A `409 duplicate_reply` means this exact reply already went out to that comment or DM conversation in the last 10 minutes (an earlier call that looked slow or failed did succeed): nothing was sent again, do not retry it, continue with `inbox:next`. A `422 reply_not_allowed` means the platform refuses replies to this item for good (Facebook #1705: the comment sits on a share or boosted copy of the post, or the commenter restricts replies; YouTube: the thread's canReply is false because comments are off on the video or the comment was removed or held for review): the item is dropped from `inbox:next` automatically, tell the user, do not retry. A Threads reply needs the Threads reply permission on the connection; a 401 `reauth_required` means the user must reconnect Threads in the dashboard. |
| `inbox:hide <message-id>` | Hide a comment someone left on one of the user's posts, as the post owner (`--unhide` reverses it). Facebook, Instagram, TikTok, YouTube (hide = moderation status rejected, which also pulls its replies from public view) and Threads (incoming top-level replies only; nested replies return `not_hideable`). Takes the message `id` from `inbox:messages` or `inbox:next`, NOT the conversation id. A hidden comment no longer counts as unanswered. Errors: 403 `reconnect_required` (the account was connected without the moderation permission; reconnect it in the dashboard), 422 `cannot_hide` (Facebook does not let the Page hide this particular comment: the commenter blocked the Page, their account is deactivated or restricted, or the comment sits on a shared copy of the post; retrying never changes it, tell the user and use `inbox:read` if it should stop coming up), 502 `hide_not_applied` (Instagram only: after a hide or unhide the API reads the comment back and returns Instagram's own `hidden` state; when Instagram accepted the call but still reports the comment in the old state, the API answers this and leaves the inbox row unchanged. It happens with comments Instagram lists under "Comments from Facebook" on a reel that is also shared to Facebook: they live on Facebook and Instagram's hide does not reach them. Hide it in the Instagram or Facebook app, do not retry), 429 `quota_exceeded` (YouTube's daily quota; retry after midnight Pacific), 401 `reauth_required`, 404 `account_not_connected`, 502 `platform_error`. Requires `inbox:write`. |
| `inbox:delete <message-id>` | Delete a comment from the platform for good. Facebook, Instagram and TikTok comments only (YouTube: use `inbox:hide` instead). Cannot be undone, so confirm with the user first. Replies under the comment go with it; the response lists them as `removed_reply_ids`. Takes the message `id`, NOT the conversation id. Same error codes as `inbox:hide`. Requires `inbox:write`. |

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
| Instagram | Yes | Yes (1-10 slides, published in order) | Yes | Always (image or video) |
| Facebook | Yes | Yes (1-10 slides, published in order) | Yes | Optional for posts, required for stories/reels |
| LinkedIn (`linkedin`) | Yes | No | No | Optional |
| LinkedIn Page (`linkedin_page`) | Yes | No | No | Optional |
| YouTube | No | No | Yes (Shorts) | Always (video) |
| TikTok | Yes | No | Yes | Always (image or video) |
| X (Twitter) | Yes | No | No | Optional |
| Pinterest | Yes | No | No | Always (image or video + board_id) |
| Bluesky | Yes | No | No | Optional |
| Threads | Yes (single post or a 2-25 part thread via `--threads-thread`; location tag via `--threads-location-id`; inbox replies/mentions via `inbox:*`; location tag still rolling out) | No | No | Optional |
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

A custom thumbnail cannot be set on a Short through OmniSocials: YouTube displays a frame from the video on Shorts (see **Video cover**). The user sets a Shorts thumbnail in YouTube Studio or the YouTube app.

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

#### Auto first comment (Instagram, Facebook, LinkedIn, YouTube, TikTok)
Posts the given text as the first comment automatically, right after the post publishes. Common for keeping hashtags or a link out of the main caption. One flag per channel, so you can set a different first comment per platform in the same call. Not posted for stories.

| Flag | Description |
|---|---|
| `--instagram-first-comment` | First comment on the Instagram post/reel (max 2200 chars) |
| `--facebook-first-comment` | First comment on the Facebook post. **Page posts only** (the API cannot comment on personal profiles) |
| `--linkedin-first-comment` | First comment on the LinkedIn profile post (max 1250 chars). Handy for "link in first comment" |
| `--linkedin-page-first-comment` | First comment on the LinkedIn company page post (max 1250 chars) |
| `--youtube-first-comment` | First comment on the YouTube video (max 10000 chars). The video must allow comments |
| `--tiktok-first-comment` | First comment on the TikTok video (max 150 chars). Needs **comments enabled** on the TikTok channel card (a second TikTok authorization); otherwise the post publishes and `first_comment_result.status` is `failed` with an explanatory error. Video must be public and allow comments. If TikTok returns the final video id a few minutes after publish, the comment posts automatically once it resolves (`first_comment_result.pending` is true meanwhile) |

#### LinkedIn multi-image style
By default a LinkedIn post with 2+ images publishes as LinkedIn's swipeable **PDF document carousel** (the images are rendered into a single PDF document server-side). These flags opt a channel out of that, into a plain multi-image gallery instead. Independent per channel; ignored for 0-1 images, videos, and polls.

| Flag | Description |
|---|---|
| `--linkedin-carousel-as-images` | `true` = the profile post's images publish as a plain image gallery. On `posts:update`, `false` reverts to the document carousel; omitted keeps the current value |
| `--linkedin-page-carousel-as-images` | Same for the company page post |

#### LinkedIn document source (original PDF)
When a channel's images are exactly the rendered pages of one uploaded PDF, in order and unchanged, LinkedIn receives the **kept original PDF file** as the document by default (sharp text, working in-document links, the real download, every page even past the 20-slide cap). These flags opt a channel out of that, into a document rebuilt from the slide images (a flattened copy). Ignored when the images are not a PDF's pages, when `--linkedin-carousel-as-images` is true, and for 0-1 images, videos and polls.

| Flag | Description |
|---|---|
| `--linkedin-document-source` | `original_pdf` (default) or `slides`. On `posts:update`, `original_pdf` reverts to the default; omitted keeps the current value |
| `--linkedin-page-document-source` | Same for the company page post |

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

#### Video cover
The thumbnail of a post whose media is **one video** (feed video or reel). One object for every platform that takes a cover: Instagram, Facebook, LinkedIn Profile and Page, TikTok and Pinterest.

| Flag | Description |
|---|---|
| `--video-cover-json` | Full `video_cover` JSON object: `{"type": "frame", "thumb_offset": 3000}` (milliseconds into the video) or `{"type": "custom", "cover_url": "https://..."}` (JPEG/PNG), plus an optional `"overrides"` object keyed by platform (`instagram`, `facebook`, `linkedin`, `linkedin_page`, `tiktok`, `pinterest`, `youtube`) that wins over the base cover for that platform |

- **TikTok only takes a frame.** A `custom` cover is skipped there, so add `"overrides": {"tiktok": {"type": "frame", "thumb_offset": 2000}}` when the user wants a specific TikTok frame.
- **Not shown on YouTube Shorts.** YouTube stores the cover as the video's default thumbnail, but displays a frame from the video on the Shorts tab, in the Shorts feed and in link previews. Do not promise a custom Shorts thumbnail: the user sets one in YouTube Studio or picks a frame in the YouTube app.
- The older per-platform flags (`--instagram-cover-url`, `--instagram-thumb-offset`, `--tiktok-video-cover-timestamp-ms`, `--pinterest-video-cover`) keep working and win over the base cover for their platform.
- On `posts:update <id>` the stored cover is replaced wholesale; pass `--video-cover-json null` to remove it. `posts:get` returns it as `video_cover`.

```bash
# One custom cover everywhere, a chosen frame on TikTok
omnisocials posts:create \
  --text "New tutorial" \
  --channels <instagram_id>,<facebook_id>,<tiktok_id> \
  --type reel \
  --media-urls "https://example.com/video.mp4" \
  --video-cover-json '{"type":"custom","cover_url":"https://example.com/cover.jpg","overrides":{"tiktok":{"type":"frame","thumb_offset":2000}}}'
```

#### TikTok
| Flag | Description |
|---|---|
| `--tiktok-title` | Photo carousels only. The title TikTok shows above the caption on Photo Mode posts (max 90 chars). TikTok takes the title and the caption as separate fields; the caption comes from `--text`. Ignored on video posts. `posts:get` returns it as `tiktok.title` |
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
| `--threads-thread "a \|\| b \|\| c"` | Post a Threads (Meta) thread. Parts are split on `\|\|` (2–25 parts, each ≤ 500 chars). Each part is published as a reply to the previous one from the same account; the first part is the post caption. For per-part media (up to 10 items per part, images and videos mixed, `{url, alt}` entries allowed), build the post with `--json` and a full `threads.thread_parts` array instead. On `posts:update`, `threads.thread_parts: null` turns the thread back into a single post. Needs the Threads reply permission: accounts connected before it was added must be reconnected once in the OmniSocials dashboard (the API answers 400 naming the reconnect). |
| `--threads-location-id <id>` | Tag a location on the Threads post. Takes a Threads location id from `locations:search --platform threads` (NOT a Facebook Place ID; never reuse `--location-id` values). On a multi-post thread the tag goes on the first post. On `posts:update`, pass the literal value `null` to remove the tag. Rolling out: needs the Threads location permission (`threads_location_tagging`), which Meta has not approved yet; until then the API returns a 400 saying location tagging is not available yet. Once enabled, older connections must be reconnected once in the OmniSocials dashboard. |

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

**PDF by URL:** a PDF passed via `--media-urls` (or `media_urls` in the API) is rasterized into one image slide per page (max 20, in order) and the original file is kept — on LinkedIn it publishes as a swipeable document made from that original PDF, elsewhere as an image carousel. Same behaviour as uploading the PDF via `media:upload`.

**Alt text (accessibility descriptions):** any `media_urls` entry can be an object `{ "url": "...", "alt": "..." }` (and any `media_ids` entry `{ "id": "...", "alt": "..." }`, including thread-part media) instead of a bare string — max 1500 chars. Delivered to Mastodon (media description — the Mastodon community strongly values alt text), Bluesky (embed alt), X (photos/GIFs only, clamped to 1000), Pinterest (fallback for `pinterest.alt_text`), Instagram (`alt_text` on image posts and carousel image slides; not Reels/Stories; clamped to 1000), LinkedIn (`altText` on images only, single and multi-image; not video/documents), and Threads (`alt_text` on every image and video, including carousel items and thread parts); other platforms ignore it. The `--media-urls` flag takes bare URLs only, so call the API directly for alt entries, e.g. a Mastodon post: `{"content": {"default": "Morning ride 🐘"}, "accounts": ["<mastodon_id>"], "media_urls": [{"url": "https://example.com/bike.jpg", "alt": "A red bicycle leaning against a brick wall"}]}`. `posts:get --json` reads alt back on each media item.

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

### Post a Threads thread
```
./scripts/omnisocials.js posts:create --channels <threads_id> --threads-thread "First point || Second point || Wrapping up"
```

### Tag an Instagram location
```
./scripts/omnisocials.js locations:search "Blue Bottle Coffee"
# Returns: location_id: 1234567890  Blue Bottle Coffee  — 1 Ferry Building, San Francisco

./scripts/omnisocials.js posts:create --text "Coffee time" --channels <instagram_id> --media-urls "https://example.com/photo.jpg" --location-id 1234567890
```

### Tag a Threads location (rolling out)
```
./scripts/omnisocials.js locations:search "Griffith Observatory" --platform threads
# Returns: threads.location_id: 17841400000000000  Griffith Observatory  (2800 E Observatory Rd, Los Angeles, United States)
# Coordinates also work: locations:search --platform threads --latitude 34.1184 --longitude -118.3004

./scripts/omnisocials.js posts:create --text "Best view in the city" --channels <threads_id> --threads-location-id 17841400000000000
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
./scripts/omnisocials.js inbox:list --unanswered
# Only the conversations still waiting for a reply

./scripts/omnisocials.js inbox:messages "<conversation_id>"
# Comment threads print the post (caption, url, thumbnail) first; every message prints its id
./scripts/omnisocials.js inbox:reply "<conversation_id>" --text "Thanks so much for the kind words!" --message-id "<message_id>"
# --message-id = the id of the comment being answered (all comments on a post share one
# conversation; without it the reply goes under the newest comment); leave it out on a DM
./scripts/omnisocials.js inbox:read "<conversation_id>"

# Hide a comment on your own post (Facebook, Instagram, TikTok, YouTube, Threads),
# using the message id printed by inbox:messages or inbox:next (not the conversation id)
./scripts/omnisocials.js inbox:hide "<message_id>"
./scripts/omnisocials.js inbox:hide "<message_id>" --unhide

# Delete a comment for good (Facebook, Instagram, TikTok; cannot be undone, confirm with the user first)
./scripts/omnisocials.js inbox:delete "<message_id>"
```

### Answer everything that is waiting (the inbox:next loop)
```
./scripts/omnisocials.js inbox:next
# Prints the next unanswered item (DMs that can still be answered first, then Instagram/Facebook
# DMs whose 24-hour window has closed, then comments oldest first): the conversation id, the
# message id to answer, its reply window, the post it is on, the thread oldest first, and
# "N more waiting"

# Reply and get the next item in the same call; repeat until the CLI prints
# "Nothing is waiting for an answer." On a comment or mention always pass --message-id
# with the "Message to answer" id; leave it out on a DM
./scripts/omnisocials.js inbox:reply "<conversation_id>" --text "Sent you a DM with the details!" --message-id "<message_id>" --next

# Skip one for good (marking it read means inbox:next will not serve it again). Also how to
# skip an Instagram/Facebook DM whose reply window is closed ("Reply window closed ..." in the
# output): the API cannot answer it, so reply from the app (that clears it too) or mark it read
./scripts/omnisocials.js inbox:read "<conversation_id>"
# Skip some for this call only
./scripts/omnisocials.js inbox:next --exclude "<conversation_id>,<conversation_id>"
# Narrow the queue, or also take items that were read but never answered
./scripts/omnisocials.js inbox:next --platform instagram --type comment
./scripts/omnisocials.js inbox:next --include-read --order newest
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
