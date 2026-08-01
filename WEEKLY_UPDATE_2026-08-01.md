# Weekly Progress Update
**Project:** MON Unlock Widget (Open Paywall)  
**Period:** July 17 – August 1, 2026  
**Focus:** Closing the agent publish → payment-ready embed path, and validating it on a live personal site.

---

### 1. Technical Work Completed

#### 1.1 Embed Signatures Required on Every Payment Path
**What was built:**  
Publisher wallet signatures (`embed-sig`) are now required before readers can pay — both for on-chain MON unlocks and Stripe card / Apple Pay / Google Pay. The generator and `/register.html` produce the signature; the widget and `POST /api/stripe/create-intent` reject missing or tampered embeds.

**Technical approach & rationale:**  
The embed HTML is public and copyable. Without a cryptographic check, anyone could change the publisher address (or point at another contract) and steal payments. An EIP-191 message over `{chain, contract, articleId, priceWei}` signed by the on-chain publisher is verified before checkout starts.

**Decision:** Prefer wallet signatures over a server allowlist or content hashes.  
Signatures stay decentralized, work offline in the widget, and don’t break when teaser whitespace changes. The tradeoff: agents cannot invent a valid `embed-sig` without the publisher’s key — so the finish-registration handoff had to get better (see 1.2).

**Simple version:**  
A paywall only accepts money if it’s stamped by the real publisher’s wallet. Copied or edited embeds without that stamp can’t charge readers.

#### 1.2 Agent Publish → One-Click Signed Embed
**What was built:**  
After `POST /api/agents/publish`, the publisher opens `finishRegistrationUrl` (`/register.html`), registers on Monad, signs the embed, and clicks **Copy signed embed** — full payment-ready HTML with `embed-sig` already inside. No more hand-pasting an attribute into the tag.

**Technical approach & rationale:**  
Agent publish already stored the body and returned draft HTML, but payments were blocked until `embed-sig` existed. The first workaround asked humans to copy only the attribute. That was correct for security and wrong for UX.

**Decision:** Carry `title` / `author` / `teaser` on the finish URL so `/register.html` can rebuild the full embed after the wallet signs; make **Copy signed embed** the primary CTA. Keep “copy attribute only” as a secondary escape hatch.

**Bug caught in testing:** A literal `</script>` inside the signed-embed template string truncated the page’s inline module in browsers (query params never rendered, buttons did nothing). Fixed by constructing the script-close sequence at runtime; added a smoke test so it can’t regress.

**Simple version:**  
The agent prepares the article. You open one link, approve in MetaMask, and copy a finished embed. Readers can pay immediately after you paste it.

#### 1.3 Live Validation on Personal Website
**What was validated:**  
End-to-end agent publish → finish registration → signed embed → live personal site. Confirmed the new handoff works outside demos.

**Why this matters for DeltaV / Monad:**  
This is the wedge for AI-assisted publishing: agents do the busywork; the publisher keeps custody of the wallet signature; native MON (and fiat) payments stay on the same `<mon-unlock>` primitive.

**Simple version:**  
Not just “it works in our repo” — an agent created a paywall and it went live on a real site.

---

### 2. Architectural Context (Continuity from Prior Weeks)

Earlier updates covered the dashboard indexer pivot and generator auto-registration. Those pieces are now load-bearing for this milestone:

| Prior milestone | Role this week |
|-----------------|----------------|
| Supabase indexer + dashboard | Publisher can see articles/revenue after agent publish |
| Generator register-on-copy | Same on-chain `registerArticle` + hash rules agents must follow |
| `embed-sig` on all payment paths | Made agent finish UX mandatory, not optional polish |

The agent path does **not** bypass security. It routes the one step only a publisher wallet can do (sign) through a page that returns paste-ready HTML.

---

### 3. Deliverables

1. **`/register.html` — Copy signed embed** — rebuilds full HTML after register + sign.
2. **Agent `finishRegistrationUrl` meta** — title/author/teaser passed through for rebuild.
3. **Docs / skill / OpenAPI / OpenClaw copy** — tell agents and humans to paste the signed HTML, not the unsigned API `embed`.
4. **`server/register-page.test.mjs`** — guards the script-truncation footgun and finish-URL meta.
5. **This weekly update** — for DeltaV program reporting.

**Live:** https://mon-unlock-widget-production.up.railway.app  
**Agent guide:** `/agents.md` · `/skill.md` · `/openapi.json`

---

### 4. Agent Dogfood Report (external agent run)

A separate agent ran the HTTP publish path and wrote up the experience (intended artifact: `mon-unlock-agent-workflow-report.md`).

**Happy path (what we designed):**  
`validate` → pay **$0.05** MPP on `publish` → return `finishRegistrationUrl` → human signs → **Copy signed embed**. Validate completed in seconds.

**What actually burned time:**  
`publish` correctly returned **HTTP 402** (unpaid). The VM had no ready mainnet PathUSD / Stripe payer. Instead of stopping there, the run spent most of an hour on keyring hangs, testnet faucets, Tempo / AgentCash login, and funding dead-ends.

**Takeaway for the product + program:**  
The core API path is short (~30s once payment works). The friction is **agent payment / funding setup**, not embed generation or the finish-registration page. Docs and skills should tell agents: treat the first unpaid 402 as success for discovery, then use a configured payer (`mppx`, Tempo, or `MPP_DEV_BYPASS` in non-prod) — do not chase faucets after 402.

**Simple version:**  
Making the paywall is fast. Paying the tiny publish fee from a fresh agent environment is the hard part.

---

### 5. Current State

**Working:**
- Generator → register → signed embed → reader pay (MON + fiat when configured).
- Agent publish → finish link → **Copy signed embed** → personal site (validated with a human-driven agent).
- Indexer-backed dashboard for connected publisher wallets.
- MPP / OpenAPI discovery for agent findability (`validate` + unpaid `publish` → 402).

**Known limitations (honest, scoped):**
- Agents still cannot silently sign without a publisher key (by design). Option A (OpenClaw `privateKey`) remains available for full automation; Option B (one wallet approval + copy) is the recommended default.
- Fresh agent VMs often lack a funded MPP payer; without one, `publish` stops at 402 and operators waste time on unrelated funding rabbit holes.

---

### 6. Next Priorities

1. Document / skill guidance: **stop after first unpaid 402** unless a payer is already configured; link one clear payment path.
2. Hosted article editing — change title/body/price in the dashboard without re-pasting HTML on the publisher’s site.
3. Optional: store `embed-sig` server-side so the public embed can stay a short tag (same security, less HTML).

---

### 7. Note on Program Feedback

Week 2 scored **4 stars** for clear milestones, strong execution, and visible momentum. This update keeps that format: what shipped, why the decision was made, a plain-language version, live validation, and an honest agent-dogfood finding (402 is correct; funding setup is the real time sink).

*Keep building at this pace.*
