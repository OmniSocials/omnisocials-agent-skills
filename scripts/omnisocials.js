#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");

// ─── Constants ───────────────────────────────────────────────────────────────

const VERSION = "1.9.0";
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
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
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

function assemblePlatformOptions(flags) {
  const platforms = {};

  const mapping = {
    pinterest: {
      "pinterest-board-id": "board_id",
      "pinterest-title": "title",
      "pinterest-link": "link",
      "pinterest-video-cover": "video_cover",
      "pinterest-alt-text": "alt_text",
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
      "instagram-first-comment": "first_comment",
    },
    // Comment-capable platforms whose only CLI option (so far) is the auto
    // first comment. Posted right after publish — handy for keeping hashtags or
    // a link out of the main caption. Facebook is Page posts only.
    facebook: {
      "facebook-first-comment": "first_comment",
    },
    linkedin: {
      "linkedin-first-comment": "first_comment",
    },
    linkedin_page: {
      "linkedin-page-first-comment": "first_comment",
    },
    tiktok: {
      "tiktok-privacy": "privacy_level",
      "tiktok-disable-comment": { key: "disable_comment", transform: (v) => v === true || v === "true" },
      "tiktok-disable-duet": { key: "disable_duet", transform: (v) => v === true || v === "true" },
      "tiktok-disable-stitch": { key: "disable_stitch", transform: (v) => v === true || v === "true" },
      "tiktok-is-aigc": { key: "is_aigc", transform: (v) => v === true || v === "true" },
      "tiktok-brand-content-toggle": { key: "brand_content_toggle", transform: (v) => v === true || v === "true" },
    },
    x: {
      "x-reply-settings": "reply_settings",
    },
  };

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

// Assemble the request body shared by posts:create, posts:create-and-publish,
// and posts:update. Centralised so all three stay in sync as the API grows.
// `content` is only set when --text is given (update can omit it). Returns the
// body object; calls exitWithError on malformed --user-tags JSON.
function buildPostBody(flags) {
  const body = {};

  if (flags.text !== undefined) body.content = flags.text;
  if (flags.channels) body.channels = splitComma(flags.channels);
  // API accepts both schedule_at and scheduled_at; send the documented name.
  if (flags.schedule) body.schedule_at = flags.schedule;
  if (flags.type) body.type = flags.type;
  if (flags["media-ids"]) body.media_ids = splitComma(flags["media-ids"]);
  if (flags["media-urls"]) body.media_urls = splitComma(flags["media-urls"]);

  // Link preview (LinkedIn / Facebook) — top-level fields.
  if (flags["link-url"]) body.link_url = flags["link-url"];
  if (flags["link-title"]) body.link_title = flags["link-title"];
  if (flags["link-description"]) body.link_description = flags["link-description"];
  if (flags["link-thumbnail-url"]) body.link_thumbnail_url = flags["link-thumbnail-url"];

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

  // Merge per-platform option objects (pinterest/youtube/instagram/tiktok/x),
  // preserving any keys already set above (e.g. x.thread_parts).
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

function formatPost(post, index) {
  const lines = [];
  lines.push(`#${index + 1}  ID: ${post.id}`);
  lines.push(`    Status: ${post.status}`);
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

  if (formatter) {
    formatter(result.data);
  } else {
    outputJson(result.data);
  }
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
      console.log(`${i + 1}. [${p.platform}] ${p.format} — ${metricStr}`);
      console.log(`   ${snippet}`);
    }
    if (result.note) console.log(`\n${result.note}`);
    if (errEntries.length) {
      console.log("\nFetch errors:");
      for (const [p, m] of errEntries) console.log(`  ${p}: ${m}`);
    }
  });
}

async function cmdPostsCreate(config, flags) {
  const text = flags.text;
  if (!text) {
    console.error("Usage: omnisocials posts:create --text \"...\" [--channels ...]");
    process.exit(1);
  }

  const body = buildPostBody(flags);

  const result = await apiRequest(config, "POST", "/posts/create", body);

  handleResult(result, flags, (data) => {
    console.log(`Post created successfully!`);
    console.log(`ID: ${data.id}`);
    console.log(`Status: ${data.status}`);
    const scheduledAt = data.schedule_at || data.scheduled_at;
    if (scheduledAt) console.log(`Scheduled: ${scheduledAt}`);
    if (data.app_url) console.log(`Open in OmniSocials: ${data.app_url}`);
  });
}

