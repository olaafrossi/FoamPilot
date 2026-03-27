import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for DockerManager.
 * These tests require a running Docker daemon and are skipped by default.
 * Run with: INTEGRATION=true npm test
 */

// Skip all tests unless INTEGRATION env var is set
const SKIP = !process.env.INTEGRATION;

// We can't easily import DockerManager here since it depends on electron
// and we don't mock electron in integration tests. Instead, test the
// underlying Docker commands directly via child_process.
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

describe.skipIf(SKIP)("DockerManager Integration", () => {
  beforeAll(async () => {
    // Verify Docker is available
    try {
      await exec("docker", ["info", "--format", "{{.ServerVersion}}"]);
    } catch {
      throw new Error("Docker daemon is not running. Start Docker Desktop first.");
    }
  });

  it("should pull a tiny test image successfully", async () => {
    const { stdout } = await exec("docker", ["pull", "alpine:3.19"], { timeout: 60000 });
    expect(stdout || "").toBeDefined();
  }, 60000);

  it("should start a container, verify it's running, then stop it", async () => {
    // Start
    const { stdout: containerId } = await exec("docker", [
      "run", "-d", "--name", "fp-integration-test", "alpine:3.19", "sleep", "30",
    ]);
    expect(containerId.trim()).toBeTruthy();

    // Verify running
    const { stdout: inspectOut } = await exec("docker", [
      "inspect", "--format", "{{.State.Running}}", "fp-integration-test",
    ]);
    expect(inspectOut.trim()).toBe("true");

    // Stop and remove
    await exec("docker", ["rm", "-f", "fp-integration-test"]);

    // Verify gone
    try {
      await exec("docker", ["inspect", "fp-integration-test"]);
      throw new Error("Container should have been removed");
    } catch (err: any) {
      expect(err.message || err.stderr).toContain("No such");
    }
  }, 30000);

  it("should detect port in use", async () => {
    // Start a container on port 58999
    await exec("docker", [
      "run", "-d", "--name", "fp-port-test", "-p", "58999:80", "alpine:3.19", "sleep", "30",
    ]);

    // Try to bind to the same port
    const net = await import("net");
    const portFree = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(58999, "127.0.0.1");
    });

    expect(portFree).toBe(false);

    // Cleanup
    await exec("docker", ["rm", "-f", "fp-port-test"]);
  }, 30000);
});
