#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");

// ─── Constants ───────────────────────────────────────────────────────────────

const VERSION = "1.31.1";
const DEFAULT_BASE_URL = "https://api.omnisocials.com/v1";
// Channel identifiers accepted by --channels. "linkedin" is a personal profile;
// "linkedin_page" is a company page (both can be connected to one workspace and
// share one OAuth token). Reddit and Snapchat are "coming soon" and not listed.
const PLATFORMS = [
  "instagram",
  "facebook",
  "linkedin",
  "linkedin_page",
  "youtube",
  "tiktok",
  "x",
  "pinterest",
  "bluesky",
  "threads",
  "mastodon",
  "google_business",
];

// ─── Config Resolution ──────────────────────────────────────────────────────

function tryReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function getProjectConfigPath() {
  return path.join(process.cwd(), ".omnisocials", "config.json");
}

function getGlobalConfigPath() {
  return path.join(os.homedir(), ".config", "omnisocials", "config.json");
}

function resolveConfig(flags) {
  // 1. CLI flag
  if (flags["api-key"]) {
    return {
      api_key: flags["api-key"],
      base_url: flags["base-url"] || DEFAULT_BASE_URL,
      source: "--api-key flag",
    };
  }

  // 2. Environment variable
  if (process.env.OMNISOCIALS_API_KEY) {
    return {
      api_key: process.env.OMNISOCIALS_API_KEY,
      base_url: process.env.OMNISOCIALS_BASE_URL || flags["base-url"] || DEFAULT_BASE_URL,
      source: "OMNISOCIALS_API_KEY env var",
    };
  }

  // 3. Project config
  const projectConfig = tryReadJson(getProjectConfigPath());
  if (projectConfig?.api_key) {
    return {
      ...projectConfig,
      base_url: projectConfig.base_url || DEFAULT_BASE_URL,
      source: ".omnisocials/config.json (project)",
    };
  }

  // 4. Global config
  const globalConfig = tryReadJson(getGlobalConfigPath());
  if (globalConfig?.api_key) {
    return {
      ...globalConfig,
      base_url: globalConfig.base_url || DEFAULT_BASE_URL,
      source: "~/.config/omnisocials/config.json (global)",
    };
  }

  return null;
}

// ─── API Client ─────────────────────────────────────────────────────────────

async function apiRequest(config, method, apiPath, body, queryParams) {
  let url = `${config.base_url}${apiPath}`;

  if (queryParams) {
    const entries = Object.entries(queryParams).filter(
      ([, v]) => v !== undefined && v !== null
    );
    if (entries.length) {
      url += `?${new URLSearchParams(entries).toString()}`;
    }
  }

  const headers = {
    Authorization: `Bearer ${config.api_key}`,
    "Content-Type": "application/json",
  };

  const options = { method, headers };
  if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (response.status === 204) {
    return { data: null };
  }

  const json = await response.json();

  if (!response.ok) {
    return {
      error: json.error || {
        code: "api_error",
        message: `Request failed with status ${response.status}`,
      },
    };
  }

  return json;
}

// ─── Argument Parser ────────────────────────────────────────────────────────

// Flags that may be given more than once. Their values are collected in an
// array in the order given (one public-reply variation per --reply). Every
// other flag keeps its last value when repeated.
const REPEATABLE_FLAGS = new Set(["reply", "dm-reply"]);

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] && !args[0].startsWith("-") ? args[0] : null;
  const positional = [];
  const flags = {};

  let i = command ? 1 : 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      // Boolean flags (no value or next arg is also a flag)
      let value;
      if (!next || next.startsWith("--")) {
        value = true;
      } else {
        value = next;
        i++;
      }
      if (REPEATABLE_FLAGS.has(key) && flags[key] !== undefined) {
        flags[key] = [].concat(flags[key], value);
      } else {
        flags[key] = value;
      }
    } else if (!command || positional.length > 0 || !arg.startsWith("-")) {
      positional.push(arg);
    }
    i++;
  }

  return { command, positional, flags };
}

function splitComma(value) {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function exitWithError(message) {
  console.error(message);
  process.exit(1);
}

// ─── Platform Option Assembly ───────────────────────────────────────────────

// --pinterest-product-tags: comma-separated product Pin IDs or Pin links
// (https://www.pinterest.com/pin/<id>/). The values stay strings: a Pin ID has
// 18+ digits and loses its last digits as a number. The API checks the entries
// and the limit of 24; the CLI only refuses a flag without a value.
function splitProductTags(value) {
  const tags = splitComma(value === true ? "" : value);
  if (!tags || !tags.length) {
    exitWithError(
      '--pinterest-product-tags needs a comma-separated list of product Pin IDs or Pin links, e.g. "813744226420795884,813744226420795885" (find them with pinterest:products)'
    );
  }
  return tags;
}

// --media-fit instagram=keep,pinterest=crop: what happens to a feed image
// whose ratio is outside what a channel shows uncropped, per channel. Actions:
// auto (the API's default: Instagram crops a tall or wide image to 4:5 /
// 1.91:1 around the subject because Instagram cuts it to that window anyway
// and Meta cannot boost a feed post outside it; Pinterest keeps a Pin taller
// than 2:3 and reports it), crop, keep. Sent as the top-level `media_fit`
// object; every decision comes back in `warnings` with code image_fit. The
// API validates the same values; the CLI refuses a malformed flag before the
// call so a typo never creates a post with the wrong fit.
const MEDIA_FIT_ACTIONS = ["auto", "crop", "keep"];
function parseMediaFit(value) {
  const usage =
    '--media-fit takes <channel>=<auto|crop|keep> pairs separated by commas, e.g. "instagram=keep,pinterest=crop"';
  const pairs = splitComma(value === true ? "" : String(value));
  if (!pairs || !pairs.length) exitWithError(usage);
  const out = {};
  for (const pair of pairs) {
    const parts = pair.split("=").map((s) => s.trim());
    const [platform, action] = parts;
    if (parts.length !== 2 || !platform || !action) exitWithError(usage);
    if (!PLATFORMS.includes(platform)) {
      exitWithError(`--media-fit: unknown channel "${platform}". ${usage}`);
    }
    if (!MEDIA_FIT_ACTIONS.includes(action)) {
      exitWithError(`--media-fit: "${action}" is not an action for ${platform}. ${usage}`);
    }
    out[platform] = action;
  }
  return out;
}

function assemblePlatformOptions(flags) {
  const platforms = {};

  const mapping = {
    pinterest: {
      "pinterest-board-id": "board_id",
      "pinterest-title": "title",
      "pinterest-link": "link",
      "pinterest-video-cover": "video_cover",
      "pinterest-alt-text": "alt_text",
      // Products to tag on the Pin (max 24, own product Pins only; ids from
      // `pinterest:products`). Tagged right after the Pin is published; a
      // product Pinterest refuses never fails the post.
      "pinterest-product-tags": { key: "product_tags", transform: splitProductTags },
    },
    youtube: {
      "youtube-title": "title",
      "youtube-privacy": "privacy_status",
      "youtube-tags": { key: "tags", transform: splitComma },
      "youtube-category-id": "category_id",
      "youtube-made-for-kids": { key: "made_for_kids", transform: (v) => v === true || v === "true" },
      "youtube-notify-subscribers": { key: "notify_subscribers", transform: (v) => v === true || v === "true" },
      "youtube-contains-synthetic-media": { key: "contains_synthetic_media", transform: (v) => v === true || v === "true" },
      "youtube-first-comment": "first_comment",
    },
    instagram: {
      "instagram-share-to-feed": { key: "share_to_feed", transform: (v) => v === true || v === "true" },
      "instagram-cover-url": "cover_url",
      "instagram-thumbnail-type": "thumbnail_type",
      "instagram-thumb-offset": { key: "thumb_offset", transform: Number },
      // Licensed music for reels — audio_id from `audio:search`.
      "instagram-audio-id": "audio_id",
      "instagram-audio-volume": { key: "audio_volume", transform: (v) => parseInt(v, 10) },
      "instagram-video-volume": { key: "video_volume", transform: (v) => parseInt(v, 10) },
      "instagram-first-comment": "first_comment",
      // Trial Reel — shown to non-followers first. Reels only; needs an
      // eligible account (~1,000+ followers, Meta-gated at publish time).
      "instagram-trial-reel": { key: "is_trial_reel", transform: (v) => v === true || v === "true" },
      "instagram-trial-graduation-strategy": "trial_graduation_strategy",
    },
    // Comment-capable platforms whose only CLI option (so far) is the auto
    // first comment. Posted right after publish — handy for keeping hashtags or
    // a link out of the main caption. Facebook is Page posts only.
    facebook: {
      "facebook-first-comment": "first_comment",
    },
    linkedin: {
      "linkedin-first-comment": "first_comment",
      // Multi-image style: true = plain image gallery instead of the default
      // swipeable PDF document carousel. Ignored for 0-1 images/videos/polls.
      "linkedin-carousel-as-images": { key: "carousel_as_images", transform: (v) => v === true || v === "true" },
      // Document source when the images are the unchanged pages of one
      // uploaded PDF: original_pdf (default, LinkedIn gets the kept file) or
      // slides (document rebuilt from the slide images).
      "linkedin-document-source": "document_source",
    },
    linkedin_page: {
      "linkedin-page-first-comment": "first_comment",
      "linkedin-page-carousel-as-images": { key: "carousel_as_images", transform: (v) => v === true || v === "true" },
      "linkedin-page-document-source": "document_source",
    },
    tiktok: {
      // Photo carousels only: the Photo Mode title TikTok shows above the
      // caption (max 90 chars). Video posts have one caption field; ignored there.
      "tiktok-title": "title",
      "tiktok-privacy": "privacy_level",
      "tiktok-disable-comment": { key: "disable_comment", transform: (v) => v === true || v === "true" },
      "tiktok-disable-duet": { key: "disable_duet", transform: (v) => v === true || v === "true" },
      "tiktok-disable-stitch": { key: "disable_stitch", transform: (v) => v === true || v === "true" },
      "tiktok-video-cover-timestamp-ms": { key: "video_cover_timestamp_ms", transform: (v) => parseInt(v, 10) },
      "tiktok-is-aigc": { key: "is_aigc", transform: (v) => v === true || v === "true" },
      "tiktok-brand-content-toggle": { key: "brand_content_toggle", transform: (v) => v === true || v === "true" },
      "tiktok-brand-organic-toggle": { key: "brand_organic_toggle", transform: (v) => v === true || v === "true" },
      "tiktok-auto-add-music": { key: "auto_add_music", transform: (v) => v === true || v === "true" },
      // Auto first comment via the TikTok Business API (max 150 chars). Needs
      // comments enabled on the TikTok channel card; video must be public.
      "tiktok-first-comment": "first_comment",
    },
    x: {
      "x-reply-settings": "reply_settings",
    },
  };

  // Polls on X, Threads and Mastodon (one JSON object per channel, nested
  // under that channel's options as `poll`; the post text is the question).
  // 'null' on posts:update removes the poll.
  for (const [platform, flag] of [
    ["x", "x-poll-json"],
    ["threads", "threads-poll-json"],
    ["mastodon", "mastodon-poll-json"],
  ]) {
    if (flags[flag] === undefined) continue;
    let parsed;
    try {
      parsed = JSON.parse(flags[flag]);
    } catch {
      exitWithError(
        `--${flag} must be JSON, e.g. '{"options":["A","B"]}' or 'null' to remove the poll`
      );
    }
    if (!platforms[platform]) platforms[platform] = {};
    platforms[platform].poll = parsed;
  }

  for (const [platform, fields] of Object.entries(mapping)) {
    for (const [flag, spec] of Object.entries(fields)) {
      if (flags[flag] !== undefined) {
        if (!platforms[platform]) platforms[platform] = {};
        if (typeof spec === "string") {
          platforms[platform][spec] = flags[flag];
        } else {
          platforms[platform][spec.key] = spec.transform(flags[flag]);
        }
      }
    }
  }

  return platforms;
}

// ─── Comment-to-DM Automations ──────────────────────────────────────────────

// An automation answers a keyword in an Instagram comment (or a DM, or a story
// reply) with a DM, once per person, with an optional public reply under the
// comment. Instagram allows one private reply per comment within 7 days, and
// OmniSocials sends at most 180 DMs an hour per account. The scopes are opt-in
// on the key: without them every call answers 403 insufficient_scope.
const AUTOMATION_MATCHES = ["word", "contains", "any"];
const AUTOMATION_SCOPES = ["post", "next_post", "any"];
const AUTOMATION_KINDS = ["comment", "dm", "story_reply"];
const AUTOMATION_STATUSES = ["active", "paused", "completed"];
const AUTOMATION_EVENT_OUTCOMES = ["sent", "skipped", "failed", "pending"];
const AUTOMATIONS_SCOPE_HINT =
  "Enable Automations on the API key (Settings > API: adds automations:read and automations:write).";

// The value of a flag that needs one; a bare flag is a CLI error.
function requireValue(flag, value) {
  const v = value === true ? "" : String(value).trim();
  if (!v) exitWithError(`${flag} needs a value`);
  return v;
}

// One value out of a fixed list, or a CLI error that names the list.
function pickOneOf(flag, value, allowed) {
  const v = value === true ? "" : String(value).trim();
  if (!allowed.includes(v)) {
    exitWithError(`${flag} must be one of ${allowed.join("|")}${v ? ` (got "${v}")` : ""}`);
  }
  return v;
}

// A comma list of values out of a fixed list (--triggers comment,dm).
function pickSomeOf(flag, value, allowed) {
  const values = splitComma(value === true ? "" : String(value));
  if (!values || !values.length) exitWithError(`${flag} takes a comma list of ${allowed.join("|")}`);
  for (const v of values) {
    if (!allowed.includes(v)) exitWithError(`${flag}: "${v}" is not one of ${allowed.join("|")}`);
  }
  return values;
}

// --keywords "guide,link": up to 20 words of 60 chars; the API checks those.
function splitKeywords(flag, value) {
  const keywords = splitComma(value === true ? "" : String(value));
  if (!keywords || !keywords.length) {
    exitWithError(`${flag} needs a comma-separated list, e.g. ${flag} "guide,link"`);
  }
  return keywords;
}

// --reply "Sent you a DM!" --reply "Check your inbox" (one variation per
// flag, see REPEATABLE_FLAGS) or --reply "Sent you a DM!,Check your inbox" (a
// comma list). A reply that contains a comma goes in a flag of its own.
function splitReplyVariations(flag, value) {
  const variations = Array.isArray(value)
    ? value.map((v) => (v === true ? "" : String(v).trim())).filter(Boolean)
    : splitComma(value === true ? "" : String(value));
  if (!variations || !variations.length) {
    exitWithError(`${flag} needs the text of a public reply, e.g. ${flag} "Sent you a DM!"`);
  }
  return variations;
}

// --max-sends 500: a whole number above zero.
function parseMaxSends(flag, value) {
  const n = value === true ? NaN : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    exitWithError(`${flag} must be a whole number above 0${value === true ? "" : ` (got "${value}")`}`);
  }
  return n;
}

// --stop-at 2026-12-31T00:00:00Z: a time Date.parse understands, sent as given.
function parseStopAt(flag, value) {
  const v = requireValue(flag, value);
  if (Number.isNaN(Date.parse(v))) exitWithError(`${flag} must be an ISO 8601 time, e.g. 2026-12-31T00:00:00Z`);
  return v;
}

// The body of automations:create (every section, the API's defaults spelled
// out) and of automations:update (`partial`: only the sections whose flags
// were given, so the rest stays as stored). Shape:
//   { name, post_id | instagram_media_id,
//     trigger: { kinds, scope, keywords, match },
//     actions: { dm: { text }, public_reply: { enabled, variations } },
//     limits: { max_sends, stop_at }, status }
// `scope` only means something for the comment trigger (post = the post
// named here, next_post = the next Instagram post the workspace publishes,
// any = every post); on create it is sent when a comment trigger is in.
function buildAutomationBody(flags, { partial = false } = {}) {
  const body = {};

  if (flags.name !== undefined) body.name = requireValue("--name", flags.name);

  if (flags["post-id"] !== undefined && flags["instagram-media-id"] !== undefined) {
    exitWithError(
      "Pass --post-id (an OmniSocials post that goes to Instagram) or --instagram-media-id (a post published outside OmniSocials), not both."
    );
  }
  if (flags["post-id"] !== undefined) body.post_id = requireValue("--post-id", flags["post-id"]);
  if (flags["instagram-media-id"] !== undefined) {
    body.instagram_media_id = requireValue("--instagram-media-id", flags["instagram-media-id"]);
  }

  const triggerGiven = ["keywords", "match", "scope", "triggers"].some((f) => flags[f] !== undefined);
  if (!partial || triggerGiven) {
    const trigger = {};
    const kinds =
      flags.triggers !== undefined
        ? pickSomeOf("--triggers", flags.triggers, AUTOMATION_KINDS)
        : partial
          ? undefined
          : ["comment"];
    if (kinds) trigger.kinds = kinds;
    if (flags.scope !== undefined) trigger.scope = pickOneOf("--scope", flags.scope, AUTOMATION_SCOPES);
    else if (!partial && kinds.includes("comment")) trigger.scope = "post";
    if (flags.keywords !== undefined) trigger.keywords = splitKeywords("--keywords", flags.keywords);
    if (flags.match !== undefined) trigger.match = pickOneOf("--match", flags.match, AUTOMATION_MATCHES);
    else if (!partial) trigger.match = "word";
    body.trigger = trigger;

    // A comment trigger on "this post" needs the post; the API would answer
    // 400 post_required, but the fix is a flag, so say so before the call.
    if (
      !partial &&
      trigger.scope === "post" &&
      trigger.kinds.includes("comment") &&
      body.post_id === undefined &&
      body.instagram_media_id === undefined
    ) {
      exitWithError(
        "A comment automation on a post needs the post: pass --post-id <id> (an OmniSocials post that goes to Instagram) or --instagram-media-id <id> (a post published outside OmniSocials), or pick --scope next_post or --scope any."
      );
    }
  }

  if (!partial && flags.dm === undefined) {
    exitWithError('--dm "<text>" is required: the DM the automation sends (max 1000 chars)');
  }
  if (flags.dm !== undefined || flags.reply !== undefined) {
    const actions = {};
    if (flags.dm !== undefined) actions.dm = { text: requireValue("--dm", flags.dm) };
    if (flags.reply !== undefined) {
      actions.public_reply = { enabled: true, variations: splitReplyVariations("--reply", flags.reply) };
    }
    body.actions = actions;
  }

  if (flags["max-sends"] !== undefined || flags["stop-at"] !== undefined) {
    const limits = {};
    if (flags["max-sends"] !== undefined) limits.max_sends = parseMaxSends("--max-sends", flags["max-sends"]);
    if (flags["stop-at"] !== undefined) limits.stop_at = parseStopAt("--stop-at", flags["stop-at"]);
    body.limits = limits;
  }

  const isOn = (v) => v === true || v === "true";
  if (partial) {
    const pause = isOn(flags.pause) || isOn(flags.paused);
    const resume = isOn(flags.resume);
    if (pause && resume) exitWithError("Pass --pause or --resume, not both.");
    if (pause) body.status = "paused";
    if (resume) body.status = "active";
  } else if (isOn(flags.paused)) {
    body.status = "paused";
  }

  return body;
}

