# Changelog

## 1.17.0 (2026-08-13)

### Added
- **TikTok in the Social Inbox.** The inbox commands now cover TikTok: `inbox:list --platform tiktok` lists comments on your TikTok videos, and `inbox:messages`, `inbox:read`, and `inbox:reply` work on those conversations like any other platform. TikTok is video comments only (no DMs or mentions), and TikTok replies are text-only, capped at 150 characters. Same opt-in `inbox:read` / `inbox:write` scopes as the rest of the inbox.

### Fixed
- **The inbox `--platform` flag doc was missing `x`.** X conversations have been supported all along; the documented list now reads `instagram|facebook|linkedin|tiktok|x`.

## 1.16.0 (2026-08-12)

### Added
- **LinkedIn polls.** New `--linkedin-poll-json` flag on `posts:create`, `posts:create-and-publish`, and `posts:update`: takes the full `linkedin_poll` object keyed by channel — `{"linkedin": {"question", "options": [2-4 entries], "duration": "ONE_DAY"|"THREE_DAYS"|"SEVEN_DAYS"|"FOURTEEN_DAYS"}, "linkedin_page": {...}}` — for a non-sponsored LinkedIn poll (question max 140 chars, each option max 30 chars). `linkedin` (personal profile) and `linkedin_page` (company page) each carry an **independent** poll — set both keys to post a different poll to each. Mutually exclusive with media and a link share on that channel's post — combining them lets the poll silently win at publish time, so don't send both. On update the object is replaced wholesale (send the full desired state for both channels); set a channel's key to `null` (or pass `--linkedin-poll-json 'null'` for the whole flag) to clear that channel's poll and revert it to a normal post.

## 1.15.0 (2026-08-04)

