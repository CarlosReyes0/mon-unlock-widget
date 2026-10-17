/**
 * Public Supabase coordinates and staging guardrails.
 *
 * SUPABASE_URL and SUPABASE_ANON_KEY are not secrets. When they are unset the
 * server keeps today's production project, so a production deploy with no new
 * variables behaves as before. APP_ENV=staging (or preview) refuses to start
 * if that fallback, or a live Stripe key, would be used.
 *
 * The anon key is injected into HTML. Never put the service role key,
 * a Stripe secret, or a relayer key in publicRuntimeConfig.
 */

export const PROD_SUPABASE_PROJECT_REF = "flczjqljgntmkanipugo";

export const PROD_SUPABASE_URL = `https://${PROD_SUPABASE_PROJECT_REF}.supabase.co`;

/** Public anon JWT already shipped in the widget. Not a secret. */
export const PROD_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsY3pqcWxqZ250bWthbmlwdWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MTUwNjQsImV4cCI6MjA5NzQ5MTA2NH0.ZKcFJ_4ZI4oK4hyZtR72vqC_JCdwttZSQQw82uTMEb4";

const STRIPE_KEY_ENVS = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "VITE_STRIPE_PUBLISHABLE_KEY"];

export function normalizeSupabaseUrl(raw) {
  return String(raw || "").trim().replace(/\/$/, "");
}

export function appEnvName(env = process.env) {
  const value = String(env.APP_ENV || "").trim().toLowerCase();
  if (value === "staging" || value === "preview") return value;
  return "production";
}

export function isStagingApp(env = process.env) {
  const name = appEnvName(env);
  return name === "staging" || name === "preview";
}

