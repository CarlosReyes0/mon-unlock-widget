# Voice drafts (optional)

Writer helper on **/write**: paste a few of your posts (or a short voice note), and Open Paywall drafts **2–3 X posts** in that voice for the current article.

**Drafts only.** The human always copies and sends. This build does **not** post, schedule, or call the X write API. Gated autopost is future work, not this PR.

## What you get

1. Optional panel on `/write` under the draft (does not block **Publish**).
2. `POST /api/voice-drafts` returns 2–3 editable cards: **Copy** / **Use as reply seed**.
3. Voice samples persist in **localStorage**, keyed by the signed-in wallet when Privy/wallet auth is already on. No new login system. Server persistence can come later.
4. If the LLM key is missing, the API returns HTTP 200 `{ ok: false, code: "missing_api_key" }` and Publish/unlock are unchanged.

## Railway / env

The repo has no built-in LLM. Set **one** key on the Railway **web** service (same process as `npm start`), then redeploy. Never put the key in `VITE_*`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `VOICE_DRAFT_API_KEY` | **Preferred** | OpenAI-compatible or Anthropic secret. |
| `OPENAI_API_KEY` | Fallback | Used if `VOICE_DRAFT_API_KEY` is unset. |
| `ANTHROPIC_API_KEY` | Fallback | Used if the two above are unset. Keys starting `sk-ant-` select Anthropic. |
| `VOICE_DRAFT_PROVIDER` | No | `openai` (default) or `anthropic`. |
| `VOICE_DRAFT_MODEL` | No | Default `gpt-4o-mini` or `claude-3-5-haiku-latest`. |
| `VOICE_DRAFT_BASE_URL` | No | Override API origin (tests use a mock). OpenAI default `https://api.openai.com/v1`. |

If no key is set, the panel still renders with “drafts only” copy and generate fail-softs. CI never spends: tests mock the LLM.

## Out of scope (do not add here)

- Autopost / scheduled post / silent X write
- Substack DMs or outreach
- NFT, MiroShark, unlock pricing

## API

- `GET /api/voice-drafts/status` — `enabled`, `draftsOnly: true`, `autopost: false`. Never returns the key.
- `POST /api/voice-drafts` `{ samples, notes, title, body, articleUrl }` — always HTTP 200 on model errors (`ok: false`). Success includes `drafts: [{ id, text }]`.

Publish does not call these endpoints.