// --dm-keywords / --dm-message / --dm-reply / --dm-match / --dm-max-sends /
// --dm-stop-at on posts:create, posts:create-and-publish and posts:update
// build the post's `comment_dm_automation`: the automation bound to this
// post (Instagram must be in --channels; it starts listening once the post is
// live on Instagram). Its shape is the create body without post, scope,
// kinds, name and status. posts:update --no-dm sends null, which removes it.
// Returns undefined when no flag was given, so the key stays out of the body.
const POST_DM_FLAGS = ["dm-keywords", "dm-message", "dm-reply", "dm-match", "dm-max-sends", "dm-stop-at"];
function buildPostCommentDm(flags) {
  const given = POST_DM_FLAGS.filter((f) => flags[f] !== undefined);
  if (flags["no-dm"] === true) {
    if (given.length) {
      exitWithError(`--no-dm removes the post's comment-to-DM automation and cannot go with --${given[0]}`);
    }
    return null;
  }
  if (!given.length) return undefined;

  const match = flags["dm-match"] !== undefined ? pickOneOf("--dm-match", flags["dm-match"], AUTOMATION_MATCHES) : "word";
  if (flags["dm-message"] === undefined) {
    exitWithError('A comment-to-DM automation needs the DM: pass --dm-message "<text>" next to --dm-keywords');
  }
  if (flags["dm-keywords"] === undefined && match !== "any") {
    exitWithError(
      'A comment-to-DM automation needs its keywords: pass --dm-keywords "guide,link" next to --dm-message (or --dm-match any to answer every comment)'
    );
  }

  const trigger = { match };
  if (flags["dm-keywords"] !== undefined) trigger.keywords = splitKeywords("--dm-keywords", flags["dm-keywords"]);
  const actions = { dm: { text: requireValue("--dm-message", flags["dm-message"]) } };
  if (flags["dm-reply"] !== undefined) {
    actions.public_reply = { enabled: true, variations: splitReplyVariations("--dm-reply", flags["dm-reply"]) };
  }
  const automation = { trigger, actions };
  if (flags["dm-max-sends"] !== undefined || flags["dm-stop-at"] !== undefined) {
    automation.limits = {};
    if (flags["dm-max-sends"] !== undefined) {
      automation.limits.max_sends = parseMaxSends("--dm-max-sends", flags["dm-max-sends"]);
    }
    if (flags["dm-stop-at"] !== undefined) automation.limits.stop_at = parseStopAt("--dm-stop-at", flags["dm-stop-at"]);
  }
  return automation;
}

// Assemble the request body shared by posts:create, posts:create-and-publish,
// and posts:update. Centralised so all three stay in sync as the API grows.
// `content` is only set when --text is given (update can omit it). Returns the
// body object; calls exitWithError on malformed --user-tags JSON.
// The "||"-separated thread flags. A post built from one of these needs no
// --text: the API derives the caption from the first part.
const THREAD_FLAGS = ["x-thread", "bluesky-thread", "mastodon-thread", "threads-thread"];
const hasThreadFlag = (flags) => THREAD_FLAGS.some((f) => flags[f]);

function buildPostBody(flags) {
  const body = {};

  if (flags.text !== undefined) body.content = flags.text;
  if (flags.channels) body.channels = splitComma(flags.channels);
  // API accepts both schedule_at and scheduled_at; send the documented name.
  if (flags.schedule) body.schedule_at = flags.schedule;
  // Planned draft: --draft keeps --schedule as the planned time but stores
  // the post as a draft (dashed on the calendar, never published by the
  // scheduler). posts:update takes --no-draft (or --draft false) to schedule
  // a planned draft at the time it carries, and --draft to unschedule.
  if (flags["no-draft"] === true || flags.draft === "false") body.draft = false;
  else if (flags.draft === true || flags.draft === "true") body.draft = true;
  if (flags.type) body.type = flags.type;
  if (flags["media-ids"]) body.media_ids = splitComma(flags["media-ids"]);
  if (flags["media-urls"]) body.media_urls = splitComma(flags["media-urls"]);

  // Image fit per channel (see parseMediaFit). On posts:update without media
  // the API re-decides the stored images: keep gives the original back, crop
  // crops an image that was kept.
  if (flags["media-fit"] !== undefined) body.media_fit = parseMediaFit(flags["media-fit"]);

  // Link preview (LinkedIn / Facebook) — top-level fields.
  if (flags["link-url"]) body.link_url = flags["link-url"];
  if (flags["link-title"]) body.link_title = flags["link-title"];
  if (flags["link-description"]) body.link_description = flags["link-description"];
  if (flags["link-thumbnail-url"]) body.link_thumbnail_url = flags["link-thumbnail-url"];

  // Hashtag sets — top-level; expanded server-side once at create time.
  if (flags["hashtag-set"]) body.hashtag_set = flags["hashtag-set"];
  if (flags["hashtag-placement"]) body.hashtag_placement = flags["hashtag-placement"];
  if (flags["hashtag-platforms"]) body.hashtag_platforms = splitComma(flags["hashtag-platforms"]);

  // Approval workflow — top-level; the post is created as in_approval and
  // publishes at --schedule once the workflow's last step approves it.
  if (flags["approval-workflow"]) body.approval_workflow_id = String(flags["approval-workflow"]);

  // Comment-to-DM automation bound to this post (see buildPostCommentDm).
  // Top-level `comment_dm_automation`; null on posts:update removes it.
  const commentDm = buildPostCommentDm(flags);
  if (commentDm !== undefined) body.comment_dm_automation = commentDm;

  // Instagram extras — top-level (not nested under `instagram`).
  if (flags["location-id"]) body.location_id = flags["location-id"];
  if (flags.collaborators) body.collaborators = splitComma(flags.collaborators);
  if (flags["user-tags"] !== undefined) {
    try {
      body.user_tags = JSON.parse(flags["user-tags"]);
    } catch {
      exitWithError(
        '--user-tags must be a JSON array, e.g. \'[{"username":"name","x":0.5,"y":0.5}]\''
      );
    }
  }

  // X thread: simple CLI form — parts separated by "||".
  //   --x-thread "first tweet || second tweet || third"
  // For per-tweet media use --json with a full thread_parts array instead.
  if (flags["x-thread"]) {
    const parts = String(flags["x-thread"])
      .split("||")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text) => ({ text }));
    if (parts.length) body.x = { ...(body.x || {}), thread_parts: parts };
  }

  // Bluesky thread: same "||"-separated CLI form as --x-thread.
  //   --bluesky-thread "first post || second post || third"
  // For per-post media use --json with a full thread_parts array instead.
  if (flags["bluesky-thread"]) {
    const parts = String(flags["bluesky-thread"])
      .split("||")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text) => ({ text }));
    if (parts.length)
      body.bluesky = { ...(body.bluesky || {}), thread_parts: parts };
  }

  // Mastodon thread: same "||"-separated CLI form as --x-thread.
  //   --mastodon-thread "first toot || second toot || third"
  // For per-toot media use --json with a full thread_parts array instead.
  if (flags["mastodon-thread"]) {
    const parts = String(flags["mastodon-thread"])
      .split("||")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text) => ({ text }));
    if (parts.length)
      body.mastodon = { ...(body.mastodon || {}), thread_parts: parts };
  }

  // Threads (Meta) thread: same "||"-separated CLI form as --x-thread.
  //   --threads-thread "first post || second post || third"
  // For per-part media use --json with a full thread_parts array instead.
  if (flags["threads-thread"]) {
    const parts = String(flags["threads-thread"])
      .split("||")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text) => ({ text }));
    if (parts.length)
      body.threads = { ...(body.threads || {}), thread_parts: parts };
  }

  // Threads (Meta) location tag. Takes a Threads location id from
  // `locations:search --platform threads` (NOT a Facebook Place ID, so never
  // reuse --location-id values here). On a multi-post thread the tag goes on
  // the first post. On posts:update, pass the literal value null to remove
  // the tag (the API clears on JSON null).
  if (flags["threads-location-id"] !== undefined) {
    const raw = flags["threads-location-id"] === true ? "" : String(flags["threads-location-id"]).trim();
    body.threads = {
      ...(body.threads || {}),
      location_id: raw === "" || raw === "null" ? null : raw,
    };
  }

  // Google Business extras. The CTA button is the ONLY way to put a link or
  // phone number on a GBP post — captions reject both. Simple CTA + topic
  // type get their own flags; the JSON-heavy EVENT/OFFER shapes go through
  // --google-business-json (merged last so it can carry the full object).
  const gb = {};
  if (flags["google-business-topic-type"]) gb.topic_type = flags["google-business-topic-type"];
  if (flags["google-business-cta-action"]) {
    gb.cta = { actionType: flags["google-business-cta-action"] };
    if (flags["google-business-cta-url"]) gb.cta.url = flags["google-business-cta-url"];
  }
  if (flags["google-business-json"] !== undefined) {
    try {
      Object.assign(gb, JSON.parse(flags["google-business-json"]));
    } catch {
      exitWithError(
        '--google-business-json must be a JSON object, e.g. \'{"topic_type":"EVENT","event":{"title":"...","schedule":{...}}}\''
      );
    }
  }
  if (Object.keys(gb).length > 0) body.google_business = gb;

  // LinkedIn poll(s) — non-sponsored, question + 2-4 options + duration,
  // independent per channel. Mutually exclusive with media/link-share on
  // that channel's post (a poll silently wins at publish time). Top-level
  // object keyed by channel — {"linkedin": {...}, "linkedin_page": {...}}
  // — not nested under the linkedin/linkedin_page option flags, since each
  // channel's poll is set independently. Replaces wholesale on
  // posts:update — set a channel's key to `null` (or pass the whole flag
  // as `null`) to clear that channel's poll and revert it to a normal post.
  if (flags["linkedin-poll-json"] !== undefined) {
    let parsed;
    try {
      parsed = JSON.parse(flags["linkedin-poll-json"]);
    } catch {
      exitWithError(
        '--linkedin-poll-json must be JSON, e.g. \'{"linkedin":{"question":"...","options":["...","..."],"duration":"SEVEN_DAYS"}}\' or \'null\' to clear'
      );
    }
    body.linkedin_poll = parsed;
  }

  // Video cover — the thumbnail of a post whose media is ONE video. Top-level
  // `video_cover` object: {"type":"frame","thumb_offset":3000} (milliseconds
  // into the video) or {"type":"custom","cover_url":"https://..."}, plus an
  // optional "overrides" object keyed by platform. Replaces wholesale on
  // posts:update — pass the whole flag as `null` to remove the cover. On
  // YouTube Shorts it shows only on channels where YouTube has enabled custom
  // Shorts thumbnails; other channels display a frame from the video.
  if (flags["video-cover-json"] !== undefined) {
    let parsed;
    try {
      parsed = JSON.parse(flags["video-cover-json"]);
    } catch {
      exitWithError(
        '--video-cover-json must be JSON, e.g. \'{"type":"frame","thumb_offset":3000}\' or \'{"type":"custom","cover_url":"https://..."}\', or \'null\' to remove the cover'
      );
    }
    body.video_cover = parsed;
  }

  // Merge per-platform option objects (pinterest/youtube/instagram/tiktok/x),
  // preserving any keys already set above (e.g. x.thread_parts,
  // bluesky.thread_parts, mastodon.thread_parts, threads.thread_parts).
  const platformOpts = assemblePlatformOptions(flags);
  for (const [platform, opts] of Object.entries(platformOpts)) {
    body[platform] = { ...(body[platform] || {}), ...opts };
  }

  return body;
}

// ─── Output Formatters ──────────────────────────────────────────────────────

function outputJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

// The API's non-blocking notices: `warnings`, a sibling of `data` on post
// create and update. Codes today: x_url_post_credits (X link-post fee) and
// image_fit (a feed image cropped or kept per channel, with the undo hint in
// its message). Printed after the result so an agent relays them to the
// person; --json carries them unchanged and never reaches this.
function printWarnings(warnings) {
  if (!Array.isArray(warnings) || !warnings.length) return;
  console.log("");
  console.log(`Warnings (${warnings.length}):`);
  for (const w of warnings) {
    const code = w && w.code ? w.code : "warning";
    const message = w && w.message ? w.message : JSON.stringify(w);
    console.log(`  [${code}] ${message}`);
    if (w && w.code === "image_fit" && w.crop_url) console.log(`    crop: ${w.crop_url}`);
  }
}

// `fit` rows of POST /media/check: how each connected channel with an image
// fit rule shows this image as a feed post. Only a library image with a known
// size (--media-id) gets rows; videos and URL checks answer an empty array.
// Ends with the --media-fit value that overrides every default shown.
function printImageFit(fit) {
  if (!Array.isArray(fit) || !fit.length) return;
  console.log("");
  console.log("Image fit (feed posts):");
  for (const row of fit) {
    const name = row.display_name || row.platform;
    if (row.fits) {
      console.log(`  ${name}: ${row.ratio}, shown whole`);
      continue;
    }
    const action =
      row.default_action === "crop"
        ? `crop to ${row.target} around the subject`
        : `keep the original (${name} may cut it; crop target ${row.target})`;
    console.log(`  ${name}: ${row.ratio}, outside the window ${name} shows uncropped; default: ${action}`);
    if (row.message) console.log(`    ${row.message}`);
  }
  const overrides = fit
    .filter((row) => !row.fits && row.platform)
    .map((row) => `${row.platform}=${row.default_action === "crop" ? "keep" : "crop"}`);
  if (overrides.length) {
    console.log(`  Override on posts:create / posts:update with --media-fit ${overrides.join(",")}`);
  }
}

function truncate(str, len) {
  if (!str) return "";
  str = String(str).replace(/\n/g, " ");
  return str.length > len ? str.slice(0, len - 3) + "..." : str;
}

// The API returns `content` as a per-platform object ({ default, instagram, … }),
// not a string. Pull a representative string for one-line display.
function postContentString(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content.default || Object.values(content).find((v) => typeof v === "string") || "";
}

// One line for `pinterest.product_tags_result`, which a published post carries
// when it had product tags: { requested, tagged: [pin_id], skipped:
// [{ pin_id, reason }], error }. `reason` is Pinterest's code (PIN_MISSING,
// PIN_IS_PRIVATE, PRODUCT_METADATA_MISSING, PIN_NOT_FROM_VERIFIED_DOMAIN,
// PIN_NOT_FROM_SAME_USER_AS_HERO_PIN); `error` is set when the tag request
// itself failed. A refused product never fails the post.
function formatProductTagsResult(result) {
  const tagged = Array.isArray(result.tagged) ? result.tagged : [];
  const skipped = Array.isArray(result.skipped) ? result.skipped : [];
  const requested =
    typeof result.requested === "number" ? result.requested : tagged.length + skipped.length;
  const notes = [];
  if (skipped.length) {
    notes.push(`skipped: ${skipped.map((s) => `${s.pin_id} ${s.reason}`).join(", ")}`);
  }
  if (result.error) notes.push(`error: ${result.error}`);
  return `${tagged.length} of ${requested} tagged${notes.length ? ` (${notes.join("; ")})` : ""}`;
}

