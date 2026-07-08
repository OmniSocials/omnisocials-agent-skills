# Changelog

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
