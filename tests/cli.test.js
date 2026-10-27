import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";

const exec = promisify(execFile);
const CLI = path.resolve(__dirname, "../scripts/omnisocials.js");

// Run the CLI in an ISOLATED environment so tests don't pick up a real config:
//   - a fresh empty cwd (no ./.omnisocials/config.json)
//   - HOME/USERPROFILE pointed at that empty dir (no ~/.config/omnisocials)
//   - OMNISOCIALS_API_KEY stripped from the inherited env
// Without this, "without config" tests fail on any machine where the developer
// has actually configured the CLI.
const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omni-cli-test-"));

function isolatedEnv(extra = {}) {
  const env = { ...process.env, HOME: ISOLATED_DIR, USERPROFILE: ISOLATED_DIR };
  delete env.OMNISOCIALS_API_KEY;
  delete env.OMNISOCIALS_BASE_URL;
  return { ...env, ...extra };
}

function run(args, { env } = {}) {
  return exec("node", [CLI, ...args], {
    timeout: 10000,
    cwd: ISOLATED_DIR,
    env: isolatedEnv(env),
  }).then(
    ({ stdout, stderr }) => ({ stdout, stderr, exitCode: 0 }),
    (err) => ({ stdout: err.stdout || "", stderr: err.stderr || "", exitCode: err.code })
  );
}