export function anonKeyProjectRef(key) {
  const parts = String(key || "").trim().split(".");
  if (parts.length < 2) return "";
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json);
    return String(payload.ref || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

export function isProdSupabaseUrl(url) {
  return normalizeSupabaseUrl(url).toLowerCase().includes(PROD_SUPABASE_PROJECT_REF);
}

export function isProdAnonKey(key) {
  const value = String(key || "").trim();
  if (!value) return false;
  if (value === PROD_SUPABASE_ANON_KEY) return true;
  return anonKeyProjectRef(value) === PROD_SUPABASE_PROJECT_REF;
}

export function isLiveStripeKey(value) {
  const key = String(value || "").trim();
  return key.startsWith("sk_live_") || key.startsWith("pk_live_");
}

export function resolveSupabaseUrl(env = process.env) {
  return normalizeSupabaseUrl(env.SUPABASE_URL) || PROD_SUPABASE_URL;
}

export function resolveAnonKey(env = process.env) {
  return String(env.SUPABASE_ANON_KEY || "").trim() || PROD_SUPABASE_ANON_KEY;
}

export function registerArticleEndpoint(env = process.env) {
  const explicit = String(env.REGISTER_ARTICLE_URL || "").trim();
  if (explicit) return explicit;
  return `${resolveSupabaseUrl(env)}/functions/v1/register-article`;
}

/**
 * Why APP_ENV=staging/preview must not boot. Empty when this is not a staging app.
 * Unset Supabase settings count: the code default is the production project.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function stagingBlockers(env = process.env) {
  if (!isStagingApp(env)) return [];
  const problems = [];
  for (const name of STRIPE_KEY_ENVS) {
    if (isLiveStripeKey(env[name])) problems.push(`${name} is a live Stripe key`);
  }
  const configuredUrl = normalizeSupabaseUrl(env.SUPABASE_URL);
  if (!configuredUrl) {
    problems.push("SUPABASE_URL is unset and would use the production project");
  } else if (isProdSupabaseUrl(configuredUrl)) {
    problems.push("SUPABASE_URL is the production Supabase project");
  }
  const configuredKey = String(env.SUPABASE_ANON_KEY || "").trim();
  if (!configuredKey) {
    problems.push("SUPABASE_ANON_KEY is unset and would use the production anon key");
  } else if (isProdAnonKey(configuredKey)) {
    problems.push("SUPABASE_ANON_KEY is the production anon key");
  }
  return problems;
}

export function assertStagingSafe(env = process.env) {
  const problems = stagingBlockers(env);
  if (!problems.length) return;
  const error = new Error(
    `Refusing to start: APP_ENV=${appEnvName(env)} must not use the production Supabase project or a live Stripe key. ${problems.join("; ")}.`
  );
  error.code = "STAGING_REFUSED";
  throw error;
}

export function configuredPublicOrigin(env = process.env) {
  const raw = String(env.PUBLIC_ORIGIN || "").trim().replace(/\/$/, "");
  if (!raw) return "";
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProto);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

export function configuredPublicHost(env = process.env) {
  const origin = configuredPublicOrigin(env);
  if (!origin) return "";
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function publicStripePublishableKey(env = process.env) {
  for (const name of ["VITE_STRIPE_PUBLISHABLE_KEY", "STRIPE_PUBLISHABLE_KEY"]) {
    const key = String(env[name] || "").trim();
    if (key.startsWith("pk_test_") || key.startsWith("pk_live_")) return key;
  }
  return "";
}

function supabaseHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Browser-visible settings. Stripe secrets and the service role key are omitted. */
export function publicRuntimeConfig(env = process.env) {
  const staging = isStagingApp(env);
  const supabaseUrl = resolveSupabaseUrl(env);
  return {
    supabaseUrl,
    supabaseAnonKey: resolveAnonKey(env),
    appEnv: appEnvName(env),
    staging,
    cryptoPay: !staging,
    gasRelayer: !staging,
    publicOrigin: configuredPublicOrigin(env),
    stripePublishableKey: publicStripePublishableKey(env),
    supabaseHost: supabaseHost(supabaseUrl),
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function runtimeConfigScript(env = process.env) {
  const json = JSON.stringify(publicRuntimeConfig(env)).replace(/</g, "\\u003c");
  return `<script>window.__OPENPAYWALL_CONFIG=${json};</script>`;
}

export function stagingBannerHtml(config) {
  const host = escapeHtml(config.supabaseHost || "");
  return (
    `<div id="openpaywall-staging-banner" role="status" data-supabase-host="${host}" ` +
    `style="position:sticky;top:0;z-index:2147483647;background:#fef3c7;color:#78350f;text-align:center;padding:10px 16px;font:600 14px/1.4 system-ui,sans-serif;border-bottom:1px solid #f59e0b">` +
    `Test site — fake payments` +
    `<span style="display:block;font-weight:500;font-size:12px">Data from ${host}</span>` +
    `</div>`
  );
}

/**
 * Inject the runtime config into an HTML document before CSP nonces are stamped.
 * The script is inline and has no src, so secureHtmlDocument can nonce it.
 * Staging also gets a noindex meta tag and the test-site banner.
 * @param {string} html
 * @param {NodeJS.ProcessEnv} [env]
 */
export function decorateHtmlDocument(html, env = process.env) {
  const config = publicRuntimeConfig(env);
  const script = runtimeConfigScript(env);
  const robots = config.staging ? `\n<meta name="robots" content="noindex, nofollow">` : "";
  const headInsert = `\n${script}${robots}`;
  let out = String(html);
  if (/<head\b[^>]*>/i.test(out)) {
    out = out.replace(/<head\b[^>]*>/i, (match) => `${match}${headInsert}`);
  } else {
    out = `${script}${robots}${out}`;
  }
  if (config.staging) {
    const banner = `\n${stagingBannerHtml(config)}`;
    if (/<body\b[^>]*>/i.test(out)) {
      out = out.replace(/<body\b[^>]*>/i, (match) => `${match}${banner}`);
    } else {
      out += banner;
    }
  }
  return out;
}

export const STAGING_ROBOTS_TXT = "User-agent: *\nDisallow: /\n";
