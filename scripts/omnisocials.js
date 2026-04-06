#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");

// ─── Constants ───────────────────────────────────────────────────────────────

const VERSION = "1.0.0";
const DEFAULT_BASE_URL = "https://api.omnisocials.com/v1";
const PLATFORMS = [
  "instagram",
  "facebook",
  "linkedin",
  "youtube",
  "tiktok",
  "x",
  "pinterest",
  "bluesky",
  "threads",
  "mastodon",
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

// ─── Platform Option Assembly ───────────────────────────────────────────────

function assemblePlatformOptions(flags) {
  const platforms = {};

  const mapping = {
    pinterest: {
      "pinterest-board-id": "board_id",
      "pinterest-title": "title",
      "pinterest-link": "link",
    },
    youtube: {
      "youtube-title": "title",
      "youtube-privacy": "privacy_status",
      "youtube-tags": { key: "tags", transform: splitComma },
      "youtube-category-id": "category_id",
      "youtube-made-for-kids": { key: "made_for_kids", transform: (v) => v === true || v === "true" },
      "youtube-notify-subscribers": { key: "notify_subscribers", transform: (v) => v === true || v === "true" },
      "youtube-contains-synthetic-media": { key: "contains_synthetic_media", transform: (v) => v === true || v === "true" },
    },
    instagram: {
      "instagram-share-to-feed": { key: "share_to_feed", transform: (v) => v === true || v === "true" },
      "instagram-cover-url": "cover_url",
      "instagram-thumbnail-type": "thumbnail_type",
      "instagram-thumb-offset": { key: "thumb_offset", transform: Number },
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

// ─── Output Formatters ──────────────────────────────────────────────────────

function outputJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function truncate(str, len) {
  if (!str) return "";
  str = str.replace(/\n/g, " ");
  return str.length > len ? str.slice(0, len - 3) + "..." : str;
}

function formatPost(post, index) {
  const lines = [];
  lines.push(`#${index + 1}  ID: ${post.id}`);
  lines.push(`    Status: ${post.status}`);
  lines.push(`    Content: "${truncate(post.content, 60)}"`);
  if (post.channels?.length) {
    lines.push(`    Channels: ${post.channels.join(", ")}`);
  }
  if (post.scheduled_at) {
    lines.push(`    Scheduled: ${post.scheduled_at}`);
  }
  if (post.published_at) {
    lines.push(`    Published: ${post.published_at}`);
  }
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

async function cmdPostsCreate(config, flags) {
  const text = flags.text;
  if (!text) {
    console.error("Usage: omnisocials posts:create --text \"...\" [--channels ...]");
    process.exit(1);
  }

  const body = { content: text };

  if (flags.channels) body.channels = splitComma(flags.channels);
  if (flags.schedule) body.scheduled_at = flags.schedule;
  if (flags.type) body.type = flags.type;
  if (flags["media-ids"]) body.media_ids = splitComma(flags["media-ids"]);
  if (flags["media-urls"]) body.media_urls = splitComma(flags["media-urls"]);

  const platformOpts = assemblePlatformOptions(flags);
  Object.assign(body, platformOpts);

  const result = await apiRequest(config, "POST", "/posts/create", body);

  handleResult(result, flags, (data) => {
    console.log(`Post created successfully!`);
    console.log(`ID: ${data.id}`);
    console.log(`Status: ${data.status}`);
    if (data.scheduled_at) console.log(`Scheduled: ${data.scheduled_at}`);
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

  const body = { content: text };

  if (flags.channels) body.channels = splitComma(flags.channels);
  if (flags.type) body.type = flags.type;
  if (flags["media-ids"]) body.media_ids = splitComma(flags["media-ids"]);
  if (flags["media-urls"]) body.media_urls = splitComma(flags["media-urls"]);

  const platformOpts = assemblePlatformOptions(flags);
  Object.assign(body, platformOpts);

  const result = await apiRequest(config, "POST", "/posts/create-and-publish", body);

  handleResult(result, flags, (data) => {
    console.log(`Post created and publishing!`);
    console.log(`ID: ${data.id}`);
    console.log(`Status: ${data.status}`);
  });
}

async function cmdPostsUpdate(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials posts:update <id> [--text ...] [--channels ...]");
    process.exit(1);
  }

  const body = {};
  if (flags.text) body.content = flags.text;
  if (flags.channels) body.channels = splitComma(flags.channels);
  if (flags.schedule) body.scheduled_at = flags.schedule;
  if (flags.type) body.type = flags.type;
  if (flags["media-ids"]) body.media_ids = splitComma(flags["media-ids"]);
  if (flags["media-urls"]) body.media_urls = splitComma(flags["media-urls"]);

  const platformOpts = assemblePlatformOptions(flags);
  Object.assign(body, platformOpts);

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

async function cmdAnalyticsPost(config, flags, positional) {
  const id = positional[0];
  if (!id) {
    console.error("Usage: omnisocials analytics:post <post-id>");
    process.exit(1);
  }

  const result = await apiRequest(config, "GET", `/analytics/posts/${id}`);

  handleResult(result, flags, (data) => {
    console.log(`Analytics for Post ${data.post_id || id}`);
    console.log("─".repeat(40));
    console.log(`Impressions: ${data.impressions ?? "N/A"}`);
    console.log(`Engagements: ${data.engagements ?? "N/A"}`);
    console.log(`Likes: ${data.likes ?? "N/A"}`);
    console.log(`Comments: ${data.comments ?? "N/A"}`);
    console.log(`Shares: ${data.shares ?? "N/A"}`);
    if (data.platform_stats) {
      console.log("\nPer-platform:");
      for (const [platform, stats] of Object.entries(data.platform_stats)) {
        console.log(`  ${platform}: ${JSON.stringify(stats)}`);
      }
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
    console.log("Analytics Overview");
    console.log("─".repeat(40));
    console.log(`Period: ${data.period || "custom"}`);
    console.log(`Total posts: ${data.total_posts ?? "N/A"}`);
    console.log(`Total impressions: ${data.total_impressions ?? "N/A"}`);
    console.log(`Total engagements: ${data.total_engagements ?? "N/A"}`);
  });
}

async function cmdAnalyticsAccounts(config, flags) {
  const result = await apiRequest(config, "GET", "/analytics/accounts", undefined, {
    platform: flags.platform,
    date: flags.date,
  });

  handleResult(result, flags);
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

Manage social media across 10 platforms from the command line.

SETUP
  setup                          Configure your API key
  setup --api-key <key> --global Non-interactive setup
  config:show                    Show current configuration

POSTS
  posts:list                     List posts [--status --limit --offset]
  posts:get <id>                 Get post details
  posts:create                   Create a post [--text --channels --schedule --type --media-urls --media-ids]
  posts:create-and-publish       Create and publish immediately
  posts:update <id>              Update a draft/scheduled post
  posts:publish <id>             Publish a post now
  posts:delete <id>              Delete a post

MEDIA
  media:list                     List media files [--limit --offset]
  media:upload                   Upload from URL [--url --filename]
  media:delete <id>              Delete a media file

ACCOUNTS
  accounts:list                  List connected accounts
  accounts:get <id>              Get account details

ANALYTICS
  analytics:post <id>            Get post analytics
  analytics:overview             Workspace analytics [--period --start-date --end-date]
  analytics:accounts             Account analytics [--platform --date]

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

PLATFORM FLAGS (for posts:create / posts:update)
  --pinterest-board-id           Pinterest board ID (required for Pinterest)
  --pinterest-title              Pinterest pin title
  --pinterest-link               Pinterest pin link
  --youtube-title                YouTube video title
  --youtube-privacy              YouTube privacy (public/private/unlisted)
  --youtube-tags                 YouTube tags (comma-separated)
  --youtube-category-id          YouTube category ID
  --youtube-made-for-kids        YouTube made for kids flag
  --instagram-share-to-feed      Share Instagram reel to feed
  --instagram-cover-url          Instagram reel cover image URL
  --tiktok-privacy               TikTok privacy level
  --tiktok-disable-comment       Disable TikTok comments
  --tiktok-disable-duet          Disable TikTok duets
  --tiktok-disable-stitch        Disable TikTok stitches
  --tiktok-is-aigc               Mark as AI-generated content
  --x-reply-settings             X reply settings (following/mentionedUsers)

EXAMPLES
  omnisocials accounts:list
  omnisocials posts:create --text "Hello world!" --channels instagram,linkedin
  omnisocials posts:create --text "New video!" --channels youtube --type reel --media-urls "https://example.com/video.mp4" --youtube-title "My Video" --youtube-privacy public
  omnisocials posts:list --status scheduled --json
  omnisocials media:upload --url "https://example.com/photo.jpg"

Learn more: https://docs.omnisocials.com`);
}

// ─── Command Router ─────────────────────────────────────────────────────────

const COMMANDS = {
  setup: { handler: cmdSetup, noAuth: true },
  "config:show": { handler: cmdConfigShow, noAuth: true },
  "posts:list": { handler: cmdPostsList },
  "posts:get": { handler: cmdPostsGet },
  "posts:create": { handler: cmdPostsCreate },
  "posts:create-and-publish": { handler: cmdPostsCreateAndPublish },
  "posts:update": { handler: cmdPostsUpdate },
  "posts:publish": { handler: cmdPostsPublish },
  "posts:delete": { handler: cmdPostsDelete },
  "media:list": { handler: cmdMediaList },
  "media:upload": { handler: cmdMediaUpload },
  "media:delete": { handler: cmdMediaDelete },
  "accounts:list": { handler: cmdAccountsList },
  "accounts:get": { handler: cmdAccountsGet },
  "analytics:post": { handler: cmdAnalyticsPost },
  "analytics:overview": { handler: cmdAnalyticsOverview },
  "analytics:accounts": { handler: cmdAnalyticsAccounts },
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
