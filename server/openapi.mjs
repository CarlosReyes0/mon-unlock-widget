/**
 * OpenAPI discovery document for MPPscan / mpp.dev registries.
 *
 * MPPscan only treats an endpoint as MPP-capable when x-payment-info.protocols
 * is an array of protocol objects, e.g. [{ mpp: { method, network, ... } }].
 * A plain ["mpp"] string list is ignored (authMode becomes "paid" with no protocols).
 */
import { publishAmount, publishCurrency, mppConfigured } from "./mpp.mjs";
import {
  BASE_CHAIN_ID,
  BASE_NETWORK_V1,
  BASE_USDC,
  x402Configured,
  x402PayTo,
  x402PublishAmountUsd,
  x402UnlockAmountUsd,
  usdToUsdcAtomic,
} from "./x402.mjs";

const PATH_USD = "0x20c0000000000000000000000000000000000000";
const TEMPO_CHAIN_ID = 4217;

function originFromEnv() {
  return (
    process.env.CDN_BASE ||
    process.env.PUBLIC_ORIGIN ||
    "https://openpaywall.app"
  ).replace(/\/$/, "");
}

function tempoRecipient() {
  return (process.env.MPP_TEMPO_RECIPIENT || "").trim();
}

/** Convert human pathUSD amount (e.g. "0.05") to 6-decimal base units. */
function amountBaseUnits(human) {
  const n = Number(human);
  if (!Number.isFinite(n) || n < 0) return "50000";
  return String(Math.round(n * 1_000_000));
}

