/**
 * OpenAPI discovery document for MPPscan / mpp.dev registries.
 *
 * MPPscan only treats an endpoint as MPP-capable when x-payment-info.protocols
 * is an array of protocol objects, e.g. [{ mpp: { method, network, ... } }].
 * A plain ["mpp"] string list is ignored (authMode becomes "paid" with no protocols).
 */
import { publishAmount, publishCurrency, mppConfigured } from "./mpp.mjs";

const PATH_USD = "0x20c0000000000000000000000000000000000000";
const TEMPO_CHAIN_ID = 4217;

function originFromEnv() {
  return (
    process.env.CDN_BASE ||
    process.env.PUBLIC_ORIGIN ||
    "https://mon-unlock-widget-production.up.railway.app"
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
      version: "1.0.5",
      description:
        "Create embeddable paywalls for long-form articles. Agents validate for free, then pay via Machine Payments Protocol (HTTP 402, ~$0.05) to publish. If unpaid and no funded payer is configured, agents should stop and ask the human — not chase faucets. On-chain Monad registration may still require one publisher wallet approval.",
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
        "POST /api/agents/publish (pay 402 challenge)",
        "Return embed HTML",
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
      mppConfigured: mppConfigured(),
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
