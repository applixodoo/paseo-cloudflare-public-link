import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const ENTRY = /^(\*|[^\s@,*]+)@[^\s@,*]+\.[^\s@,*]+$/;

/** Splits comma-separated emails and `*@domain` rules; throws on anything cloudflared would not accept. */
export function parseAccess(text: string): string[] {
  const entries = text.split(",").map(entry => entry.trim().toLowerCase()).filter(Boolean);
  const invalid = entries.filter(entry => !ENTRY.test(entry));
  if (invalid.length) throw new Error(`Not an email address or *@domain rule: ${invalid.join(", ")}`);
  return [...new Set(entries)];
}

export const accessSettings = defineSettings({
  id: "access",
  scope: "host",
  version: 1,
  schema: z.object({
    alwaysAllowed: z.array(z.string()).default([]),
    workspaces: z.record(z.string(), z.array(z.string())).default({}),
    // Workspaces whose links skip the email PIN (public).
    publicWorkspaces: z.array(z.string()).default([]),
  }),
});

const link = z.object({ workspaceId: z.string(), scriptName: z.string(), url: z.string(), protected: z.boolean() });
export const listLinks = defineRpc({ name: "links.list", input: z.object({}),
  output: z.object({ links: z.array(link), alwaysAllowed: z.array(z.string()), workspaces: z.record(z.string(), z.array(z.string())),
    publicWorkspaces: z.array(z.string()) }) });
export const startLink = defineRpc({ name: "links.start", input: z.object({ workspaceId: z.string(), scriptName: z.string() }),
  output: z.object({ url: z.string() }) });
export const stopLink = defineRpc({ name: "links.stop", input: z.object({ workspaceId: z.string() }), output: z.object({}) });
