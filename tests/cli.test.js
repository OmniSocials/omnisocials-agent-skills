import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const exec = promisify(execFile);
const CLI = path.resolve(__dirname, "../scripts/omnisocials.js");

function run(args) {
  return exec("node", [CLI, ...args], { timeout: 10000 }).then(
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

describe("config:show with env var", () => {
  it("reads API key from env", async () => {
    const testKey = ["omsk", "test", "fakekeyfortesting"].join("_");
    const { stdout, exitCode } = await exec("node", [CLI, "config:show"], {
      env: { ...process.env, OMNISOCIALS_API_KEY: testKey },
    });
    expect(exitCode ?? 0).toBe(0);
    expect(stdout).toContain("omsk_test_fake");
    expect(stdout).toContain("env var");
  });
});
