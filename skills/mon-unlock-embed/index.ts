import { Type } from "@sinclair/typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { CDN_BASE, generateEmbed, publishArticle } from "./embed.js";

type PluginConfig = {
  publisher?: string;
  /** Publisher private key — enables automatic on-chain registration (costs gas) */
  privateKey?: `0x${string}`;
};

function formatOnChainNextSteps(finishUrl: string): string[] {
  return [
    "",
    "## ⚠ One step left — readers can't pay yet",
    "",
    "Your embed and body are already saved. You only need to register on Monad.",
    "**You don't need to re-enter title, teaser, or body.**",
    "",
    "**Tap this link on your phone or desktop:**",
    finishUrl,
    "",
    "Then:",
    "1. Connect MetaMask (your publisher wallet)",
    "2. Click **Register on Monad**",
    "3. Approve the transaction",
    "",
    "That's it — slug and price are already in the link.",
    "",
    "**Want zero manual steps next time?** Add `privateKey` to plugin config (see OPTIONS.md).",
  ];
}

function formatPublishResult(result: Awaited<ReturnType<typeof publishArticle>>): string {
  const lines: string[] = ["## MON Unlock — article published", ""];

  lines.push(`Slug: \`${result.slug}\``);
  lines.push(`Hash: \`${result.articleIdHash}\``);
  lines.push("");

  // On-chain
  if (result.onChainRegistered) {
    if (result.onChainAlreadyRegistered) {
      lines.push("✓ Already registered on Monad — **readers can pay**");
    } else {
      lines.push(`✓ Registered on Monad — tx: ${result.onChainTxHash}`);
      lines.push("  **Readers can pay now.**");
    }
  } else {
    lines.push(...formatOnChainNextSteps(result.finishRegistrationUrl));
  }

  lines.push("");

  // Supabase
  if (result.metadataSynced) {
    lines.push("✓ Body + teaser saved to Supabase (shown after unlock)");
  } else {
    lines.push(`⚠ Supabase sync failed: ${result.metadataError}`);
  }

  lines.push("");
  lines.push("## Paste this embed into your site:");
  lines.push("");
  lines.push("```html");
  lines.push(result.embed);
  lines.push("```");

  return lines.join("\n");
}

function formatSetupRequired(): string {
  return [
    "## Setup required",
    "",
    "Add your wallet to OpenClaw plugin config. Pick one:",
    "",
    "**Option B — Recommended (safer):**",
    "```json",
    '{',
    '  "plugins": {',
    '    "mon-unlock-embed": {',
    '      "publisher": "0xYourWalletAddress"',
    "    }",
    "  }",
    "}",
    "```",
    "I generate embed + sync Supabase. You register on-chain once via the web generator + MetaMask.",
    "",
    "**Option A — Full automation:**",
    "```json",
    '{',
    '  "plugins": {',
    '    "mon-unlock-embed": {',
    '      "privateKey": "0xYourPrivateKey"',
    "    }",
    "  }",
    "}",
    "```",
    "I do everything from phone, including on-chain registration. Key stays on your OpenClaw host.",
    "",
    "See OPTIONS.md in the plugin folder for the full comparison.",
    "",
    `Generator (Option B on-chain step): ${CDN_BASE}/register.html`,
  ].join("\n");
}

export default definePluginEntry({
  id: "mon-unlock-embed",
  name: "MON Unlock Embed Generator",
  description:
    "Publish paid articles via mon-unlock from chat. Generates embed HTML, syncs body to Supabase, " +
    "and registers on Monad when privateKey is configured. Use when user wants to create/publish a paid article.",

  register(api) {
    const config = (api.config ?? {}) as PluginConfig;

    api.registerTool({
      name: "generate_mon_unlock_embed",
      description:
        "Publish a mon-unlock paid article end-to-end. " +
        "Collects title, slug (articleId), teaser, and body from the user. " +
        "Generates embed HTML, syncs body/teaser to Supabase, and registers on-chain if privateKey is configured. " +
        "Always call this when the user wants to publish or create a new paid article.",
      parameters: Type.Object({
        title: Type.String({ description: "Article title shown in the widget header" }),
        articleId: Type.String({
          description: "Stable URL slug, e.g. midnight-writing or july-3-11pm",
        }),
        teaser: Type.String({ description: "Free preview text shown before unlock" }),
        body: Type.String({
          description: "Full paid article body (plain text or HTML). Stored in Supabase.",
        }),
        author: Type.Optional(Type.String({ description: "Author name" })),
        price: Type.Optional(Type.String({ description: "Price in MON, e.g. 1 or 0.5" })),
        publisher: Type.Optional({
          type: "string",
          description: "Publisher wallet 0x... Uses plugin config if omitted.",
        }),
      }),
      async execute(_id, params) {
        const privateKey = config.privateKey;
        const publisher = (params.publisher || config.publisher || "").trim();

        if (!publisher && !privateKey) {
          return {
            content: [{ type: "text", text: formatSetupRequired() }],
            isError: true,
          };
        }

        try {
          const result = await publishArticle(
            {
              title: params.title,
              articleId: params.articleId,
              teaser: params.teaser,
              body: params.body,
              author: params.author,
              price: params.price,
              publisher,
            },
            { publisher: publisher || undefined, privateKey },
          );

          return {
            content: [{ type: "text", text: formatPublishResult(result) }],
          };
        } catch (e) {
          return {
            content: [
              {
                type: "text",
                text: e instanceof Error ? e.message : "Publish failed",
              },
            ],
            isError: true,
          };
        }
      },
    });

    api.registerTool(
      {
        name: "preview_mon_unlock_embed",
        description: "Preview embed HTML only — no Supabase or on-chain registration.",
        parameters: Type.Object({
          title: Type.String(),
          articleId: Type.String(),
          teaser: Type.String(),
          author: Type.Optional(Type.String()),
          price: Type.Optional(Type.String()),
        }),
        async execute(_id, params) {
          const embed = generateEmbed(params);
          return {
            content: [{ type: "text", text: `Preview:\n\n${embed}` }],
          };
        },
      },
      { optional: true },
    );
  },
});