function formatPost(post, index) {
  const lines = [];
  lines.push(`#${index + 1}  ID: ${post.id}`);
  lines.push(`    Status: ${post.status}`);
  // none / approved say nothing more than the status does; pending and
  // rejected have a review worth reading (who it waits for, who rejected, why).
  if (post.approval_status === "pending" || post.approval_status === "rejected") {
    lines.push(`    Approval: ${post.approval_status} (review: posts:approval ${post.id})`);
  }
  lines.push(`    Content: "${truncate(postContentString(post.content), 60)}"`);
  // The API returns `accounts` (channel ids) and `schedule_at`; older code read
  // `channels`/`scheduled_at` which the response never contains, so both showed
  // blank. Accept both names so output is correct against the current API.
  const channels = post.accounts || post.channels;
  if (channels?.length) {
    lines.push(`    Channels: ${channels.join(", ")}`);
  }
  const scheduledAt = post.schedule_at || post.scheduled_at;
  if (scheduledAt) {
    lines.push(`    Scheduled: ${scheduledAt}`);
  }
  if (post.published_urls && Object.keys(post.published_urls).length) {
    lines.push(`    Published: ${Object.values(post.published_urls).join(", ")}`);
  }
  // Multi-slide stories: one story per slide on the platform; published_urls
  // only carries slide 1, so list every slide here.
  if (post.story_slides && typeof post.story_slides === "object") {
    for (const [platform, slides] of Object.entries(post.story_slides)) {
      if (!Array.isArray(slides) || !slides.length) continue;
      lines.push(`    ${platform} story slides (${slides.length}):`);
      slides.forEach((slide, i) => {
        const n = (typeof slide.index === "number" ? slide.index : i) + 1;
        lines.push(`      ${n}. ${slide.url || slide.native_post_id || "(no url)"}`);
      });
    }
  }
  // Pinterest product tags: what Pinterest did with them after the Pin went live.
  const productTagsResult = post.pinterest && post.pinterest.product_tags_result;
  if (productTagsResult && typeof productTagsResult === "object") {
    lines.push(`    Pinterest products: ${formatProductTagsResult(productTagsResult)}`);
  }
  // Retry lineage: retry_of = the failed post this one retries; retries = retry
  // posts created from this one. A "published" post with empty published_urls
  // and retries set is a resolved failure; the live URLs are on the retry post.
  if (post.retry_of) lines.push(`    Retry of: ${post.retry_of}`);
  if (post.retries?.length) lines.push(`    Retries: ${post.retries.join(", ")}`);
  if (post.app_url) lines.push(`    Open in OmniSocials: ${post.app_url}`);
  lines.push(`    Created: ${post.created_at}`);
  return lines.join("\n");
}

function formatAccount(account, index) {
  const lines = [];
  lines.push(`#${index + 1}  ID: ${account.id}`);
  lines.push(`    Platform: ${account.platform}`);
  lines.push(`    Username: ${account.username || account.display_name}`);
  lines.push(`    Status: ${account.status}`);
  if (account.content_types?.length) {
    lines.push(`    Content types: ${account.content_types.join(", ")}`);
  }
  if (account.boards?.length) {
    lines.push(
      `    Boards: ${account.boards.map((b) => `${b.name} (${b.id})`).join(", ")}`
    );
  }
  return lines.join("\n");
}

function formatMedia(item, index) {
  const lines = [];
  lines.push(`#${index + 1}  ID: ${item.id}`);
  lines.push(`    Type: ${item.type}`);
  lines.push(`    Filename: ${item.filename}`);
  lines.push(`    Size: ${(item.size / 1024 / 1024).toFixed(2)} MB`);
  lines.push(`    URL: ${item.url}`);
  return lines.join("\n");
}

function formatWebhook(webhook, index) {
  const lines = [];
  lines.push(`#${index + 1}  ID: ${webhook.id}`);
  lines.push(`    URL: ${webhook.url}`);
  lines.push(`    Events: ${webhook.events.join(", ")}`);
  lines.push(`    Active: ${webhook.is_active}`);
  if (webhook.last_triggered_at) {
    lines.push(`    Last triggered: ${webhook.last_triggered_at}`);
  }
  return lines.join("\n");
}

// --- Automations ---

const AUTOMATION_KIND_WORDS = { comment: "comment", dm: "DM", story_reply: "story reply" };
const AUTOMATION_SCOPE_WORDS = {
  post: "this post",
  next_post: "the next Instagram post",
  any: "every post",
};

// "comment on this post; keywords: guide, link (whole word)"
function describeTrigger(trigger) {
  const t = trigger || {};
  const kinds = (Array.isArray(t.kinds) ? t.kinds : []).map((k) => AUTOMATION_KIND_WORDS[k] || k);
  let line = kinds.length ? kinds.join(", ") : "(no trigger)";
  if (t.scope && AUTOMATION_SCOPE_WORDS[t.scope]) line += ` on ${AUTOMATION_SCOPE_WORDS[t.scope]}`;
  if (t.match === "any") return `${line}; no keyword, every one counts`;
  const words = Array.isArray(t.keywords) && t.keywords.length ? t.keywords.join(", ") : "(none)";
  const how = t.match === "contains" ? "anywhere in the text" : "whole word";
  return `${line}; keywords: ${words} (${how})`;
}

// The post an automation listens on: the caption when the snapshot has one,
// the permalink when there is one, else only the id. `post` is null until
// the automation has a post (next_post and any have none).
function describeAutomationPost(a) {
  const p = a.post;
  if (p && typeof p === "object") {
    const name = p.source === "instagram" ? `Instagram media ${p.id}` : `post ${p.id}`;
    const parts = [];
    if (p.caption) parts.push(`"${truncate(p.caption, 60)}"`);
    if (p.permalink) parts.push(p.permalink);
    const state = p.source === "omnisocials" ? (p.live ? "live" : p.status || "") : "";
    return `${name}${parts.length ? `: ${parts.join("  ")}` : ""}${state ? `  (${state})` : ""}`;
  }
  if (a.post_id) {
    return `post ${a.post_id}${a.instagram_media_id ? `  (Instagram media ${a.instagram_media_id})` : ""}`;
  }
  if (a.instagram_media_id) return `Instagram media ${a.instagram_media_id}`;
  return "";
}

function describeAutomationStats(stats) {
  const s = stats || {};
  const n = (v) => (typeof v === "number" ? v : 0);
  return `${n(s.sent)} sent / ${n(s.matched)} matched / ${n(s.skipped)} skipped / ${n(s.failed)} failed`;
}

// One automation in automations:list.
function formatAutomationRow(a) {
  const lines = [];
  lines.push(`ID: ${a.id}  ${a.status}${a.name ? `  ${a.name}` : ""}`);
  lines.push(`  Trigger: ${describeTrigger(a.trigger)}`);
  const post = describeAutomationPost(a);
  if (post) lines.push(`  Post: ${post}`);
  lines.push(`  Stats: ${describeAutomationStats(a.stats)}`);
  return lines.join("\n");
}

// The whole automation, for automations:get / create / update.
function formatAutomationDetail(a) {
  const lines = [];
  lines.push(`ID: ${a.id}`);
  lines.push(`Status: ${a.status}`);
  if (a.name) lines.push(`Name: ${a.name}`);
  lines.push(`Trigger: ${describeTrigger(a.trigger)}`);
  const post = describeAutomationPost(a);
  if (post) lines.push(`Post: ${post}`);
  const actions = a.actions || {};
  const dm = actions.dm && actions.dm.text ? actions.dm.text.replace(/\n/g, "\n    ") : "(none)";
  lines.push(`DM: ${dm}`);
  const reply = actions.public_reply || {};
  const variations = Array.isArray(reply.variations) ? reply.variations : [];
  lines.push(
    `Public reply: ${reply.enabled && variations.length ? variations.map((v) => `"${v}"`).join(" | ") : "off"}`
  );
  const limits = a.limits || {};
  const limitWords = [];
  if (limits.max_sends) limitWords.push(`max ${limits.max_sends} DMs`);
  if (limits.stop_at) limitWords.push(`stop at ${limits.stop_at}`);
  lines.push(`Limits: ${limitWords.length ? limitWords.join("; ") : "none"}`);
  const stats = a.stats || {};
  lines.push(
    `Stats: ${describeAutomationStats(stats)}${stats.last_event_at ? `  (last event ${stats.last_event_at})` : ""}`
  );
  if (a.created_at) lines.push(`Created: ${a.created_at}`);
  if (a.updated_at) lines.push(`Updated: ${a.updated_at}`);
  return lines.join("\n");
}

// One row of automations:events: time, kind, outcome (with the reason when
// it was skipped or failed), who, what they wrote, the DM that went out.
function formatAutomationEvent(e) {
  const person = e.person || {};
  const who = person.username ? `@${person.username}` : person.id ? `person ${person.id}` : "(unknown)";
  let outcome = e.outcome || "?";
  if (e.reason_label || e.reason) outcome += ` (${e.reason_label || e.reason})`;
  const parts = [e.created_at || e.sent_at || "", AUTOMATION_KIND_WORDS[e.kind] || e.kind || "", outcome, who];
  if (e.trigger_text) parts.push(`"${truncate(e.trigger_text, 60)}"`);
  if (e.message) parts.push(`DM: "${truncate(e.message, 60)}"`);
  return parts.filter(Boolean).join("  ");
}

// The post's comment-to-DM automation as posts:create / posts:update return
// it when the request carried comment_dm_automation: the Automation object
// (post: null) or null when the post has none (after --no-dm).
function printCommentDm(automation) {
  if (automation === null) {
    console.log("Comment-to-DM: off");
    return;
  }
  if (!automation || typeof automation !== "object") return;
  const t = automation.trigger || {};
  const keywords =
    t.match === "any"
      ? "every comment"
      : `keywords: ${Array.isArray(t.keywords) && t.keywords.length ? t.keywords.join(", ") : "(none)"}`;
  const state = automation.status === "active" || !automation.status ? "on" : automation.status;
  console.log(`Comment-to-DM: ${state} (${keywords}; id ${automation.id})`);
}

// --- Social Inbox ---

// Message direction values vary a little by platform ("outbound"/"outgoing"/
// "sent" all mean the reply was sent from OmniSocials). Treat any of them as
// "you" so the sender label is right regardless of the platform's wording.
const OUTBOUND_DIRECTIONS = new Set(["outbound", "outgoing", "sent"]);
function isOutbound(direction) {
  return OUTBOUND_DIRECTIONS.has(String(direction || "").toLowerCase());
}

function formatConversation(convo, index) {
  const lines = [];
  const p = convo.participant || {};
  const name = p.name || p.username || p.id || "Unknown";
  const handle = p.username && p.username !== name ? ` (@${p.username})` : "";
  lines.push(`#${index + 1}  ${name}${handle}`);
  // conversation_id is the key passed to inbox:messages/read/reply. It can
  // contain ":" and "()" (LinkedIn URNs), so print it whole for copy/paste.
  lines.push(`    Conversation: ${convo.conversation_id}`);
  lines.push(`    Platform: ${convo.platform}    Type: ${convo.type}`);
  if (convo.unread_count) lines.push(`    Unread: ${convo.unread_count}`);
  const lm = convo.last_message;
  if (lm) {
    const who = isOutbound(lm.direction) ? "you" : name;
    lines.push(
      `    Last (${who}): "${truncate(lm.text, 60)}"${lm.timestamp ? `  ${lm.timestamp}` : ""}`
    );
  }
  if (convo.post) {
    const cap = convo.post.caption ? ` "${truncate(convo.post.caption, 40)}"` : "";
    lines.push(`    On post: ${convo.post.id}${cap}`);
  }
  return lines.join("\n");
}

function formatMessage(msg, index) {
  const lines = [];
  const s = msg.sender || {};
  const who = isOutbound(msg.direction) ? "You" : s.name || s.username || "Them";
  lines.push(`#${index + 1}  ${who}${msg.timestamp ? `  ${msg.timestamp}` : ""}`);
  // Print the full message body (indent continuation lines); --json has the raw.
  lines.push(`    ${msg.text ? msg.text.replace(/\n/g, "\n    ") : "(no text)"}`);
  const meta = [`id: ${msg.id}`];
  if (msg.type) meta.push(msg.type);
  if (msg.is_read === false) meta.push("unread");
  if (msg.is_replied) meta.push("replied");
  if (msg.reaction) meta.push(`reaction: ${msg.reaction}`);
  // Comments on every inbox platform: true when hidden on the platform (flip
  // with inbox:hide). DMs have no hidden state (null).
  if (msg.hidden === true) meta.push("hidden");
  lines.push(`    ${meta.join("  ·  ")}`);
  if (msg.permalink) lines.push(`    ${msg.permalink}`);
  return lines.join("\n");
}

// Cursor-pagination hint shared by inbox:list and inbox:messages.
function printPagination(pagination) {
  if (pagination && pagination.has_more && pagination.next_cursor) {
    console.log(`\nMore — pass --cursor "${pagination.next_cursor}" for the next page.`);
  }
}

// The post a comment/mention thread belongs to ({ id, caption, thumbnail, url,
// media_type }). Printed above comment threads so a reply can be drafted with
// the post in view. DMs have no post.
function formatPostBlock(post) {
  if (!post) return "";
  const lines = [];
  const kind = post.media_type ? `  (${post.media_type})` : "";
  lines.push(`On post: ${post.id || "(unknown id)"}${kind}`);
  if (post.caption) lines.push(`    Caption: ${truncate(post.caption, 200)}`);
  if (post.url) lines.push(`    URL: ${post.url}`);
  if (post.thumbnail) lines.push(`    Thumbnail: ${post.thumbnail}`);
  return lines.join("\n");
}

// Shared by inbox:next and inbox:reply --next. `data` is one /inbox/next item
// ({ conversation, message, messages, reply_window }) or null when nothing is
// waiting; `remaining` is how many more unanswered items sit behind it. The
// queue serves DMs that can still be answered first, then Instagram/Facebook
// DMs whose 24-hour window has closed (reply_window.open false), then
// comments and mentions.
function printNextItem(data, remaining) {
  if (!data) {
    console.log("Nothing is waiting for an answer.");
    return;
  }
  const convo = data.conversation || {};
  const msg = data.message || {};
  const p = convo.participant || msg.sender || {};
  const name = p.name || p.username || p.id || "Unknown";
  const handle = p.username && p.username !== name ? ` (@${p.username})` : "";
  const platform = convo.platform || msg.platform || "unknown";
  const type = convo.type || msg.type || "message";
  const convId = convo.conversation_id || msg.conversation_id;
  const isComment = type === "comment" || type === "mention";
  const replyWindow = data.reply_window || msg.reply_window || convo.reply_window || null;
  const windowClosed = !!replyWindow && replyWindow.open === false;
  const app =
    platform === "instagram" ? "Instagram" : platform === "facebook" ? "Facebook" : "Instagram/Facebook";

  console.log(`Next up: ${platform} ${type} from ${name}${handle}`);
  console.log("─".repeat(40));
  // Two ids matter: the conversation id (inbox:reply / inbox:read) and the
  // message id of the unanswered item (inbox:reply --message-id on comment
  // threads, inbox:hide / inbox:delete).
  console.log(`Conversation: ${convId}`);
  console.log(
    `Message to answer: ${msg.id}${msg.timestamp ? `  ${msg.timestamp}` : ""}${
      isComment ? "  (pass as --message-id when replying)" : ""
    }`
  );
  // Only Instagram and Facebook DMs have a reply window (Meta's 24-hour rule:
  // closes_at = the customer's last message + 24 h). Every other item is
  // served as { open: true, closes_at: null }. A closed window means
  // inbox:reply answers 422 outside_messaging_window without sending.
  if (windowClosed) {
    console.log(
      `Reply window closed ${replyWindow.closes_at || "(time unknown)"} (Meta 24-hour rule): answer this DM from the ${app} app or run inbox:read "${convId}" to skip it`
    );
  } else if (replyWindow && replyWindow.closes_at) {
    console.log(`Reply window open until ${replyWindow.closes_at} (Meta 24-hour rule)`);
  }
  const post = msg.post || convo.post;
  if (post) console.log(formatPostBlock(post));

  const messages = Array.isArray(data.messages) ? data.messages : [];
  if (messages.length) {
    console.log("\nThread (oldest first)");
    console.log(
      messages
        .map((m, i) => {
          const block = formatMessage(m, i);
          return String(m.id) === String(msg.id) ? `${block}\n    ^ answer this one` : block;
        })
        .join("\n\n")
    );
  }

  const n = Number(remaining) || 0;
  console.log(`\n${n} more waiting.`);
  if (windowClosed) {
    console.log(
      `Do not call inbox:reply on this one (it answers 422 outside_messaging_window and sends nothing). Answer it from the ${app} app, which mirrors the reply into the inbox and clears the item, or skip it for good with inbox:read "${convId}"`
    );
    return;
  }
  const messageId = isComment ? ` --message-id ${msg.id}` : "";
  const moderation = isComment
    ? `; hide or delete the comment with inbox:hide ${msg.id} / inbox:delete ${msg.id}`
    : "";
  console.log(
    `Reply with inbox:reply "${convId}" --text "..."${messageId} --next; skip it for good with inbox:read "${convId}"${moderation}`
  );
}

function handleResult(result, flags, formatter) {
  if (result.error) {
    if (flags.json) {
      outputJson(result);
    } else {
      console.error(`Error [${result.error.code}]: ${result.error.message}`);
    }
    process.exit(1);
  }

  if (flags.json) {
    outputJson(result);
    return;
  }

  // Formatters get the API's `warnings` (post create/update) as a second
  // argument; the ones that print posts pass them to printWarnings.
  if (formatter) {
    formatter(result.data, result.warnings);
  } else {
    outputJson(result.data);
  }
}

