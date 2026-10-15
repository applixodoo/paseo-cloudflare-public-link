import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { execCommand, spawnProcess, terminateProcess } from "@getpaseo/plugin/server";

// --allowed-mail shipped in 2026.9.2; 2026.10.0 fixed path normalization in its access rules (VULN-141859).
const MINIMUM = [2026, 10, 0];
// Paseo launched from Finder may not have Homebrew on PATH.
const CANDIDATES = ["cloudflared", "/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"];
// Quick tunnel names are hyphenated words, which keeps api./login.trycloudflare.com out.
const LINK = /https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/;

export async function findCloudflared(candidates = CANDIDATES): Promise<string> {
  let old: string | undefined;
  for (const candidate of candidates) {
    try {
      const { stdout, stderr } = await execCommand(candidate, ["--version"], { timeout: 10_000 });
      const version = /(\d+)\.(\d+)\.(\d+)/.exec(stdout + stderr);
      if (!version) continue;
      const [year, month, patch] = version.slice(1).map(Number);
      if ((year - MINIMUM[0] || month - MINIMUM[1] || patch - MINIMUM[2]) >= 0) return candidate;
      old = version[0];
    } catch { /* not installed at this location */ }
  }
  throw new Error(old ? `cloudflared ${old} is too old; email-protected links need 2026.10.0 or newer`
    : "cloudflared was not found; install version 2026.10.0 or newer");
}

/** `null` emails means a public link without the email PIN. */
type Access = string[] | null;
type Tunnel = { scriptName: string; port: number; emails: Access; url: string; child: ChildProcessWithoutNullStreams };
type Service = { scriptName: string; type?: string; lifecycle: string; port: number | null };

export function createTunnels(find = () => findCloudflared(),
  spawn = (binary: string, args: string[]) => spawnProcess(binary, args, { stdio: "pipe" })) {
  const tunnels = new Map<string, Tunnel>();
  const queues = new Map<string, Promise<unknown>>();
  // One operation per workspace at a time, so a double click or an access change never leaves an orphaned cloudflared.
  function serial<T>(workspaceId: string, task: () => Promise<T>): Promise<T> {
    const next = (queues.get(workspaceId) ?? Promise.resolve()).then(task, task);
    queues.set(workspaceId, next.catch(() => {}));
    return next;
  }
  async function halt(workspaceId: string) {
    const tunnel = tunnels.get(workspaceId);
    tunnels.delete(workspaceId);
    if (!tunnel) return;
    // terminateProcess only signals on Unix; wait so a stopped link is really gone before we report or replace it.
    const exited = tunnel.child.exitCode === null && tunnel.child.signalCode === null ? once(tunnel.child, "exit") : undefined;
    await terminateProcess(tunnel.child);
    await exited;
  }
  async function open(workspaceId: string, scriptName: string, port: number, emails: Access) {
    if (emails && !emails.length) throw new Error("Add at least one allowed email or *@domain before creating a public link");
    await halt(workspaceId);
    const child = spawn(await find(), ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`,
      ...(emails ? ["--allowed-mail", emails.join(",")] : [])]);
    const url = await new Promise<string>((resolve, reject) => {
      let output = "";
      let settled = false;
      const timer = setTimeout(() => fail(new Error("cloudflared did not report a link within 30 seconds")), 30_000);
      function fail(error: Error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void terminateProcess(child);
        reject(error);
      }
      // Keep draining both pipes for the tunnel's lifetime; a full pipe would stall cloudflared.
      function read(chunk: Buffer) {
        if (settled) return;
        output += chunk;
        const match = LINK.exec(output);
        if (!match) return;
        settled = true;
        clearTimeout(timer);
        resolve(match[0]);
      }
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.once("error", fail);
      child.once("exit", () => fail(new Error(`cloudflared stopped: ${output.trim().split("\n").slice(-2).join(" ")}`)));
    });
    const tunnel = { scriptName, port, emails, url, child };
    tunnels.set(workspaceId, tunnel);
    child.once("exit", () => { if (tunnels.get(workspaceId) === tunnel) tunnels.delete(workspaceId); });
    return url;
  }
  return {
    list: () => [...tunnels].map(([workspaceId, { scriptName, url, emails }]) => ({ workspaceId, scriptName, url, protected: emails !== null })),
    start: (workspaceId: string, scriptName: string, port: number, emails: Access) =>
      serial(workspaceId, () => open(workspaceId, scriptName, port, emails)),
    stop: (workspaceId: string) => serial(workspaceId, () => halt(workspaceId)),
    /** Closes a link whose service stopped or moved to another port. */
    services: (workspaceId: string, scripts: readonly Service[]) => serial(workspaceId, async () => {
      const tunnel = tunnels.get(workspaceId);
      if (tunnel && !scripts.some(script => script.scriptName === tunnel.scriptName && script.lifecycle === "running" && script.port === tunnel.port))
        await halt(workspaceId);
    }),
    /** Restarts links whose access changed; the new link replaces the old one immediately. */
    access: (allowed: (workspaceId: string) => Access) => Promise.all([...tunnels.keys()].map(workspaceId => serial(workspaceId, async () => {
      const tunnel = tunnels.get(workspaceId);
      const emails = allowed(workspaceId);
      if (!tunnel || JSON.stringify(emails) === JSON.stringify(tunnel.emails)) return;
      try { await open(workspaceId, tunnel.scriptName, tunnel.port, emails); }
      catch (error) { console.error(`Could not restart the public link for workspace ${workspaceId}`, error); await halt(workspaceId); }
    }))),
    close: () => Promise.all([...tunnels.keys()].map(halt)),
  };
}
