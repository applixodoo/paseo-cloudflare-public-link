import { openExternalUrl, type PluginButton, type PluginButtonMenuEntry, type PluginButtonRegistration,
  type PluginClientContext } from "@getpaseo/plugin/client";
import type { RpcOutput } from "@getpaseo/plugin";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { AlwaysAllowed, WorkspaceAccess } from "./client/access";
import { listLinks, startLink, stopLink } from "./shared/contracts";

type Script = { scriptName: string; type?: string; lifecycle: string; port: number | null };
type Workspace = { id: string; scripts?: readonly Script[]; archivingAt?: string | null };
type Header = { button: PluginButtonRegistration; scripts: readonly Script[]; services: string[]; shown?: string };

const action = (onPress: () => unknown) => ({ kind: "action", onPress: async () => { await onPress(); } }) as const;

export default function contribute(client: PluginClientContext) {
  const headers = new Map<string, Header>();
  let state: RpcOutput<typeof listLinks> | undefined;
  let stopped = false;

  function menu(workspaceId: string, services: string[]): Partial<PluginButton> {
    const link = state?.links.find(item => item.workspaceId === workspaceId);
    const pin = !state?.publicWorkspaces.includes(workspaceId);
    const access = [...new Set([...(state?.alwaysAllowed ?? []), ...(state?.workspaces[workspaceId] ?? [])])];
    const items: PluginButtonMenuEntry[] = link ? [
      { kind: "item", id: "copy", title: "Copy public link", icon: "Copy", behavior: action(() => copyText(link.url)) },
      { kind: "item", id: "open", title: "Open public link", icon: "ExternalLink", behavior: action(() => openExternalUrl(link.url)) },
      { kind: "item", id: "stop", title: `Stop public link (${link.scriptName})`, icon: "CircleStop",
        behavior: action(async () => { await client.rpc(stopLink, { workspaceId }); await poll(); }) },
    ] : services.map(scriptName => ({ kind: "item", id: `start-${scriptName}`, icon: "Globe",
      title: services.length > 1 ? `Create public link for ${scriptName}` : "Create public link",
      behavior: action(async () => { await client.rpc(startLink, { workspaceId, scriptName }); await poll(); }) }));
    items.push({ kind: "separator", id: "access-separator" }, { kind: "item", id: "access", icon: pin ? "Lock" : "LockOpen",
      title: pin ? `Access: ${access.join(", ") || "nobody yet"} — Edit…` : "Access: public, no PIN — Edit…",
      behavior: { kind: "popover", Content: WorkspaceAccess } });
    return { visible: services.length > 0,
      label: link ? new URL(link.url).hostname + (link.protected ? "" : " (no PIN)") : undefined,
      behavior: { kind: "menu", items } };
  }
  function render(workspaceId: string) {
    const header = headers.get(workspaceId);
    if (!header) return;
    const view = menu(workspaceId, header.services);
    // Menu callbacks are recreated on each render, so compare the visible state instead.
    const key = JSON.stringify([header.services, view.label, view.behavior?.kind === "menu" && view.behavior.items.map(item => item.kind === "item" && item.title)]);
    if (header.shown === key) return;
    header.shown = key;
    header.button.update(view);
  }
  function track(workspace: Workspace) {
    if (workspace.archivingAt) return forget(workspace.id);
    // A rename or title update may carry no scripts; keep the live service list then.
    services(workspace.id, workspace.scripts ?? headers.get(workspace.id)?.scripts ?? []);
  }
  function services(workspaceId: string, scripts: readonly Script[]) {
    let header = headers.get(workspaceId);
    if (!header) {
      header = { scripts: [], services: [], button: client.addHeaderButton({ id: "public-link", workspaceId,
        button: { title: "Public link", icon: "Globe", visible: false, behavior: { kind: "menu", items: [] } } }) };
      headers.set(workspaceId, header);
    }
    header.scripts = scripts;
    header.services = scripts.filter(script => script.type === "service" && script.lifecycle === "running" && script.port !== null)
      .map(script => script.scriptName);
    render(workspaceId);
  }
  function forget(workspaceId: string) {
    headers.get(workspaceId)?.button.remove();
    headers.delete(workspaceId);
  }
  async function poll() {
    try {
      state = await client.rpc(listLinks, {});
      for (const workspaceId of headers.keys()) render(workspaceId);
    } catch (error) { if (!stopped) console.error("Cloudflare Public Link: listing links failed", error); }
  }

  client.addSettingsScreen({ id: "access", title: "Access", icon: "Lock", Component: AlwaysAllowed });
  // Links can drop on their own (cloudflared exits, the service stops), and plugins get no push from their server.
  const timer = setInterval(poll, 5000);
  void poll();
  const directory = client.paseo.workspaces.list({ page: { limit: 200 }, subscribe: {} });
  void directory.then(({ subscription }) => subscription.subscribe({
    snapshot({ entries }) {
      const live = new Set(entries.map(entry => entry.id));
      for (const id of [...headers.keys()]) if (!live.has(id)) forget(id);
      for (const entry of entries) track(entry);
    },
    update(message) {
      if (message.type !== "workspace_update") return;
      if (message.payload.kind === "upsert") track(message.payload.workspace);
      else forget(message.payload.id);
    },
  })).catch((error: unknown) => { if (!stopped) console.error("Cloudflare Public Link: workspace observation failed", error); });
  const events = client.paseo.observeEvents(["script_status_update"]);
  events.subscribe({
    snapshot() {},
    update(message) {
      if (message.type === "script_status_update") services(message.payload.workspaceId, message.payload.scripts);
    },
    error(error) { if (!stopped) console.error("Cloudflare Public Link: service observation failed", error); },
  });
  events.ready.catch(() => {});
  return async () => {
    stopped = true;
    clearInterval(timer);
    for (const id of [...headers.keys()]) forget(id);
    await events.release();
    await directory.then(({ subscription }) => subscription.release(), () => {});
  };
}