// handleResult plus the scope hint. Every automation call, and a post call
// whose body carries comment_dm_automation, answers 403 insufficient_scope on
// a key without the opt-in Automations scopes; the fix is a key setting, so
// name it. A 409 automation_exists names the automation the post already has.
function handleAutomationResult(result, flags, formatter) {
  const error = result && result.error;
  if (error && error.code === "insufficient_scope") {
    if (flags.json) outputJson(result);
    else console.error(`Error [${error.code}]: ${error.message}`);
    console.error(AUTOMATIONS_SCOPE_HINT);
    process.exit(1);
  }
  if (error && error.code === "automation_exists" && error.automation_id && !flags.json) {
    console.error(`Error [${error.code}]: ${error.message}`);
    console.error(
      `The post already has automation ${error.automation_id}: change it with automations:update ${error.automation_id}, or delete it first.`
    );
    process.exit(1);
  }
  handleResult(result, flags, formatter);
}

// ─── Command Handlers ───────────────────────────────────────────────────────

// --- Setup ---

async function cmdSetup(flags) {
  let apiKey = flags["api-key"];

  if (!apiKey) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

    console.log("OmniSocials Agent Skill Setup");
    console.log("─────────────────────────────");
    console.log("");
    console.log("Get your API key from: https://app.omnisocials.com/settings/api");
    console.log("");

    apiKey = await ask("Enter your API key: ");
    rl.close();

    if (!apiKey || !apiKey.trim()) {
      console.error("No API key provided. Aborting.");
      process.exit(1);
    }
    apiKey = apiKey.trim();
  }

  // Validate the key
  console.log("Validating API key...");
  const config = { api_key: apiKey, base_url: flags["base-url"] || DEFAULT_BASE_URL };
  const result = await apiRequest(config, "GET", "/accounts");

  if (result.error) {
    console.error(`Invalid API key: ${result.error.message}`);
    process.exit(1);
  }

  const accounts = result.data || [];
  console.log(`Valid! Found ${accounts.length} connected account(s).`);

  // Write config
  const configData = { api_key: apiKey };
  if (flags["base-url"]) {
    configData.base_url = flags["base-url"];
  }

  const configPath = flags.global ? getGlobalConfigPath() : getProjectConfigPath();
  const configDir = path.dirname(configPath);

  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2) + "\n");

  console.log(`Config saved to: ${configPath}`);

  // Update .gitignore for project config
  if (!flags.global) {
    const gitignorePath = path.join(process.cwd(), ".gitignore");
    try {
      const content = fs.existsSync(gitignorePath)
        ? fs.readFileSync(gitignorePath, "utf-8")
        : "";
      if (!content.includes(".omnisocials/")) {
        fs.appendFileSync(gitignorePath, "\n.omnisocials/\n");
        console.log("Added .omnisocials/ to .gitignore");
      }
    } catch {
      // Not critical
    }
  }

  console.log("\nSetup complete! Try: omnisocials accounts:list");
}

async function cmdConfigShow(flags) {
  const config = resolveConfig(flags);
  if (!config) {
    console.log("No configuration found.");
    console.log("");
    console.log("Run: omnisocials setup");
    console.log("Or set: export OMNISOCIALS_API_KEY=omsk_live_...");
    return;
  }

  if (flags.json) {
    outputJson({
      api_key: config.api_key.slice(0, 14) + "...",
      base_url: config.base_url,
      source: config.source,
    });
  } else {
    console.log("OmniSocials Configuration");
    console.log("─────────────────────────");
    console.log(`API Key: ${config.api_key.slice(0, 14)}...`);
    console.log(`Base URL: ${config.base_url}`);
    console.log(`Source: ${config.source}`);
  }
}

// --- Posts ---

async function cmdPostsList(config, flags) {
  const result = await apiRequest(config, "GET", "/posts", undefined, {
    status: flags.status,
    limit: flags.limit,
    offset: flags.offset,
  });

  handleResult(result, flags, (data) => {
    const posts = Array.isArray(data) ? data : data?.posts || [];
    if (!posts.length) {
      console.log("No posts found.");
      return;
    }
    console.log(`Posts (${posts.length} results)`);
    console.log("─".repeat(40));
    console.log(posts.map((p, i) => formatPost(p, i)).join("\n\n"));
  });
}

async function cmdPostsGet(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials posts:get <id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "GET", `/posts/${id}`);
  handleResult(result, flags);
}

async function cmdPostsRecentPlatform(config, flags) {
  // Fetches recent posts live from the connected platform APIs (including
  // content published outside OmniSocials). The fallback for brand-new
  // workspaces where posts:list is empty. Requires the analytics:read scope.
  const result = await apiRequest(config, "GET", "/posts/recent-platform", undefined, {
    limit: flags.limit,
    platforms: flags.platforms,
  });

  handleResult(result, flags, (data) => {
    const posts = Array.isArray(data) ? data : [];
    const connected = result.connected_platforms || [];
    const errors = result.errors || {};
    const errEntries = Object.entries(errors);

    if (!posts.length) {
      console.log(result.note || "No recent platform posts found.");
      if (errEntries.length) {
        console.log("\nFetch errors:");
        for (const [p, m] of errEntries) console.log(`  ${p}: ${m}`);
      }
      return;
    }

    console.log(
      `Recent platform posts (${posts.length} across ${connected.length} platform${connected.length === 1 ? "" : "s"})`
    );
    console.log("─".repeat(40));
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const hasMetrics = p.metrics && Object.keys(p.metrics).length > 0;
      const caption = (p.text || "").replace(/\s+/g, " ").trim();
      const snippet =
        caption.length > 70 ? caption.slice(0, 69) + "…" : caption || "(no caption)";
      // Every counter the platform reported (reach, views, saves, …), not just
      // the two normalized headline numbers.
      const detail = metricRows(p.metrics)
        .filter(([label]) => label !== "engagements")
        .map(([label, n]) => `${n} ${label}`)
        .join(", ");
      const metricStr = hasMetrics
        ? `${p.engagement} engagements${detail ? ` — ${detail}` : ""}`
        : "no metrics from this platform";
      // Video length in m:ss (95 → "1:35"), where the platform reports it
      // (currently TikTok and YouTube); null/absent for images and platforms
      // that don't expose a duration.
      const duration =
        typeof p.duration_seconds === "number"
          ? ` (${Math.floor(p.duration_seconds / 60)}:${String(p.duration_seconds % 60).padStart(2, "0")})`
          : "";
      console.log(`${i + 1}. [${p.platform}] ${p.format}${duration} — ${metricStr}`);
      console.log(`   ${snippet}`);
      // id (dedupe key) + permalink for ingestion; --json carries the full,
      // untruncated caption and exact-integer metrics.
      if (p.id) console.log(`   id: ${p.id}${p.permalink ? `  ·  ${p.permalink}` : ""}`);
    }
    if (result.note) console.log(`\n${result.note}`);
    console.log("\nTip: add --json for the full untruncated captions, exact-integer metrics, ids, and permalinks (for storing each post).");
    if (errEntries.length) {
      console.log("\nFetch errors:");
      for (const [p, m] of errEntries) console.log(`  ${p}: ${m}`);
    }
  });
}

async function cmdPostsCreate(config, flags) {
  const text = flags.text;
  if (!text && !hasThreadFlag(flags)) {
    console.error("Usage: omnisocials posts:create --text \"...\" [--channels ...]");
    process.exit(1);
  }

  const body = buildPostBody(flags);
  // Thread-only create: the API requires a content field but takes the
  // caption from thread part 1, so send an empty default.
  if (body.content === undefined) body.content = "";

  const result = await apiRequest(config, "POST", "/posts/create", body);

  // With a comment-to-DM automation in the body a 403 is about the
  // Automations scopes; the handler says where to turn them on.
  const handle = body.comment_dm_automation !== undefined ? handleAutomationResult : handleResult;
  handle(result, flags, (data, warnings) => {
    console.log(`Post created successfully!`);
    console.log(`ID: ${data.id}`);
    console.log(`Status: ${data.status}`);
    const scheduledAt = data.schedule_at || data.scheduled_at;
    if (scheduledAt) console.log(`${data.status === "draft" ? "Planned for" : "Scheduled"}: ${scheduledAt}`);
    if (data.app_url) console.log(`Open in OmniSocials: ${data.app_url}`);
    if (data.comment_dm_automation !== undefined) printCommentDm(data.comment_dm_automation);
    printWarnings(warnings);
  });
}

async function cmdPostsCreateAndPublish(config, flags) {
  const text = flags.text;
  if (!text && !hasThreadFlag(flags)) {
    console.error(
      "Usage: omnisocials posts:create-and-publish --text \"...\" [--channels ...]"
    );
    process.exit(1);
  }

  const body = buildPostBody(flags);
  if (body.content === undefined) body.content = "";
  // create-and-publish ignores scheduling; drop it if a stray --schedule or --draft slipped in.
  delete body.schedule_at;
  delete body.draft;

  const result = await apiRequest(config, "POST", "/posts/create-and-publish", body);

  const handle = body.comment_dm_automation !== undefined ? handleAutomationResult : handleResult;
  handle(result, flags, (data, warnings) => {
    console.log(`Post created and publishing!`);
    console.log(`ID: ${data.id}`);
    console.log(`Status: ${data.status}`);
    if (data.app_url) console.log(`Open in OmniSocials: ${data.app_url}`);
    if (data.comment_dm_automation !== undefined) printCommentDm(data.comment_dm_automation);
    printWarnings(warnings);
  });
}

async function cmdPostsUpdate(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials posts:update <id> [--text ...] [--channels ...]");
    process.exit(1);
  }

  const body = buildPostBody(flags);

  const result = await apiRequest(config, "PATCH", `/posts/${id}`, body);

  const handle = body.comment_dm_automation !== undefined ? handleAutomationResult : handleResult;
  handle(result, flags, (data, warnings) => {
    console.log(`Post updated successfully!`);
    console.log(`ID: ${data.id}`);
    console.log(`Status: ${data.status}`);
    const scheduledAt = data.schedule_at || data.scheduled_at;
    if (scheduledAt) console.log(`${data.status === "draft" ? "Planned for" : "Scheduled"}: ${scheduledAt}`);
    if (data.comment_dm_automation !== undefined) printCommentDm(data.comment_dm_automation);
    printWarnings(warnings);
  });
}

async function cmdPostsPublish(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials posts:publish <id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "POST", `/posts/${id}/publish`);

  handleResult(result, flags, (data) => {
    console.log(`Post queued for publishing!`);
    console.log(`ID: ${data.id}`);
    console.log(`Status: ${data.status}`);
  });
}

async function cmdPostsRetry(config, flags, positional) {
  // Retries ONLY the failed platforms of a post whose status is `failed` or
  // `warning` (partially failed), on the same post; platforms that already
  // succeeded are never re-published. Asynchronous: a success response means
  // the retry is queued, so poll posts:get for the outcome. Max 3 retries per
  // platform; after that the API returns 400 max_retries_reached and the post
  // must be recreated.
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials posts:retry <id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "POST", `/posts/${id}/retry`);

  handleResult(result, flags, (data) => {
    console.log(`Retry queued!`);
    console.log(`ID: ${data.id}`);
    console.log(`Status: ${data.status}`);
    if (data.platforms?.length) {
      console.log(`Retrying: ${data.platforms.join(", ")}`);
    }
    console.log(
      "Platforms that already succeeded are never re-published; poll posts:get for the outcome."
    );
  });
}

async function cmdPostsApprove(config, flags, positional) {
  // Approves the CURRENT step of a post's approval workflow, on behalf of
  // the connected API key's owner. That user must be a listed approver for
  // the current step — steps approve in order, so an approver on a later
  // step gets a 403 forbidden error until earlier steps clear. Only works
  // on a post with approval_status "pending". If this is the last step, the
  // post finalizes immediately (scheduled or posting); otherwise it stays
  // in_approval and the next step's approvers are notified.
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials posts:approve <id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "POST", `/posts/${id}/approve`);

  handleResult(result, flags, (data) => {
    console.log(`Approved!`);
    console.log(`ID: ${data.id}`);
    console.log(`Status: ${data.status}`);
    console.log(`Approval status: ${data.approval_status}`);
    if (data.message) console.log(data.message);
  });
}

async function cmdPostsReject(config, flags, positional) {
  // Rejects a post's approval workflow, stopping the WHOLE workflow
  // immediately (not just the current step). Same approver requirement as
  // posts:approve. --comment is optional and, when given, is shown to the
  // requester and other approvers in the post's review thread.
  const id = positional[0];
  if (!id) {
    console.error('Usage: omnisocials posts:reject <id> [--comment "..."]');
    process.exit(1);
  }

  const body = flags.comment ? { comment: flags.comment } : undefined;
  const result = await apiRequest(config, "POST", `/posts/${id}/reject`, body);

  handleResult(result, flags, (data) => {
    console.log(`Rejected.`);
    console.log(`ID: ${data.id}`);
    console.log(`Status: ${data.status}`);
    if (data.message) console.log(data.message);
  });
}

async function cmdPostsApproval(config, flags, positional) {
  // Reads the review of a post that went through an approval workflow: every
  // step with its approvers and their decisions, the rejection with its
  // reason, and the comment thread (oldest first). Read-only (posts:read).
  // Use it when approval_status is "rejected" (who rejected and why) or
  // "pending" (who the post waits for). A post without a workflow answers
  // status "none" with empty steps and comments.
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials posts:approval <id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "GET", `/posts/${id}/approval`);

  handleResult(result, flags, (data) => {
    const person = (p) => (p && (p.name || p.email || p.id)) || "(unknown)";
    const steps = data.steps || [];
    const comments = data.comments || [];

    console.log(`Approval review for post ${data.post_id || id}`);
    console.log("─".repeat(40));
    console.log(`Status: ${data.status}`);
    if (data.status === "none") {
      console.log("This post has no approval workflow.");
      return;
    }
    if (data.workflow) {
      console.log(
        `Workflow: ${data.workflow.name}${data.workflow.id ? ` (ID: ${data.workflow.id})` : " (one-off approval)"}`
      );
    }
    if (data.requested_by) {
      console.log(
        `Requested by: ${person(data.requested_by)}${data.requested_at ? ` at ${data.requested_at}` : ""}`
      );
    }
    if (data.current_step !== null && data.current_step !== undefined) {
      const step = steps.find((s) => s.order === data.current_step);
      const waiting = (step?.approvers || []).filter((a) => a.status === "pending").map(person);
      console.log(
        `Waiting on: step ${data.current_step}${step?.name ? ` (${step.name})` : ""}${waiting.length ? `: ${waiting.join(", ")}` : ""}`
      );
    }
    if (data.rejection) {
      const r = data.rejection;
      console.log(
        `Rejected by: ${person(r.by)}${r.step !== null && r.step !== undefined ? ` on step ${r.step}` : ""}${r.at ? ` at ${r.at}` : ""}`
      );
      console.log(`Reason: ${r.reason || "(no reason given)"}`);
    }

    if (steps.length) {
      console.log("");
      console.log("Steps");
      for (const s of steps) {
        console.log(
          `  Step ${s.order}: ${s.name || "Review"} [${s.require_mode === "all" ? "all must approve" : "any one approves"}]: ${s.status}`
        );
        for (const a of s.approvers || []) {
          console.log(
            `    ${person(a)}: ${a.status}${a.decided_at ? ` at ${a.decided_at}` : ""}${a.comment ? ` ("${a.comment}")` : ""}`
          );
        }
      }
    }

    console.log("");
    if (!comments.length) {
      console.log("Comments: none");
      return;
    }
    console.log(`Comments (${comments.length}, oldest first)`);
    for (const c of comments) {
      console.log(
        `  ${c.created_at}  ${person(c.author)}${c.account ? ` [${c.account}]` : ""}: ${c.message}`
      );
    }
  });
}

async function cmdPostsDelete(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials posts:delete <id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "DELETE", `/posts/${id}`);

  if (result.error) {
    handleResult(result, flags);
  } else {
    if (flags.json) {
      outputJson({ success: true, message: "Post deleted." });
    } else {
      console.log("Post deleted successfully.");
    }
  }
}

// --- Media ---

async function cmdMediaList(config, flags) {
  const result = await apiRequest(config, "GET", "/media", undefined, {
    limit: flags.limit,
    offset: flags.offset,
  });

  handleResult(result, flags, (data) => {
    const items = Array.isArray(data) ? data : data?.media || [];
    if (!items.length) {
      console.log("No media files found.");
      return;
    }
    console.log(`Media (${items.length} files)`);
    console.log("─".repeat(40));
    console.log(items.map((m, i) => formatMedia(m, i)).join("\n\n"));
  });
}

async function cmdMediaUpload(config, flags) {
  const url = flags.url;
  if (!url) {
    console.error('Usage: omnisocials media:upload --url "https://..."');
    process.exit(1);
  }

  const body = { url };
  if (flags.filename) body.filename = flags.filename;
  if (flags.name) body.name = flags.name;
  if (flags.folder) body.folder = flags.folder;
  if (flags["folder-id"]) body.folder_id = flags["folder-id"];
  if (flags["pdf-mode"]) body.pdf_mode = flags["pdf-mode"];

  const result = await apiRequest(config, "POST", "/media/upload-from-url", body);

  handleResult(result, flags, (data) => {
    if (printPdfUploadResult(result)) return;
    console.log("Media uploaded successfully!");
    console.log(`ID: ${data.id}`);
    console.log(`Type: ${data.type}`);
    console.log(`Filename: ${data.filename}`);
    console.log(`URL: ${data.url}`);
  });
}

async function cmdMediaDelete(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials media:delete <id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "DELETE", `/media/${id}`);

  if (result.error) {
    handleResult(result, flags);
  } else {
    if (flags.json) {
      outputJson({ success: true, message: "Media deleted." });
    } else {
      console.log("Media deleted successfully.");
    }
  }
}

