/**
 * Browser view of the config the server injects as window.__OPENPAYWALL_CONFIG.
 * When that object is missing, every value falls back to production.
 * The embeddable widget uses widgetSupabaseTarget so a third-party page
 * cannot retarget the production script at another database.
 */
import { SUPABASE_ANON_KEY } from "./publish-auth.js";

export const PROD_SUPABASE_PROJECT_REF = "flczjqljgntmkanipugo";
export const PROD_SUPABASE_URL = `https://${PROD_SUPABASE_PROJECT_REF}.supabase.co`;

export type OpenPaywallRuntimeConfig = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  appEnv?: string;
  staging?: boolean;
  cryptoPay?: boolean;
  gasRelayer?: boolean;
  publicOrigin?: string;
  stripePublishableKey?: string;
  supabaseHost?: string;
};

declare global {
  interface Window {
    __OPENPAYWALL_CONFIG?: OpenPaywallRuntimeConfig;
  }
}

export type ResolvedRuntimeConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appEnv: string;
  staging: boolean;
  cryptoPay: boolean;
  gasRelayer: boolean;
  publicOrigin: string;
  stripePublishableKey: string;
  supabaseHost: string;
};

function readRawConfig(): OpenPaywallRuntimeConfig {
  const scope = globalThis as {
    window?: { __OPENPAYWALL_CONFIG?: OpenPaywallRuntimeConfig };
  };
  return scope.window?.__OPENPAYWALL_CONFIG || {};
}

export function readRuntimeConfig(): ResolvedRuntimeConfig {
  const raw = readRawConfig();
  const supabaseUrl = String(raw.supabaseUrl || "").trim().replace(/\/$/, "") || PROD_SUPABASE_URL;
  const supabaseAnonKey = String(raw.supabaseAnonKey || "").trim() || SUPABASE_ANON_KEY;
  const appEnv = String(raw.appEnv || "").trim().toLowerCase();
  const staging = raw.staging === true || appEnv === "staging" || appEnv === "preview";
  const runtimeStripe = String(raw.stripePublishableKey || "").trim();
  const stripePublishableKey = staging && runtimeStripe.startsWith("pk_live_") ? "" : runtimeStripe;
  return {
    supabaseUrl,
    supabaseAnonKey,
    appEnv: staging ? appEnv || "staging" : "production",
    staging,
    cryptoPay: staging ? false : raw.cryptoPay !== false,
    gasRelayer: staging ? false : raw.gasRelayer !== false,
    publicOrigin: String(raw.publicOrigin || "").trim().replace(/\/$/, ""),
    stripePublishableKey,
    supabaseHost: String(raw.supabaseHost || "").trim(),
  };
}

export function supabaseProjectUrl(): string {
  return readRuntimeConfig().supabaseUrl;
}

export function registerArticleUrl(): string {
  return `${supabaseProjectUrl()}/functions/v1/register-article`;
}

export type WidgetSupabaseTarget = {
  functionsBase: string;
  anonKey: string;
  hideCrypto: boolean;
};

/**
 * Third-party embeds load the widget from openpaywall.app onto another origin.
 * Those pages keep the production Edge Function even if they define
 * window.__OPENPAYWALL_CONFIG. Hosted pages (script origin equals the page)
 * may point at the Supabase project the server injected.
 */
export function widgetSupabaseTarget(input: {
  pageOrigin?: string;
  scriptSrc?: string;
  config?: OpenPaywallRuntimeConfig | null;
}): WidgetSupabaseTarget {
  const prod: WidgetSupabaseTarget = {
    functionsBase: `${PROD_SUPABASE_URL}/functions/v1`,
    anonKey: SUPABASE_ANON_KEY,
    hideCrypto: false,
  };
  const cfg = input.config;
  if (!cfg) return prod;
  const pageOrigin = String(input.pageOrigin || "").trim();
  const scriptSrc = String(input.scriptSrc || "").trim();
  if (!pageOrigin || !scriptSrc) return prod;
  let scriptOrigin = "";
  try {
    scriptOrigin = new URL(scriptSrc, pageOrigin).origin;
  } catch {
    return prod;
  }
  if (scriptOrigin !== pageOrigin) return prod;
  const supabaseUrl = String(cfg.supabaseUrl || "").trim().replace(/\/$/, "");
  const anonKey = String(cfg.supabaseAnonKey || "").trim();
  if (!supabaseUrl || !anonKey) return prod;
  const appEnv = String(cfg.appEnv || "").trim().toLowerCase();
  const staging = cfg.staging === true || appEnv === "staging" || appEnv === "preview";
  return {
    functionsBase: `${supabaseUrl}/functions/v1`,
    anonKey,
    hideCrypto: staging || cfg.cryptoPay === false,
  };
}
