import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

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