export function buildOpenApiDocument() {
  const origin = originFromEnv();
  const recipient = tempoRecipient();
  const humanAmount = publishAmount();
  const baseAmount = amountBaseUnits(humanAmount);
  const asset = publishCurrency() || PATH_USD;

  const mppProtocol = {
    mpp: {
      method: "tempo",
      network: "tempo",
      chainId: TEMPO_CHAIN_ID,
      asset,
      amount: baseAmount,
      ...(recipient ? { recipient } : {}),
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Open Paywall Agent API",
      version: "1.2.0",
      description:
        "Create embeddable paywalls for long-form articles. Agents validate for free, then pay via Machine Payments Protocol (HTTP 402, ~$0.05 PathUSD on Tempo) or x402 (USDC on Base) to publish. Bankr agents should use POST /api/x402/publish and GET /api/x402/articles/{slug}. If unpaid and no funded payer is configured, agents should stop and ask the human — not chase faucets. On-chain Monad registration may still require one publisher wallet approval. Human readers still unlock USDC on Monad.",
      contact: {
        name: "Open Paywall",
        email: "carlos.a.reyes00@gmail.com",
        url: origin,
      },
    },
    servers: [{ url: origin }],
    "x-service-info": {
      categories: [
        "content-monetization",
        "paywall",
        "publishing",
        "embeddable-paywall",
        "pay-per-article",
      ],
      docs: {
        homepage: origin,
        llms: `${origin}/llms.txt`,
        apiReference: `${origin}/agents.md`,
      },
    },
    "x-agent-guidance": {
      preferredFlow: [
        "Accept human paste (Title/Teaser/---/body) or JSON",
        "POST /api/agents/publish/parse (optional, free)",
        "POST /api/agents/publish/validate",
        "POST /api/agents/publish (MPP 402) OR POST /api/x402/publish (x402 USDC on Base)",
        "Return embed HTML + finishRegistrationUrl",
        "Unlock/read: GET /api/x402/articles/{slug} (x402 USDC on Base, or existing reader entitlement)",
        "Send finishRegistrationUrl if needsManualOnChainRegistration; tell user to Copy signed embed there",
      ],
      humanPasteFormat: {
        description:
          "Mobile-friendly plain text. Messy input OK — agent interprets loosely, confirms before publish.",
        messyInputOk: true,
        confirmBeforePublish: true,
        interpretationPrompt:
          "Reply with Title, Price, Teaser, Slug (agent-generated), body preview; wait for looks good.",
        example:
          "Title: July rain walk\\nPrice: 0.50\\nTeaser: Walking home…\\n---\\nFull article text.",
        completedExample:
          "Title: July rain walk\\nPrice: 0.50\\nTeaser: Walking home…\\nSlug: july-rain-walk-k3m9x2\\n---\\nFull article text.",
        idealHumanLines: ["Title:", "Price:", "Teaser:", "---"],
        slugRule: "Always auto-generate Slug on publish. Never accept Slug from human.",
        optionalLines: ["Author:", "Asset: mon"],
      },
      skill: `${origin}/skill.md`,
      cursorSkill: `${origin}/.well-known/skills/mon-unlock/SKILL.md`,
      x402Skill: `${origin}/.well-known/skills/open-paywall-x402/SKILL.md`,
      mppConfigured: mppConfigured(),
      x402Configured: x402Configured(),
    },
    paths: {
      "/api/agents/health": {
        get: {
          operationId: "agentHealth",
          summary: "Agent API + MPP configuration status",
          security: [],
          responses: { "200": { description: "Health payload" } },
        },
      },
      "/api/agents/publish/parse": {
        post: {
          operationId: "parsePublishPaste",
          summary: "Parse casual human paste into publish JSON (free)",
          description:
            "Converts Title/Teaser/---/body plain text into the PublishRequest shape. Pass publisher separately.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["paste", "publisher"],
                  properties: {
                    paste: {
                      type: "string",
                      description:
                        "Plain text with Title/Price/Teaser header lines, --- separator, then body",
                    },
                    publisher: {
                      type: "string",
                      description: "0x publisher wallet (ask once, reuse)",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Parsed publish payload" },
            "400": { description: "Invalid paste" },
          },
        },
      },
      "/api/agents/publish/validate": {
        post: {
          operationId: "validatePublish",
          summary: "Validate publish payload and return quote (free)",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PublishRequest" },
              },
            },
          },
          responses: {
            "200": { description: "Valid payload + quote" },
            "400": { description: "Invalid payload" },
          },
        },
      },
      "/api/agents/publish": {
        post: {
          operationId: "publishPaywall",
          summary: "Create embed + sync article body (MPP paid)",
          description:
            "Unpaid requests receive HTTP 402 with WWW-Authenticate Payment challenge (~$0.05). Agents without a funded payer should stop after this response and ask the human to pay or supply MPPX_PRIVATE_KEY — do not use testnet faucets. After payment, returns unsigned embed HTML plus finishRegistrationUrl. Publishers open that URL to register on Monad, sign the embed, and Copy signed embed.",
          "x-payment-info": {
            price: {
              mode: "fixed",
              currency: "USD",
              amount: humanAmount,
            },
            protocols: [mppProtocol],
            offers: [
              {
                method: "tempo",
                intent: "charge",
                currency: asset,
                amount: baseAmount,
                description: `Create one embeddable paywall — $${humanAmount} in pathUSD/USDC.e on Tempo`,
              },
            ],
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PublishRequest" },
              },
            },
          },
          responses: {
            "200": { description: "Published embed payload" },
            "402": { description: "Payment Required" },
            "400": { description: "Invalid payload" },
            "503": { description: "MPP not configured on server" },
          },
        },
      },
      "/api/x402/publish": {
        post: {
          operationId: "x402PublishPaywall",
          summary: "Create embed + sync article body (x402 USDC on Base)",
          description:
            "Bankr-friendly x402. Unpaid requests receive HTTP 402 with x402 accepts[] (USDC on Base, ~$0.05). Retry with X-PAYMENT (v1) or PAYMENT-SIGNATURE (v2). Same JSON body and result as POST /api/agents/publish. MPP PathUSD on that route is unchanged. After payment, returns unsigned embed HTML plus finishRegistrationUrl — publishers still register on Monad.",
          "x-payment-info": {
            price: {
              mode: "fixed",
              currency: "USD",
              amount: x402PublishAmountUsd(),
            },
            protocols: [
              {
                x402: {
                  version: 1,
                  scheme: "exact",
                  network: BASE_NETWORK_V1,
                  chainId: BASE_CHAIN_ID,
                  asset: BASE_USDC,
                  amount: usdToUsdcAtomic(x402PublishAmountUsd()),
                  ...(x402PayTo() && /^0x[a-fA-F0-9]{40}$/.test(x402PayTo())
                    ? { recipient: x402PayTo() }
                    : {}),
                },
              },
            ],
            offers: [
              {
                method: "x402",
                network: BASE_NETWORK_V1,
                currency: BASE_USDC,
                amount: usdToUsdcAtomic(x402PublishAmountUsd()),
                description: `Create one embeddable paywall — $${x402PublishAmountUsd()} USDC on Base (Bankr x402). Human reader unlocks remain USDC on Monad.`,
              },
            ],
          },
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PublishRequest" },
              },
            },
          },
          responses: {
            "200": { description: "Published embed payload" },
            "402": { description: "x402 Payment Required (USDC on Base)" },
            "400": { description: "Invalid payload" },
            "503": { description: "x402 not configured on server" },
          },
        },
      },
      "/api/x402/unlock": {
        get: {
          operationId: "x402UnlockGet",
          summary: "Unlock / fetch paid body (x402 USDC on Base, or existing entitlement)",
          description:
            "Without payment: HTTP 402 with the listing price in USDC on Base (default $0.50). Does not return body. A bare reader= wallet does not skip the charge. A reader session (X-Reader-Session from POST /api/reader/session) or Stripe fiat_session returns the body without charging when that reader is already entitled. After X-PAYMENT, returns the paid article body.",
          parameters: [
            {
              name: "articleId",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
            {
              name: "reader",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Ignored unless it matches a reader session. A bare address does not skip x402.",
            },
          ],
          responses: {
            "200": { description: "Unlocked body" },
            "402": { description: "x402 Payment Required" },
            "404": { description: "Article not found" },
          },
        },
        post: {
          operationId: "x402UnlockPost",
          summary: "Unlock / fetch paid body (x402 USDC on Base)",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    articleId: { type: "string" },
                    slug: { type: "string" },
                    reader: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Unlocked body" },
            "402": { description: "x402 Payment Required" },
            "404": { description: "Article not found" },
          },
        },
      },
      "/api/x402/articles/{slug}": {
        get: {
          operationId: "x402ArticleBySlug",
          summary: "Unlock / fetch paid body by slug (x402)",
          description: `Default listing price ${x402UnlockAmountUsd()} USDC. Settlement is USDC on Base for agents; readers on the web still pay USDC on Monad.`,
          parameters: [
            {
              name: "slug",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Unlocked body" },
            "402": { description: "x402 Payment Required" },
            "404": { description: "Article not found" },
          },
        },
      },
      "/api/miroshark/status": {
        get: {
          operationId: "mirosharkPreviewStatus",
          summary: "Optional MiroShark Write preview + x402aff affiliate status",
          description:
            "Enabled only when BASE_BUILDER_CODE is set. Does not affect publish or article unlock.",
          security: [],
          responses: { "200": { description: "enabled flag, serverPayer boolean, affiliate meta" } },
        },
      },
      "/api/miroshark/preview": {
        post: {
          operationId: "mirosharkPreview",
          summary: "Optional MiroShark sim from a Write draft (fail-soft)",
          description:
            "Seeds POST https://x402.miroshark.xyz/run with title + teaser + body snippet. Always attaches X-Builder-Code. If MiroShark returns 402 and MIROSHARK_X402_PRIVATE_KEY is unset, the response includes clientPayment for the signed-in wallet to approve $1 USDC on Base. Retry the same POST with payment: { signature, authorization }. A paid run returns the simulation URL. Sim errors never block publish.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    body: { type: "string" },
                    payment: {
                      type: "object",
                      description: "Writer wallet EIP-3009 approval for the Base USDC charge.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "ok run, payment_required challenge, or fail-soft error" },
          },
        },
      },
      "/api/miroshark/runs/{runId}": {
        get: {
          operationId: "mirosharkRunStatus",
          summary: "Poll a MiroShark run and return a short summary",
          security: [],
          parameters: [
            {
              name: "runId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Run status + optional report summary" } },
        },
      },
      "/api/writers/{wallet}": {
        get: {
          operationId: "getWriter",
          summary: "Public writer page data",
          description:
            "Display name, follower count (including 0), optional paid membership, and listed articles for a writer wallet. Follow is free. Reading a post is still pay-per-piece.",
          security: [],
          parameters: [
            {
              name: "wallet",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" },
            },
          ],
          responses: {
            "200": { description: "Writer profile. Cache-Control public, max-age=60." },
            "404": { description: "No listed articles for this wallet." },
          },
        },
      },
      "/api/writers/followers/counts": {
        get: {
          operationId: "getWriterFollowerCounts",
          summary: "Public follower counts for feed cards",
          description:
            "Verified follows that are not unsubscribed, one number per writer wallet. Every requested wallet is included, even when the count is 0. At most 50 wallets. Email and wallet breakdown is not public.",
          security: [],
          parameters: [
            {
              name: "wallets",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Comma-separated writer wallets.",
            },
          ],
          responses: {
            "200": { description: "{ counts: { [wallet]: number } }. Cache-Control public, max-age=60." },
          },
        },
      },
      "/api/writers/{wallet}/followers/count": {
        get: {
          operationId: "getWriterFollowerCount",
          summary: "Public follower count",
          description:
            "Verified follows that are not unsubscribed. The count is always returned, including 0. Email and wallet breakdown is not public.",
          security: [],
          parameters: [
            {
              name: "wallet",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" },
            },
          ],
          responses: {
            "200": { description: "{ followers: number }" },
          },
        },
      },
      "/api/voice-drafts/status": {
        get: {
          operationId: "voiceDraftStatus",
          summary: "Optional writer voice-draft status (drafts only)",
          description:
            "Enabled when VOICE_DRAFT_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY is set. Never posts to X. Does not affect publish or article unlock.",
          security: [],
          responses: {
            "200": { description: "enabled flag, draftsOnly true, autopost false" },
          },
        },
      },
      "/api/voice-drafts": {
        post: {
          operationId: "voiceDraftGenerate",
          summary: "Draft 2–3 social posts in the writer's voice (never posts)",
          description:
            "Returns editable draft cards from voice samples + the current article. LLM errors are HTTP 200 { ok: false }. Autopost / X write API is out of scope.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    samples: {
                      description: "Sample posts (string or array)",
                      oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
                    },
                    notes: { type: "string" },
                    title: { type: "string" },
                    teaser: { type: "string" },
                    body: { type: "string" },
                    articleUrl: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "ok drafts, or fail-soft missing_api_key / llm_error" },
          },
        },
      },
    },
    components: {
      schemas: {
        PublishRequest: {
          type: "object",
          required: ["title", "articleId", "teaser", "body", "publisher"],
          properties: {
            title: { type: "string" },
            articleId: {
              type: "string",
              description: "URL-safe slug",
            },
            teaser: { type: "string" },
            body: { type: "string" },
            publisher: {
              type: "string",
              description: "0x publisher wallet",
            },
            price: {
              type: "string",
              description:
                "Article price as a string. USD amount when paymentAsset is usdc (default 0.50); MON amount when paymentAsset is mon (default 1).",
              default: "0.50",
            },
            paymentAsset: {
              type: "string",
              enum: ["usdc", "mon"],
              description:
                "Settlement asset for reader unlocks. Default usdc ($0.50). Use mon for legacy native-MON embeds.",
              default: "usdc",
            },
            author: { type: "string" },
          },
        },
      },
    },
  };
}