// A throwaway HTTP server standing in for the API. `handler(req, body)` returns
// { status, json }; every request is recorded in `calls` so tests can assert on
// the method, path, query string, and JSON body the CLI sent.
async function withMockServer(handler, fn) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      const url = new URL(req.url, "http://127.0.0.1");
      calls.push({ method: req.method, path: url.pathname, query: url.searchParams, body });
      const reply = handler(req, body) || { status: 200, json: { data: null } };
      res.writeHead(reply.status || 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply.json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl, calls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const MOCK_KEY = ["omsk", "test", "mock"].join("_");

describe("CLI basics", () => {
  it("shows help with --help", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("OmniSocials CLI");
    expect(stdout).toContain("POSTS");
    expect(stdout).toContain("MEDIA");
    expect(stdout).toContain("ACCOUNTS");
    expect(stdout).toContain("ANALYTICS");
    expect(stdout).toContain("INBOX");
    expect(stdout).toContain("WEBHOOKS");
  });

  it("shows help when no command given", async () => {
    const { stdout, exitCode } = await run([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("OmniSocials CLI");
  });

  it("errors on unknown command", async () => {
    const { stderr, exitCode } = await run(["unknown:command"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Unknown command");
  });

  it("errors when no API key for auth commands", async () => {
    const { stderr, exitCode } = await run(["posts:list"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("API key not found");
  });

  it("config:show works without config", async () => {
    const { stdout, exitCode } = await run(["config:show"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No configuration found");
  });

  it("posts:get requires an id", async () => {
    const { stderr, exitCode } = await run([
      "posts:get",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("posts:create requires --text", async () => {
    const { stderr, exitCode } = await run([
      "posts:create",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("posts:create sends --video-cover-json as video_cover", async () => {
    const cover = {
      type: "custom",
      cover_url: "https://example.com/cover.jpg",
      overrides: { tiktok: { type: "frame", thumb_offset: 2000 } },
    };
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const { exitCode } = await run([
          "posts:create",
          "--text",
          "New tutorial",
          "--video-cover-json",
          JSON.stringify(cover),
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("POST");
        expect(calls[0].path).toBe("/posts/create");
        expect(calls[0].body.video_cover).toEqual(cover);
      }
    );
  });

  it("posts:update --video-cover-json null removes the cover", async () => {
    await withMockServer(
      () => ({ json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const { exitCode } = await run([
          "posts:update",
          "p1",
          "--video-cover-json",
          "null",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("PATCH");
        expect(calls[0].path).toBe("/posts/p1");
        expect(calls[0].body).toHaveProperty("video_cover", null);
      }
    );
  });

  it("posts:create --draft with --schedule sends draft: true", async () => {
    await withMockServer(
      () => ({
        status: 201,
        json: { data: { id: "p1", status: "draft", schedule_at: "2026-08-01T09:00:00Z" } },
      }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "posts:create",
          "--text",
          "Proposed for Friday",
          "--schedule",
          "2026-08-01T09:00:00Z",
          "--draft",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].path).toBe("/posts/create");
        expect(calls[0].body.schedule_at).toBe("2026-08-01T09:00:00Z");
        expect(calls[0].body.draft).toBe(true);
        expect(stdout).toContain("Planned for: 2026-08-01T09:00:00Z");
      }
    );
  });

  it("posts:update --no-draft sends draft: false", async () => {
    await withMockServer(
      () => ({ json: { data: { id: "p1", status: "scheduled", schedule_at: "2026-08-01T09:00:00Z" } } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "posts:update",
          "p1",
          "--no-draft",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("PATCH");
        expect(calls[0].path).toBe("/posts/p1");
        expect(calls[0].body).toEqual({ draft: false });
        expect(stdout).toContain("Scheduled: 2026-08-01T09:00:00Z");
      }
    );
  });

  it("posts:create sends the --telegram-* flags as the telegram object", async () => {
    await withMockServer(
      () => ({
        status: 201,
        json: {
          data: {
            id: "p1",
            status: "published",
            telegram: { result: { message_ids: ["41", "42"], pinned: false, pin_error: "no_right" } },
          },
        },
      }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "posts:create",
          "--text",
          "The new collection is live.",
          "--channels",
          "telegram",
          "--telegram-silent",
          "--telegram-pin",
          "--telegram-link-preview",
          "false",
          "--telegram-buttons-json",
          '[{"text":"Shop now","url":"https://example.com/shop"}]',
          "--telegram-poll-json",
          '{"options":["Tuesday","Thursday"],"open_period":86400}',
          "--telegram-first-comment",
          "Questions? Reply here.",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].path).toBe("/posts/create");
        expect(calls[0].body.channels).toEqual(["telegram"]);
        expect(calls[0].body.telegram).toEqual({
          silent: true,
          pin: true,
          link_preview: false,
          buttons: [{ text: "Shop now", url: "https://example.com/shop" }],
          poll: { options: ["Tuesday", "Thursday"], open_period: 86400 },
          first_comment: "Questions? Reply here.",
        });
        expect(stdout).toContain("ID: p1");
      }
    );
  });

  it("posts:list prints where a Telegram post landed", async () => {
    await withMockServer(
      () => ({
        json: {
          data: [
            {
              id: "p1",
              status: "published",
              content: { default: "The new collection is live." },
              accounts: ["telegram"],
              telegram: { result: { message_ids: ["41", "42"], pinned: false, pin_error: "no_right" } },
              created_at: "2026-10-17T09:00:00Z",
            },
          ],
        },
      }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run(["posts:list", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Telegram: 2 messages (not pinned: no_right)");
      }
    );
  });

  it("posts:update --telegram-json merges over the flags and null clears a key", async () => {
    await withMockServer(
      () => ({ json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const { exitCode } = await run([
          "posts:update",
          "p1",
          "--telegram-pin",
          "--telegram-json",
          '{"pin":false,"poll":null}',
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("PATCH");
        expect(calls[0].body.telegram).toEqual({ pin: false, poll: null });
      }
    );
  });

  it("posts:create rejects --telegram-buttons-json that is not an array", async () => {
    const { stderr, exitCode } = await run([
      "posts:create",
      "--text",
      "Hi",
      "--channels",
      "telegram",
      "--telegram-buttons-json",
      '{"text":"Shop","url":"https://example.com"}',
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--telegram-buttons-json must be a JSON array");
  });

  it("help lists the telegram channel and flags", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("telegram (a channel or group)");
    expect(stdout).toContain("--telegram-poll-json");
    expect(stdout).toContain("--telegram-buttons-json");
  });

  it("posts:create sends the --discord-* flags as the discord object", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "scheduled" } } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "posts:create",
          "--text",
          "The spring drop is live.",
          "--channels",
          "discord",
          "--discord-silent",
          "--discord-no-link-preview",
          "--discord-allow-mentions",
          "--discord-spoiler",
          "--discord-thread-name",
          "Spring drop",
          "--discord-button",
          "Shop now|https://example.com/shop?a=1|b",
          "--discord-button",
          "Lookbook | https://example.com/lookbook",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].path).toBe("/posts/create");
        expect(calls[0].body.channels).toEqual(["discord"]);
        // Split on the FIRST "|": the second button's link keeps its own "|".
        expect(calls[0].body.discord).toEqual({
          silent: true,
          link_preview: false,
          allow_mentions: true,
          spoiler: true,
          thread_name: "Spring drop",
          buttons: [
            { text: "Shop now", url: "https://example.com/shop?a=1|b" },
            { text: "Lookbook", url: "https://example.com/lookbook" },
          ],
        });
        expect(stdout).toContain("ID: p1");
      }
    );
  });

  it("posts:create-and-publish sends --discord-poll-json as discord.poll, and false values as false", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p2", status: "posting" } } }),
      async (baseUrl, calls) => {
        const { exitCode } = await run([
          "posts:create-and-publish",
          "--text",
          "Which day suits the community call?",
          "--channels",
          "discord",
          "--discord-poll-json",
          '{"options":["Tuesday","Thursday"],"duration_hours":48,"multiple":true}',
          "--discord-silent",
          "false",
          "--discord-no-link-preview",
          "false",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].path).toBe("/posts/create-and-publish");
        expect(calls[0].body.discord).toEqual({
          poll: { options: ["Tuesday", "Thursday"], duration_hours: 48, multiple: true },
          silent: false,
          link_preview: true,
        });
      }
    );
  });

  it("posts:list prints the Discord message link and the videos sent as a link", async () => {
    await withMockServer(
      () => ({
        json: {
          data: [
            {
              id: "p1",
              status: "published",
              content: { default: "The spring drop is live." },
              accounts: ["discord"],
              published_urls: { discord: "https://discord.com/channels/11/22/33" },
              discord: {
                silent: true,
                result: {
                  webhook_id: "44",
                  guild_id: "11",
                  channel_id: "22",
                  thread_id: null,
                  message_id: "33",
                  url: "https://discord.com/channels/11/22/33",
                  sent_at: "2026-10-22T09:00:00Z",
                  video_links: ["https://cdn.example.com/big.mp4"],
                  warnings: ["media_sent_as_links"],
                },
              },
              created_at: "2026-10-22T08:00:00Z",
            },
          ],
        },
      }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run(["posts:list", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Discord: sent · https://discord.com/channels/11/22/33, 1 video sent as a link");
        expect(stdout).not.toContain("warnings:");
      }
    );
  });

  it("posts:update --discord-json merges over the flags, and 'null' removes the poll or every option", async () => {
    await withMockServer(
      () => ({ json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const base = ["posts:update", "p1", "--api-key", MOCK_KEY, "--base-url", baseUrl];

        const merged = await run([...base, "--discord-silent", "--discord-json", '{"silent":false,"buttons":null}']);
        expect(merged.exitCode).toBe(0);
        expect(calls[0].method).toBe("PATCH");
        expect(calls[0].body.discord).toEqual({ silent: false, buttons: null });

        const noPoll = await run([...base, "--discord-poll-json", "null", "--discord-thread-name", "null"]);
        expect(noPoll.exitCode).toBe(0);
        expect(calls[1].body.discord).toEqual({ poll: null, thread_name: null });

        const cleared = await run([...base, "--discord-json", "null"]);
        expect(cleared.exitCode).toBe(0);
        expect(calls[2].body.discord).toBeNull();
      }
    );
  });

  it("posts:create refuses a bad --discord-button, --discord-poll-json, --discord-json or a bare --discord-thread-name before calling the API", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const base = ["posts:create", "--text", "Hi", "--channels", "discord", "--api-key", MOCK_KEY, "--base-url", baseUrl];

        const noBar = await run([...base, "--discord-button", "Shop now https://example.com"]);
        expect(noBar.exitCode).not.toBe(0);
        expect(noBar.stderr).toContain('--discord-button takes "text|url"');

        const noText = await run([...base, "--discord-button", " |https://example.com"]);
        expect(noText.exitCode).not.toBe(0);
        expect(noText.stderr).toContain('has no text before the "|"');

        const noUrl = await run([...base, "--discord-button", "Shop now|"]);
        expect(noUrl.exitCode).not.toBe(0);
        expect(noUrl.stderr).toContain('has no link after the "|"');

        // One bad entry among good ones still stops the call.
        const oneBad = await run([...base, "--discord-button", "Shop|https://example.com", "--discord-button", "Lookbook"]);
        expect(oneBad.exitCode).not.toBe(0);
        expect(oneBad.stderr).toContain('--discord-button takes "text|url"');

        const badPoll = await run([...base, "--discord-poll-json", "{options:[A,B]}"]);
        expect(badPoll.exitCode).not.toBe(0);
        expect(badPoll.stderr).toContain("--discord-poll-json must be JSON");

        const badJson = await run([...base, "--discord-json", "{silent:true}"]);
        expect(badJson.exitCode).not.toBe(0);
        expect(badJson.stderr).toContain("--discord-json must be a JSON object");

        const arrayJson = await run([...base, "--discord-json", "[]"]);
        expect(arrayJson.exitCode).not.toBe(0);
        expect(arrayJson.stderr).toContain("--discord-json must be a JSON object or null");

        const bareName = await run([...base, "--discord-thread-name"]);
        expect(bareName.exitCode).not.toBe(0);
        expect(bareName.stderr).toContain("--discord-thread-name needs a value");

        expect(calls).toHaveLength(0);
      }
    );
  });

  it("accounts:list prints the Discord server (or the webhook name) and the channel link", async () => {
    await withMockServer(
      () => ({
        json: {
          data: [
            {
              id: "1_discord",
              platform: "discord",
              username: "OmniSocials",
              status: "active",
              platform_details: {
                guild_id: "11",
                guild_name: "Brand Community",
                channel_id: "22",
                webhook_name: "OmniSocials",
                connect_method: "oauth",
                url: "https://discord.com/channels/11/22",
              },
            },
            {
              id: "2_discord",
              platform: "discord",
              username: "Announcements",
              status: "active",
              platform_details: {
                guild_id: "12",
                guild_name: null,
                channel_id: "23",
                webhook_name: "Announcements",
                connect_method: "url",
                url: "https://discord.com/channels/12/23",
              },
            },
          ],
        },
      }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run(["accounts:list", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Discord: Brand Community, https://discord.com/channels/11/22");
        expect(stdout).toContain("Discord: webhook Announcements, https://discord.com/channels/12/23");
      }
    );
  });

  it("analytics:post counts all Discord reactions as the engagement", async () => {
    await withMockServer(
      () => ({
        json: {
          data: {
            post_id: "p1",
            platforms: { discord: { metrics: { likes: 7, reactions: { "🔥": 5, "👍": 2 } } } },
          },
        },
      }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run(["analytics:post", "p1", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Engagements: 7");
        expect(stdout).toContain("discord: 7 likes");
      }
    );
  });

  it("help lists the discord channel and flags", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("OmniSocials CLI v1.36.0");
    expect(stdout).toContain("discord (a channel, posted through its webhook)");
    expect(stdout).toContain("--discord-button");
    expect(stdout).toContain("--discord-poll-json");
    expect(stdout).toContain("--discord-json");
  });

  it("posts:create rejects a --video-cover-json that is not JSON", async () => {
    const { stderr, exitCode } = await run([
      "posts:create",
      "--text",
      "New tutorial",
      "--video-cover-json",
      "{type:frame}",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--video-cover-json must be JSON");
  });

  it("help lists posts:retry", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("posts:retry <id>");
  });

  it("help lists --tiktok-title", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--tiktok-title");
  });

  it("posts:retry requires an id", async () => {
    const { stderr, exitCode } = await run([
      "posts:retry",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("help lists posts:approve and posts:reject", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("posts:approve <id>");
    expect(stdout).toContain("posts:reject <id>");
  });

  it("posts:approve requires an id", async () => {
    const { stderr, exitCode } = await run([
      "posts:approve",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("posts:reject requires an id", async () => {
    const { stderr, exitCode } = await run([
      "posts:reject",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("help lists posts:approval", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("posts:approval <id>");
  });

  it("posts:approval requires an id", async () => {
    const { stderr, exitCode } = await run([
      "posts:approval",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("posts:approval prints who rejected a post, the reason and the comments", async () => {
    const review = {
      post_id: "123456",
      status: "rejected",
      workflow: { id: "42", name: "Content approval" },
      requested_by: { id: "u-ruby", name: "Alex" },
      requested_at: "2026-10-01T09:00:00.000Z",
      current_step: null,
      steps: [
        {
          order: 1,
          name: "Team review",
          require_mode: "any",
          status: "approved",
          approvers: [
            {
              id: "u-glen",
              name: "Sam",
              email: "sam@example.com",
              status: "approved",
              decided_at: "2026-10-01T10:15:00.000Z",
              comment: null,
            },
          ],
        },
        {
          order: 2,
          name: "Client approval",
          require_mode: "all",
          status: "rejected",
          approvers: [
            {
              id: "u-ben",
              name: "Jordan",
              email: "jordan@example.com",
              status: "rejected",
              decided_at: "2026-10-01T14:30:00.000Z",
              comment: "The image does not match the caption",
            },
          ],
        },
      ],
      rejection: {
        by: { id: "u-ben", name: "Jordan" },
        reason: "The image does not match the caption",
        at: "2026-10-01T14:30:00.000Z",
        step: 2,
      },
      comments: [
        {
          id: "c1",
          author: { id: "u-ben", name: "Jordan" },
          message: "Please use the new logo",
          account: "instagram",
          created_at: "2026-10-01T14:28:00.000Z",
        },
      ],
    };
    await withMockServer(
      () => ({ json: { data: review } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "posts:approval",
          "123456",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls).toHaveLength(1);
        expect(calls[0].method).toBe("GET");
        expect(calls[0].path).toBe("/posts/123456/approval");
        expect(stdout).toContain("Status: rejected");
        expect(stdout).toContain("Workflow: Content approval (ID: 42)");
        expect(stdout).toContain("Requested by: Alex");
        expect(stdout).toContain("Rejected by: Jordan on step 2");
        expect(stdout).toContain("Reason: The image does not match the caption");
        expect(stdout).toContain("Step 1: Team review [any one approves]: approved");
        expect(stdout).toContain("Step 2: Client approval [all must approve]: rejected");
        expect(stdout).toContain("Jordan [instagram]: Please use the new logo");
        expect(stdout).not.toContain("Waiting on:");
      }
    );
  });

  it("posts:approval names who a pending post waits for", async () => {
    const review = {
      post_id: "777",
      status: "pending",
      workflow: { id: null, name: "One-off review" },
      requested_by: { id: "u-ruby", name: null },
      requested_at: "2026-10-01T08:00:00.000Z",
      current_step: 2,
      steps: [
        {
          order: 1,
          name: "Draft",
          require_mode: "any",
          status: "approved",
          approvers: [
            { id: "u-glen", name: "Sam", email: null, status: "approved", decided_at: "2026-10-01T09:00:00.000Z", comment: null },
          ],
        },
        {
          order: 2,
          name: "Sign-off",
          require_mode: "all",
          status: "pending",
          approvers: [
            { id: "u-ben", name: "Jordan", email: "jordan@example.com", status: "approved", decided_at: "2026-10-01T10:00:00.000Z", comment: null },
            { id: "u-ava", name: null, email: "ava@example.com", status: "pending", decided_at: null, comment: null },
          ],
        },
      ],
      rejection: null,
      comments: [],
    };
    await withMockServer(
      () => ({ json: { data: review } }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "posts:approval",
          "777",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Status: pending");
        expect(stdout).toContain("Workflow: One-off review (one-off approval)");
        expect(stdout).toContain("Requested by: u-ruby");
        expect(stdout).toContain("Waiting on: step 2 (Sign-off): ava@example.com");
        expect(stdout).toContain("Comments: none");
        expect(stdout).not.toContain("Rejected by:");
      }
    );
  });

  it("posts:approval says so when a post has no approval workflow", async () => {
    const review = {
      post_id: "5",
      status: "none",
      workflow: null,
      requested_by: null,
      requested_at: null,
      current_step: null,
      steps: [],
      rejection: null,
      comments: [],
    };
    await withMockServer(
      () => ({ json: { data: review } }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "posts:approval",
          "5",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Status: none");
        expect(stdout).toContain("This post has no approval workflow.");
      }
    );
  });

  it("posts:approval --json returns the API response unchanged", async () => {
    const review = { post_id: "5", status: "none", workflow: null, steps: [], rejection: null, comments: [] };
    await withMockServer(
      () => ({ json: { data: review } }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "posts:approval",
          "5",
          "--json",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toEqual({ data: review });
      }
    );
  });

  it("posts:approval relays a 404 not_found", async () => {
    await withMockServer(
      () => ({ status: 404, json: { error: { code: "not_found", message: "Post not found." } } }),
      async (baseUrl) => {
        const { stderr, exitCode } = await run([
          "posts:approval",
          "999",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Error [not_found]: Post not found.");
      }
    );
  });

  it("posts:list points at the review for a rejected or pending post", async () => {
    const posts = [
      { id: "1", status: "rejected", approval_status: "rejected", content: { default: "a" }, created_at: "2026-10-01T00:00:00Z" },
      { id: "2", status: "in_approval", approval_status: "pending", content: { default: "b" }, created_at: "2026-10-01T00:00:00Z" },
      { id: "3", status: "scheduled", approval_status: "approved", content: { default: "c" }, created_at: "2026-10-01T00:00:00Z" },
      { id: "4", status: "draft", approval_status: "none", content: { default: "d" }, created_at: "2026-10-01T00:00:00Z" },
    ];
    await withMockServer(
      () => ({ json: { data: posts } }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "posts:list",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Approval: rejected (review: posts:approval 1)");
        expect(stdout).toContain("Approval: pending (review: posts:approval 2)");
        expect(stdout).not.toContain("posts:approval 3");
        expect(stdout).not.toContain("posts:approval 4");
      }
    );
  });

  it("media:upload requires --url", async () => {
    const { stderr, exitCode } = await run([
      "media:upload",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("webhooks:create requires --url and --events", async () => {
    const { stderr, exitCode } = await run([
      "webhooks:create",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("webhooks:create usage and help list the approval events", async () => {
    const usage = await run([
      "webhooks:create",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(usage.stderr).toContain("post.approved");
    expect(usage.stderr).toContain("post.rejected");
    const help = await run(["--help"]);
    expect(help.stdout).toContain("post.approved");
    expect(help.stdout).toContain("post.rejected");
  });

  it("webhooks:create sends the approval events through", async () => {
    await withMockServer(
      (req, body) => ({
        status: 201,
        json: { data: { id: "w1", url: body.url, events: body.events, secret: "s" } },
      }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "webhooks:create",
          "--url",
          "https://example.com/hook",
          "--events",
          "post.approved,post.rejected",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].path).toBe("/webhooks");
        expect(calls[0].body.events).toEqual(["post.approved", "post.rejected"]);
        expect(stdout).toContain("Events: post.approved, post.rejected");
      }
    );
  });

  it("help lists the hashtag set commands", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("HASHTAG SETS");
    expect(stdout).toContain("hashtag-sets:create");
    expect(stdout).toContain("--hashtag-set <name>");
  });

  it("hashtag-sets:create requires --name and --tags", async () => {
    const { stderr, exitCode } = await run([
      "hashtag-sets:create",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("hashtag-sets:update requires an id and a field", async () => {
    const { stderr, exitCode } = await run([
      "hashtag-sets:update",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("hashtag-sets:delete requires an id", async () => {
    const { stderr, exitCode } = await run([
      "hashtag-sets:delete",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });
});

describe("Threads topic (mock API)", () => {
  it("posts:create sends --threads-topic as threads.topic_tag, trimmed and without the #", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const { exitCode } = await run([
          "posts:create",
          "--text",
          "Week 12 of building in public",
          "--channels",
          "threads",
          "--threads-topic",
          "  #Build   in public ",
          "--threads-location-id",
          "123",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].body.threads).toEqual({ location_id: "123", topic_tag: "Build in public" });
      }
    );
  });

  it("posts:update --threads-topic null removes the topic", async () => {
    await withMockServer(
      () => ({ json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const { exitCode } = await run(["posts:update", "p1", "--threads-topic", "null", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("PATCH");
        expect(calls[0].body.threads).toEqual({ topic_tag: null });
      }
    );
  });

  it("posts:create refuses a topic over 50 characters or with a period before calling the API", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const base = ["posts:create", "--text", "Hi", "--channels", "threads", "--api-key", MOCK_KEY, "--base-url", baseUrl];
        const long = await run([...base, "--threads-topic", "a".repeat(51)]);
        expect(long.exitCode).not.toBe(0);
        expect(long.stderr).toContain("--threads-topic can be up to 50 characters (got 51)");
        const dot = await run([...base, "--threads-topic", "Node.js"]);
        expect(dot.exitCode).not.toBe(0);
        expect(dot.stderr).toContain("--threads-topic cannot contain a period (.) or an ampersand (&)");
        expect(calls.length).toBe(0);
      }
    );
  });

  it("posts:list prints the Threads topic", async () => {
    await withMockServer(
      () => ({
        json: {
          data: [
            {
              id: "p1",
              status: "draft",
              content: { default: "Week 12" },
              accounts: ["threads"],
              threads: { topic_tag: "Build in public" },
              created_at: "2026-10-26T08:00:00Z",
            },
          ],
        },
      }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run(["posts:list", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Threads topic: Build in public");
      }
    );
  });

  it("--help lists --threads-topic", async () => {
    const { stdout } = await run(["--help"]);
    expect(stdout).toContain("--threads-topic");
  });
});

describe("Inbox commands", () => {
  it("inbox:list is a known command (requires an API key)", async () => {
    const { stderr, exitCode } = await run(["inbox:list"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("API key not found");
    expect(stderr).not.toContain("Unknown command");
  });

  it("inbox:messages requires a conversation id", async () => {
    const { stderr, exitCode } = await run([
      "inbox:messages",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("inbox:read requires a conversation id", async () => {
    const { stderr, exitCode } = await run([
      "inbox:read",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("inbox:reply requires a conversation id and --text", async () => {
    const { stderr, exitCode } = await run([
      "inbox:reply",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("inbox:reply with an id still requires --text", async () => {
    const { stderr, exitCode } = await run([
      "inbox:reply",
      "linkedin_comment_urn:li:activity:123",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("inbox:hide requires a message id", async () => {
    const { stderr, exitCode } = await run([
      "inbox:hide",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("inbox:hide is a known command (requires an API key)", async () => {
    const { stderr, exitCode } = await run(["inbox:hide", "123"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("API key not found");
    expect(stderr).not.toContain("Unknown command");
  });

  it("inbox:like requires a message id", async () => {
    const { stderr, exitCode } = await run([
      "inbox:like",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
    expect(stderr).toContain("[--unlike]");
  });

  it("inbox:like is a known command (requires an API key)", async () => {
    const { stderr, exitCode } = await run(["inbox:like", "123"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("API key not found");
    expect(stderr).not.toContain("Unknown command");
  });

  it("help lists inbox:like with --unlike", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("inbox:like <message-id>");
    expect(stdout).toContain("--unlike removes it");
  });

  it("help lists inbox:next, inbox:delete, --unanswered and --next", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("inbox:next");
    expect(stdout).toContain("inbox:delete <message-id>");
    expect(stdout).toContain("--unanswered");
    expect(stdout).toContain("--include-read --exclude");
    expect(stdout).toContain("--message-id <message-id>");
    expect(stdout).toContain("--attachment-type --next]");
  });

  it("inbox:next is a known command (requires an API key)", async () => {
    const { stderr, exitCode } = await run(["inbox:next"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("API key not found");
    expect(stderr).not.toContain("Unknown command");
  });

  it("inbox:next rejects an unknown --order", async () => {
    const { stderr, exitCode } = await run([
      "inbox:next",
      "--order",
      "sideways",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
    expect(stderr).toContain("oldest|newest");
  });

  it("inbox:delete requires a message id", async () => {
    const { stderr, exitCode } = await run([
      "inbox:delete",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
    expect(stderr).toContain("cannot be undone");
  });

  it("inbox:delete is a known command (requires an API key)", async () => {
    const { stderr, exitCode } = await run(["inbox:delete", "123"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("API key not found");
    expect(stderr).not.toContain("Unknown command");
  });
});

// Fixtures in the public API's response shape (see GET /inbox/next).
const POST = {
  id: "17912345678901234",
  caption: "Summer drop is live",
  thumbnail: "https://cdn.example.com/p1.jpg",
  url: "https://www.instagram.com/p/abc123/",
  media_type: "IMAGE",
};
const SENDER = { id: "u1", name: "Jane Doe", username: "janedoe", profile_picture: null };
function msg(overrides) {
  return {
    id: "42",
    conversation_id: "ig_comment_18001",
    platform: "instagram",
    type: "comment",
    direction: "incoming",
    text: "Where can I buy this?",
    timestamp: "2026-09-06T10:00:00.000Z",
    is_read: false,
    is_replied: false,
    reaction: null,
    parent_comment_id: null,
    hidden: false,
    permalink: null,
    attachment: null,
    sender: SENDER,
    post: POST,
    ...overrides,
  };
}
const EARLIER = msg({
  id: "41",
  text: "Love it!",
  timestamp: "2026-09-05T09:00:00.000Z",
  is_read: true,
  is_replied: true,
});
const TARGET = msg();
const NEXT_ITEM = {
  conversation: {
    conversation_id: "ig_comment_18001",
    platform: "instagram",
    type: "comment",
    participant: SENDER,
    unread_count: 1,
    last_message: {
      id: "42",
      direction: "incoming",
      text: TARGET.text,
      timestamp: TARGET.timestamp,
      is_read: false,
    },
    post: POST,
  },
  message: TARGET,
  messages: [EARLIER, TARGET],
};

describe("Inbox work queue (mock API)", () => {
  it("inbox:list --unanswered sends unanswered=true", async () => {
    await withMockServer(
      () => ({ json: { data: [], pagination: { has_more: false } } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "inbox:list",
          "--unanswered",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("No conversations found.");
        expect(calls[0].method).toBe("GET");
        expect(calls[0].path).toBe("/inbox/conversations");
        expect(calls[0].query.get("unanswered")).toBe("true");
      }
    );
  });

  it("inbox:next prints the empty-queue line when data is null", async () => {
    await withMockServer(
      () => ({ json: { data: null, remaining: 0 } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "inbox:next",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(stdout.trim()).toBe("Nothing is waiting for an answer.");
        expect(calls[0].path).toBe("/inbox/next");
      }
    );
  });

  it("inbox:next passes its flags through and prints the item, post, thread and count", async () => {
    await withMockServer(
      () => ({ json: { data: NEXT_ITEM, remaining: 3 } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "inbox:next",
          "--platform",
          "instagram",
          "--type",
          "comment",
          "--order",
          "newest",
          "--include-read",
          "--exclude",
          "ig_dm_1, fb_dm_2",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        const q = calls[0].query;
        expect(q.get("platform")).toBe("instagram");
        expect(q.get("type")).toBe("comment");
        expect(q.get("order")).toBe("newest");
        expect(q.get("include_read")).toBe("true");
        expect(q.get("exclude")).toBe("ig_dm_1,fb_dm_2");

        expect(stdout).toContain("Next up: instagram comment from Jane Doe (@janedoe)");
        expect(stdout).toContain("Conversation: ig_comment_18001");
        expect(stdout).toContain("Message to answer: 42");
        expect(stdout).toContain("(pass as --message-id when replying)");
        expect(stdout).not.toContain("Reply window");
        expect(stdout).toContain("On post: 17912345678901234  (IMAGE)");
        expect(stdout).toContain("Caption: Summer drop is live");
        expect(stdout).toContain("URL: https://www.instagram.com/p/abc123/");
        expect(stdout).toContain("Thumbnail: https://cdn.example.com/p1.jpg");
        expect(stdout).toContain("Thread (oldest first)");
        expect(stdout.indexOf("id: 41")).toBeLessThan(stdout.indexOf("id: 42"));
        expect(stdout).toContain("^ answer this one");
        expect(stdout).toContain("3 more waiting.");
        expect(stdout).toContain('inbox:reply "ig_comment_18001" --text "..." --message-id 42 --next');
        expect(stdout).toContain('inbox:read "ig_comment_18001"');
        expect(stdout).toContain("inbox:hide 42 / inbox:delete 42");
      }
    );
  });

  it("inbox:next offers inbox:like on a comment that can be liked", async () => {
    const fb = msg({ platform: "facebook", conversation_id: "fb_comment_9", liked: false });
    const item = {
      conversation: { ...NEXT_ITEM.conversation, conversation_id: "fb_comment_9", platform: "facebook" },
      message: fb,
      messages: [fb],
    };
    await withMockServer(
      () => ({ json: { data: item, remaining: 0 } }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "inbox:next",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("inbox:hide 42 / inbox:delete 42; like it with inbox:like 42");
      }
    );
  });

  it("inbox:next leaves inbox:like out when the platform has no like (liked null)", async () => {
    const ig = msg({ liked: null });
    await withMockServer(
      () => ({ json: { data: { ...NEXT_ITEM, message: ig, messages: [ig] }, remaining: 0 } }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "inbox:next",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("inbox:hide 42 / inbox:delete 42");
        expect(stdout).not.toContain("inbox:like");
      }
    );
  });

  it("inbox:next leaves hide/delete out of the hint for DMs", async () => {
    const dm = msg({ type: "dm", conversation_id: "ig_dm_7", post: null });
    const item = {
      conversation: { ...NEXT_ITEM.conversation, conversation_id: "ig_dm_7", type: "dm", post: null },
      message: dm,
      messages: [dm],
    };
    await withMockServer(
      () => ({ json: { data: item, remaining: 0 } }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "inbox:next",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Next up: instagram dm from Jane Doe");
        expect(stdout).not.toContain("On post:");
        expect(stdout).not.toContain("inbox:hide");
        expect(stdout).not.toContain("--message-id");
        expect(stdout).toContain('inbox:reply "ig_dm_7" --text "..." --next');
        expect(stdout).toContain("0 more waiting.");
      }
    );
  });

  it("inbox:next prints an open reply window and flags a closed one instead of suggesting inbox:reply", async () => {
    const dm = msg({ type: "dm", conversation_id: "ig_dm_9", post: null });
    const base = {
      conversation: { ...NEXT_ITEM.conversation, conversation_id: "ig_dm_9", type: "dm", post: null },
      message: dm,
      messages: [dm],
    };
    let item = { ...base, reply_window: { open: true, closes_at: "2026-09-25T08:00:00.000Z" } };
    await withMockServer(
      () => ({ json: { data: item, remaining: 1 } }),
      async (baseUrl) => {
        const open = await run(["inbox:next", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(open.exitCode).toBe(0);
        expect(open.stdout).toContain("Reply window open until 2026-09-25T08:00:00.000Z (Meta 24-hour rule)");
        expect(open.stdout).toContain('Reply with inbox:reply "ig_dm_9" --text "..." --next');

        item = { ...base, reply_window: { open: false, closes_at: "2026-09-15T11:25:34.352Z" } };
        const closed = await run(["inbox:next", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(closed.exitCode).toBe(0);
        expect(closed.stdout).toContain("Conversation: ig_dm_9");
        expect(closed.stdout).toContain(
          'Reply window closed 2026-09-15T11:25:34.352Z (Meta 24-hour rule): answer this DM from the Instagram app or run inbox:read "ig_dm_9" to skip it'
        );
        expect(closed.stdout).toContain("422 outside_messaging_window");
        expect(closed.stdout).toContain("1 more waiting.");
        expect(closed.stdout).not.toContain("Reply with inbox:reply");
        expect(closed.stdout).not.toContain("--message-id");
      }
    );
  });

  it("inbox:reply sends --message-id as message_id and rejects a non-numeric one before calling the API", async () => {
    await withMockServer(
      () => ({ json: { data: { id: "99" } } }),
      async (baseUrl, calls) => {
        const ok = await run([
          "inbox:reply",
          "ig_comment_18001",
          "--text",
          "Sent you a DM!",
          "--message-id",
          "42",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(ok.exitCode).toBe(0);
        expect(calls[0].path).toBe("/inbox/conversations/ig_comment_18001/reply");
        expect(calls[0].body).toEqual({ text: "Sent you a DM!", message_id: "42" });

        const bad = await run([
          "inbox:reply",
          "ig_comment_18001",
          "--text",
          "x",
          "--message-id",
          "ig_comment_18001",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(bad.exitCode).not.toBe(0);
        expect(bad.stderr).toContain("Usage:");
        expect(bad.stderr).toContain("--message-id takes the numeric message id");
        expect(calls).toHaveLength(1);
      }
    );
  });

  it("inbox:reply --next sends include_next and prints the next item after the confirmation", async () => {
    await withMockServer(
      () => ({
        json: {
          data: { id: "99", timestamp: "2026-09-06T11:00:00.000Z" },
          next: NEXT_ITEM,
          remaining: 1,
        },
      }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "inbox:reply",
          "fb_dm_555",
          "--text",
          "On it!",
          "--next",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("POST");
        expect(calls[0].path).toBe("/inbox/conversations/fb_dm_555/reply");
        expect(calls[0].body).toEqual({ text: "On it!", include_next: true });
        expect(stdout).toContain("Reply sent!");
        expect(stdout).toContain("Message ID: 99");
        expect(stdout.indexOf("Reply sent!")).toBeLessThan(stdout.indexOf("Next up:"));
        expect(stdout).toContain("Conversation: ig_comment_18001");
        expect(stdout).toContain("1 more waiting.");
      }
    );
  });

  it("inbox:reply without --next does not send include_next", async () => {
    await withMockServer(
      () => ({ json: { data: { id: "99" } } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "inbox:reply",
          "fb_dm_555",
          "--text",
          "On it!",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].body).toEqual({ text: "On it!" });
        expect(stdout).not.toContain("Next up:");
        expect(stdout).not.toContain("Nothing is waiting");
      }
    );
  });

  it("inbox:messages prints the post block before a comment thread", async () => {
    await withMockServer(
      () => ({ json: { data: [EARLIER, TARGET], pagination: { has_more: false } } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "inbox:messages",
          "ig_comment_18001",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].path).toBe("/inbox/conversations/ig_comment_18001/messages");
        expect(stdout.indexOf("On post: 17912345678901234")).toBeLessThan(stdout.indexOf("Messages (2)"));
        expect(stdout).toContain("URL: https://www.instagram.com/p/abc123/");
        expect(stdout).toContain("id: 41");
        expect(stdout).toContain("id: 42");
      }
    );
  });

  it("inbox:messages shows 'hidden' on a hidden comment", async () => {
    await withMockServer(
      () => ({ json: { data: [msg({ hidden: true, platform: "facebook" })] } }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "inbox:messages",
          "fb_comment_1",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("hidden");
        expect(stdout).not.toContain("hidden on Threads");
      }
    );
  });

  it("inbox:hide names the platform from the response", async () => {
    await withMockServer(
      () => ({ json: { data: msg({ hidden: true, platform: "youtube" }) } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "inbox:hide",
          "42",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].path).toBe("/inbox/messages/42/hide");
        expect(calls[0].body).toEqual({ hide: true });
        expect(stdout).toContain("Comment 42 is now hidden on youtube.");
      }
    );
  });

  it("inbox:messages shows 'liked' on a liked comment and nothing for null", async () => {
    await withMockServer(
      () => ({
        json: {
          data: [
            msg({ id: "50", platform: "tiktok", liked: true }),
            msg({ id: "51", platform: "tiktok", liked: false }),
            msg({ id: "52", liked: null }),
          ],
        },
      }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "inbox:messages",
          "tt_comment_1",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(stdout.match(/·  liked/g) || []).toHaveLength(1);
        expect(stdout).toMatch(/id: 50[^\n]*liked/);
        expect(stdout).not.toMatch(/id: 51[^\n]*liked/);
        expect(stdout).not.toMatch(/id: 52[^\n]*liked/);
      }
    );
  });

  it("inbox:like sends like true and names the platform", async () => {
    await withMockServer(
      () => ({ json: { data: msg({ platform: "facebook", liked: true }) } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "inbox:like",
          "42",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("POST");
        expect(calls[0].path).toBe("/inbox/messages/42/like");
        expect(calls[0].body).toEqual({ like: true });
        expect(stdout).toContain("Comment 42 on facebook is now liked.");
      }
    );
  });

  it("inbox:like --unlike sends like false", async () => {
    await withMockServer(
      () => ({ json: { data: msg({ platform: "linkedin", liked: false }) } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "inbox:like",
          "42",
          "--unlike",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].body).toEqual({ like: false });
        expect(stdout).toContain("Comment 42 on linkedin: like removed.");
      }
    );
  });

  it("inbox:like --json prints the API response", async () => {
    await withMockServer(
      () => ({ json: { data: msg({ platform: "tiktok", liked: true }) } }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "inbox:like",
          "42",
          "--json",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        const out = JSON.parse(stdout);
        expect(out.data.liked).toBe(true);
        expect(out.data.platform).toBe("tiktok");
      }
    );
  });

  it("inbox:like relays the API error envelope", async () => {
    await withMockServer(
      () => ({
        status: 403,
        json: {
          error: {
            code: "reconnect_required",
            message: "Reconnect Facebook in OmniSocials to like comments.",
          },
        },
      }),
      async (baseUrl) => {
        const { stderr, exitCode } = await run([
          "inbox:like",
          "42",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Error [reconnect_required]");
      }
    );
  });

  it("inbox:delete sends DELETE and prints what was removed", async () => {
    await withMockServer(
      () => ({
        json: {
          data: { id: "42", conversation_id: "fb_comment_1", removed_reply_ids: ["43", "44"] },
        },
      }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "inbox:delete",
          "42",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("DELETE");
        expect(calls[0].path).toBe("/inbox/messages/42");
        expect(stdout).toContain("Comment 42 deleted from the platform.");
        expect(stdout).toContain("Conversation: fb_comment_1");
        expect(stdout).toContain("Also removed 2 replies under it: 43, 44");
      }
    );
  });

  it("inbox:delete relays the API error envelope", async () => {
    await withMockServer(
      () => ({
        status: 400,
        json: {
          error: {
            code: "unsupported_platform",
            message: "Only incoming Facebook, Instagram and TikTok comments can be deleted.",
          },
        },
      }),
      async (baseUrl) => {
        const { stderr, exitCode } = await run([
          "inbox:delete",
          "42",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Error [unsupported_platform]");
      }
    );
  });
});

const PRODUCT_A = "813744226420795884";
const PRODUCT_B = "813744226420795885";

const CATALOG_PRODUCTS = {
  products: [
    {
      pin_id: PRODUCT_A,
      title: "Blue ribbed top",
      description: null,
      link: "https://shop.example.com/products/blue-ribbed-top",
      image_url: "https://i.pinimg.com/400x300/aa/bb/cc/example.jpg",
      price: 24.99,
      currency: "EUR",
      availability: "IN_STOCK",
      item_id: "TOP-BLUE-M",
    },
    {
      pin_id: PRODUCT_B,
      title: "Grey wool scarf",
      description: null,
      link: "https://shop.example.com/products/grey-wool-scarf",
      image_url: null,
      price: null,
      currency: null,
      availability: null,
      item_id: null,
    },
  ],
  bookmark: "next_page_1",
  source: "catalog",
  catalog_access: true,
  product_groups: [
    { id: "443727193917", name: "All Products" },
    { id: "443727193918", name: "Autumn" },
  ],
  product_group_id: "443727193917",
};

describe("Pinterest product tagging (mock API)", () => {
  it("help lists the Pinterest commands and --pinterest-product-tags", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("pinterest:products");
    expect(stdout).toContain("pinterest:validate <pin>");
    expect(stdout).toContain("--pinterest-product-tags");
  });

  it("posts:create sends --pinterest-product-tags as pinterest.product_tags, ids as strings and links unchanged", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const { exitCode } = await run([
          "posts:create",
          "--text",
          "Autumn outfit",
          "--channels",
          "pinterest",
          "--pinterest-board-id",
          "board_1",
          "--pinterest-product-tags",
          `${PRODUCT_A}, https://www.pinterest.com/pin/${PRODUCT_B}/`,
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("POST");
        expect(calls[0].path).toBe("/posts/create");
        expect(calls[0].body.pinterest).toEqual({
          board_id: "board_1",
          product_tags: [PRODUCT_A, `https://www.pinterest.com/pin/${PRODUCT_B}/`],
        });
      }
    );
  });

  it("posts:create-and-publish sends --pinterest-product-tags", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "posting" } } }),
      async (baseUrl, calls) => {
        const { exitCode } = await run([
          "posts:create-and-publish",
          "--text",
          "Autumn outfit",
          "--channels",
          "pinterest",
          "--pinterest-board-id",
          "board_1",
          "--pinterest-product-tags",
          PRODUCT_A,
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].path).toBe("/posts/create-and-publish");
        expect(calls[0].body.pinterest.product_tags).toEqual([PRODUCT_A]);
      }
    );
  });

  it("posts:update sends --pinterest-product-tags, and leaves product_tags out when the flag is not given", async () => {
    await withMockServer(
      () => ({ json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const withTags = await run([
          "posts:update",
          "p1",
          "--pinterest-board-id",
          "board_1",
          "--pinterest-product-tags",
          `${PRODUCT_A},${PRODUCT_B}`,
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(withTags.exitCode).toBe(0);
        expect(calls[0].method).toBe("PATCH");
        expect(calls[0].path).toBe("/posts/p1");
        expect(calls[0].body.pinterest).toEqual({
          board_id: "board_1",
          product_tags: [PRODUCT_A, PRODUCT_B],
        });

        const withoutTags = await run([
          "posts:update",
          "p1",
          "--pinterest-board-id",
          "board_1",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(withoutTags.exitCode).toBe(0);
        expect(calls[1].body.pinterest).toEqual({ board_id: "board_1" });
      }
    );
  });

  it("posts:create rejects --pinterest-product-tags without a value before calling the API", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const { stderr, exitCode } = await run([
          "posts:create",
          "--text",
          "Autumn outfit",
          "--pinterest-product-tags",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("--pinterest-product-tags needs a comma-separated list");
        expect(calls).toHaveLength(0);
      }
    );
  });

  it("posts:list prints what Pinterest did with the product tags", async () => {
    const posts = [
      {
        id: "1",
        status: "published",
        content: { default: "a" },
        created_at: "2026-10-05T00:00:00Z",
        pinterest: {
          board_id: "board_1",
          product_tags: [PRODUCT_A, PRODUCT_B],
          product_tags_result: {
            requested: 2,
            tagged: [PRODUCT_A],
            skipped: [{ pin_id: PRODUCT_B, reason: "PIN_IS_PRIVATE" }],
            error: null,
          },
        },
      },
      {
        id: "2",
        status: "published",
        content: { default: "b" },
        created_at: "2026-10-05T00:00:00Z",
        pinterest: {
          board_id: "board_1",
          product_tags: [PRODUCT_A],
          product_tags_result: { requested: 1, tagged: [], skipped: [], error: "Pinterest did not answer" },
        },
      },
      {
        id: "3",
        status: "scheduled",
        content: { default: "c" },
        created_at: "2026-10-05T00:00:00Z",
        pinterest: { board_id: "board_1", product_tags: [PRODUCT_A] },
      },
    ];
    await withMockServer(
      () => ({ json: { data: posts } }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "posts:list",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain(
          `Pinterest products: 1 of 2 tagged (skipped: ${PRODUCT_B} PIN_IS_PRIVATE)`
        );
        expect(stdout).toContain("Pinterest products: 0 of 1 tagged (error: Pinterest did not answer)");
        expect(stdout.match(/Pinterest products:/g)).toHaveLength(2);
      }
    );
  });

  it("pinterest:products passes its flags through and prints the products, groups and next page", async () => {
    await withMockServer(
      () => ({ json: CATALOG_PRODUCTS }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "pinterest:products",
          "--source",
          "catalog",
          "--product-group-id",
          "443727193917",
          "--bookmark",
          "page_0",
          "--page-size",
          "50",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("GET");
        expect(calls[0].path).toBe("/pinterest/products");
        const q = calls[0].query;
        expect(q.get("source")).toBe("catalog");
        expect(q.get("product_group_id")).toBe("443727193917");
        expect(q.get("bookmark")).toBe("page_0");
        expect(q.get("page_size")).toBe("50");
        expect(stdout).toContain("Pinterest products (2, source: catalog)");
        expect(stdout).toContain(
          `pin_id: ${PRODUCT_A}  Blue ribbed top  (24.99 EUR, IN_STOCK, item TOP-BLUE-M)`
        );
        expect(stdout).toContain("https://shop.example.com/products/blue-ribbed-top");
        expect(stdout).toContain(`pin_id: ${PRODUCT_B}  Grey wool scarf\n`);
        expect(stdout).toContain("All Products (443727193917) [shown], Autumn (443727193918)");
        expect(stdout).toContain('--bookmark "next_page_1"');
        expect(stdout).toContain("--pinterest-product-tags <id,id> (max 24 per Pin)");
      }
    );
  });

  it("pinterest:products sends no query when no flag is given", async () => {
    await withMockServer(
      () => ({ json: { products: [], bookmark: null, source: "pins", catalog_access: false } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "pinterest:products",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect([...calls[0].query.keys()]).toEqual([]);
        expect(stdout).toContain("No product Pins found on this Pinterest account.");
        expect(stdout).toContain("Connect catalog");
      }
    );
  });

  it("pinterest:products points at the bookmark when a scan found no product Pin but more Pins are left", async () => {
    await withMockServer(
      () => ({ json: { products: [], bookmark: "scan_2", source: "pins", catalog_access: false } }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "pinterest:products",
          "--source",
          "pins",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("No product Pins in this batch.");
        expect(stdout).toContain('--bookmark "scan_2"');
        expect(stdout).not.toContain("No product Pins found on this Pinterest account.");
      }
    );
  });

  it("pinterest:products prints an HTTP 200 error object as an error, not as an empty list", async () => {
    await withMockServer(
      () => ({
        status: 200,
        json: {
          error: {
            code: "pinterest_catalog_access_required",
            message: "This Pinterest connection cannot read the product catalog.",
          },
          catalog_access: false,
        },
      }),
      async (baseUrl) => {
        const { stdout, stderr, exitCode } = await run([
          "pinterest:products",
          "--source",
          "catalog",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain(
          "Error [pinterest_catalog_access_required]: This Pinterest connection cannot read the product catalog."
        );
        expect(stdout).not.toContain("No product");
      }
    );
  });

  it("pinterest:products relays a 400 validation_error", async () => {
    await withMockServer(
      () => ({
        status: 400,
        json: { error: { code: "validation_error", message: "product_group_id is not a product group of the connected account." } },
      }),
      async (baseUrl) => {
        const { stderr, exitCode } = await run([
          "pinterest:products",
          "--product-group-id",
          "1",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Error [validation_error]");
      }
    );
  });

  it("pinterest:products rejects an unknown --source before calling the API", async () => {
    await withMockServer(
      () => ({ json: CATALOG_PRODUCTS }),
      async (baseUrl, calls) => {
        const { stderr, exitCode } = await run([
          "pinterest:products",
          "--source",
          "shop",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Usage:");
        expect(stderr).toContain("--source catalog|pins");
        expect(calls).toHaveLength(0);
      }
    );
  });

  it("pinterest:products --json returns the API response unchanged", async () => {
    await withMockServer(
      () => ({ json: CATALOG_PRODUCTS }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "pinterest:products",
          "--json",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toEqual(CATALOG_PRODUCTS);
      }
    );
  });

  it("pinterest:validate requires a Pin ID or Pin link", async () => {
    const { stderr, exitCode } = await run([
      "pinterest:validate",
      "--api-key",
      "omsk_test_fake",
      "--base-url",
      "http://localhost:0",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Usage:");
  });

  it("pinterest:validate sends the id and prints a valid product Pin", async () => {
    const link = `https://www.pinterest.com/pin/${PRODUCT_A}/`;
    await withMockServer(
      () => ({
        json: {
          valid: true,
          pin_id: PRODUCT_A,
          title: "Blue ribbed top",
          link: "https://shop.example.com/products/blue-ribbed-top",
          image_url: null,
        },
      }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "pinterest:validate",
          link,
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("GET");
        expect(calls[0].path).toBe("/pinterest/products/validate");
        expect(calls[0].query.get("id")).toBe(link);
        expect(stdout).toContain(`Valid product Pin: ${PRODUCT_A}  Blue ribbed top`);
        expect(stdout).toContain(`--pinterest-product-tags ${PRODUCT_A}`);
      }
    );
  });

  it("pinterest:validate prints why a Pin is not valid, and says so when the check could not run", async () => {
    const answers = [
      {
        valid: false,
        pin_id: PRODUCT_B,
        reason: "This Pin is not a product Pin.",
      },
      {
        valid: false,
        unverified: true,
        pin_id: PRODUCT_B,
        reason: "Pinterest did not answer. The publish step is the final check.",
      },
    ];
    await withMockServer(
      () => ({ json: answers.shift() }),
      async (baseUrl) => {
        const args = ["pinterest:validate", PRODUCT_B, "--api-key", MOCK_KEY, "--base-url", baseUrl];
        const invalid = await run(args);
        expect(invalid.exitCode).toBe(0);
        expect(invalid.stdout).toContain(`Not valid (${PRODUCT_B}): This Pin is not a product Pin.`);

        const unverified = await run(args);
        expect(unverified.exitCode).toBe(0);
        expect(unverified.stdout).toContain(
          `Not checked (${PRODUCT_B}): Pinterest did not answer. The publish step is the final check.`
        );
      }
    );
  });
});

// Fixtures in the public API's response shape for the image fit feature:
// a `warnings[]` entry of POST /posts/create and a `fit[]` row of POST /media/check.
const FIT_CROPPED = {
  code: "image_fit",
  platform: "instagram",
  media_url: "https://cdn.example.com/pier-9x16.jpg",
  ratio: "9:16",
  target: "4:5",
  action: "cropped",
  crop_url: "https://cdn.example.com/pier-9x16-4x5.jpg",
  message:
    'Instagram: This image is 9:16. Instagram shows feed images between 4:5 and 1.91:1, and Meta cannot boost a feed post outside that range. It was cropped to 4:5 around the subject. To send the original, update the post with media_fit: { "instagram": "keep" }.',
};
const FIT_KEPT = {
  code: "image_fit",
  platform: "pinterest",
  media_url: "https://cdn.example.com/pier-9x16.jpg",
  ratio: "9:16",
  target: "2:3",
  action: "kept",
  message:
    'Pinterest: This image is 9:16. Pinterest may cut a Pin taller than 2:3 in the home feed. The Pin page shows it whole. Pinterest cuts it to fit. Pass media_fit: { "pinterest": "crop" } to crop it to 2:3.',
};
const MEDIA_CHECK_FIT = {
  file: { size_bytes: 812345, mime: "image/jpeg", size_known: true, width: 1080, height: 1920 },
  connected_platforms: ["instagram", "pinterest", "linkedin"],
  compatible: true,
  warnings: [],
  summary: null,
  fit: [
    {
      platform: "instagram",
      display_name: "Instagram",
      fits: false,
      ratio: "9:16",
      shown: "cut",
      target: "4:5",
      default_action: "crop",
      message:
        'Instagram: This image is 9:16. Instagram shows feed images between 4:5 and 1.91:1, and Meta cannot boost a feed post outside that range. A post crops it to 4:5 unless media_fit says "keep".',
    },
    {
      platform: "pinterest",
      display_name: "Pinterest",
      fits: false,
      ratio: "9:16",
      shown: "cut",
      target: "2:3",
      default_action: "keep",
      message:
        "Pinterest: This image is 9:16. Pinterest may cut a Pin taller than 2:3 in the home feed. The Pin page shows it whole. Pinterest cuts it to fit.",
    },
  ],
};

describe("Image fit per channel (mock API)", () => {
  it("help lists --media-fit", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--media-fit <ch=action,..>");
    expect(stdout).toContain("--media-urls --media-ids --media-fit]");
  });

  it("posts:create sends --media-fit as a media_fit object and prints the image_fit warnings", async () => {
    await withMockServer(
      () => ({
        status: 201,
        json: { data: { id: "p1", status: "scheduled" }, warnings: [FIT_CROPPED, FIT_KEPT] },
      }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "posts:create",
          "--text",
          "Golden hour on the pier",
          "--channels",
          "instagram,pinterest",
          "--media-urls",
          "https://example.com/pier-9x16.jpg",
          "--media-fit",
          "instagram=auto, pinterest=keep",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("POST");
        expect(calls[0].path).toBe("/posts/create");
        expect(calls[0].body.media_fit).toEqual({ instagram: "auto", pinterest: "keep" });
        expect(stdout).toContain("Post created successfully!");
        expect(stdout).toContain("Warnings (2):");
        expect(stdout).toContain("[image_fit] Instagram: This image is 9:16.");
        expect(stdout).toContain('update the post with media_fit: { "instagram": "keep" }.');
        expect(stdout).toContain("crop: https://cdn.example.com/pier-9x16-4x5.jpg");
        expect(stdout).toContain("[image_fit] Pinterest: This image is 9:16.");
        expect(stdout.indexOf("Post created successfully!")).toBeLessThan(stdout.indexOf("Warnings (2):"));
      }
    );
  });

  it("posts:create without --media-fit sends no media_fit and prints no warnings block when the API sends none", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "posts:create",
          "--text",
          "Square photo",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].body).not.toHaveProperty("media_fit");
        expect(stdout).not.toContain("Warnings");
      }
    );
  });

  it("posts:create --json returns the response with its warnings unchanged", async () => {
    const response = { data: { id: "p1", status: "scheduled" }, warnings: [FIT_CROPPED] };
    await withMockServer(
      () => ({ status: 201, json: response }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "posts:create",
          "--text",
          "Golden hour",
          "--json",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toEqual(response);
      }
    );
  });

  it("posts:create-and-publish prints the x_url_post_credits warning too", async () => {
    const credits = {
      code: "x_url_post_credits",
      message:
        "This post contains 1 X tweet(s) with a link and will use 20 credits when it publishes (X's link-post fee, passed through at cost).",
      credits_required: 20,
      credits_balance: 140,
      enforced: true,
      enforce_from: "2026-08-14",
    };
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p2", status: "posting" }, warnings: [credits] } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "posts:create-and-publish",
          "--text",
          "Read it at https://example.com/report",
          "--channels",
          "x",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].path).toBe("/posts/create-and-publish");
        expect(stdout).toContain("Post created and publishing!");
        expect(stdout).toContain("Warnings (1):");
        expect(stdout).toContain("[x_url_post_credits] This post contains 1 X tweet(s) with a link");
        expect(stdout).not.toContain("crop:");
      }
    );
  });

  it("posts:update --media-fit alone sends only media_fit and prints what changed", async () => {
    const restored = { ...FIT_CROPPED, action: "kept", message: "Instagram: This image is 9:16. Instagram shows feed images between 4:5 and 1.91:1, and Meta cannot boost a feed post outside that range. Instagram cuts it to fit." };
    delete restored.crop_url;
    await withMockServer(
      () => ({ json: { data: { id: "p1", status: "scheduled" }, warnings: [restored] } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "posts:update",
          "p1",
          "--media-fit",
          "instagram=keep",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("PATCH");
        expect(calls[0].path).toBe("/posts/p1");
        expect(calls[0].body).toEqual({ media_fit: { instagram: "keep" } });
        expect(stdout).toContain("Post updated successfully!");
        expect(stdout).toContain("[image_fit] Instagram: This image is 9:16.");
        expect(stdout).toContain("Instagram cuts it to fit.");
        expect(stdout).not.toContain("crop:");
      }
    );
  });

  it("posts:create rejects a malformed --media-fit before calling the API", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const base = ["posts:create", "--text", "Golden hour", "--api-key", MOCK_KEY, "--base-url", baseUrl];

        const badAction = await run([...base, "--media-fit", "instagram=stretch"]);
        expect(badAction.exitCode).not.toBe(0);
        expect(badAction.stderr).toContain('"stretch" is not an action for instagram');
        expect(badAction.stderr).toContain("instagram=keep,pinterest=crop");

        const badChannel = await run([...base, "--media-fit", "instgram=keep"]);
        expect(badChannel.exitCode).not.toBe(0);
        expect(badChannel.stderr).toContain('unknown channel "instgram"');

        const noPair = await run([...base, "--media-fit", "instagram"]);
        expect(noPair.exitCode).not.toBe(0);
        expect(noPair.stderr).toContain("--media-fit takes <channel>=<auto|crop|keep> pairs");

        const noValue = await run([...base, "--media-fit"]);
        expect(noValue.exitCode).not.toBe(0);
        expect(noValue.stderr).toContain("--media-fit takes <channel>=<auto|crop|keep> pairs");

        expect(calls).toHaveLength(0);
      }
    );
  });

  it("media:check prints the fit rows in plain words after the JSON, with the --media-fit override", async () => {
    await withMockServer(
      () => ({ json: MEDIA_CHECK_FIT }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "media:check",
          "--media-id",
          "12345",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].path).toBe("/media/check");
        expect(calls[0].body).toEqual({ media_id: "12345" });
        expect(stdout).toContain('"width": 1080');
        expect(stdout).toContain("Image fit (feed posts):");
        expect(stdout).toContain(
          "Instagram: 9:16, outside the window Instagram shows uncropped; default: crop to 4:5 around the subject"
        );
        expect(stdout).toContain('A post crops it to 4:5 unless media_fit says "keep".');
        expect(stdout).toContain(
          "Pinterest: 9:16, outside the window Pinterest shows uncropped; default: keep the original (Pinterest may cut it; crop target 2:3)"
        );
        expect(stdout).toContain(
          "Override on posts:create / posts:update with --media-fit instagram=keep,pinterest=crop"
        );
        expect(stdout.indexOf('"fit"')).toBeLessThan(stdout.indexOf("Image fit (feed posts):"));
      }
    );
  });

  it("media:check prints a fitting image as shown whole and no block when fit is empty", async () => {
    const answers = [
      {
        ...MEDIA_CHECK_FIT,
        file: { ...MEDIA_CHECK_FIT.file, width: 1080, height: 1350 },
        fit: [
          { platform: "instagram", display_name: "Instagram", fits: true, ratio: "4:5", shown: "whole", target: null, default_action: null, message: null },
        ],
      },
      { ...MEDIA_CHECK_FIT, file: { ...MEDIA_CHECK_FIT.file, mime: "video/mp4", width: null, height: null }, fit: [] },
    ];
    await withMockServer(
      () => ({ json: answers.shift() }),
      async (baseUrl) => {
        const args = ["media:check", "--media-id", "12345", "--api-key", MOCK_KEY, "--base-url", baseUrl];
        const whole = await run(args);
        expect(whole.exitCode).toBe(0);
        expect(whole.stdout).toContain("Instagram: 4:5, shown whole");
        expect(whole.stdout).not.toContain("Override on posts:create");

        const video = await run(args);
        expect(video.exitCode).toBe(0);
        expect(video.stdout).not.toContain("Image fit (feed posts):");
      }
    );
  });

  it("media:check --json returns the API response unchanged", async () => {
    await withMockServer(
      () => ({ json: MEDIA_CHECK_FIT }),
      async (baseUrl) => {
        const { stdout, exitCode } = await run([
          "media:check",
          "--media-id",
          "12345",
          "--json",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(JSON.parse(stdout)).toEqual(MEDIA_CHECK_FIT);
      }
    );
  });
});

// The Automation object as GET /automations/{id} returns it (post: a snapshot
// of the OmniSocials post it listens on).
const AUTOMATION = {
  id: "100000004",
  type: "comment_to_dm",
  platform: "instagram",
  status: "active",
  name: "guide",
  post_id: "83778183",
  instagram_media_id: "18134683699582250",
  post: {
    source: "omnisocials",
    id: "83778183",
    caption: "Comment GUIDE for the free checklist",
    thumbnail_url: "https://cdn.example.com/thumb.jpg",
    permalink: "https://www.instagram.com/p/DABC123/",
    media_type: "POST",
    status: "posted",
    post_date_time: "2026-10-09T09:00:00.000Z",
    live: true,
  },
  trigger: { kinds: ["comment"], scope: "post", keywords: ["guide", "link"], match: "word" },
  actions: {
    dm: { text: "Here is the guide: https://example.com/guide" },
    public_reply: { enabled: true, variations: ["Sent you a DM!", "Check your inbox"] },
  },
  limits: { max_sends: 100, stop_at: null },
  stats: { matched: 15, sent: 12, skipped: 3, failed: 0, last_event_at: "2026-10-10T21:40:00.000Z" },
  created_at: "2026-10-10T21:33:34.341Z",
  updated_at: "2026-10-10T21:33:34.341Z",
};

const SCOPE_ERROR = {
  status: 403,
  json: { error: { code: "insufficient_scope", message: "This API key lacks the automations:read scope" } },
};

describe("Comment-to-DM automations (mock API)", () => {
  it("help lists the automation commands and the --dm-* post flags", async () => {
    const { stdout, exitCode } = await run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("AUTOMATIONS");
    expect(stdout).toContain("automations:list");
    expect(stdout).toContain("automations:create");
    expect(stdout).toContain("automations:events <id>");
    expect(stdout).toContain("--dm-keywords <a,b>");
    expect(stdout).toContain("--dm-message");
    expect(stdout).toContain("--no-dm");
  });

  it("automations:create builds the nested body with the defaults spelled out", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: AUTOMATION } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "automations:create",
          "--post-id",
          "83778183",
          "--keywords",
          "guide, link",
          "--dm",
          "Here is the guide: https://example.com/guide",
          "--reply",
          "Sent you a DM!",
          "--reply",
          "Check your inbox",
          "--max-sends",
          "100",
          "--name",
          "guide",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("POST");
        expect(calls[0].path).toBe("/automations");
        expect(calls[0].body).toEqual({
          name: "guide",
          post_id: "83778183",
          trigger: { kinds: ["comment"], scope: "post", keywords: ["guide", "link"], match: "word" },
          actions: {
            dm: { text: "Here is the guide: https://example.com/guide" },
            public_reply: { enabled: true, variations: ["Sent you a DM!", "Check your inbox"] },
          },
          limits: { max_sends: 100 },
        });
        expect(stdout).toContain("Automation created!");
        expect(stdout).toContain("ID: 100000004");
        expect(stdout).toContain("Trigger: comment on this post; keywords: guide, link (whole word)");
        expect(stdout).toContain('Post: post 83778183: "Comment GUIDE for the free checklist"  https://www.instagram.com/p/DABC123/  (live)');
        expect(stdout).toContain("DM: Here is the guide: https://example.com/guide");
        expect(stdout).toContain('Public reply: "Sent you a DM!" | "Check your inbox"');
        expect(stdout).toContain("Limits: max 100 DMs");
        expect(stdout).toContain("Stats: 12 sent / 15 matched / 3 skipped / 0 failed");
        expect(stdout).toContain("Activity: automations:events 100000004");
      }
    );
  });

  it("automations:create takes a comma list for --reply, --triggers, --scope, --stop-at and --paused", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { ...AUTOMATION, status: "paused", post: null, post_id: null } } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "automations:create",
          "--triggers",
          "comment,dm",
          "--scope",
          "next_post",
          "--keywords",
          "guide",
          "--match",
          "contains",
          "--dm",
          "Here you go",
          "--reply",
          "Sent you a DM!,Check your inbox",
          "--stop-at",
          "2026-12-31T00:00:00Z",
          "--paused",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].body).toEqual({
          trigger: { kinds: ["comment", "dm"], scope: "next_post", keywords: ["guide"], match: "contains" },
          actions: {
            dm: { text: "Here you go" },
            public_reply: { enabled: true, variations: ["Sent you a DM!", "Check your inbox"] },
          },
          limits: { stop_at: "2026-12-31T00:00:00Z" },
          status: "paused",
        });
        expect(stdout).toContain("Turn it on with: automations:update 100000004 --resume");
      }
    );
  });

  it("automations:create leaves scope out of a DM-only trigger and needs no post for it", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: AUTOMATION } }),
      async (baseUrl, calls) => {
        const { exitCode } = await run([
          "automations:create",
          "--triggers",
          "dm,story_reply",
          "--keywords",
          "guide",
          "--dm",
          "Here you go",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].body.trigger).toEqual({ kinds: ["dm", "story_reply"], keywords: ["guide"], match: "word" });
      }
    );
  });

  it("automations:create refuses a missing --dm, both post flags, and a comment trigger on a post without the post, before calling the API", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: AUTOMATION } }),
      async (baseUrl, calls) => {
        const base = ["automations:create", "--api-key", MOCK_KEY, "--base-url", baseUrl];

        const noDm = await run([...base, "--keywords", "guide", "--post-id", "1"]);
        expect(noDm.exitCode).not.toBe(0);
        expect(noDm.stderr).toContain("Usage: omnisocials automations:create");

        const bothPosts = await run([...base, "--dm", "x", "--keywords", "guide", "--post-id", "1", "--instagram-media-id", "2"]);
        expect(bothPosts.exitCode).not.toBe(0);
        expect(bothPosts.stderr).toContain("not both");

        const noPost = await run([...base, "--dm", "x", "--keywords", "guide"]);
        expect(noPost.exitCode).not.toBe(0);
        expect(noPost.stderr).toContain("needs the post");
        expect(noPost.stderr).toContain("--scope next_post");

        const badMatch = await run([...base, "--dm", "x", "--keywords", "guide", "--post-id", "1", "--match", "fuzzy"]);
        expect(badMatch.exitCode).not.toBe(0);
        expect(badMatch.stderr).toContain("--match must be one of word|contains|any");

        const badTrigger = await run([...base, "--dm", "x", "--keywords", "guide", "--post-id", "1", "--triggers", "comment,mention"]);
        expect(badTrigger.exitCode).not.toBe(0);
        expect(badTrigger.stderr).toContain('--triggers: "mention" is not one of comment|dm|story_reply');

        const badSends = await run([...base, "--dm", "x", "--keywords", "guide", "--post-id", "1", "--max-sends", "lots"]);
        expect(badSends.exitCode).not.toBe(0);
        expect(badSends.stderr).toContain("--max-sends must be a whole number above 0");

        const badStop = await run([...base, "--dm", "x", "--keywords", "guide", "--post-id", "1", "--stop-at", "tomorrow"]);
        expect(badStop.exitCode).not.toBe(0);
        expect(badStop.stderr).toContain("--stop-at must be an ISO 8601 time");

        expect(calls).toHaveLength(0);
      }
    );
  });

  it("automations:create --scope any sends no post and passes", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { ...AUTOMATION, post: null, post_id: null, instagram_media_id: null } } }),
      async (baseUrl, calls) => {
        const { exitCode } = await run([
          "automations:create",
          "--scope",
          "any",
          "--match",
          "any",
          "--dm",
          "Thanks for the comment",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].body).toEqual({
          trigger: { kinds: ["comment"], scope: "any", match: "any" },
          actions: { dm: { text: "Thanks for the comment" } },
        });
      }
    );
  });

  it("automations:update sends only the sections given, and --pause / --resume the status", async () => {
    await withMockServer(
      () => ({ json: { data: AUTOMATION } }),
      async (baseUrl, calls) => {
        const keywords = await run([
          "automations:update",
          "100000004",
          "--keywords",
          "guide,link,checklist",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(keywords.exitCode).toBe(0);
        expect(calls[0].method).toBe("PATCH");
        expect(calls[0].path).toBe("/automations/100000004");
        expect(calls[0].body).toEqual({ trigger: { keywords: ["guide", "link", "checklist"] } });
        expect(keywords.stdout).toContain("Automation updated!");

        const pause = await run(["automations:update", "100000004", "--pause", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(pause.exitCode).toBe(0);
        expect(calls[1].body).toEqual({ status: "paused" });

        const resume = await run([
          "automations:update",
          "100000004",
          "--resume",
          "--max-sends",
          "500",
          "--dm",
          "New text",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(resume.exitCode).toBe(0);
        expect(calls[2].body).toEqual({
          status: "active",
          actions: { dm: { text: "New text" } },
          limits: { max_sends: 500 },
        });

        const move = await run([
          "automations:update",
          "100000004",
          "--instagram-media-id",
          "17931294888148229",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(move.exitCode).toBe(0);
        expect(calls[3].body).toEqual({ instagram_media_id: "17931294888148229" });
      }
    );
  });

  it("automations:update refuses no fields, --pause with --resume, and a missing id, before calling the API", async () => {
    await withMockServer(
      () => ({ json: { data: AUTOMATION } }),
      async (baseUrl, calls) => {
        const noId = await run(["automations:update", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(noId.exitCode).not.toBe(0);
        expect(noId.stderr).toContain("Usage:");

        const nothing = await run(["automations:update", "100000004", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(nothing.exitCode).not.toBe(0);
        expect(nothing.stderr).toContain("Nothing to update");

        const both = await run(["automations:update", "100000004", "--pause", "--resume", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(both.exitCode).not.toBe(0);
        expect(both.stderr).toContain("Pass --pause or --resume, not both");

        expect(calls).toHaveLength(0);
      }
    );
  });

  it("automations:list passes --status and --post-id through and prints one block per automation", async () => {
    const second = {
      ...AUTOMATION,
      id: "100000005",
      status: "paused",
      name: null,
      post: null,
      post_id: null,
      instagram_media_id: null,
      trigger: { kinds: ["dm", "story_reply"], scope: null, keywords: ["price"], match: "contains" },
      stats: { matched: 0, sent: 0, skipped: 0, failed: 0, last_event_at: null },
    };
    await withMockServer(
      () => ({ json: { data: [AUTOMATION, second] } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "automations:list",
          "--status",
          "active",
          "--post-id",
          "83778183",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("GET");
        expect(calls[0].path).toBe("/automations");
        expect(calls[0].query.get("status")).toBe("active");
        expect(calls[0].query.get("post_id")).toBe("83778183");
        expect(stdout).toContain("Automations (2)");
        expect(stdout).toContain("ID: 100000004  active  guide");
        expect(stdout).toContain("  Trigger: comment on this post; keywords: guide, link (whole word)");
        expect(stdout).toContain('  Post: post 83778183: "Comment GUIDE for the free checklist"  https://www.instagram.com/p/DABC123/  (live)');
        expect(stdout).toContain("  Stats: 12 sent / 15 matched / 3 skipped / 0 failed");
        expect(stdout).toContain("ID: 100000005  paused\n");
        expect(stdout).toContain("  Trigger: DM, story reply; keywords: price (anywhere in the text)");
        expect(stdout).toContain("  Stats: 0 sent / 0 matched / 0 skipped / 0 failed");
      }
    );
  });

  it("automations:list prints the empty line, rejects an unknown --status, and sends no query without flags", async () => {
    await withMockServer(
      () => ({ json: { data: [] } }),
      async (baseUrl, calls) => {
        const empty = await run(["automations:list", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(empty.exitCode).toBe(0);
        expect(empty.stdout).toContain("No automations found. Create one with automations:create.");
        expect([...calls[0].query.keys()]).toEqual([]);

        const bad = await run(["automations:list", "--status", "done", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(bad.exitCode).not.toBe(0);
        expect(bad.stderr).toContain("--status must be one of active|paused|completed");
        expect(calls).toHaveLength(1);
      }
    );
  });

  it("automations:get prints the detail, and --json the API response unchanged", async () => {
    await withMockServer(
      () => ({ json: { data: AUTOMATION } }),
      async (baseUrl, calls) => {
        const human = await run(["automations:get", "100000004", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(human.exitCode).toBe(0);
        expect(calls[0].path).toBe("/automations/100000004");
        expect(human.stdout).toContain("ID: 100000004\nStatus: active\nName: guide\n");
        expect(human.stdout).toContain("Stats: 12 sent / 15 matched / 3 skipped / 0 failed  (last event 2026-10-10T21:40:00.000Z)");
        expect(human.stdout).toContain("Created: 2026-10-10T21:33:34.341Z");

        const raw = await run(["automations:get", "100000004", "--json", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(raw.exitCode).toBe(0);
        expect(JSON.parse(raw.stdout)).toEqual({ data: AUTOMATION });
      }
    );
  });

  it("automations:delete sends DELETE and says so", async () => {
    await withMockServer(
      () => ({ status: 204, json: null }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run(["automations:delete", "100000004", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("DELETE");
        expect(calls[0].path).toBe("/automations/100000004");
        expect(stdout).toContain("Automation deleted.");

        const noId = await run(["automations:delete", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(noId.exitCode).not.toBe(0);
        expect(noId.stderr).toContain("Usage: omnisocials automations:delete <id>");
      }
    );
  });

  it("automations:events prints the counts line, one line per event and the next offset", async () => {
    const events = [
      {
        id: "1",
        automation_id: "100000004",
        kind: "comment",
        outcome: "sent",
        reason: null,
        reason_label: null,
        person: { id: "1784", username: "jane" },
        trigger_id: "1789",
        trigger_text: "guide please",
        message: "Here is the guide: https://example.com/guide",
        public_reply: "Sent you a DM!",
        platform_message_id: "m_1",
        created_at: "2026-10-10T21:40:00.000Z",
        sent_at: "2026-10-10T21:40:01.000Z",
      },
      {
        id: "2",
        automation_id: "100000004",
        kind: "story_reply",
        outcome: "skipped",
        reason: "already_sent",
        reason_label: "Already sent to this person",
        person: { id: "1785", username: null },
        trigger_id: "m_2",
        trigger_text: null,
        message: null,
        public_reply: null,
        platform_message_id: null,
        created_at: "2026-10-10T21:41:00.000Z",
        sent_at: null,
      },
    ];
    await withMockServer(
      () => ({
        json: {
          data: events,
          counts: { sent: 12, skipped: 3 },
          pagination: { total: 15, limit: 2, offset: 0, has_more: true },
        },
      }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "automations:events",
          "100000004",
          "--outcome",
          "sent",
          "--limit",
          "2",
          "--offset",
          "0",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].path).toBe("/automations/100000004/events");
        expect(calls[0].query.get("outcome")).toBe("sent");
        expect(calls[0].query.get("limit")).toBe("2");
        expect(calls[0].query.get("offset")).toBe("0");
        expect(stdout).toContain("Counts: 12 sent, 3 skipped");
        expect(stdout).toContain("Events (15, sent)");
        expect(stdout).toContain(
          '2026-10-10T21:40:00.000Z  comment  sent  @jane  "guide please"  DM: "Here is the guide: https://example.com/guide"'
        );
        expect(stdout).toContain("2026-10-10T21:41:00.000Z  story reply  skipped (Already sent to this person)  person 1785");
        expect(stdout).toContain("More: pass --offset 2 for the next page.");
      }
    );
  });

  it("automations:events says so when there is nothing yet and rejects an unknown --outcome", async () => {
    await withMockServer(
      () => ({ json: { data: [], counts: {}, pagination: { total: 0, limit: 25, offset: 0, has_more: false } } }),
      async (baseUrl, calls) => {
        const empty = await run(["automations:events", "100000004", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(empty.exitCode).toBe(0);
        expect(empty.stdout).toContain("Counts: none yet");
        expect(empty.stdout).toContain("No events yet.");

        const bad = await run(["automations:events", "100000004", "--outcome", "bounced", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(bad.exitCode).not.toBe(0);
        expect(bad.stderr).toContain("--outcome must be one of sent|skipped|failed|pending|queued|opted_out");
        expect(calls).toHaveLength(1);
      }
    );
  });

  it("a 403 insufficient_scope prints the error and where to turn the scopes on", async () => {
    await withMockServer(
      () => SCOPE_ERROR,
      async (baseUrl) => {
        const { stderr, stdout, exitCode } = await run(["automations:list", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Error [insufficient_scope]: This API key lacks the automations:read scope");
        expect(stderr).toContain("Enable Automations on the API key (Settings > API: adds automations:read and automations:write).");
        expect(stdout).toBe("");

        const raw = await run(["automations:list", "--json", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(raw.exitCode).not.toBe(0);
        expect(JSON.parse(raw.stdout)).toEqual(SCOPE_ERROR.json);
        expect(raw.stderr).toContain("Enable Automations on the API key");
      }
    );
  });

  it("a 409 automation_exists names the automation the post already has; other errors print code and message", async () => {
    let reply = {
      status: 409,
      json: { error: { code: "automation_exists", message: "This post already has an automation", automation_id: "100000004" } },
    };
    await withMockServer(
      () => reply,
      async (baseUrl) => {
        const exists = await run([
          "automations:create",
          "--post-id",
          "83778183",
          "--keywords",
          "guide",
          "--dm",
          "Here you go",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exists.exitCode).not.toBe(0);
        expect(exists.stderr).toContain("Error [automation_exists]: This post already has an automation");
        expect(exists.stderr).toContain("automations:update 100000004");

        reply = { status: 409, json: { error: { code: "instagram_not_connected", message: "Connect Instagram first" } } };
        const other = await run(["automations:get", "100000004", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(other.exitCode).not.toBe(0);
        expect(other.stderr).toContain("Error [instagram_not_connected]: Connect Instagram first");
        expect(other.stderr).not.toContain("Enable Automations");
      }
    );
  });

  it("posts:create builds comment_dm_automation from the --dm-* flags and prints the Comment-to-DM line", async () => {
    const bound = { ...AUTOMATION, id: "100000006", post: null };
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "scheduled", comment_dm_automation: bound } } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "posts:create",
          "--text",
          "Comment GUIDE for the free checklist",
          "--channels",
          "instagram",
          "--media-urls",
          "https://example.com/photo.jpg",
          "--dm-keywords",
          "guide, link",
          "--dm-message",
          "Here is the guide: https://example.com/guide",
          "--dm-reply",
          "Sent you a DM!,Check your inbox",
          "--dm-match",
          "contains",
          "--dm-max-sends",
          "500",
          "--dm-stop-at",
          "2026-12-31T00:00:00Z",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].path).toBe("/posts/create");
        expect(calls[0].body.comment_dm_automation).toEqual({
          trigger: { keywords: ["guide", "link"], match: "contains" },
          actions: {
            dm: { text: "Here is the guide: https://example.com/guide" },
            public_reply: { enabled: true, variations: ["Sent you a DM!", "Check your inbox"] },
          },
          limits: { max_sends: 500, stop_at: "2026-12-31T00:00:00Z" },
        });
        expect(stdout).toContain("Post created successfully!");
        expect(stdout).toContain("Comment-to-DM: on (keywords: guide, link; id 100000006)");
      }
    );
  });

  it("posts:create-and-publish sends the --dm-* flags too, and a post without them carries no comment_dm_automation", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "posting" } } }),
      async (baseUrl, calls) => {
        const withDm = await run([
          "posts:create-and-publish",
          "--text",
          "Comment GUIDE",
          "--channels",
          "instagram",
          "--dm-keywords",
          "guide",
          "--dm-message",
          "Here you go",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(withDm.exitCode).toBe(0);
        expect(calls[0].path).toBe("/posts/create-and-publish");
        expect(calls[0].body.comment_dm_automation).toEqual({
          trigger: { keywords: ["guide"], match: "word" },
          actions: { dm: { text: "Here you go" } },
        });
        expect(withDm.stdout).not.toContain("Comment-to-DM");

        const without = await run(["posts:create", "--text", "Plain post", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(without.exitCode).toBe(0);
        expect(calls[1].body).not.toHaveProperty("comment_dm_automation");
      }
    );
  });

  it("posts:update --no-dm sends comment_dm_automation: null and prints it as off", async () => {
    await withMockServer(
      () => ({ json: { data: { id: "p1", status: "scheduled", comment_dm_automation: null } } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run(["posts:update", "p1", "--no-dm", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(exitCode).toBe(0);
        expect(calls[0].method).toBe("PATCH");
        expect(calls[0].path).toBe("/posts/p1");
        expect(calls[0].body).toEqual({ comment_dm_automation: null });
        expect(stdout).toContain("Comment-to-DM: off");
      }
    );
  });

  it("posts:create refuses --dm-keywords without --dm-message and the reverse, and --no-dm next to a --dm-* flag, before calling the API", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "draft" } } }),
      async (baseUrl, calls) => {
        const base = ["posts:create", "--text", "Comment GUIDE", "--channels", "instagram", "--api-key", MOCK_KEY, "--base-url", baseUrl];

        const noMessage = await run([...base, "--dm-keywords", "guide"]);
        expect(noMessage.exitCode).not.toBe(0);
        expect(noMessage.stderr).toContain('pass --dm-message "<text>" next to --dm-keywords');

        const noKeywords = await run([...base, "--dm-message", "Here you go"]);
        expect(noKeywords.exitCode).not.toBe(0);
        expect(noKeywords.stderr).toContain('pass --dm-keywords "guide,link" next to --dm-message');

        const mixed = await run(["posts:update", "p1", "--no-dm", "--dm-keywords", "guide", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(mixed.exitCode).not.toBe(0);
        expect(mixed.stderr).toContain("--no-dm removes the post's comment-to-DM automation and cannot go with --dm-keywords");

        const badMatch = await run([...base, "--dm-keywords", "guide", "--dm-message", "x", "--dm-match", "exact"]);
        expect(badMatch.exitCode).not.toBe(0);
        expect(badMatch.stderr).toContain("--dm-match must be one of word|contains|any");

        expect(calls).toHaveLength(0);

        // --dm-match any answers every comment, so no keywords are needed.
        const any = await run([...base, "--dm-message", "Thanks!", "--dm-match", "any"]);
        expect(any.exitCode).toBe(0);
        expect(calls[0].body.comment_dm_automation).toEqual({
          trigger: { match: "any" },
          actions: { dm: { text: "Thanks!" } },
        });
      }
    );
  });

  it("posts:create with a comment-to-DM automation gets the scope hint on a 403", async () => {
    await withMockServer(
      () => SCOPE_ERROR,
      async (baseUrl) => {
        const { stderr, exitCode } = await run([
          "posts:create",
          "--text",
          "Comment GUIDE",
          "--channels",
          "instagram",
          "--dm-keywords",
          "guide",
          "--dm-message",
          "Here you go",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Error [insufficient_scope]");
        expect(stderr).toContain("Enable Automations on the API key");
      }
    );
  });

  it("automations:create --platform facebook sends platform and facebook_post_id and prints the Facebook post", async () => {
    const facebook = {
      ...AUTOMATION,
      id: "100000007",
      platform: "facebook",
      name: null,
      post_id: null,
      instagram_media_id: null,
      facebook_post_id: "104857600_123456789",
      post: {
        source: "facebook",
        id: "104857600_123456789",
        caption: "Comment GUIDE for the checklist",
        thumbnail_url: null,
        permalink: "https://www.facebook.com/104857600/posts/123456789",
        media_type: null,
      },
      trigger: { kinds: ["comment", "dm"], scope: "post", keywords: ["guide"], match: "word" },
    };
    await withMockServer(
      () => ({ status: 201, json: { data: facebook } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "automations:create",
          "--platform",
          "facebook",
          "--facebook-post-id",
          "104857600_123456789",
          "--triggers",
          "comment,dm",
          "--keywords",
          "guide",
          "--dm",
          "Here is the guide",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].body).toEqual({
          platform: "facebook",
          facebook_post_id: "104857600_123456789",
          trigger: { kinds: ["comment", "dm"], scope: "post", keywords: ["guide"], match: "word" },
          actions: { dm: { text: "Here is the guide" } },
        });
        expect(stdout).toContain("Platform: Facebook Page");
        expect(stdout).toContain('Post: Facebook post 104857600_123456789: "Comment GUIDE for the checklist"');
        expect(stdout).not.toContain("live on Instagram");
      }
    );
  });

  it("automations:create refuses story replies on Facebook, a wrong post flag for the platform, two post flags and an unknown --platform, before calling the API", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: AUTOMATION } }),
      async (baseUrl, calls) => {
        const base = ["automations:create", "--dm", "x", "--keywords", "guide", "--api-key", MOCK_KEY, "--base-url", baseUrl];

        const story = await run([...base, "--platform", "facebook", "--facebook-post-id", "1_2", "--triggers", "comment,story_reply"]);
        expect(story.exitCode).not.toBe(0);
        expect(story.stderr).toContain("Facebook has no story replies");

        // --facebook-post-id implies facebook, so the same check applies.
        const implied = await run([...base, "--facebook-post-id", "1_2", "--triggers", "story_reply"]);
        expect(implied.exitCode).not.toBe(0);
        expect(implied.stderr).toContain("Facebook has no story replies");

        const igOnFacebook = await run([...base, "--platform", "facebook", "--instagram-media-id", "18134683699582250"]);
        expect(igOnFacebook.exitCode).not.toBe(0);
        expect(igOnFacebook.stderr).toContain("for a Facebook Page post use --facebook-post-id");

        const fbOnInstagram = await run([...base, "--platform", "instagram", "--facebook-post-id", "1_2"]);
        expect(fbOnInstagram.exitCode).not.toBe(0);
        expect(fbOnInstagram.stderr).toContain("for an Instagram post use --instagram-media-id");

        const both = await run([...base, "--post-id", "1", "--facebook-post-id", "1_2"]);
        expect(both.exitCode).not.toBe(0);
        expect(both.stderr).toContain("Pass --post-id or --facebook-post-id, not both");

        const badPlatform = await run([...base, "--platform", "tiktok", "--post-id", "1"]);
        expect(badPlatform.exitCode).not.toBe(0);
        expect(badPlatform.stderr).toContain("--platform must be one of instagram|facebook|x");

        const noPost = await run([...base, "--platform", "facebook"]);
        expect(noPost.exitCode).not.toBe(0);
        expect(noPost.stderr).toContain("--facebook-post-id <id>");

        expect(calls).toHaveLength(0);
      }
    );
  });

  it("automations:list passes --platform and names the next Facebook post", async () => {
    const nextFacebook = {
      ...AUTOMATION,
      platform: "facebook",
      post: null,
      post_id: null,
      instagram_media_id: null,
      facebook_post_id: null,
      trigger: { kinds: ["comment"], scope: "next_post", keywords: ["guide"], match: "word" },
    };
    await withMockServer(
      () => ({ json: { data: [nextFacebook] } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run(["automations:list", "--platform", "facebook", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(exitCode).toBe(0);
        expect(calls[0].query.get("platform")).toBe("facebook");
        expect(stdout).toContain("  Platform: Facebook Page");
        expect(stdout).toContain("  Trigger: comment on the next Facebook post; keywords: guide (whole word)");

        const bad = await run(["automations:list", "--platform", "tiktok", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(bad.exitCode).not.toBe(0);
        expect(bad.stderr).toContain("--platform must be one of instagram|facebook|x");
        expect(calls).toHaveLength(1);
      }
    );
  });

  it("posts:create --dm-platforms sends comment_dm_automation.platforms and prints one id per channel", async () => {
    const bound = {
      ...AUTOMATION,
      id: "100000006",
      post: null,
      platforms: ["instagram", "facebook"],
      automations: [
        { id: "100000006", platform: "instagram", status: "active" },
        { id: "100000007", platform: "facebook", status: "active" },
      ],
    };
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1", status: "scheduled", comment_dm_automation: bound } } }),
      async (baseUrl, calls) => {
        const base = [
          "posts:create",
          "--text",
          "Comment GUIDE",
          "--channels",
          "instagram,facebook",
          "--dm-keywords",
          "guide",
          "--dm-message",
          "Here you go",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ];
        const { stdout, exitCode } = await run([...base, "--dm-platforms", "instagram,facebook"]);
        expect(exitCode).toBe(0);
        expect(calls[0].body.comment_dm_automation).toEqual({
          trigger: { keywords: ["guide"], match: "word" },
          actions: { dm: { text: "Here you go" } },
          platforms: ["instagram", "facebook"],
        });
        expect(stdout).toContain("Comment-to-DM: on (keywords: guide, link; Instagram id 100000006, Facebook id 100000007)");

        const bad = await run([...base, "--dm-platforms", "instagram,threads"]);
        expect(bad.exitCode).not.toBe(0);
        expect(bad.stderr).toContain('--dm-platforms: "threads" is not one of instagram|facebook');

        const mixed = await run(["posts:update", "p1", "--no-dm", "--dm-platforms", "facebook", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(mixed.exitCode).not.toBe(0);
        expect(mixed.stderr).toContain("cannot go with --dm-platforms");
        expect(calls).toHaveLength(1);
      }
    );
  });

  // An X automation: a keyword in a DM to the X account, nothing else.
  const X_AUTOMATION = {
    ...AUTOMATION,
    id: "100000009",
    platform: "x",
    status: "paused",
    name: null,
    post_id: null,
    instagram_media_id: null,
    facebook_post_id: null,
    post: null,
    trigger: { kinds: ["dm"], scope: null, keywords: ["guide"], match: "word" },
    actions: { dm: { text: "Here is the guide" }, public_reply: { enabled: false, variations: [] } },
    limits: { max_sends: null, stop_at: null },
    stats: { matched: 0, sent: 0, skipped: 0, failed: 0, last_event_at: null },
  };

  it("automations:create --platform x sends the dm trigger by default and prints Platform: X", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: X_AUTOMATION } }),
      async (baseUrl, calls) => {
        const { stdout, exitCode } = await run([
          "automations:create",
          "--platform",
          "x",
          "--keywords",
          "guide",
          "--dm",
          "Here is the guide",
          "--paused",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(exitCode).toBe(0);
        expect(calls[0].body).toEqual({
          platform: "x",
          trigger: { kinds: ["dm"], keywords: ["guide"], match: "word" },
          actions: { dm: { text: "Here is the guide" } },
          status: "paused",
        });
        expect(stdout).toContain("Platform: X");
        expect(stdout).toContain("Trigger: DM; keywords: guide (whole word)");
        expect(stdout).toContain("Turn it on with: automations:update 100000009 --resume (X DMs must be on for the workspace)");
        expect(stdout).not.toContain("Post:");
      }
    );
  });

  it("automations:create refuses a comment or story trigger, post flags, --scope and --reply on X, before calling the API", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: X_AUTOMATION } }),
      async (baseUrl, calls) => {
        const base = ["automations:create", "--platform", "x", "--dm", "x", "--keywords", "guide", "--api-key", MOCK_KEY, "--base-url", baseUrl];

        const comment = await run([...base, "--triggers", "dm,comment"]);
        expect(comment.exitCode).not.toBe(0);
        expect(comment.stderr).toContain("X automations answer DMs only: use --triggers dm with --platform x");

        const story = await run([...base, "--triggers", "story_reply"]);
        expect(story.exitCode).not.toBe(0);
        expect(story.stderr).toContain("X automations answer DMs only");

        const post = await run([...base, "--post-id", "83778183"]);
        expect(post.exitCode).not.toBe(0);
        expect(post.stderr).toContain("--platform x answers DMs only, with no post and no public reply: drop --post-id.");

        const more = await run([...base, "--scope", "any", "--reply", "Sent you a DM!", "--instagram-media-id", "1"]);
        expect(more.exitCode).not.toBe(0);
        expect(more.stderr).toContain("drop --instagram-media-id, --scope, --reply.");

        expect(calls).toHaveLength(0);
      }
    );
  });

  it("a 409 x_dms_off says where X DMs are turned on; --json prints the API answer", async () => {
    const dmsOff = {
      status: 409,
      json: { error: { code: "x_dms_off", message: "Turn on X DMs first: the automation answers the DMs that X sends to OmniSocials." } },
    };
    await withMockServer(
      () => dmsOff,
      async (baseUrl, calls) => {
        const args = ["automations:create", "--platform", "x", "--keywords", "guide", "--dm", "Hi", "--api-key", MOCK_KEY, "--base-url", baseUrl];
        const human = await run(args);
        expect(human.exitCode).not.toBe(0);
        expect(human.stderr).toContain("Error [x_dms_off]: Turn on X DMs first");
        expect(human.stderr).toContain("Social Inbox, X DMs card, or the automation editor");
        expect(human.stderr).toContain("--paused");

        const resume = await run(["automations:update", "100000009", "--resume", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(resume.exitCode).not.toBe(0);
        expect(calls[1].body).toEqual({ status: "active" });
        expect(resume.stderr).toContain("Error [x_dms_off]");

        const raw = await run([...args, "--json"]);
        expect(raw.exitCode).not.toBe(0);
        expect(raw.stdout + raw.stderr).toContain('"x_dms_off"');
        expect(raw.stderr).not.toContain("Social Inbox, X DMs card");
      }
    );
  });

  it("automations:list --platform x and automations:events print queued and opted_out rows", async () => {
    const events = [
      {
        id: "11",
        automation_id: "100000009",
        kind: "dm",
        outcome: "queued",
        reason: "rate_limited",
        reason_label: "Waiting for room under the send limit. It goes out within the hour",
        person: { id: "44", username: "jane" },
        trigger_id: "dm_1",
        trigger_text: null,
        message: null,
        public_reply: null,
        platform_message_id: null,
        created_at: "2026-10-25T10:00:00.000Z",
        sent_at: null,
      },
      {
        id: "12",
        automation_id: "100000009",
        kind: "dm",
        outcome: "opted_out",
        reason: null,
        reason_label: null,
        person: { id: "45", username: "bob" },
        trigger_id: "dm_2",
        trigger_text: null,
        message: null,
        public_reply: null,
        platform_message_id: null,
        created_at: "2026-10-25T10:01:00.000Z",
        sent_at: null,
      },
      {
        id: "13",
        automation_id: "100000009",
        kind: "dm",
        outcome: "skipped",
        reason: "no_credits",
        reason_label: "Credits ran out before the answer. Top up, then answer in the Social Inbox",
        person: { id: "46", username: "amy" },
        trigger_id: "dm_3",
        trigger_text: null,
        message: null,
        public_reply: null,
        platform_message_id: null,
        created_at: "2026-10-25T10:02:00.000Z",
        sent_at: null,
      },
    ];
    await withMockServer(
      (req) =>
        req.url.includes("/events")
          ? { json: { data: events, counts: { queued: 1, opted_out: 1, skipped: 1 }, pagination: { total: 3, limit: 25, offset: 0, has_more: false } } }
          : { json: { data: [{ ...X_AUTOMATION, status: "active" }] } },
      async (baseUrl, calls) => {
        const list = await run(["automations:list", "--platform", "x", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(list.exitCode).toBe(0);
        expect(calls[0].query.get("platform")).toBe("x");
        expect(list.stdout).toContain("  Platform: X");
        expect(list.stdout).toContain("  Trigger: DM; keywords: guide (whole word)");

        const { stdout, exitCode } = await run(["automations:events", "100000009", "--outcome", "queued", "--api-key", MOCK_KEY, "--base-url", baseUrl]);
        expect(exitCode).toBe(0);
        expect(calls[1].query.get("outcome")).toBe("queued");
        expect(stdout).toContain("Counts: 1 queued, 1 opted_out, 1 skipped");
        // The API's reason_label wins; a row without one gets the CLI's note.
        expect(stdout).toContain("2026-10-25T10:00:00.000Z  DM  queued (Waiting for room under the send limit. It goes out within the hour)  @jane");
        expect(stdout).toContain("2026-10-25T10:01:00.000Z  DM  opted_out (replied STOP: no automatic DMs from this account again)  @bob");
        expect(stdout).toContain("skipped (Credits ran out before the answer. Top up, then answer in the Social Inbox)  @amy");
      }
    );
  });

  it("--dm-platforms refuses x: the automation of a post answers comments", async () => {
    await withMockServer(
      () => ({ status: 201, json: { data: { id: "p1" } } }),
      async (baseUrl, calls) => {
        const bad = await run([
          "posts:create",
          "--text",
          "Comment GUIDE",
          "--channels",
          "x",
          "--dm-keywords",
          "guide",
          "--dm-message",
          "Here you go",
          "--dm-platforms",
          "x",
          "--api-key",
          MOCK_KEY,
          "--base-url",
          baseUrl,
        ]);
        expect(bad.exitCode).not.toBe(0);
        expect(bad.stderr).toContain('--dm-platforms: "x" is not one of instagram|facebook');
        expect(calls).toHaveLength(0);
      }
    );
  });
});

describe("config:show with env var", () => {
  it("reads API key from env", async () => {
    const testKey = ["omsk", "test", "fakekeyfortesting"].join("_");
    const { stdout, exitCode } = await run(["config:show"], {
      env: { OMNISOCIALS_API_KEY: testKey },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("omsk_test_fake");
    expect(stdout).toContain("env var");
  });
});