const EXT_TO_MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  pdf: "application/pdf",
};

// Print an upload result, handling the PDF carousel shape (a PDF is split into
// one image slide per page; the response carries slides + media_ids). Returns
// true if it handled a PDF result, false for a normal single-media result.
function printPdfUploadResult(result) {
  if (!Array.isArray(result.media_ids) || !result.media_ids.length) return false;
  // --pdf-mode document: ONE media item for the whole PDF.
  if (result.data && result.data.type === "document") {
    const pages = result.data.pdf && Array.isArray(result.data.pdf.pages)
      ? result.data.pdf.pages.length
      : result.pdf && result.pdf.rendered_pages;
    console.log(`PDF uploaded as one media item (${pages} page(s)).`);
    if (result.pdf && result.pdf.truncated) {
      console.log(
        `(${result.pdf.total_pages} pages in the file; the first ${result.pdf.rendered_pages} became page images. LinkedIn still receives the full file.)`
      );
    }
    console.log(`Media ID (pass to posts:create --media-ids; expands into every page): ${result.data.id}`);
    console.log(
      "On LinkedIn it posts as a swipeable document made from the original PDF file; on Instagram, TikTok, Threads and Pinterest as an image carousel."
    );
    return true;
  }
  console.log(
    `PDF uploaded and split into ${result.media_ids.length} image slide(s).`
  );
  if (result.pdf && result.pdf.truncated) {
    console.log(
      `(the first ${result.pdf.rendered_pages} of ${result.pdf.total_pages} pages became slides; max 20. LinkedIn still receives the full file.)`
    );
  }
  if (result.pdf && result.pdf.name) {
    console.log(`Original PDF kept: ${result.pdf.name}${result.pdf.id ? ` (id ${result.pdf.id})` : ""}`);
  }
  console.log(
    `Slide media IDs (pass ALL to posts:create --media-ids): ${result.media_ids.join(",")}`
  );
  console.log(
    "On LinkedIn these post as a swipeable document made from the original PDF file (text stays sharp, links keep working) as long as the slides are posted unchanged and in order; on Instagram, TikTok, Threads and Pinterest as an image carousel. Pass --linkedin-document-source slides to send a document rebuilt from the slide images instead."
  );
  return true;
}

async function cmdMediaCheck(config, flags) {
  const body = {};
  if (flags.url) body.url = flags.url;
  if (flags["media-id"]) body.media_id = flags["media-id"];
  if (flags["size-bytes"]) body.size_bytes = Number(flags["size-bytes"]);
  if (flags.mime) body.mime = flags.mime;

  if (!body.url && !body.media_id && !(body.size_bytes && body.mime)) {
    exitWithError(
      "Usage: omnisocials media:check (--url <url> | --media-id <id> | --size-bytes <n> --mime <type>)"
    );
  }

  const result = await apiRequest(config, "POST", "/media/check", body);
  // /media/check returns a top-level object (no `data` wrapper), so print the
  // whole response rather than result.data (which would be undefined). The
  // `fit` rows (how each channel shows a library image as a feed post) are
  // repeated in plain words below the JSON, with the --media-fit override.
  handleResult(result, flags, () => {
    outputJson(result);
    printImageFit(result.fit);
  });
}

async function cmdMediaUploadBase64(config, flags) {
  let data = flags.data;
  let mime = flags["mime-type"] || flags.mime;
  let filename = flags.filename;

  // Convenience: --file <path> reads and base64-encodes a local file, inferring
  // the MIME type from the extension (override with --mime-type).
  if (flags.file) {
    try {
      data = fs.readFileSync(flags.file).toString("base64");
    } catch (err) {
      exitWithError(`Could not read --file ${flags.file}: ${err.message}`);
    }
    const ext = path.extname(flags.file).slice(1).toLowerCase();
    mime = mime || EXT_TO_MIME[ext];
    filename = filename || path.basename(flags.file);
  }

  if (!data || !mime) {
    exitWithError(
      "Usage: omnisocials media:upload-base64 (--file <path> | --data <base64> --mime-type <type>) [--filename --name --folder --folder-id]"
    );
  }

  const body = { data, mime_type: mime };
  if (filename) body.filename = filename;
  if (flags.name) body.name = flags.name;
  if (flags.folder) body.folder = flags.folder;
  if (flags["folder-id"]) body.folder_id = flags["folder-id"];
  if (flags["pdf-mode"]) body.pdf_mode = flags["pdf-mode"];

  const result = await apiRequest(config, "POST", "/media/upload-from-base64", body);
  handleResult(result, flags, (d) => {
    if (printPdfUploadResult(result)) return;
    console.log("Media uploaded successfully!");
    console.log(`ID: ${d.id}`);
    console.log(`Type: ${d.type}`);
    console.log(`Filename: ${d.filename}`);
    console.log(`URL: ${d.url}`);
  });
}

// --- Folders ---

async function cmdFoldersList(config, flags) {
  const result = await apiRequest(config, "GET", "/folders");
  handleResult(result, flags, (data) => {
    const folders = Array.isArray(data) ? data : [];
    if (!folders.length) {
      console.log("No folders found.");
      return;
    }
    console.log(`Folders (${folders.length})`);
    console.log("─".repeat(40));
    for (const f of folders) {
      const parent = f.parent_id ? `  [parent: ${f.parent_id}]` : "";
      console.log(`ID: ${f.id}  ${f.name}  (${f.item_count ?? 0} items)${parent}`);
    }
  });
}

async function cmdFoldersCreate(config, flags) {
  const name = flags.name;
  if (!name) {
    exitWithError('Usage: omnisocials folders:create --name "My Folder" [--parent-id <id>]');
  }

  const body = { name };
  if (flags["parent-id"]) body.parent_id = flags["parent-id"];

  const result = await apiRequest(config, "POST", "/folders", body);
  handleResult(result, flags, (d) => {
    console.log("Folder created successfully!");
    console.log(`ID: ${d.id}`);
    console.log(`Name: ${d.name}`);
  });
}

// --- Approval workflows ---

async function cmdApprovalWorkflowsList(config, flags) {
  const result = await apiRequest(config, "GET", "/approval-workflows");
  handleResult(result, flags, (data) => {
    const workflows = Array.isArray(data) ? data : [];
    if (!workflows.length) {
      console.log(
        "No approval workflows found. Create one in the OmniSocials dashboard under Approvals, then use posts:create --approval-workflow <id>."
      );
      return;
    }
    console.log(`Approval workflows (${workflows.length})`);
    console.log("─".repeat(40));
    for (const w of workflows) {
      console.log(`ID: ${w.id}  ${w.name}${w.workspace_id ? "" : "  (company-wide)"}`);
      for (const s of w.steps || []) {
        const approvers = (s.approvers || []).map((a) => a.name || a.email || a.id).join(", ") || "(no approvers)";
        console.log(`  Step ${s.order}: ${s.name || "Review"} [${s.require_mode === "all" ? "all must approve" : "any one approves"}]: ${approvers}`);
      }
    }
    console.log("");
    console.log("Submit a post for review with: posts:create ... --schedule <ISO8601> --approval-workflow <id>");
  });
}

// --- Hashtag sets ---

async function cmdHashtagSetsList(config, flags) {
  const result = await apiRequest(config, "GET", "/hashtag-sets");
  handleResult(result, flags, (data) => {
    const sets = Array.isArray(data) ? data : [];
    if (!sets.length) {
      console.log("No hashtag sets found. Create one with hashtag-sets:create.");
      return;
    }
    console.log(`Hashtag sets (${sets.length})`);
    console.log("─".repeat(40));
    for (const s of sets) {
      console.log(`ID: ${s.id}  ${s.name}  (${s.hashtag_count} tags)`);
      console.log(`  ${s.preview}`);
    }
  });
}

async function cmdHashtagSetsCreate(config, flags) {
  const name = flags.name;
  const tags = flags.tags;
  if (!name || !tags) {
    exitWithError(
      'Usage: omnisocials hashtag-sets:create --name "Fitness Brand" --tags "#fitness #gym #workout"'
    );
  }

  const result = await apiRequest(config, "POST", "/hashtag-sets", {
    name,
    hashtags: tags,
  });
  handleResult(result, flags, (d) => {
    console.log("Hashtag set created successfully!");
    console.log(`ID: ${d.id}`);
    console.log(`Name: ${d.name}`);
    console.log(`Tags (${d.hashtag_count}): ${d.preview}`);
    console.log(`Apply it with: posts:create --hashtag-set "${d.name}"`);
  });
}

async function cmdHashtagSetsUpdate(config, flags, positional) {
  const id = flags.id || positional[0];
  if (!id || (!flags.name && !flags.tags)) {
    exitWithError(
      'Usage: omnisocials hashtag-sets:update <id> [--name "New Name"] [--tags "#full #replacement #list"]'
    );
  }

  const body = {};
  if (flags.name) body.name = flags.name;
  if (flags.tags) body.hashtags = flags.tags;

  const result = await apiRequest(config, "PATCH", `/hashtag-sets/${id}`, body);
  handleResult(result, flags, (d) => {
    console.log("Hashtag set updated!");
    console.log(`ID: ${d.id}`);
    console.log(`Name: ${d.name}`);
    console.log(`Tags (${d.hashtag_count}): ${d.preview}`);
  });
}

async function cmdHashtagSetsDelete(config, flags, positional) {
  const id = flags.id || positional[0];
  if (!id) {
    exitWithError("Usage: omnisocials hashtag-sets:delete <id>");
  }

  const result = await apiRequest(config, "DELETE", `/hashtag-sets/${id}`);
  handleResult(result, flags, () => {
    console.log("Hashtag set deleted. Posts that already used it keep their hashtags.");
  });
}

// --- Automations (comment to DM) ---
// Bodies and checks: buildAutomationBody. Every call goes through
// handleAutomationResult for the scope hint.

async function cmdAutomationsList(config, flags) {
  const query = {};
  if (flags.status !== undefined) query.status = pickOneOf("--status", flags.status, AUTOMATION_STATUSES);
  if (flags["post-id"] !== undefined) query.post_id = requireValue("--post-id", flags["post-id"]);

  const result = await apiRequest(config, "GET", "/automations", undefined, query);
  handleAutomationResult(result, flags, (data) => {
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
      console.log("No automations found. Create one with automations:create.");
      return;
    }
    console.log(`Automations (${rows.length})`);
    console.log("─".repeat(40));
    console.log(rows.map(formatAutomationRow).join("\n"));
  });
}

async function cmdAutomationsGet(config, flags, positional) {
  const id = flags.id || positional[0];
  if (!id) {
    exitWithError("Usage: omnisocials automations:get <id>");
  }

  const result = await apiRequest(config, "GET", `/automations/${id}`);
  handleAutomationResult(result, flags, (d) => {
    console.log(formatAutomationDetail(d));
    console.log(`Activity: automations:events ${d.id}`);
  });
}

async function cmdAutomationsCreate(config, flags) {
  if (flags.dm === undefined) {
    exitWithError(
      'Usage: omnisocials automations:create --dm "<text>" --keywords "guide,link" --post-id <id> [--reply "Sent you a DM!" --match word|contains|any --scope post|next_post|any --triggers comment,dm,story_reply --max-sends <n> --stop-at <ISO8601> --name "..." --paused]'
    );
  }

  const body = buildAutomationBody(flags);
  const result = await apiRequest(config, "POST", "/automations", body);
  handleAutomationResult(result, flags, (d) => {
    console.log("Automation created!");
    console.log(formatAutomationDetail(d));
    if (d.status === "paused") {
      console.log(`Turn it on with: automations:update ${d.id} --resume`);
    } else if (d.post_id && !d.instagram_media_id) {
      console.log("It starts listening once the post is live on Instagram.");
    }
    console.log(`Activity: automations:events ${d.id}`);
  });
}

async function cmdAutomationsUpdate(config, flags, positional) {
  const id = flags.id || positional[0];
  if (!id) {
    exitWithError(
      'Usage: omnisocials automations:update <id> [--keywords "guide,link" --match word|contains|any --dm "<text>" --reply "<text>" --post-id <id> | --instagram-media-id <id> --scope post|next_post|any --triggers comment,dm,story_reply --max-sends <n> --stop-at <ISO8601> --name "..." --pause | --resume]'
    );
  }

  const body = buildAutomationBody(flags, { partial: true });
  if (!Object.keys(body).length) {
    exitWithError("Nothing to update: pass at least one flag (see omnisocials --help)");
  }

  const result = await apiRequest(config, "PATCH", `/automations/${id}`, body);
  handleAutomationResult(result, flags, (d) => {
    console.log("Automation updated!");
    console.log(formatAutomationDetail(d));
  });
}

async function cmdAutomationsDelete(config, flags, positional) {
  const id = flags.id || positional[0];
  if (!id) {
    exitWithError("Usage: omnisocials automations:delete <id>");
  }

  const result = await apiRequest(config, "DELETE", `/automations/${id}`);
  handleAutomationResult(result, flags, () => {
    console.log("Automation deleted. It sends nothing more; DMs that went out stay in the inbox.");
  });
}

async function cmdAutomationsEvents(config, flags, positional) {
  const id = flags.id || positional[0];
  if (!id) {
    exitWithError(
      "Usage: omnisocials automations:events <id> [--outcome sent|skipped|failed|pending --limit <1-100> --offset <n>]"
    );
  }

  const query = {};
  if (flags.outcome !== undefined) query.outcome = pickOneOf("--outcome", flags.outcome, AUTOMATION_EVENT_OUTCOMES);
  if (flags.limit !== undefined) query.limit = flags.limit;
  if (flags.offset !== undefined) query.offset = flags.offset;

  const result = await apiRequest(config, "GET", `/automations/${id}/events`, undefined, query);
  handleAutomationResult(result, flags, (data) => {
    const events = Array.isArray(data) ? data : [];
    // `counts` covers every outcome of the automation, whatever --outcome
    // asked for; `pagination.total` is the size of the list asked for.
    const counts = result.counts && typeof result.counts === "object" ? result.counts : {};
    const countWords = Object.entries(counts)
      .map(([outcome, n]) => `${n} ${outcome}`)
      .join(", ");
    console.log(`Counts: ${countWords || "none yet"}`);
    const pagination = result.pagination || {};
    const total = typeof pagination.total === "number" ? pagination.total : events.length;
    console.log(`Events (${total}${query.outcome ? `, ${query.outcome}` : ""})`);
    if (!events.length) {
      console.log("No events yet.");
      return;
    }
    console.log("─".repeat(40));
    console.log(events.map(formatAutomationEvent).join("\n"));
    if (pagination.has_more) {
      const next = (Number(pagination.offset) || 0) + (Number(pagination.limit) || events.length);
      console.log(`\nMore: pass --offset ${next} for the next page.`);
    }
  });
}

// --- Locations (Instagram or Threads place tagging) ---
// --platform instagram (default) searches Facebook Places for Instagram tags;
// --platform threads searches Threads locations (DIFFERENT id namespace; a
// Facebook Place ID is not a Threads location id) and also accepts
// --latitude/--longitude instead of a name. Threads location tagging is
// rolling out; until Meta approves the permission the API answers
// error.code = not_available.

async function cmdLocationsSearch(config, flags, positional) {
  const platform = String(flags.platform || "instagram").toLowerCase();
  const q = flags.q || positional.join(" ");
  const hasCoords = flags.latitude !== undefined && flags.longitude !== undefined;

  if (platform === "threads" ? !hasCoords && (!q || q.trim().length < 2) : !q || q.trim().length < 2) {
    exitWithError(
      'Usage: omnisocials locations:search "<place name>" [--platform instagram|threads]\n' +
        "       omnisocials locations:search --platform threads --latitude 34.1184 --longitude -118.3004\n" +
        "(name min 2 chars; instagram returns location_id values, threads returns threads.location_id values)"
    );
  }

  const params = { platform };
  if (q && q.trim()) params.q = q;
  if (hasCoords) {
    params.latitude = flags.latitude;
    params.longitude = flags.longitude;
  }

  const label = q && q.trim() ? `"${q}"` : `${flags.latitude}, ${flags.longitude}`;
  const result = await apiRequest(config, "GET", "/locations/search", undefined, params);

  if (platform === "threads") {
    // Threads answers { locations: [...] } (no `data` wrapper) or
    // { error: { code, message } } with code not_available |
    // threads_not_connected | threads_reauth_required | platform_error.
    if (result.error) {
      const err = result.error;
      if (flags.json) {
        outputJson(result);
      } else {
        console.error(`Error [${err.code || "error"}]: ${err.message || err}`);
      }
      process.exit(1);
    }
    if (flags.json) {
      outputJson(result);
      return;
    }
    const locations = Array.isArray(result.locations) ? result.locations : [];
    if (!locations.length) {
      console.log(`No Threads locations found for ${label}. Try a more specific place name.`);
      return;
    }
    console.log(`Threads locations matching ${label} (${locations.length})`);
    console.log("─".repeat(40));
    for (const loc of locations) {
      const bits = [loc.address, loc.city, loc.country].filter(Boolean).join(", ");
      console.log(`threads.location_id: ${loc.id}  ${loc.name || ""}${bits ? `  (${bits})` : ""}`);
    }
    console.log("\nPass an id to posts:create/posts:update with --threads-location-id <id>.");
    return;
  }

  handleResult(result, flags, (data) => {
    const locations = Array.isArray(data) ? data : [];
    if (!locations.length) {
      console.log(`No taggable locations found for ${label}. Try a more specific venue name.`);
      return;
    }
    console.log(`Locations matching ${label} (${locations.length})`);
    console.log("─".repeat(40));
    for (const loc of locations) {
      console.log(`location_id: ${loc.id}  ${loc.name}${loc.address ? `  — ${loc.address}` : ""}`);
    }
  });
}

