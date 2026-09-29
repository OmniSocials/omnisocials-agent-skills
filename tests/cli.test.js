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
