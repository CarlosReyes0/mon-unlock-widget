# Weekly Progress Update
**Project:** MON Unlock Widget  
**Period:** June 13 – June 19, 2026  
**Focus:** Productionizing the Writer Dashboard and preparing for ecosystem funding.

---

### 1. Technical Work Completed

#### 1.1 Writer Dashboard – Automatic On-Chain Data Loading
**What was built:**  
The dashboard now automatically fetches registered articles and revenue for the connected wallet upon login (or session restore) without requiring a manual "Load from chain" button.

**Technical approach & rationale:**  
Initially, the implementation attempted to query `eth_getLogs` directly from the browser. This failed because the public Monad RPC enforces a hard 100-block range limit per request. A naive `fromBlock: 0n` query was rejected with `RPC Request failed`.

**Decision:** Implement client-side pagination in 100-block chunks.  
While this works functionally, it highlighted a deeper architectural issue: performing heavy historical queries from the browser is slow and fragile. This directly informed the later decision to move indexing to a backend (see Section 2).

**Simple version:**  
The dashboard now shows your real articles and earnings automatically when you connect your wallet. It handles the RPC's 100-block limit by breaking the query into small chunks.

#### 1.2 Embed Generator – Wallet Connection & Automatic Registration
**What was built:**  
Clicking "Copy full embed block" now prompts for wallet connection (if not already connected), computes the correct `keccak256(articleId)`, calls `registerArticle` on the mainnet contract, and only then copies the embed code containing the `unlock-contract` attribute.

**Decision rationale:**  
Previously, the generator produced embed code that pointed to a contract where the article was *not* registered, causing `getArticle` to return `publisher = address(0)` and the pre-flight check to block the payment. By forcing registration at copy-time, we guarantee that generated embeds are immediately functional for real MON payments.

**Simple version:**  
The generator now ensures that when you generate a "live" embed, the article is actually registered to your wallet on-chain before you copy the code.

#### 1.3 Security & Transaction Reliability
- Added explicit `gas: 200000n` to the `unlock` transaction to prevent "exceeds transaction gas limit" errors caused by the contract's internal `.call` forwarding payment.
- Added a pre-flight `getArticle` check before sending the payable transaction. This prevents MetaMask from simulating a reverting transaction and showing the "This transaction is likely to fail" warning.

---

### 2. Architectural Pivot: Supabase Backend Indexer

**The Problem:**  
Even with pagination, loading the full history of `ArticleRegistered` and `ArticleUnlocked` events from the browser is too slow for a production dashboard. The 100-block RPC limit makes the initial load take seconds to minutes.

**Decision:** Move the indexer off the client and into a Supabase Edge Function triggered by `pg_cron`.

**Why Supabase over alternatives:**
- **Railway Postgres + Node worker:** Requires managing a persistent process and connection pooling. More operational overhead for a small team.
- **The Graph:** Powerful but introduces a new framework and deployment pipeline. Overkill for a simple "show my articles" feature.
- **Supabase Edge Functions:** Serverless, has a generous free tier, integrates directly with Postgres RLS, and allows the dashboard to query data via the Supabase client instead of a custom API.

This pivot was made because the original "pure static site" architecture hit a hard infrastructure wall. The README now documents this as a known limitation that is actively being solved.

---

### 3. Deliverables Created

1.  **DELTA_V_PROPOSAL.md**: A detailed funding proposal written specifically to address previous feedback requesting "more detail and context" and "more thinking behind decisions." It includes market context, technical rationale for every major architecture choice, and clear success metrics.
2.  **Supabase migration and Edge Function code**: Schema (`articles`, `unlocks` tables) and the indexer function (`supabase/functions/indexer/index.ts`) ready for deployment.
3.  **Dashboard frontend updates**: Replaced direct RPC logic with Supabase client calls for instant data loading.

---

### 4. Current State

**Working:**
- End-to-end flow from Generator → Registration → Embed → Payment.
- Correct `keccak256` encoding used consistently across Generator, Widget, and (now) Dashboard registration form.
- Passive unlock detection works after the first explicit connect on an origin.

**Blocked / In Progress:**
- Writer Dashboard does not yet display articles registered via the generator (`test-6`, etc.) because the Supabase indexer is not yet deployed and running.
- Embed tampering security (signature verification) is designed but not yet implemented in the widget.

---

### 5. Next Week Priorities

1.  Deploy Supabase project and Edge Function indexer.
2.  Wire the Dashboard to read from Supabase tables (replacing the current RPC pagination logic).
3.  Implement signature generation in the Generator and verification in the Widget.
4.  Prepare the hosted service pricing page and authentication flow.

---

*This update focuses on the specific work completed in the last 7 days and the reasoning behind the architectural changes made during that period.*