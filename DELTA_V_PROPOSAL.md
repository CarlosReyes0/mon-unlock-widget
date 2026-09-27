# MON Unlock Widget
## Monetization Infrastructure for Long-Form Content on Monad

**Applicant:** Carlos Reyes  
**Date:** June 19, 2026  
**Status:** Working MVP with known limitations; seeking funding to productionize.

---

### 1. Executive Summary

I have built and shipped a functional end-to-end paywall system that allows writers to embed a "pay with MON" widget on any website. Readers connect a wallet, pay native MON, and unlock the full article. The publisher receives 100% of the payment on-chain with no platform fee.

The widget is live on `https://openpaywall.app/`. A working demo embed is running on a personal site, and the generator successfully registers articles to the connected wallet on Monad mainnet.

**The core problem I am solving:** There is no simple, embeddable way for independent writers to monetize long-form content with native MON on Monad. Existing solutions either require readers to leave the page, use custodial platforms that take 30% cuts, or require complex self-hosting.

This proposal requests funding to move from a working prototype to a production-grade hosted service with a reliable revenue dashboard and tamper-proof embed security.

---

### 2. The Problem (Context & Market Insight)

#### 2.1 The Content Monetization Gap on Monad
Monad has positioned itself as a high-performance chain suitable for consumer applications. However, the ecosystem currently lacks infrastructure for **direct, per-article monetization** of long-form writing.

- Newsletter platforms (Substack, Ghost) take significant cuts and own the relationship.
- Token-gated content usually requires holding an NFT or token, creating high friction for one-time readers.
- "Pay per article" solutions on other chains (e.g., Mirror, Paragraph) are either custodial or require readers to bridge assets.

**Insight:** Native MON payments are the most seamless experience for readers already in the Monad ecosystem. A simple `<mon-unlock>` HTML tag that works anywhere is the lowest-friction on-ramp for writers.

#### 2.2 Why This Matters for Monad's Growth
Every successful on-chain payment increases:
- Active addresses
- Gas usage
- Visibility of "real things happening on Monad" (a common investor and user question)

A working writer monetization primitive creates a flywheel: more writers → more readers → more MON volume → more developers building around the standard.

---

### 3. Solution Overview

The MON Unlock Widget is a self-contained system with three components:

1. **The Widget** (`<mon-unlock>`): A web component that handles wallet connection, on-chain `hasUnlocked` checks, and the `unlock(bytes32)` transaction.
2. **The Generator**: A no-code tool that lets writers configure an article, connect their wallet, and receive a ready-to-paste embed block. On "Copy and register", the generator automatically calls `registerArticle` on the mainnet contract using the correct `keccak256` encoding.
3. **The Dashboard** (in progress): A view for writers to see registered articles and real revenue from `ArticleUnlocked` events.

All payments flow directly from reader → publisher via the `ArticleUnlock` contract. The widget never touches the funds.

---

### 4. Technical Architecture & Decision Rationale

This section explains not just *what* was built, but *why* specific technical choices were made.

#### 4.1 Why Supabase + Edge Functions for the Indexer (Instead of Client-Side RPC)

**The Constraint:** The public Monad RPC (`rpc.monad.xyz`) limits `eth_getLogs` to a 100-block range per request. Scanning the full history from a browser is impossible without hundreds of sequential calls, which is slow and unreliable.

**Decision:** Move the indexer to a Supabase Edge Function triggered by `pg_cron`.

**Rationale:**
- **Performance:** The browser should never do heavy RPC scanning. A serverless function runs in a controlled environment with better networking.
- **Reliability:** Edge Functions can be retried. Browser code cannot.
- **Cost:** Supabase has a generous free tier for low-volume workloads. Running a persistent Railway worker would cost more at this stage.
- **Simplicity:** Using the Supabase client directly from the dashboard (`supabase-js`) removes the need for a custom Express API layer.

This was a deliberate shift from the original "pure static site" architecture once the RPC limitation became clear.

#### 4.2 Why a Signature-Based Embed Security Model

