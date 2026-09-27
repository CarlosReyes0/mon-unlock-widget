# Open Paywall — OpenClaw Embed Generator

Publish paid articles from your phone via chat.

**Not sure which setup to use?** Read **[OPTIONS.md](./OPTIONS.md)** first — it explains the three paths and tradeoffs.

---

## Quick summary

| Option | Setup | On-chain registration |
|--------|-------|----------------------|
| **A — Full automation** | `privateKey` in config | Agent does it (costs gas) |
| **B — Recommended** | `publisher` address only | You do it once via [generator + wallet](https://openpaywall.app/generator.html) |
| **C — No agent** | None | [Web generator](https://openpaywall.app/generator.html) only |

Most people should start with **Option B**.

---

## Install (Options A or B)

### 1. OpenClaw

```bash
npm install -g openclaw@
openclaw onboard --install-daemon
```

### 2. This plugin

```bash
git clone https://github.com/CarlosReyes0/mon-unlock-widget.git
cd mon-unlock-widget/skills/mon-unlock-embed
npm install
openclaw plugins install .
```

### 3. Pick your config

**Option B (recommended):**
```json
{
  "plugins": {
    "mon-unlock-embed": {
      "publisher": "0xYourWalletAddress"
    }
  }
}
```

**Option A (full automation):**
```json
{
  "plugins": {
    "mon-unlock-embed": {
      "privateKey": "0xYourPrivateKey"
    }
  }
}
```

### 4. Agent instructions

Copy `AGENT.md` into your OpenClaw workspace.

### 5. Connect chat

```bash
openclaw channels login telegram
openclaw gateway restart
```

---

## What happens when you publish (Option B)

```
You: New article — title July 3 11pm, slug july-3-11pm,
     teaser "rain walk", body: The streets were empty...

Agent:
✓ Embed generated
✓ Body + teaser saved to Supabase

⚠ One step left — open this link:
https://openpaywall.app/register.html?slug=july-3-11pm&price=1

Connect MetaMask → Register on Monad → done.
(No need to re-enter title, teaser, or body.)

Paste this embed into your site:
[HTML]
```

---

## Can anyone use this when you push to GitHub?

OpenClaw still needs a local install. For agents that should discover MON Unlock without cloning this repo, use the hosted HTTP/MPP API instead:

- https://openpaywall.app/llms.txt
- https://openpaywall.app/agents.md
- `POST /api/agents/publish` (HTTP 402 / MPP)

Paste `AGENT.md` so OpenClaw knows to call the tool and explain the options.

---

## Test without OpenClaw

```bash
npm test
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Readers can't pay | Complete on-chain step — see OPTIONS.md |
| Body not showing after unlock | Check Supabase sync succeeded |
| Agent doesn't help | Paste `AGENT.md` into workspace |
| "Missing publisher wallet" | Add `publisher` or `privateKey` to config |

See **[OPTIONS.md](./OPTIONS.md)** for full decision guide.
