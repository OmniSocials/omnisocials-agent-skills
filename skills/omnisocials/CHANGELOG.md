# Changelog

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