### Fixed
- **Engagement totals now match the dashboard.** `analytics:post` and `analytics:posts` computed engagement inline as likes + comments + shares, silently dropping LinkedIn link clicks and X quotes/bookmarks — the same post could report different engagement here than in the OmniSocials app. Both commands now use the same normalization as the dashboard, public API overview, and MCP servers (LinkedIn engagement includes link clicks, matching LinkedIn's own definition; X includes quotes and bookmarks; Instagram prefers `views` over `reach` for the exposure count).

### Docs
- **Account-level metric semantics.** `analytics:accounts` output for LinkedIn (profile and page) reports `impressions` as LIFETIME cumulative totals across all of the account's content — including posts published outside OmniSocials — as of the snapshot date, not a daily or windowed count. Rows carry an explanatory `note` and `impressions_period: "lifetime"` (after the backend deploys). Never compare these to a windowed export such as LinkedIn's native 90-day analytics; diff two snapshot dates instead.

## 1.14.0 (2026-08-02)

### Added
- **Google Business Profile options.** New flags on `posts:create`, `posts:create-and-publish`, and `posts:update`: `--google-business-cta-action` (`LEARN_MORE`, `BOOK`, `ORDER`, `SHOP`, `SIGN_UP`, `CALL`) + `--google-business-cta-url` attach the CTA button — the only way to put a link or phone number on a GBP post, since GBP captions reject both; `--google-business-topic-type` picks `STANDARD`/`EVENT`/`OFFER`; and `--google-business-json` takes the full `google_business` object for the JSON-heavy EVENT/OFFER shapes. On update the stored object is replaced wholesale, so send the full shape.

## 1.13.0 (2026-08-02)

### Docs
- **Alt text now also delivered to Instagram and LinkedIn.** Per-media `alt` additionally publishes to Instagram (`alt_text` on image posts and carousel image slides; Reels and Stories not supported by Instagram; clamped to Instagram's 1000-char cap) and LinkedIn (`altText` on images only, single and multi-image; video and documents not supported by LinkedIn) — on top of the existing Mastodon/Bluesky/X/Pinterest delivery. Same entry shapes as before; no CLI changes needed.

### Added
- **`posts:recent-platform` records now include `duration_seconds`** (integer, nullable): the video length in whole seconds where the platform's listing API reports it — currently TikTok and YouTube; `null` for images and for platforms that don't expose a duration (Instagram's media API has no duration field). The human table shows it as `m:ss` next to the format (e.g. `video (1:35)`); `--json` carries the raw integer.

## 1.12.0 (2026-07-27)

### Docs
- **Per-media alt text.** Documented the API's media entry objects: any `media_urls` entry can be `{ "url": "...", "alt": "..." }` and any `media_ids` entry `{ "id": "...", "alt": "..." }` (max 1500 chars, thread-part media included) to attach an accessibility description. Delivered to Mastodon (media description), Bluesky (embed alt), X (photos/GIFs, clamped to 1000) and Pinterest (`pinterest.alt_text` fallback). The `--media-urls`/`--media-ids` flags still take bare values — call the API directly for alt entries.

### Added
- **Retry failed platforms.** New command: `posts:retry <id>` retries ONLY the failed platforms of a post whose status is `failed` or `warning` (partially failed), on the same post; platforms that already succeeded are never re-published (`posts:publish` refuses failed posts, so retry is the correct command for them). Asynchronous: a success response means the retry is queued, so poll `posts:get` for the outcome. Max 3 retries per platform; after that the API returns `max_retries_reached` and the post must be recreated. Post responses now also carry two optional fields, `retry_of` (the failed post this one retries) and `retries` (retry posts created from this one), which `posts:list` prints when present; a `published` post with empty `published_urls` and `retries` set is a resolved failure whose live URLs are on the retry post.
- **Hashtag sets.** Save reusable, named groups of hashtags per workspace and apply one to a new post in a single call. Four new commands: `hashtag-sets:list`, `hashtag-sets:create --name "Brand" --tags "#a #b #c"` (`#` optional, deduped case-insensitively, max 100 tags), `hashtag-sets:update <id>` (`--tags` replaces the full list), and `hashtag-sets:delete <id>`. Apply a set at create time with `posts:create --hashtag-set "<name>"` — tags merge into the captions once (existing posts never change when a set is edited), tags already present in a caption are skipped, and Instagram's 30-hashtag cap fails fast with `hashtag_limit_exceeded`. Add `--hashtag-placement first_comment` to post the tags as the automatic first comment on comment-capable channels, and `--hashtag-platforms instagram,tiktok` to target a subset of the post's channels.

## 1.11.1 (2026-07-26)

### Docs
- Documented the two Instagram Reel cover flags that already worked but were missing from the CLI help text and the SKILL.md flag table: `--instagram-thumbnail-type` (`from-video` / `from-library`) and `--instagram-thumb-offset` — the cover frame timestamp in **milliseconds** from the video start (`3000` = 0:03). `posts:get` reads the chosen cover back. No functional changes.

## 1.11.0 (2026-07-19)

### Added
- **Social Inbox.** Read and reply to DMs, comments, and mentions from the CLI. Four new commands: `inbox:list` (list conversations, filter with `--platform instagram|facebook|linkedin`, `--type dm|comment|mention`, `--unread`, and cursor-paginate with `--limit`/`--cursor`), `inbox:messages <conversation-id>` (full message history for one conversation), `inbox:read <conversation-id>` (mark a conversation's messages as read), and `inbox:reply <conversation-id> --text "..."` (reply, with optional `--attachment-url`/`--attachment-type`). Conversation ids that contain `:` and `()` (LinkedIn URNs) are URL-encoded automatically, so paste them straight from `inbox:list`. Requires the **opt-in** `inbox:read` / `inbox:write` scopes — enable "Social Inbox access" when creating the API key.

## 1.10.0

### Added
- **`posts:recent-platform` now returns a `permalink` and the platform's native post `id` per post**, so an agent can store and de-duplicate natively-published posts. `--json` output carries the full untruncated caption and exact-integer metrics (the human table still truncates captions and shows only a snippet). The human view now also prints each post's `id` and permalink.

## 1.9.0 (2026-07-16)

### Fixed
- **Analytics output now shows every metric the platform reported.** `analytics:post` and `posts:recent-platform` used to print a fixed set (impressions, engagements, likes, comments, shares), silently dropping Instagram reach/saves/views, TikTok views, LinkedIn clicks, and any platform `note`. Both commands now render the full per-platform metric set.
- `analytics:post` / `analytics:posts` impressions totals no longer misreport Instagram: the exposure number now prefers the platform's own `impressions`, falling back to `views` then `reach`, instead of relabeling reach as impressions.

### Changed
- `posts:recent-platform` docs: LinkedIn personal profiles can't be listed live (LinkedIn grants apps no such permission) — the API now returns posts published through OmniSocials with their latest collected stats for the `linkedin` platform, and backfills TikTok photo posts the video list omits.

## 1.8.0 (2026-07-13)

### Added
- **Best time to post.** `analytics:best-times --platform <platform> [--timezone <IANA tz>]` returns the top 3 recommended posting slots plus per-day scores, computed from the workspace's own posting history (publish time × engagement, recency-weighted, outlier-damped, bucketed in the account's timezone). With fewer than 15 analyzed posts on the platform the CLI prints clearly-labeled cross-industry defaults and how many more posts unlock personal recommendations. Requires the `analytics:read` scope.

### Changed
- `posts:recent-platform` docs: Instagram posts now include reach/views/saves/shares from per-post insights (API-side improvement).
- PDF support documented for `--media-urls`: a PDF URL is rasterized into one image slide per page (max 20, in order) — LinkedIn publishes it as a swipeable document, other platforms as an image carousel.

## 1.7.0 (2026-07-09)

### Added
- Set an **automatic first comment** from the CLI. New per-platform flags on `posts:create`, `posts:create-and-publish`, and `posts:update`: `--instagram-first-comment`, `--facebook-first-comment`, `--linkedin-first-comment`, `--linkedin-page-first-comment`, and `--youtube-first-comment`. The text is posted as the first comment right after the post publishes, so you can keep hashtags or a link out of the main caption (e.g. `--instagram-first-comment "#reels #marketing\nlink: https://example.com"`). Facebook works on Page posts only; first comments are not posted for stories, and YouTube requires the video to allow comments.

### Fixed
- `--help` / `--version` now report the correct version (the CLI version string had lagged behind the package version).

## 1.6.0 (2026-07-08)

### Added
- Post threads on **Bluesky** and **Mastodon** from the CLI. `posts:create --bluesky-thread "part 1 || part 2 || part 3"` and `posts:create --mastodon-thread "..."` split the text on `||` into a chained thread, the same form as `--x-thread` (2–25 parts; 300 chars each on Bluesky, 500 on Mastodon). Links, mentions, and hashtags become clickable automatically. For per-part media, build the post with `--json` and a full `thread_parts` array instead.

### Changed
- `analytics:post` and `analytics:posts` now report correct per-platform totals for thread posts. A thread's parts are summed server-side, so the numbers match the OmniSocials app instead of showing a single part.

## 1.5.0 (2026-07-05)

### Added
- Upload a **PDF** as a carousel. `media:upload --url <pdf>` and `media:upload-base64 --file deck.pdf` now accept PDFs: the server splits the document into one image slide per page (max 20) and returns a media ID for every slide. Pass all of them to `posts:create --media-ids` to post the deck as a carousel. On LinkedIn the slides post as a native swipeable **document**; on Instagram, TikTok, Threads and Pinterest as an image carousel. Lets you post an existing deck (Canva/PowerPoint/Figma exported to PDF) without exporting each slide by hand.

## 1.4.0 (2026-07-04)

### Added
- Post responses now include `app_url`, a deep link that opens the post inside the OmniSocials app (composer for drafts/scheduled, details view for published), correct for the environment. `posts:create`, `posts:create-and-publish`, `posts:list`, and `posts:get` print it as "Open in OmniSocials" so you can hand the user a clickable link to review a draft.

## 1.3.0 (2026-07-04)

### Added
- `posts:recent-platform` command. Fetches recent posts live from the connected platform APIs (including content published outside OmniSocials), so brand-new workspaces with no OmniSocials posts yet can still be analyzed. Returns captions, format, timestamps, and normalized engagement/impressions where the platform exposes them. Flags: `--limit` (1-50, default 25), `--platforms`. Requires the `analytics:read` scope.

## 1.0.0 (2026-04-06)

Initial release of OmniSocials agent skills.

### Features
- Full CLI for OmniSocials API (22 commands)
- Posts: create, schedule, update, publish, delete across 10 platforms
- Support for posts, stories, and reels with platform-specific options
- Media upload from URL (max 50MB)
- Analytics: post-level, workspace overview, account-level
- Webhook management with secret rotation
- Platform-specific flags: Pinterest boards, YouTube metadata, TikTok privacy, Instagram covers, X reply settings
- Config management: env var, project-local, and global config files
- Interactive and non-interactive setup
- Human-friendly and JSON output modes
