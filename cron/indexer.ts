// cron/indexer.ts
// Scheduled job that triggers the Supabase Edge Function "indexer".
// Deploy this as a Railway cron service.

const SUPABASE_URL = "https://flczjqljgntmkanipugo.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsY3pqcWxqZ250bWthbmlwdWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MTUwNjQsImV4cCI6MjA5NzQ5MTA2NH0.ZKcFJ_4ZI4oK4hyZtR72vqC_JCdwttZSQQw82uTMEb4";
const INDEXER_SECRET = (Deno.env.get("INDEXER_SECRET") || "").trim();

async function triggerIndexer() {
  if (!INDEXER_SECRET) {
    console.error("[indexer] INDEXER_SECRET is not set — refusing to call the edge function");
    Deno.exit(1);
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/indexer`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "x-indexer-secret": INDEXER_SECRET,
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();
  console.log(`[indexer] ${res.status} — ${text}`);
}

triggerIndexer();