// --- Pinterest products (product tagging) ---
// A product tag is the Pin ID of one of the account's own product Pins.
// pinterest:products lists them: --source catalog reads the Pinterest catalog
// (with price and availability; needs catalog access on the connection),
// --source pins reads the account's own Pins and returns the ones Pinterest
// marks as product Pins (works on every connection). Without --source the API
// uses catalog when the connection has catalog access, else pins.
// pinterest:validate checks one Pin ID or Pin link. Both answer without a
// `data` wrapper.

async function cmdPinterestProducts(config, flags) {
  const source = flags.source;
  if (source !== undefined && !["catalog", "pins"].includes(source)) {
    console.error(
      "Usage: omnisocials pinterest:products [--source catalog|pins --product-group-id <id> --bookmark <bookmark> --page-size <1-100>]"
    );
    process.exit(1);
  }

  const result = await apiRequest(config, "GET", "/pinterest/products", undefined, {
    source,
    product_group_id: flags["product-group-id"],
    bookmark: flags.bookmark,
    page_size: flags["page-size"],
  });

  // Answers { products, bookmark, source, catalog_access, product_groups?,
  // product_group_id? } or { error: { code, message } }. The error comes as
  // HTTP 400 (validation_error) or as HTTP 200 with code
  // pinterest_not_connected | pinterest_catalog_access_required |
  // platform_error and no `products` key, like the Threads location search.
  // Print it as an error, never as an empty list.
  if (result.error) {
    const err = result.error;
    if (flags.json) {
      outputJson(result);
    } else {
      console.error(`Error [${err.code || "error"}]: ${err.message || err}`);
    }
    process.exit(1);
  }
  if (flags.json) {
    outputJson(result);
    return;
  }

  const products = Array.isArray(result.products) ? result.products : [];
  const fromCatalog = result.source === "catalog";
  const groups = Array.isArray(result.product_groups) ? result.product_groups : [];
  const printGroups = () => {
    if (groups.length < 2) return;
    const names = groups.map(
      (g) =>
        `${g.name || "Unnamed"} (${g.id})${String(g.id) === String(result.product_group_id) ? " [shown]" : ""}`
    );
    console.log(`Product groups (pick another with --product-group-id): ${names.join(", ")}`);
  };

  if (!products.length) {
    // The pins source scans up to 250 Pins per call, so a call can find no
    // product Pin while Pinterest still has more Pins to scan.
    if (result.bookmark) {
      console.log(
        `No product Pins in this batch. There are more Pins to scan: run the same command with --bookmark "${result.bookmark}".`
      );
      return;
    }
    if (result.no_catalog) {
      // Catalog access, but the account has no catalog yet (Pinterest 409).
      console.log(
        "The Pinterest account has no catalog yet. Add products at https://www.pinterest.com/business/catalogs/ and run the command again, or pass a product Pin link to posts:create --pinterest-product-tags."
      );
      return;
    }
    console.log(
      fromCatalog
        ? "No products found in this product group of the Pinterest catalog."
        : "No product Pins found on this Pinterest account."
    );
    printGroups();
    if (!fromCatalog && result.catalog_access === false) {
      console.log(
        "To list the products of a Pinterest catalog, give catalog access one time: in the OmniSocials composer open the Pinterest options, select Add products, then Connect catalog."
      );
    }
    return;
  }

  console.log(`Pinterest products (${products.length}, source: ${result.source})`);
  console.log("─".repeat(40));
  for (const p of products) {
    const bits = [];
    if (p.price !== null && p.price !== undefined) {
      bits.push(`${p.price}${p.currency ? ` ${p.currency}` : ""}`);
    }
    if (p.availability) bits.push(p.availability);
    if (p.item_id) bits.push(`item ${p.item_id}`);
    console.log(
      `pin_id: ${p.pin_id}  ${truncate(p.title, 60) || "Untitled"}${bits.length ? `  (${bits.join(", ")})` : ""}`
    );
    if (p.link) console.log(`  ${p.link}`);
  }
  printGroups();
  if (result.bookmark) {
    console.log(`\nMore: run the same command with --bookmark "${result.bookmark}" for the next page.`);
  }
  console.log(
    "\nPass ids to posts:create/posts:update with --pinterest-product-tags <id,id> (max 24 per Pin)."
  );
}

async function cmdPinterestValidate(config, flags, positional) {
  const id = typeof flags.id === "string" ? flags.id : positional[0];
  if (!id) {
    exitWithError(
      "Usage: omnisocials pinterest:validate <pin-id-or-link>  (a Pin ID or https://www.pinterest.com/pin/<id>/; pin.it short links do not work)"
    );
  }

  const result = await apiRequest(config, "GET", "/pinterest/products/validate", undefined, { id });
  // Answers { valid, pin_id, title?, link?, image_url?, unverified?, reason? }
  // with no `data` wrapper. unverified = the check could not run (no Pinterest
  // account, Pinterest did not answer, or it did not say if the Pin is a
  // product Pin); the publish step is then the final check.
  handleResult(result, flags, () => {
    const pin = result.pin_id ? ` (${result.pin_id})` : "";
    if (result.valid) {
      console.log(`Valid product Pin: ${result.pin_id}${result.title ? `  ${result.title}` : ""}`);
      if (result.link) console.log(`  ${result.link}`);
      console.log(`Tag it with: posts:create ... --pinterest-product-tags ${result.pin_id}`);
      return;
    }
    if (result.unverified) {
      console.log(`Not checked${pin}: ${result.reason || "the check could not run."}`);
      return;
    }
    console.log(`Not valid${pin}: ${result.reason || "this Pin cannot be tagged as a product."}`);
  });
}

// --- Audio (Instagram Reel music) ---