async function cmdPostsCreateAndPublish(config, flags) {
  const text = flags.text;
  if (!text) {
    console.error(
      "Usage: omnisocials posts:create-and-publish --text \"...\" [--channels ...]"
    );
    process.exit(1);
  }

  const body = buildPostBody(flags);
  // create-and-publish ignores scheduling; drop it if a stray --schedule slipped in.
  delete body.schedule_at;

  const result = await apiRequest(config, "POST", "/posts/create-and-publish", body);

  handleResult(result, flags, (data) => {
    console.log(`Post created and publishing!`);
    console.log(`ID: ${data.id}`);
    console.log(`Status: ${data.status}`);
    if (data.app_url) console.log(`Open in OmniSocials: ${data.app_url}`);
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

  handleResult(result, flags, (data) => {
    console.log(`Post updated successfully!`);
    console.log(`ID: ${data.id}`);
    console.log(`Status: ${data.status}`);
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
  console.log(
    `PDF uploaded and split into ${result.media_ids.length} image slide(s).`
  );
  if (result.pdf && result.pdf.truncated) {
    console.log(
      `(imported the first ${result.pdf.rendered_pages} of ${result.pdf.total_pages} pages; max 20)`
    );
  }
  console.log(
    `Slide media IDs (pass ALL to posts:create --media-ids): ${result.media_ids.join(",")}`
  );
  console.log(
    "On LinkedIn these post as a swipeable document carousel; on Instagram, TikTok, Threads and Pinterest as an image carousel."
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
  // whole response rather than result.data (which would be undefined).
  handleResult(result, flags, () => outputJson(result));
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

// --- Locations (Instagram place tagging) ---

async function cmdLocationsSearch(config, flags, positional) {
  const q = flags.q || positional.join(" ");
  if (!q || q.trim().length < 2) {
    exitWithError(
      'Usage: omnisocials locations:search "<place name>"  (min 2 chars; returns location_id values for Instagram posts)'
    );
  }

  const result = await apiRequest(config, "GET", "/locations/search", undefined, { q });
  handleResult(result, flags, (data) => {
    const locations = Array.isArray(data) ? data : [];
    if (!locations.length) {
      console.log(`No taggable locations found for "${q}". Try a more specific venue name.`);
      return;
    }
    console.log(`Locations matching "${q}" (${locations.length})`);
    console.log("─".repeat(40));
    for (const loc of locations) {
      console.log(`location_id: ${loc.id}  ${loc.name}${loc.address ? `  — ${loc.address}` : ""}`);
    }
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
      // Broadest exposure count present, regardless of the platform's name for
      // it (LinkedIn: impressions, TikTok/X/YouTube: views, IG: reach).
      const impressions = Number(m.impressions ?? m.views ?? m.reach ?? 0);
      const likes = Number(m.likes ?? m.favorites ?? m.reactions ?? 0);
      const comments = Number(m.comments ?? m.replies ?? 0);
      const shares = Number(m.shares ?? m.retweets ?? m.reposts ?? 0);
      const engagements = m.engagement != null ? Number(m.engagement) : likes + comments + shares;
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
      for (const [, p] of Object.entries(platforms)) {
        const m = (p && p.metrics) || {};
        // Broadest exposure count present (impressions / views / reach).
        impressions += Number(m.impressions ?? m.views ?? m.reach ?? 0);
        const likes = Number(m.likes ?? m.favorites ?? m.reactions ?? 0);
        const comments = Number(m.comments ?? m.replies ?? 0);
        const shares = Number(m.shares ?? m.retweets ?? m.reposts ?? 0);
        engagements += m.engagement != null ? Number(m.engagement) : likes + comments + shares;
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
    } else {
      console.log(`\nBased on ${result.sample_size} posts from the last ${result.window_days} days (metric: ${result.metric}, times in ${result.timezone}).`);
    }
  });
}

// --- Webhooks ---

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
  posts:create                   Create a post [--text --channels --schedule --type --media-urls --media-ids]
  posts:create-and-publish       Create and publish immediately
  posts:update <id>              Update a draft/scheduled post
  posts:publish <id>             Publish a post now
  posts:delete <id>              Delete a post

MEDIA
  media:list                     List media files [--limit --offset]
  media:upload                   Upload from URL (image, video, or PDF) [--url --filename]
  media:upload-base64            Upload a local file or base64 [--file | --data --mime-type] [--name --folder --folder-id]
  media:check                    Check media compatibility [--url | --media-id | --size-bytes --mime]
  media:delete <id>              Delete a media file
  (PDF: a PDF is split into one image slide per page — pass all returned media IDs to posts:create as a carousel)

FOLDERS
  folders:list                   List media folders
  folders:create                 Create a folder [--name --parent-id]

LOCATIONS
  locations:search "<name>"      Find Instagram location_id values for a place

ACCOUNTS
  accounts:list                  List connected accounts
  accounts:get <id>              Get account details

ANALYTICS
  analytics:post <id>            Get post analytics
  analytics:posts <id,id,...>    Get analytics for up to 100 posts in one call (bulk)
  analytics:overview             Workspace analytics [--period --start-date --end-date]
  analytics:accounts             Account analytics [--platform --date]
  analytics:best-times           Recommended posting slots [--platform (required) --timezone]

WEBHOOKS
  webhooks:list                  List webhooks
  webhooks:create                Create webhook [--url --events]
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
  --media-urls <url,url>         Attach media by URL
  --media-ids <id,id>            Attach media from the library
  --link-url <url>               Link preview (LinkedIn/Facebook); --link-title --link-description --link-thumbnail-url
  --location-id <id>             Instagram place tag (from locations:search)
  --collaborators <a,b>          Instagram co-author usernames (max 3)
  --user-tags '<json>'           Instagram photo tags, JSON array [{"username","x","y","image_index?"}]
  --x-thread "a || b || c"       Post an X thread; parts split on "||"
  --bluesky-thread "a || b || c" Post a Bluesky thread; parts split on "||"
  --mastodon-thread "a || b || c" Post a Mastodon thread; parts split on "||"

PLATFORM FLAGS
  --pinterest-board-id           Pinterest board ID (required for Pinterest)
  --pinterest-title              Pinterest pin title
  --pinterest-link               Pinterest pin link
  --pinterest-video-cover        Pinterest video cover image URL
  --pinterest-alt-text           Pinterest pin alt text
  --youtube-title                YouTube video title
  --youtube-privacy              YouTube privacy (public/private/unlisted)
  --youtube-tags                 YouTube tags (comma-separated)
  --youtube-category-id          YouTube category ID
  --youtube-made-for-kids        YouTube made for kids flag
  --youtube-first-comment        Auto first comment on the video (video must allow comments)
  --instagram-share-to-feed      Share Instagram reel to feed
  --instagram-cover-url          Instagram reel cover image URL
  --instagram-first-comment      Auto first comment on the post/reel (great for hashtags; not for stories)
  --facebook-first-comment       Auto first comment on the Facebook Page post (Page posts only)
  --linkedin-first-comment       Auto first comment on the LinkedIn profile post (e.g. link in first comment)
  --linkedin-page-first-comment  Auto first comment on the LinkedIn company page post
  --tiktok-privacy               TikTok privacy level
  --tiktok-disable-comment       Disable TikTok comments
  --tiktok-disable-duet          Disable TikTok duets
  --tiktok-disable-stitch        Disable TikTok stitches
  --tiktok-is-aigc               Mark as AI-generated content
  --x-reply-settings             X reply settings (following/mentionedUsers)

EXAMPLES
  omnisocials accounts:list
  omnisocials posts:create --text "Hello world!" --channels instagram,linkedin,linkedin_page
  omnisocials posts:create --text "New video!" --channels youtube --type reel --media-urls "https://example.com/video.mp4" --youtube-title "My Video" --youtube-privacy public
  omnisocials posts:create --text "Thread time" --channels x --x-thread "First tweet || Second tweet || Third"
  omnisocials posts:create --text "New reel!" --channels instagram --type reel --media-urls "https://example.com/reel.mp4" --instagram-first-comment "#reels #marketing\nlink: https://example.com"
  omnisocials locations:search "Blue Bottle Coffee"
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
  "posts:delete": { handler: cmdPostsDelete },
  "media:list": { handler: cmdMediaList },
  "media:upload": { handler: cmdMediaUpload },
  "media:upload-base64": { handler: cmdMediaUploadBase64 },
  "media:check": { handler: cmdMediaCheck },
  "media:delete": { handler: cmdMediaDelete },
  "folders:list": { handler: cmdFoldersList },
  "folders:create": { handler: cmdFoldersCreate },
  "locations:search": { handler: cmdLocationsSearch },
  "accounts:list": { handler: cmdAccountsList },
  "accounts:get": { handler: cmdAccountsGet },
  "analytics:post": { handler: cmdAnalyticsPost },
  "analytics:posts": { handler: cmdAnalyticsPosts },
  "analytics:overview": { handler: cmdAnalyticsOverview },
  "analytics:accounts": { handler: cmdAnalyticsAccounts },
  "analytics:best-times": { handler: cmdAnalyticsBestTimes },
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
