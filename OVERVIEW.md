Cloudflare Public Link turns a service running in a Paseo workspace, such as a dev server, a preview build, or an app under test, into a temporary public HTTPS link on `trycloudflare.com`. Send the link to a customer or a colleague, or open it on your phone, without a Cloudflare account, port forwarding, or DNS setup. By default, visitors first confirm an allowed email address with a one-time PIN.

## How it works

While a service in the workspace is running, a globe button appears in the workspace header.

- **Create public link** starts a Cloudflare Quick Tunnel to that service's local port. The button then shows the link's hostname.
- **Copy public link** and **Open public link** share or check the link.
- **Stop public link** closes it while the service keeps running.
- When several services run, the menu asks which one to share.

A link closes when you stop it, when the service stops, or when the plugin stops. Every new link gets a new random address.

## Access control

Links are protected by Cloudflare's email one-time PIN unless you turn it off for a workspace. A visitor enters their email address and receives a code by email. Only allowed addresses get through, and the visitor needs no Cloudflare account.

- **Always allowed**, under Settings, Plugins, Cloudflare Public Link, Access, lists the emails or `*@domain` rules that may open every link, such as your team's domain.
- **Access, Edit** in the button menu adds extra emails or domains for one workspace, separated by commas, for example a customer's `*@customer.com`. They are remembered per workspace.
- **Require email PIN** in the same popover is on by default. Turning it off makes that workspace's links public, so anyone with the link reaches the service. The button label then shows "no PIN". Only do this for services that protect themselves.

Saving changed access while a link is active replaces it with a new link right away, so removed people lose access immediately. A protected link is never created without at least one allowed address.

## Setup

Install `cloudflared` 2026.10.0 or newer on the daemon machine, for example with Homebrew on macOS. Older versions lack the email PIN or its access-rule fix, so the plugin refuses them. The plugin looks for `cloudflared` on the daemon's PATH and in the Homebrew locations, and never downloads software itself. Requires Paseo 0.11.2 or newer.

## Limits

Traffic passes through Cloudflare. Quick Tunnels have no uptime guarantee, allow 200 concurrent requests, and do not support server-sent events. WebSockets work. The PIN page needs a browser, so webhooks and other non-interactive clients cannot pass it. Links belong to the plugin, so stopping or reloading the plugin closes them.

With cloudflared 2026.10, Cloudflare ends PIN sessions a few seconds after login, so protected pages stop loading and ask for a new PIN ([cloudflare/cloudflared#1752](https://github.com/cloudflare/cloudflared/issues/1752)). Until Cloudflare fixes this, protected links only suit very short visits, and public links are the practical choice for services that have their own login.
