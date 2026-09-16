/**
 * Local Stripe sandbox checkout: real test-mode Sessions, no live charges.
 * Not used in production. Run: node scripts/serve-fiat-test.mjs
 */
import { createServer as createViteServer } from "vite";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { loadEnv } from "vite";

const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
const secret = (env.STRIPE_SECRET_KEY || "").trim();
const publishable = (env.VITE_STRIPE_PUBLISHABLE_KEY || "").trim();
if (!secret || !publishable) {
  console.error("Need STRIPE_SECRET_KEY and VITE_STRIPE_PUBLISHABLE_KEY in .env.local");
  process.exit(1);
}

const stripe = new Stripe(secret);
const tokens = new Map();

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const vite = await createViteServer({
  configFile: "vite.config.ts",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  plugins: [
    {
      name: "fiat-sandbox-api",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          try {
            if (req.method === "POST" && req.url?.startsWith("/api/stripe/create-intent")) {
              const body = await readJson(req);
              const amount = Math.max(50, Math.round(Number(body.amountUsdCents) || 50));
              const title = `Unlock: ${String(body.title || body.articleId || "article").slice(0, 80)}`;
              const returnUrl =
                String(body.returnUrl || "").trim() ||
                "http://127.0.0.1:5173/unlock.html?session_id={CHECKOUT_SESSION_ID}";
              const sessionToken = randomUUID();
              const session = await stripe.checkout.sessions.create({
                ui_mode: "elements",
                mode: "payment",
                return_url: returnUrl,
                line_items: [
                  {
                    price_data: {
                      currency: "usd",
                      unit_amount: amount,
                      product_data: { name: title },
                    },
                    quantity: 1,
                  },
                ],
              });
              tokens.set(session.id, sessionToken);
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  clientSecret: session.client_secret,
                  sessionId: session.id,
                  sessionToken,
                  amountUsdCents: amount,
                })
              );
              return;
            }
            if (req.method === "POST" && req.url?.startsWith("/api/stripe/confirm")) {
              const body = await readJson(req);
              const sessionToken = tokens.get(body.sessionId) || randomUUID();
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ sessionToken }));
              return;
            }
          } catch (e) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: e instanceof Error ? e.message : "create_failed" }));
            return;
          }
          next();
        });
      },
    },
  ],
});

await vite.listen();
const url =
  "http://127.0.0.1:5173/unlock.html?articleId=the-quote-was-a-trap-939i9e&title=The%20Quote%20Was%20a%20Trap&price=0.50&contract=0xd66Df017335ae80BcE5d4Ec728421f3a3DAf6f9f&parentOrigin=http://127.0.0.1:5173&paymentAsset=usdc&returnUrl=http://127.0.0.1:5173/articles.html";
console.log("Fiat sandbox checkout: " + url);
