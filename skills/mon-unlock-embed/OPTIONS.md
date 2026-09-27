# Choose your setup

Publishing a paid article needs **three things**. You can automate different amounts from your phone.

| Step | What it does | Can skip? |
|------|--------------|-----------|
| 1. **Embed** | HTML block for your site | No |
| 2. **Supabase** | Stores body + teaser (shown after unlock) | No |
| 3. **On-chain** | Registers price on Monad so readers can pay | **No — readers can't pay without this** |

Steps 1 and 2 always happen when you use the agent. Step 3 is where you choose how. The hosted `/register.html` path now **relays gas** when `RELAYER_PRIVATE_KEY` is set — you still sign, you don't pay MON.

---

## Option A — Phone only (full automation)

**Best if:** you publish often from your phone and trust your OpenClaw host.

**Config:**
```json
{
  "plugins": {
    "mon-unlock-embed": {
      "privateKey": "0xYourPrivateKey"
    }
  }
}
```

**What happens:** you chat → agent generates embed, syncs Supabase, **and registers on Monad automatically**.

**Tradeoff:** your private key lives on the OpenClaw machine. Keep it on your own Mac/VPS, never commit to git.

---

## Option B — Phone + one wallet click (recommended for most people)

**Best if:** you want phone convenience but don't want to store a private key.

**Config:**
```json
{
  "plugins": {
    "mon-unlock-embed": {
      "publisher": "0xYourWalletAddress"
    }
  }
}
```

**What happens:**
1. You chat → agent syncs Supabase and sends a **finish link** (slug, price, title/teaser filled in)
2. Open link → Connect MetaMask → **Register on Monad** → approve the embed signature
3. Click **Copy signed embed** → paste that HTML on your site

**You do NOT re-enter title, teaser, or body.** Those are already saved. The finish page registers on-chain and gives you the payment-ready embed (with `embed-sig`).

**Tradeoff:** ~30 seconds to open the link and approve one MetaMask transaction + signature. Safer — no private key in OpenClaw.

---

## Option C — Web generator only (no OpenClaw)

**Best if:** you're at a desktop and don't need phone publishing.

1. Open [generator.html](https://openpaywall.app/generator.html)
2. Fill in title, slug, teaser, body
3. Connect wallet → Copy embed
4. Paste on your site

Does all three steps in one place. No agent setup.

---

## How to decide

| You want… | Choose |
|-----------|--------|
| Text from phone → live article, zero desktop | **Option A** |
| Text from phone, okay with one MetaMask click per article | **Option B** ← start here |
| Just paste embed code, no agent | **Option C** |

---

## What readers need before they can pay

After you publish, readers need **all three** steps done. If on-chain registration is missing:

- They see the teaser ✓
- They can connect wallet ✓
- **Payment fails** ✗ — article isn't on the contract yet

The agent always tells you if on-chain registration still needs doing and which option applies to you.