async function cmdAudioSearch(config, flags, positional) {
  const q = flags.q || positional.join(" ");
  const params = {};
  if (q && q.trim()) params.q = q.trim();
  if (flags.type) params.type = flags.type; // music (default) | original_sound

  const result = await apiRequest(config, "GET", "/audio/search", undefined, params);
  // Unavailable search (e.g. no Facebook account linked to the IG account)
  // comes back 200 with a plain-string `error` — an expected state, not a
  // failure, so surface it as a message instead of letting handleResult
  // treat it as an {code,message} API error.
  if (result && typeof result.error === "string") {
    if (flags.json) outputJson(result);
    else console.log(result.error);
    return;
  }
  handleResult(result, flags, (data) => {
    const tracks = Array.isArray(data) ? data : [];
    if (!tracks.length) {
      console.log(
        params.q
          ? `No tracks found for "${params.q}". Only music licensed for third-party publishing appears here.`
          : "No trending audio available right now."
      );
      return;
    }
    const fmtDur = (ms) => {
      if (!ms) return "";
      const s = Math.round(ms / 1000);
      return `  ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };
    console.log(params.q ? `Audio matching "${params.q}" (${tracks.length})` : `Trending audio (${tracks.length})`);
    console.log("─".repeat(40));
    for (const t of tracks) {
      console.log(`audio_id: ${t.audio_id}  ${t.title || "Untitled"}${t.artist || t.ig_username ? `  — ${t.artist || t.ig_username}` : ""}${fmtDur(t.duration_ms)}`);
    }
    console.log("\nPass an id to posts:create with --instagram-audio-id (reels only).");
  });
}

// --- Accounts ---

async function cmdAccountsList(config, flags) {
  const result = await apiRequest(config, "GET", "/accounts");

  handleResult(result, flags, (data) => {
    const accounts = Array.isArray(data) ? data : data?.accounts || [];
    if (!accounts.length) {
      console.log("No connected accounts found.");
      return;
    }
    console.log(`Connected Accounts (${accounts.length})`);
    console.log("─".repeat(40));
    console.log(accounts.map((a, i) => formatAccount(a, i)).join("\n\n"));
  });
}

async function cmdAccountsGet(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials accounts:get <id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "GET", `/accounts/${id}`);
  handleResult(result, flags);
}

// --- Analytics ---

// Canonical render order + labels for per-platform metric objects. Any numeric
// key the API returns that isn't listed here still renders (prettified from
// snake_case) so no metric is ever silently dropped — reach/saves/views used to
// vanish because the renderers printed a fixed field set. Mirrors the MCP
// server's metricRows.
const METRIC_LABELS = [
  ["impressions", "impressions"],
  ["reach", "reach"],
  ["views", "views"],
  ["likes", "likes"],
  ["comments", "comments"],
  ["shares", "shares"],
  ["saves", "saves"],
  ["clicks", "clicks"],
  ["reposts", "reposts"],
  ["quotes", "quotes"],
  ["bookmarks", "bookmarks"],
  ["replies", "replies"],
  ["reactions", "reactions"],
  ["total_reactions", "total reactions"],
  ["favorites", "favorites"],
  ["plays", "plays"],
  ["engagement", "engagements"],
];

// Context keys that ride along in stored metrics — not counters.
const NON_COUNTER_KEYS = new Set(["create_time"]);

// Flatten a raw metrics object into ordered [label, value] pairs, keeping every
// numeric counter the platform reported. Strings (note, title, cover_image_url)
// are skipped; `plays` is a legacy always-0 Instagram back-compat key so a zero
// there is noise, not data.
function metricRows(m) {
  const rows = [];
  const seen = new Set();
  for (const [key, label] of METRIC_LABELS) {
    const v = m?.[key];
    if (v === undefined || v === null) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    seen.add(key);
    if (key === "plays" && n === 0) continue;
    rows.push([label, n]);
  }
  for (const [key, v] of Object.entries(m || {})) {
    if (seen.has(key) || NON_COUNTER_KEYS.has(key)) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    rows.push([key.replace(/_/g, " "), n]);
  }
  return rows;
}

// Engagement/impressions normalizers — vendored from the web app's
// shared/analytics-metrics module (the single source of truth used by the
// dashboard, public API, and both MCP servers). Keep in sync when the rules
// change there. The old inline likes+comments+shares sum dropped LinkedIn
// link clicks and X quotes/bookmarks, so this CLI reported different
// engagement totals than the app for the same post.
function numOr0(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getEngagement(platform, metrics) {
  const m = metrics || {};
  // Trust a precomputed engagement count when a fetcher supplied one; a
  // stored 0 means "not computed" for the platforms that don't set it.
  const pre = numOr0(m.engagement);
  if (pre > 0) return pre;
  const sum = (...keys) => keys.reduce((t, k) => t + numOr0(m[k]), 0);
  switch (platform) {
    case "facebook":
      return (numOr0(m.total_reactions) || numOr0(m.likes)) + numOr0(m.comments) + numOr0(m.shares);
    case "linkedin":
    case "linkedin_page":
      // LinkedIn's native engagement includes link clicks.
      return sum("likes", "comments", "shares", "clicks");
    case "youtube":
    case "reddit":
    case "tiktok":
      return sum("likes", "comments", "shares");
    case "x":
      return sum("likes", "comments", "reposts", "quotes", "bookmarks");
    case "threads":
      return numOr0(m.likes) + (numOr0(m.comments) || numOr0(m.replies)) + numOr0(m.reposts) + numOr0(m.quotes);
    case "bluesky":
      return sum("likes", "comments", "reposts", "quotes");
    case "mastodon":
      return sum("likes", "comments", "reposts");
    case "instagram":
      return sum("likes", "comments", "saves", "shares");
    case "pinterest":
      return sum("saves", "pin_clicks", "outbound_clicks");
    case "google_business":
      return pre;
    default:
      return sum("likes", "comments", "replies", "shares", "reposts", "quotes", "saves");
  }
}

function getImpressions(platform, metrics) {
  const m = metrics || {};
  switch (platform) {
    case "instagram":
      return numOr0(m.views) || numOr0(m.impressions) || numOr0(m.reach);
    case "facebook":
      return numOr0(m.reach) || numOr0(m.impressions) || numOr0(m.video_views) || numOr0(m.views);
    case "linkedin":
    case "linkedin_page":
    case "pinterest":
    case "google_business":
      return numOr0(m.impressions) || numOr0(m.views) || numOr0(m.reach);
    default:
      return numOr0(m.views) || numOr0(m.impressions) || numOr0(m.reach);
  }
}

async function cmdAnalyticsPost(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials analytics:post <post-id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "GET", `/analytics/posts/${id}`);

  handleResult(result, flags, (data) => {
    // API returns { post_id, platforms: { <platform>: { metrics: {...} } } }.
    // Each platform's metrics are already summed across thread parts server-side
    // (thread posts publish as a chain), so we just total across platforms here.
    // The old code read a flat data.impressions/platform_stats shape that this
    // endpoint never returns, so every field printed N/A. Aggregate the
    // per-platform metrics the same way the dashboard does (IG uses reach,
    // others use views; engagement falls back to likes+comments+shares).
    const platforms = data.platforms || {};
    const entries = Object.entries(platforms);
    console.log(`Analytics for Post ${data.post_id || id}`);
    console.log("─".repeat(40));

    if (!entries.length) {
      console.log(
        "No analytics collected yet. Stats are fetched periodically after publishing; check back in a few hours."
      );
      return;
    }

    const totals = { impressions: 0, engagements: 0, likes: 0, comments: 0, shares: 0 };
    const perPlatform = [];
    for (const [platform, entry] of entries) {
      const m = (entry && entry.metrics) || {};
      const impressions = getImpressions(platform, m);
      const likes = Number(m.likes ?? m.favorites ?? m.reactions ?? 0);
      const comments = Number(m.comments ?? m.replies ?? 0);
      const shares = Number(m.shares ?? m.retweets ?? m.reposts ?? 0);
      const engagements = getEngagement(platform, m);
      totals.impressions += impressions;
      totals.engagements += engagements;
      totals.likes += likes;
      totals.comments += comments;
      totals.shares += shares;
      perPlatform.push({ platform, metrics: m, engagements });
    }

    console.log(`Impressions: ${totals.impressions}`);
    console.log(`Engagements: ${totals.engagements}`);
    console.log(`Likes: ${totals.likes}`);
    console.log(`Comments: ${totals.comments}`);
    console.log(`Shares: ${totals.shares}`);
    console.log("\nPer-platform (every metric the platform reported):");
    for (const p of perPlatform) {
      const parts = metricRows(p.metrics).map(([label, n]) => `${n} ${label}`);
      const note = typeof p.metrics.note === "string" ? `\n    note: ${p.metrics.note}` : "";
      console.log(`  ${p.platform}: ${parts.join(", ") || "no metrics"}${note}`);
    }
  });
}

async function cmdAnalyticsPosts(config, flags, positional) {
  // Accept ids comma-separated, space-separated, or a mix:
  //   analytics:posts 1024,1025   |   analytics:posts 1024 1025
  const ids = positional
    .join(",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    console.error(
      "Usage: omnisocials analytics:posts <id,id,...>  (up to 100 post ids, comma- or space-separated)"
    );
    process.exit(1);
  }

  const result = await apiRequest(config, "GET", "/analytics/posts", undefined, {
    ids: ids.join(","),
  });

  handleResult(result, flags, (data) => {
    // API returns { data: [{ post_id, platforms: { <platform>: { metrics } } }] }.
    // result.data is that array. Total each post's per-platform metrics, using
    // the same normalization as the dashboard (Instagram reach vs views, etc.).
    const entries = Array.isArray(data) ? data : [];
    console.log(`Analytics for ${entries.length} posts`);
    console.log("─".repeat(40));
    for (const entry of entries) {
      const platforms = entry.platforms || {};
      let impressions = 0;
      let engagements = 0;
      for (const [name, p] of Object.entries(platforms)) {
        const m = (p && p.metrics) || {};
        impressions += getImpressions(name, m);
        engagements += getEngagement(name, m);
      }
      const names = Object.keys(platforms).join(", ") || "no stats collected yet";
      console.log(
        `Post ${entry.post_id}: ${impressions} impressions, ${engagements} engagements (${names})`
      );
    }
  });
}

async function cmdAnalyticsOverview(config, flags) {
  const result = await apiRequest(config, "GET", "/analytics/overview", undefined, {
    period: flags.period,
    start_date: flags["start-date"],
    end_date: flags["end-date"],
  });

  handleResult(result, flags, (data) => {
    // `period` and the resolved date range live at the top level of the
    // response, not inside `data` (the summary). The summary uses singular
    // `total_engagement` (not `total_engagements`).
    console.log("Analytics Overview");
    console.log("─".repeat(40));
    console.log(`Period: ${result.period || data.period || "custom"}`);
    console.log(`Total posts: ${data.total_posts ?? "N/A"}`);
    console.log(`Total impressions: ${data.total_impressions ?? "N/A"}`);
    console.log(`Total engagements: ${data.total_engagement ?? "N/A"}`);
    if (data.average_engagement_rate != null) {
      console.log(`Avg engagement rate: ${Number(data.average_engagement_rate).toFixed(2)}%`);
    }
    if (data.top_performing_platform) {
      console.log(`Top platform: ${data.top_performing_platform}`);
    }
  });
}

async function cmdAnalyticsAccounts(config, flags) {
  const result = await apiRequest(config, "GET", "/analytics/accounts", undefined, {
    platform: flags.platform,
    date: flags.date,
  });

  handleResult(result, flags);
}

async function cmdAnalyticsBestTimes(config, flags) {
  if (!flags.platform) {
    console.error("Usage: omnisocials analytics:best-times --platform <platform> [--timezone <IANA tz>]");
    process.exit(1);
  }
  const result = await apiRequest(config, "GET", "/analytics/best-times", undefined, {
    platform: flags.platform,
    timezone: flags.timezone,
  });

  // Response is a top-level object (no data wrapper) — render from the closure.
  handleResult(result, flags, () => {
    const cap = (v) => (typeof v === "string" && v ? v.charAt(0).toUpperCase() + v.slice(1) : v);
    console.log(`Best times to post — ${cap(result.platform)} (${result.timezone})`);
    console.log("─".repeat(40));
    (result.recommendations || []).forEach((r, i) => {
      const extras = [];
      if (r.typical_engagement) extras.push(`~${r.typical_engagement} typical engagement`);
      if (r.n) extras.push(`${r.n} posts`);
      console.log(`${i + 1}. ${cap(r.day)} ${r.time}  (score ${r.score}${extras.length ? `, ${extras.join(", ")}` : ""})`);
    });
    if (result.basis === "defaults") {
      console.log(`\nNot enough posting history yet (${result.sample_size} analyzed posts). These are cross-industry averages. Publish ${result.posts_needed} more posts on this platform to unlock recommendations from your own audience data.`);
    } else if (result.basis === "audience") {
      console.log(`\nNot enough posting history yet (${result.sample_size} analyzed posts), so these times come from when your followers are online. Publish ${result.posts_needed} more posts on this platform to blend in your own results.`);
    } else if (result.basis === "own_data_and_audience") {
      console.log(`\nBased on ${result.sample_size} posts from the last ${result.window_days} days, blended with when your followers are online (metric: ${result.metric}, times in ${result.timezone}).`);
    } else {
      console.log(`\nBased on ${result.sample_size} posts from the last ${result.window_days} days (metric: ${result.metric}, times in ${result.timezone}).`);
    }
  });
}

// --- Social Inbox ---
// The Social Inbox uses OPT-IN scopes: inbox:read lists/reads conversations,
// inbox:write replies and marks read (enabled via "Social Inbox access" when the
// API key is created). conversation_id values can contain ":" and "()" (LinkedIn
// URNs), so every id is encodeURIComponent'd into the request path.

async function cmdInboxList(config, flags) {
  const result = await apiRequest(config, "GET", "/inbox/conversations", undefined, {
    platform: flags.platform,
    type: flags.type,
    unread: flags.unread,
    unanswered: flags.unanswered,
    limit: flags.limit,
    cursor: flags.cursor,
  });

  handleResult(result, flags, (data) => {
    const convos = Array.isArray(data) ? data : [];
    if (!convos.length) {
      console.log("No conversations found.");
      return;
    }
    console.log(`Conversations (${convos.length})`);
    console.log("─".repeat(40));
    console.log(convos.map((c, i) => formatConversation(c, i)).join("\n\n"));
    printPagination(result.pagination);
  });
}

async function cmdInboxMessages(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials inbox:messages <conversation-id> [--limit --cursor]");
    process.exit(1);
  }

  const result = await apiRequest(
    config,
    "GET",
    `/inbox/conversations/${encodeURIComponent(id)}/messages`,
    undefined,
    { limit: flags.limit, cursor: flags.cursor }
  );

  handleResult(result, flags, (data) => {
    const messages = Array.isArray(data) ? data : [];
    if (!messages.length) {
      console.log("No messages in this conversation.");
      return;
    }
    // Comment/mention threads: show the post the thread is on first so a
    // reply can be drafted with it in view (DMs carry no post).
    const withPost = messages.find((m) => m && m.post);
    if (withPost) {
      console.log(formatPostBlock(withPost.post));
      console.log("");
    }
    console.log(`Messages (${messages.length})`);
    console.log("─".repeat(40));
    console.log(messages.map((m, i) => formatMessage(m, i)).join("\n\n"));
    printPagination(result.pagination);
  });
}

async function cmdInboxMarkRead(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials inbox:read <conversation-id>");
    process.exit(1);
  }

  const result = await apiRequest(
    config,
    "POST",
    `/inbox/conversations/${encodeURIComponent(id)}/read`
  );

  // Response is a top-level object ({ conversation_id, marked_read }) with no
  // `data` wrapper — read it straight off `result` in the closure.
  handleResult(result, flags, () => {
    const convId = result.conversation_id || id;
    if (result.marked_read) {
      console.log(`Conversation ${convId} marked as read.`);
    } else {
      console.log(`Conversation ${convId} had no unread messages.`);
    }
  });
}

// Send a reply. Every comment on a post shares ONE conversation, so on a
// comment/mention thread pass --message-id <message-id> (the "Message to
// answer" id from inbox:next, or a message id from inbox:messages) to name the
// comment being answered; without it the API replies under the NEWEST incoming
// comment on the post, which may be a different person. Ignored for DMs (a DM
// reply goes to the conversation). Instagram/Facebook DMs whose 24-hour window
// has closed answer 422 outside_messaging_window before anything is sent:
// answer them from the native app, do not retry.
async function cmdInboxReply(config, flags, positional) {
  const id = positional[0];
  const text = flags.text;
  const usage =
    'Usage: omnisocials inbox:reply <conversation-id> --text "..." [--message-id <message-id> --attachment-url <url> --attachment-type <type> --next]';
  if (!id || !text) {
    console.error(usage);
    process.exit(1);
  }
  const messageId = flags["message-id"];
  if (messageId !== undefined && !/^\d+$/.test(String(messageId))) {
    console.error(usage);
    console.error(
      "--message-id takes the numeric message id printed by inbox:next (Message to answer) or inbox:messages, not the conversation id."
    );
    process.exit(1);
  }

  const body = { text };
  if (messageId !== undefined) body.message_id = String(messageId);
  if (flags["attachment-url"]) body.attachment_url = flags["attachment-url"];
  if (flags["attachment-type"]) body.attachment_type = flags["attachment-type"];
  // --next: the response also carries the next conversation that needs an
  // answer (`next`, same shape as inbox:next) and `remaining`, so working
  // through the inbox is one call per answer.
  if (flags.next) body.include_next = true;

  const result = await apiRequest(
    config,
    "POST",
    `/inbox/conversations/${encodeURIComponent(id)}/reply`,
    body
  );

  handleResult(result, flags, (data) => {
    console.log("Reply sent!");
    if (data && data.id) console.log(`Message ID: ${data.id}`);
    if (data && data.timestamp) console.log(`Sent: ${data.timestamp}`);
    if (flags.next) {
      console.log("");
      printNextItem(result.next, result.remaining);
    }
  });
}

// Hide (or unhide with --unhide) a comment someone left on one of the user's
// posts, as the post owner. Facebook, Instagram, TikTok, YouTube (hide = the
// comment's moderation status set to rejected, which also pulls its replies
// from public view) and Threads (incoming top-level replies only; nested
// replies return not_hideable). Takes the message id from inbox:messages or
// inbox:next, NOT the conversation id. Errors worth relaying: 403
// reconnect_required (account connected without the moderation permission;
// reconnect it in the dashboard), 422 cannot_hide (Facebook will not let the
// Page hide this comment; retrying never changes it), 429 quota_exceeded
// (YouTube daily quota), 502 hide_not_applied (Instagram accepted the call but
// still reports the comment in the old state, e.g. "Comments from Facebook"
// under a reel shared to Facebook; hide it in the Instagram or Facebook app,
// do not retry), 401 reauth_required, 404 account_not_connected, 502
// platform_error. After an Instagram hide/unhide the API reads the comment
// back, so `hidden` in the response is Instagram's own state.
async function cmdInboxHide(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error(
      "Usage: omnisocials inbox:hide <message-id> [--unhide]  (Facebook, Instagram, TikTok, YouTube, Threads comments on your posts; id from inbox:messages or inbox:next)"
    );
    process.exit(1);
  }

  const result = await apiRequest(
    config,
    "POST",
    `/inbox/messages/${encodeURIComponent(id)}/hide`,
    { hide: !flags.unhide }
  );

  handleResult(result, flags, (data) => {
    const where = data && data.platform ? ` on ${data.platform}` : "";
    if (data && data.hidden === true) {
      console.log(`Comment ${id} is now hidden${where}.`);
    } else {
      console.log(`Comment ${id} is visible${where} again.`);
    }
  });
}

// Work queue: the next conversation that still needs an answer, with its
// thread and the post it is on, so a reply can be drafted from one call.
// Order: DMs that can still be answered first (Instagram/Facebook DMs inside
// Meta's 24-hour window, soonest to close first, and X DMs), then
// Instagram/Facebook DMs whose window has closed (served so the customer is
// not left waiting; reply_window.open is false), then comments and mentions
// oldest first. --order newest reverses within each group. Only unread items
// are served by default: inbox:read is the durable skip, --exclude a
// temporary one for this call. Looks back 30 days.
async function cmdInboxNext(config, flags) {
  const order = flags.order;
  if (order !== undefined && !["oldest", "newest"].includes(order)) {
    console.error(
      "Usage: omnisocials inbox:next [--platform <platform> --type dm|comment|mention --order oldest|newest --include-read --exclude <conv-id,conv-id>]"
    );
    process.exit(1);
  }
  const exclude =
    typeof flags.exclude === "string" ? splitComma(flags.exclude).join(",") : undefined;

  const result = await apiRequest(config, "GET", "/inbox/next", undefined, {
    platform: flags.platform,
    type: flags.type,
    order,
    include_read: flags["include-read"],
    exclude,
  });

  handleResult(result, flags, (data) => {
    printNextItem(data, result.remaining);
  });
}

// Delete a comment from the platform for good. Facebook, Instagram and TikTok
// comments only (YouTube offers no delete for other people's comments: use
// inbox:hide). Cannot be undone. Replies under the comment go with it. Takes
// the message id from inbox:messages or inbox:next, NOT the conversation id.
async function cmdInboxDelete(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error(
      "Usage: omnisocials inbox:delete <message-id>  (Facebook, Instagram, TikTok comments; id from inbox:messages or inbox:next; cannot be undone)"
    );
    process.exit(1);
  }

  const result = await apiRequest(
    config,
    "DELETE",
    `/inbox/messages/${encodeURIComponent(id)}`
  );

  handleResult(result, flags, (data) => {
    const d = data || {};
    console.log(`Comment ${d.id || id} deleted from the platform.`);
    if (d.conversation_id) console.log(`Conversation: ${d.conversation_id}`);
    const replies = Array.isArray(d.removed_reply_ids) ? d.removed_reply_ids : [];
    if (replies.length) {
      const noun = replies.length === 1 ? "reply" : "replies";
      console.log(`Also removed ${replies.length} ${noun} under it: ${replies.join(", ")}`);
    }
  });
}

// --- Webhooks ---

// Every event the API accepts in --events. post.approved / post.rejected fire
// when the review of a post in an approval workflow ends; their payload
// carries data.approval { status, decided_by, reason } and an empty targets
// array. The API validates the list (400 on anything else), the CLI only
// prints it.
const WEBHOOK_EVENTS = [
  "post.scheduled",
  "post.published",
  "post.failed",
  "post.approved",
  "post.rejected",
];

async function cmdWebhooksList(config, flags) {
  const result = await apiRequest(config, "GET", "/webhooks");

  handleResult(result, flags, (data) => {
    const webhooks = Array.isArray(data) ? data : data?.webhooks || [];
    if (!webhooks.length) {
      console.log("No webhooks configured.");
      return;
    }
    console.log(`Webhooks (${webhooks.length})`);
    console.log("─".repeat(40));
    console.log(webhooks.map((w, i) => formatWebhook(w, i)).join("\n\n"));
  });
}

async function cmdWebhooksCreate(config, flags) {
  const url = flags.url;
  const events = splitComma(flags.events);

  if (!url || !events?.length) {
    console.error(
      "Usage: omnisocials webhooks:create --url \"https://...\" --events post.scheduled,post.published"
    );
    console.error(`Events: ${WEBHOOK_EVENTS.join(", ")}`);
    process.exit(1);
  }

  const result = await apiRequest(config, "POST", "/webhooks", { url, events });

  handleResult(result, flags, (data) => {
    console.log("Webhook created successfully!");
    console.log(`ID: ${data.id}`);
    console.log(`URL: ${data.url}`);
    console.log(`Events: ${data.events.join(", ")}`);
    if (data.secret) {
      console.log(`Secret: ${data.secret}`);
      console.log("(Save this secret - it won't be shown again)");
    }
  });
}

async function cmdWebhooksGet(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials webhooks:get <id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "GET", `/webhooks/${id}`);
  handleResult(result, flags);
}

async function cmdWebhooksUpdate(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials webhooks:update <id> [--url ...] [--events ...] [--active true|false]");
    process.exit(1);
  }

  const body = {};
  if (flags.url) body.url = flags.url;
  if (flags.events) body.events = splitComma(flags.events);
  if (flags.active !== undefined) {
    body.is_active = flags.active === true || flags.active === "true";
  }

  const result = await apiRequest(config, "PATCH", `/webhooks/${id}`, body);

  handleResult(result, flags, (data) => {
    console.log("Webhook updated successfully!");
    console.log(`ID: ${data.id}`);
  });
}

async function cmdWebhooksDelete(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials webhooks:delete <id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "DELETE", `/webhooks/${id}`);

  if (result.error) {
    handleResult(result, flags);
  } else {
    if (flags.json) {
      outputJson({ success: true, message: "Webhook deleted." });
    } else {
      console.log("Webhook deleted successfully.");
    }
  }
}

async function cmdWebhooksRotateSecret(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials webhooks:rotate-secret <id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "POST", `/webhooks/${id}/rotate-secret`);

  handleResult(result, flags, (data) => {
    console.log("Webhook secret rotated!");
    console.log(`ID: ${data.id}`);
    if (data.secret) {
      console.log(`New secret: ${data.secret}`);
      console.log("(Save this secret - it won't be shown again)");
    }
  });
}

// ─── Help ───────────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`OmniSocials CLI v${VERSION}

Manage social media across 11 platforms from the command line.

CHANNELS
  instagram, facebook, linkedin (profile), linkedin_page (company page),
  youtube, tiktok, x, pinterest, bluesky, threads, mastodon, google_business

SETUP
  setup                          Configure your API key
  setup --api-key <key> --global Non-interactive setup
  config:show                    Show current configuration

POSTS
  posts:list                     List posts [--status --limit --offset]
  posts:get <id>                 Get post details
  posts:recent-platform          Fetch recent posts live from connected platforms [--limit --platforms] (analytics:read)
  posts:create                   Create a post [--text --channels --schedule --draft --type --media-urls --media-ids --media-fit]
  posts:create-and-publish       Create and publish immediately
  posts:update <id>              Update a draft/scheduled post [--no-draft schedules a planned draft, --draft unschedules]
  posts:publish <id>             Publish a post now (refuses failed posts; use posts:retry)
  posts:retry <id>               Retry only the failed platforms of a failed/partially failed post (async; max 3 retries per platform)
  posts:approve <id>             Approve the current step of a post's approval workflow (must be a listed approver for that step)
  posts:reject <id>              Reject a post's approval workflow, stopping it immediately [--comment "..."]
  posts:approval <id>            Read a post's approval review: steps, approvers, who rejected it and why, comments
  posts:delete <id>              Remove a post from OmniSocials (the live post stays)

MEDIA
  media:list                     List media files [--limit --offset]
  media:upload                   Upload from URL (image, video, or PDF) [--url --filename --name --folder --folder-id --pdf-mode]
  media:upload-base64            Upload a local file or base64 [--file | --data --mime-type] [--name --folder --folder-id --pdf-mode]
  media:check                    Check media compatibility [--url | --media-id | --size-bytes --mime]; a library image also gets an "Image fit" block: how Instagram and Pinterest show it as a feed post, with the --media-fit override
  media:delete <id>              Delete a media file
  (PDF: a PDF is split into one image slide per page — pass all returned media IDs to posts:create as a carousel. --pdf-mode document keeps it as ONE media item whose single ID expands into every page. The original file is kept and LinkedIn receives it when the pages are posted unchanged)

FOLDERS
  folders:list                   List media folders
  folders:create                 Create a folder [--name --parent-id]

APPROVAL WORKFLOWS
  approval-workflows:list        List the workspace's approval workflows (id, steps, approvers); pass an id to posts:create --approval-workflow

HASHTAG SETS
  hashtag-sets:list              List saved hashtag sets (id, name, tags)
  hashtag-sets:create            Save a reusable set [--name --tags "#a #b #c"]
  hashtag-sets:update <id>       Rename / replace tags [--name --tags] (--tags replaces the FULL list)
  hashtag-sets:delete <id>       Delete a set (existing posts keep their tags)

AUTOMATIONS (comment to DM on Instagram: needs the opt-in automations:read / automations:write scopes)
  automations:list               List automations: trigger, post, stats [--status active|paused|completed --post-id <id>]
  automations:get <id>           Full detail: trigger, post, DM, public reply, limits, stats
  automations:create             Answer a keyword in a comment with a DM, once per person [--dm "<text>" (required) --keywords "guide,link" --post-id <id> | --instagram-media-id <id> --reply "<text>" (repeat for variations) --match word|contains|any --scope post|next_post|any --triggers comment,dm,story_reply --max-sends <n> --stop-at <ISO8601> --name --paused]
  automations:update <id>        Change only what you pass; the rest keeps its value [same flags, plus --pause | --resume]
  automations:delete <id>        Delete an automation (DMs that went out stay)
  automations:events <id>        Activity: who wrote what, the DM sent or why it was skipped [--outcome sent|skipped|failed|pending --limit <1-100> --offset]

LOCATIONS
  locations:search "<name>"      Find location ids for a place [--platform instagram|threads --latitude --longitude]

PINTEREST
  pinterest:products             List the product Pins of the connected Pinterest account, to tag on a Pin [--source catalog|pins --product-group-id --bookmark --page-size]
  pinterest:validate <pin>       Check that a Pin ID or Pin link is a product Pin you can tag

AUDIO
  audio:search ["<song/artist>"] Instagram Reel music from Meta's licensed catalog; no query = trending [--type music|original_sound]

ACCOUNTS
  accounts:list                  List connected accounts
  accounts:get <id>              Get account details

ANALYTICS
  analytics:post <id>            Get post analytics
  analytics:posts <id,id,...>    Get analytics for up to 100 posts in one call (bulk)
  analytics:overview             Workspace analytics [--period --start-date --end-date]
  analytics:accounts             Account analytics [--platform --date]
  analytics:best-times           Recommended posting slots [--platform (required) --timezone]

INBOX (Social Inbox: needs the opt-in inbox:read / inbox:write scopes)
  inbox:list                     List conversations [--platform --type dm|comment|mention --unread --unanswered --limit --cursor]
  inbox:next                     Next conversation that needs an answer (answerable DMs first, then expired Meta DMs flagged by reply_window, then comments), with its thread and post [--platform --type --order oldest|newest --include-read --exclude <conv-id,conv-id>]
  inbox:messages <conv-id>       Full message history for one conversation; comment threads print the post first [--limit --cursor]
  inbox:read <conv-id>           Mark a conversation's messages as read; also the durable skip for inbox:next (inbox:write)
  inbox:reply <conv-id>          Reply to a conversation [--text (required) --message-id <message-id> (the comment being answered; always pass it on comment threads) --attachment-url --attachment-type --next] (inbox:write)
  inbox:hide <message-id>        Hide a comment on your post (Facebook, Instagram, TikTok, YouTube, Threads); --unhide reverses it (inbox:write)
  inbox:delete <message-id>      Delete a comment from the platform (Facebook, Instagram, TikTok); cannot be undone (inbox:write)

WEBHOOKS
  webhooks:list                  List webhooks
  webhooks:create                Create webhook [--url --events] (events: post.scheduled, post.published, post.failed, post.approved, post.rejected)
  webhooks:get <id>              Get webhook details
  webhooks:update <id>           Update webhook [--url --events --active]
  webhooks:delete <id>           Delete a webhook
  webhooks:rotate-secret <id>    Rotate webhook secret

GLOBAL FLAGS
  --json                         Output raw JSON
  --api-key <key>                Override API key
  --base-url <url>               Override API base URL
  --help                         Show this help

POST OPTIONS (for posts:create / posts:create-and-publish / posts:update)
  --channels <a,b>               Channel ids (see CHANNELS above)
  --type <post|story|reel>       Content type
  --schedule <ISO8601>           Schedule time (e.g. 2026-07-01T09:00:00Z)
  --draft                        With --schedule: store a planned draft (on the calendar at that time, not published until a person schedules it, or posts:update --no-draft). On posts:update alone: unschedule a scheduled post, keeping its time
  --no-draft                     posts:update only: schedule a planned draft at the time it already carries
  --media-urls <url,url>         Attach media by URL
  --media-ids <id,id>            Attach media from the library
  --media-fit <ch=action,..>     Feed image outside what a channel shows uncropped, per channel: instagram=keep,pinterest=crop (actions auto|crop|keep). Default: Instagram crops a 9:16 image to 4:5 (wide: 1.91:1) around the subject because Instagram cuts it to that window anyway and Meta cannot boost it otherwise; Pinterest keeps a Pin taller than 2:3. Every decision is printed as a [image_fit] warning after the post is created. On posts:update alone it re-decides the stored images (instagram=keep gives the original back). Never on stories, reels or videos
  --link-url <url>               Link preview (LinkedIn/Facebook); --link-title --link-description --link-thumbnail-url
  --hashtag-set <name>           Apply a saved hashtag set by name (see hashtag-sets:list)
  --hashtag-placement <mode>     caption_append (default) or first_comment
  --hashtag-platforms <a,b>      Only apply the set to these channels
  --approval-workflow <id>       Hold the post for review in this approval workflow (see approval-workflows:list); needs --schedule
  --dm-keywords <a,b>            Comment to DM: whoever comments one of these words on the post gets a DM, once per person (Instagram must be in --channels; needs automations:write on the key). Pair with --dm-message
  --dm-message "<text>"          Comment to DM: the DM to send (max 1000 chars)
  --dm-reply "<text>"            Comment to DM: public reply under the comment; repeat the flag (or pass a comma list) for rotating variations, max 10
  --dm-match <mode>              Comment to DM: word (default, whole word), contains, any (every comment, no keywords)
  --dm-max-sends <n>             Comment to DM: stop after n DMs
  --dm-stop-at <ISO8601>         Comment to DM: stop at this time
  --no-dm                        posts:update only: remove the post's comment-to-DM automation
  --location-id <id>             Instagram place tag (from locations:search)
  --threads-location-id <id>     Threads place tag (from locations:search --platform threads; "null" clears on update)
  --collaborators <a,b>          Instagram co-author usernames (max 3)
  --user-tags '<json>'           Instagram photo tags, JSON array [{"username","x","y","image_index?"}]
  --x-thread "a || b || c"       Post an X thread; parts split on "||"
  --bluesky-thread "a || b || c" Post a Bluesky thread; parts split on "||"
  --mastodon-thread "a || b || c" Post a Mastodon thread; parts split on "||"
  --threads-thread "a || b || c" Post a Threads (Meta) thread; parts split on "||"

PLATFORM FLAGS
  --pinterest-board-id           Pinterest board ID (required for Pinterest)
  --pinterest-title              Pinterest pin title
  --pinterest-link               Pinterest pin link
  --pinterest-video-cover        Pinterest video cover image URL
  --pinterest-alt-text           Pinterest pin alt text
  --pinterest-product-tags       Pinterest products to tag on the Pin: comma-separated Pin IDs or Pin links of your own product Pins (max 24; from pinterest:products)
  --youtube-title                YouTube video title
  --youtube-privacy              YouTube privacy (public/private/unlisted)
  --youtube-tags                 YouTube tags (comma-separated)
  --youtube-category-id          YouTube category ID
  --youtube-made-for-kids        YouTube made for kids flag
  --youtube-first-comment        Auto first comment on the video (video must allow comments)
  --instagram-share-to-feed      Share Instagram reel to feed
  --instagram-cover-url          Instagram reel cover image URL (with --instagram-thumbnail-type from-library)
  --instagram-thumbnail-type     Reel cover source: from-video (frame at --instagram-thumb-offset) or from-library (image at --instagram-cover-url)
  --instagram-thumb-offset       Reel cover frame timestamp in MILLISECONDS from video start (3000 = 0:03)
  --instagram-audio-id           Licensed music for the reel (from audio:search; reels only)
  --instagram-audio-volume       Music volume 0-100 (default 100)
  --instagram-video-volume       Video's own audio volume 0-100 (0 = music-only reel)
  --instagram-trial-reel         Publish as a Trial Reel: non-followers see it first (reels only; needs ~1,000+ followers, Meta-gated at publish)
  --instagram-trial-graduation-strategy  Trial Reel graduation: MANUAL (default) or SS_PERFORMANCE (auto-share if it performs well)
  --instagram-first-comment      Auto first comment on the post/reel (great for hashtags; not for stories)
  --facebook-first-comment       Auto first comment on the Facebook Page post (Page posts only)
  --linkedin-first-comment       Auto first comment on the LinkedIn profile post (e.g. link in first comment)
  --linkedin-page-first-comment  Auto first comment on the LinkedIn company page post
  --linkedin-carousel-as-images  true = post the profile post's 2+ images as a plain image gallery instead of the default swipeable PDF document carousel (false on posts:update reverts)
  --linkedin-page-carousel-as-images  Same as above for the company page post
  --linkedin-document-source     When the profile post's images are the unchanged pages of one uploaded PDF: original_pdf (default; LinkedIn receives the kept original file: sharp text, working links, every page) or slides (document rebuilt from the slide images). On posts:update, original_pdf reverts
  --linkedin-page-document-source  Same as above for the company page post
  --linkedin-poll-json '<json>'  Non-sponsored LinkedIn poll(s), independent per channel: {"linkedin":{"question","options":[2-4],"duration":"ONE_DAY|THREE_DAYS|SEVEN_DAYS|FOURTEEN_DAYS"},"linkedin_page":{...}}. Mutually exclusive with media/link-share on that channel. A channel key set to null (or the whole flag as 'null') on posts:update clears it.
  --video-cover-json '<json>'    Thumbnail for a post whose media is ONE video: {"type":"frame","thumb_offset":3000} (ms into the video) or {"type":"custom","cover_url":"https://..."}, plus optional "overrides" keyed by platform (instagram, facebook, linkedin, linkedin_page, tiktok, pinterest, youtube). TikTok only takes a frame. YouTube Shorts show it only on channels with custom Shorts thumbnails enabled. 'null' on posts:update removes it.
  --tiktok-title                 TikTok photo carousel title (max 90 chars; shown above the caption on Photo Mode posts; ignored on video)
  --tiktok-privacy               TikTok privacy level
  --tiktok-disable-comment       Disable TikTok comments
  --tiktok-disable-duet          Disable TikTok duets
  --tiktok-disable-stitch        Disable TikTok stitches
  --tiktok-is-aigc               Mark as AI-generated content
  --tiktok-first-comment         Auto first comment on the TikTok video (max 150 chars; needs comments enabled on the channel; video must be public)
  --x-reply-settings             X reply settings (following/mentionedUsers)
  --x-poll-json '<json>'         Poll on the X post (the text is the question): {"options":["A","B"],"duration_minutes":1440} (2-4 options of up to 25 chars; 5 to 10080 minutes). No media on X with a poll. 'null' on posts:update removes it.
  --threads-poll-json '<json>'   Poll on the Threads post: {"options":["A","B"]} (2-4 options of 1 to 25 chars; Threads closes it after 24 hours). Text-only post. 'null' on posts:update removes it.
  --mastodon-poll-json '<json>'  Poll on the Mastodon status: {"options":["A","B"],"expires_in":86400,"multiple":false,"hide_totals":false} (limits from the instance). No media with a poll. 'null' on posts:update removes it.
  --google-business-cta-action   GBP CTA button: LEARN_MORE, BOOK, ORDER, SHOP, SIGN_UP, CALL (GBP captions reject links/phone numbers — the button is the only way)
  --google-business-cta-url      CTA target URL, http(s):// (required for every action except CALL)
  --google-business-topic-type   GBP post type: STANDARD (default), EVENT, OFFER
  --google-business-json         Full google_business JSON for EVENT/OFFER shapes

EXAMPLES
  omnisocials accounts:list
  omnisocials posts:create --text "Hello world!" --channels instagram,linkedin,linkedin_page
  omnisocials posts:create --text "New video!" --channels youtube --type reel --media-urls "https://example.com/video.mp4" --youtube-title "My Video" --youtube-privacy public
  omnisocials posts:create --text "Thread time" --channels x --x-thread "First tweet || Second tweet || Third"
  omnisocials posts:create --text "Spring sale, 20% off until Sunday" --channels google_business --google-business-cta-action LEARN_MORE --google-business-cta-url "https://example.com/sale"
  omnisocials posts:create --text "What should we build next?" --channels linkedin --linkedin-poll-json '{"linkedin":{"question":"What should we build next?","options":["Mobile app","Public API","More integrations"],"duration":"SEVEN_DAYS"}}'
  omnisocials posts:create --text "New reel!" --channels instagram --type reel --media-urls "https://example.com/reel.mp4" --instagram-first-comment "#reels #marketing\nlink: https://example.com"
  omnisocials media:check --media-id 12345
  omnisocials posts:create --text "Golden hour on the pier" --channels instagram --media-ids 12345 --media-fit instagram=keep
  omnisocials locations:search "Blue Bottle Coffee"
  omnisocials pinterest:products
  omnisocials posts:create --text "Autumn outfit" --channels pinterest --media-urls "https://example.com/outfit.jpg" --pinterest-board-id <board_id> --pinterest-product-tags 813744226420795884,813744226420795885
  omnisocials posts:create --text "Comment GUIDE for the free checklist" --channels instagram --media-urls "https://example.com/photo.jpg" --dm-keywords "guide" --dm-message "Here is the checklist: https://example.com/guide" --dm-reply "Sent you a DM!"
  omnisocials automations:create --post-id 83778183 --keywords "guide,link" --dm "Here is the guide: https://example.com/guide" --reply "Sent you a DM!" --reply "Check your inbox"
  omnisocials automations:events 100000004
  omnisocials inbox:list --platform instagram --unread
  omnisocials inbox:next --platform instagram
  omnisocials inbox:reply <conversation-id> --text "Thanks for reaching out!" --message-id <message-id> --next
  omnisocials posts:list --status scheduled --json
  omnisocials media:upload-base64 --file ./photo.jpg --name "summer-promo"

Learn more: https://docs.omnisocials.com`);
}

// ─── Command Router ─────────────────────────────────────────────────────────

const COMMANDS = {
  setup: { handler: cmdSetup, noAuth: true },
  "config:show": { handler: cmdConfigShow, noAuth: true },
  "posts:list": { handler: cmdPostsList },
  "posts:get": { handler: cmdPostsGet },
  "posts:recent-platform": { handler: cmdPostsRecentPlatform },
  "posts:create": { handler: cmdPostsCreate },
  "posts:create-and-publish": { handler: cmdPostsCreateAndPublish },
  "posts:update": { handler: cmdPostsUpdate },
  "posts:publish": { handler: cmdPostsPublish },
  "posts:retry": { handler: cmdPostsRetry },
  "posts:approve": { handler: cmdPostsApprove },
  "posts:reject": { handler: cmdPostsReject },
  "posts:approval": { handler: cmdPostsApproval },
  "posts:delete": { handler: cmdPostsDelete },
  "media:list": { handler: cmdMediaList },
  "media:upload": { handler: cmdMediaUpload },
  "media:upload-base64": { handler: cmdMediaUploadBase64 },
  "media:check": { handler: cmdMediaCheck },
  "media:delete": { handler: cmdMediaDelete },
  "folders:list": { handler: cmdFoldersList },
  "folders:create": { handler: cmdFoldersCreate },
  "approval-workflows:list": { handler: cmdApprovalWorkflowsList },
  "hashtag-sets:list": { handler: cmdHashtagSetsList },
  "hashtag-sets:create": { handler: cmdHashtagSetsCreate },
  "hashtag-sets:update": { handler: cmdHashtagSetsUpdate },
  "hashtag-sets:delete": { handler: cmdHashtagSetsDelete },
  "automations:list": { handler: cmdAutomationsList },
  "automations:get": { handler: cmdAutomationsGet },
  "automations:create": { handler: cmdAutomationsCreate },
  "automations:update": { handler: cmdAutomationsUpdate },
  "automations:delete": { handler: cmdAutomationsDelete },
  "automations:events": { handler: cmdAutomationsEvents },
  "locations:search": { handler: cmdLocationsSearch },
  "pinterest:products": { handler: cmdPinterestProducts },
  "pinterest:validate": { handler: cmdPinterestValidate },
  "audio:search": { handler: cmdAudioSearch },
  "accounts:list": { handler: cmdAccountsList },
  "accounts:get": { handler: cmdAccountsGet },
  "analytics:post": { handler: cmdAnalyticsPost },
  "analytics:posts": { handler: cmdAnalyticsPosts },
  "analytics:overview": { handler: cmdAnalyticsOverview },
  "analytics:accounts": { handler: cmdAnalyticsAccounts },
  "analytics:best-times": { handler: cmdAnalyticsBestTimes },
  "inbox:list": { handler: cmdInboxList },
  "inbox:next": { handler: cmdInboxNext },
  "inbox:messages": { handler: cmdInboxMessages },
  "inbox:read": { handler: cmdInboxMarkRead },
  "inbox:reply": { handler: cmdInboxReply },
  "inbox:hide": { handler: cmdInboxHide },
  "inbox:delete": { handler: cmdInboxDelete },
  "webhooks:list": { handler: cmdWebhooksList },
  "webhooks:create": { handler: cmdWebhooksCreate },
  "webhooks:get": { handler: cmdWebhooksGet },
  "webhooks:update": { handler: cmdWebhooksUpdate },
  "webhooks:delete": { handler: cmdWebhooksDelete },
  "webhooks:rotate-secret": { handler: cmdWebhooksRotateSecret },
};

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);

  if (!command || flags.help) {
    showHelp();
    process.exit(0);
  }

  const cmd = COMMANDS[command];
  if (!cmd) {
    console.error(`Unknown command: ${command}`);
    console.error("Run: omnisocials --help");
    process.exit(1);
  }

  if (cmd.noAuth) {
    await cmd.handler(flags, positional);
    return;
  }

  const config = resolveConfig(flags);
  if (!config) {
    console.error("API key not found.");
    console.error("");
    console.error("Run: omnisocials setup");
    console.error("Or set: export OMNISOCIALS_API_KEY=omsk_live_...");
    process.exit(1);
  }

  await cmd.handler(config, flags, positional);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