**The Risk:** The embed HTML is unauthenticated. Anyone can copy the snippet, change the `unlock-contract` address, register the same slug under their own wallet, and steal future payments.

**Decision:** At generation time, the connected wallet signs a message containing `{articleId, contract, price, timestamp}`. The widget verifies this signature against the on-chain `publisher` before initiating a payment.

**Why not other options:**
- Server-side verification endpoint: Adds latency and a single point of failure.
- Hardcoded allowlist: Too inflexible if we want multiple contracts later.
- Content hash: Brittle to whitespace changes.

A cryptographic signature is the most robust, decentralized solution that still allows the generator to remain a static page.

#### 4.3 Why Native MON (Not USDC or a Custom Token)

This decision was locked early (see `FOCUS.md`). The rationale remains:
- **Ecosystem alignment:** Monad's value accrues to MON. Using the native asset creates direct demand.
- **Simplicity:** One asset for gas + payment. No need for permit signatures or allowance management in v1.
- **Writer experience:** Writers receive MON directly in their wallet. No need to explain "what is this $READ token?"

USDC can be revisited later if publishers demand dollar-stable pricing.

---

### 5. Current Progress & Demo

**Working Today:**
- Generator successfully registers articles to the connected wallet on mainnet.
- Widget supports both demo mode and live `unlock-contract` mode.
- Passive `eth_accounts` check allows unlocks to appear automatically on subsequent visits.
- CORS headers allow embedding from any origin (including `localhost` and production sites).
- Idempotency guard prevents duplicate registration transactions.

**Known Limitations (Documented in README):**
1. First-visit connect is still required (passive detection only works after explicit approval on that origin).
2. Writer Dashboard currently shows zero revenue because `loadOnchainData` was hitting the RPC range limit. The Supabase indexer solves this.
3. Embed tampering risk exists until signature verification is wired into the widget.

**Live Artifacts:**
- Widget: https://openpaywall.app/
- Generator: https://openpaywall.app/generator.html
- Example embed on personal site: https://personal-website-production-b90b.up.railway.app/test-6.html

---

### 6. Requested Funding & Milestones

I am requesting **$35,000 in MON** (or equivalent) to complete the following scoped work over 6–8 weeks.

**Milestone 1: Production Dashboard (2–3 weeks)**
- Deploy Supabase project with `articles` and `unlocks` tables.
- Implement Edge Function indexer with 100-block pagination + `pg_cron` scheduling.
- Update Dashboard to read from Supabase (instant load, no RPC calls from browser).
- Add per-article unlock counts and transaction links.

**Milestone 2: Embed Security (2 weeks)**
- Implement EIP-191 signature generation in the generator.
- Add signature verification in the widget before `unlock` transaction.
- Display clear error if signature is invalid or missing.

**Milestone 3: Hosted Service Foundation (2 weeks)**
- Add basic authentication (email magic links or wallet signature) so writers can manage multiple sites.
- Create "Pro" tier UI (unlimited articles, custom branding toggle, priority support).
- Document pricing page (proposed: $19/mo or 5% revenue share).

**Success Metrics:**
- At least 5 writers (including myself) have registered 20+ articles via the hosted generator.
- Dashboard correctly shows revenue for `0x5594…307b` and at least one other wallet.
- Zero "RPC range limit" errors in the dashboard.

---

### 7. Why DeltaV / Monad Should Fund This

This is not just a single application. It is **infrastructure** that makes it easier for the next 100 writers to monetize on Monad.

Every successful implementation of this pattern (signature verification, Edge Function indexing, direct MON payments) becomes reusable knowledge for other consumer apps on the chain.

The limitations section in the README is written in the exact format DeltaV has previously responded well to: clear problem, concrete solution, measurable outcome.

I am ready to ship.

---

**Contact**  
Carlos Reyes  
[Your email / Twitter / Farcaster]  
Live demo: https://openpaywall.app/generator.html

*Thank you for the feedback two weeks ago. This proposal attempts to address the request for more detail and decision context.*