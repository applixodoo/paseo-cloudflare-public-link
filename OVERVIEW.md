Cloudflare Public Link shares a running workspace service through a temporary public `trycloudflare.com` address, so a customer, a colleague, or your own phone can open it from anywhere. By default every visitor has to confirm an allowed email address with a one-time PIN before the service is reached.

## How it works

While at least one service of a workspace is running, the workspace header shows a globe button. Choose **Create public link** to start a Cloudflare Quick Tunnel to that service's port. The button then shows the link's hostname and offers Copy, Open, and Stop. When several services run, the menu asks which one to share. The link closes when you stop it, when the service stops, or when the plugin stops. Each new link gets a new address.

Cloudflare's email PIN protects links by default. A visitor enters their email address, receives a code, and only allowed addresses get through. A protected link is never created without at least one allowed address.

## Setup

Install `cloudflared` 2026.10.0 or newer on the daemon machine, for example with Homebrew on macOS. Older versions lack the email PIN or the access-rule path fix in 2026.10.0, so the plugin refuses them. The plugin looks for `cloudflared` on the daemon's PATH and in the Homebrew locations, and never downloads anything itself. No Cloudflare account is needed.

Open Settings, Plugins, Cloudflare Public Link, Access, and set **Always allowed** to the addresses or `*@domain` rules that may open every link, such as your team's domain.

## Access per workspace

**Access, Edit** in the button menu adds extra addresses or domains for one workspace, separated by commas, such as a customer's `*@customer.com`. They are remembered for that workspace. Saving changed access while a link is active replaces it with a new link right away, so removed people lose access immediately.

The same popover has a **Require email PIN** checkbox, on by default. Turning it off makes that workspace's links public: anyone who has the link reaches the service without a PIN, and the button label says so. Only do this for services that protect themselves.

## Limits

Traffic passes through Cloudflare. Quick Tunnels have no uptime guarantee, allow 200 concurrent requests, and do not support server-sent events; WebSockets work. The PIN page needs a browser, so webhooks and other non-interactive clients cannot pass it. Links belong to the plugin, so stopping or reloading the plugin closes them.

With cloudflared 2026.10, Cloudflare ends PIN sessions a few seconds after login, so protected pages stop loading and ask for a new PIN ([cloudflare/cloudflared#1752](https://github.com/cloudflare/cloudflared/issues/1752)). Until Cloudflare fixes this, protected links are only usable for very short visits.
