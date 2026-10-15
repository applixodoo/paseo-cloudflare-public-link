import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { createTunnels } from "./server/tunnels";
import { accessSettings, listLinks, parseAccess, startLink, stopLink } from "./shared/contracts";

type Paseo = PluginHandlerContext["paseo"];
type Values = { alwaysAllowed: string[]; workspaces: Record<string, string[]>; publicWorkspaces: string[] };

// Settings are a file on disk, so entries are validated again before they reach cloudflared. `null` = public, no PIN.
const allowed = (values: Values, workspaceId: string) => values.publicWorkspaces.includes(workspaceId) ? null
  : parseAccess([...values.alwaysAllowed, ...(values.workspaces[workspaceId] ?? [])].join(","));

export default function contribute(server: PluginServerContext, tunnels = createTunnels()) {
  const settings = server.registerSettings(accessSettings);
  let events: ReturnType<Paseo["observeEvents"]> | undefined;
  async function values(): Promise<Values> {
    const state = await settings.read();
    if (state.status !== "ready") throw new Error(`Cloudflare Public Link settings are invalid: ${state.error}`);
    return state.values;
  }
  // The daemon connection only arrives with a request; links exist only after one, so watching from then on is enough.
  function watch(paseo: Paseo) {
    if (events) return;
    events = paseo.observeEvents(["script_status_update"]);
    events.subscribe({
      snapshot() {},
      update(message) {
        if (message.type === "script_status_update") void tunnels.services(message.payload.workspaceId, message.payload.scripts);
      },
      error(error) { console.error("Cloudflare Public Link: service observation failed", error); },
    });
    events.ready.catch(() => {});
  }
  server.handle(listLinks, async (_, { paseo }) => {
    watch(paseo);
    const current = await values();
    // Also reconcile on every poll, so revoked access closes the old link even if a settings event is missed.
    await reconcile(current);
    return { links: tunnels.list(), ...current };
  });
  server.handle(startLink, async ({ workspaceId, scriptName }, { paseo }) => {
    watch(paseo);
    // Resolve the port from Paseo rather than trusting the client.
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    const script = workspace?.scripts.find(item => item.scriptName === scriptName && item.type === "service" && item.lifecycle === "running");
    if (!script?.port) throw new Error(`${scriptName} is not running`);
    return { url: await tunnels.start(workspaceId, scriptName, script.port, allowed(await values(), workspaceId)) };
  });
  server.handle(stopLink, async ({ workspaceId }) => {
    await tunnels.stop(workspaceId);
    return {};
  });
  // Invalid entries yield an empty list, which closes the link instead of keeping stale access.
  const reconcile = (current: Values) => tunnels.access(workspaceId => {
    try { return allowed(current, workspaceId); } catch { return []; }
  });
  const unsubscribe = settings.subscribe(async state => {
    if (state.status === "ready") await reconcile(state.values);
  });
  return async () => {
    unsubscribe();
    await tunnels.close();
    await events?.release();
  };
}
