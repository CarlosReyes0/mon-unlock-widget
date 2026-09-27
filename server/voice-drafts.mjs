/**
 * Optional writer voice drafts for /write.
 *
 * Learns tone from samples + notes, then returns 2–3 editable social posts
 * (especially X). Drafts only — this module never posts, schedules, or calls
 * the X write API. Autopost is explicitly out of scope.
 *
 * Env (first match wins for the key):
 *   VOICE_DRAFT_API_KEY     — preferred
 *   OPENAI_API_KEY          — OpenAI / OpenAI-compatible
 *   ANTHROPIC_API_KEY       — Anthropic
 *   VOICE_DRAFT_PROVIDER    — openai | anthropic (optional; auto-detected)
 *   VOICE_DRAFT_MODEL       — optional override
 *   VOICE_DRAFT_BASE_URL    — optional API origin (tests inject a mock here)
 *   VOICE_DRAFTS_VISIBLE    — set to true to show the /write panel. Unset hides it
 *                             and never calls the model.
 *
 * Publish / unlock must not call this module.
 */
export const MISSING_KEY_MESSAGE =
  "Voice drafts are off until an LLM key is set. Add VOICE_DRAFT_API_KEY on Railway (or OPENAI_API_KEY / ANTHROPIC_API_KEY). Drafts still never auto-post.";

export const DRAFTS_ONLY_MESSAGE =
  "Drafts only. Nothing posts from this page. Copy a card and send it yourself. Autopost is out of scope.";

export const HIDDEN_MESSAGE = "Voice drafts are hidden. Nothing posts from this page.";

/** Hidden unless explicitly turned on. A shared model key must not be reachable by default. */
export function voiceDraftsVisible(env = process.env) {
  const raw = String(env.VOICE_DRAFTS_VISIBLE || "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export const SYSTEM_PROMPT = `You draft social posts in the writer's voice for Open Paywall (@openpaywall).

DRAFTS ONLY. Never claim a post was published. Never instruct a tool to tweet, post, or schedule. A human will copy and send if they choose.

Write 2 or 3 posts for X (Twitter) that could promote the article or a Paywall unlock.
Match the writer's punctuation, energy, length, and quirks from the samples.
Do not add hashtags unless the samples use them.
Do not invent quotes, stats, or facts that are not in the article context.
Do not spam @openpaywall. Mention the URL at most once across the set if it helps.
Keep each post at or under 280 characters when you can.

Return JSON only:
{"drafts":[{"text":"..."},{"text":"..."}]}`;

const MAX_SAMPLES = 8;
const MAX_SAMPLE_CHARS = 500;
const MAX_NOTES = 1500;
const MAX_TITLE = 200;
const MAX_TEASER = 400;
const MAX_BODY = 800;
const MAX_URL = 500;
const FETCH_MS = 25_000;

function sendJson(res, status, body) {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
  });
  res.end(payload);
}

function readIncomingBody(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body_too_large"));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function failSoft(code, message, extra = {}) {
  return {
    ok: false,
    code,
    message,
    draftsOnly: true,
    autopost: false,
    ...extra,
  };
}

function clip(value, max) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

/** Split a Write body the same way the paywall fold does: --- or first paragraph. */
export function splitDraft(raw) {
  const text = String(raw || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) return { teaser: "", body: "" };
  const sep = text.search(/^---\s*$/m);
  if (sep >= 0) {
    const teaser = text.slice(0, sep).trim();
    const body = text
      .slice(sep)
      .replace(/^---\s*\n?/, "")
      .trim();
    if (teaser && body) return { teaser, body };
    if (body) return { teaser: body.slice(0, 280).trim(), body };
    return { teaser, body: teaser };
  }
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length >= 2) {
    return { teaser: paras[0], body: paras.slice(1).join("\n\n") };
  }
  const only = paras[0] || text;
  return {
    teaser: only.length <= 280 ? only : only.slice(0, 280).trim(),
    body: only,
  };
}

/** Accept a string, newline/--- separated blob, or array of sample posts. */
export function normalizeVoiceSamples(input) {
  let rows = [];
  if (Array.isArray(input)) {
    rows = input.map((row) => String(row || "").trim());
  } else {
    const text = String(input || "").replace(/\r\n/g, "\n").trim();
    if (!text) return [];
    if (/\n---+\n/.test(`\n${text}\n`)) {
      rows = text.split(/\n---+\n/);
    } else {
      rows = text.split(/\n\s*\n/);
    }
  }
  return rows
    .map((row) => clip(row, MAX_SAMPLE_CHARS))
    .filter(Boolean)
    .slice(0, MAX_SAMPLES);
}

export function assembleVoiceDraftPrompt({
  samples,
  notes,
  title,
  teaser,
  body,
  articleUrl,
} = {}) {
  const voice = normalizeVoiceSamples(samples);
  const voiceNotes = clip(notes, MAX_NOTES);
  const headline = clip(title, MAX_TITLE);
  const preview = clip(teaser, MAX_TEASER);
  const excerpt = clip(body, MAX_BODY);
  const url = clip(articleUrl, MAX_URL);

  const sampleBlock = voice.length
    ? voice.map((row, i) => `${i + 1}. ${row}`).join("\n\n")
    : "(none — match a clear, human writer voice; do not invent a persona)";

  const parts = [
    "Draft 2–3 X posts in this writer's voice. Output JSON only.",
    `Voice samples:\n${sampleBlock}`,
    voiceNotes ? `Voice notes from the writer:\n${voiceNotes}` : "",
    headline ? `Article title: ${headline}` : "",
    preview ? `Teaser (free preview):\n${preview}` : "",
    excerpt && excerpt !== preview ? `Body snippet:\n${excerpt}` : "",
    url ? `Article URL: ${url}` : "",
    "Remember: drafts only. Do not post.",
  ].filter(Boolean);

  return {
    system: SYSTEM_PROMPT,
    user: parts.join("\n\n"),
    sampleCount: voice.length,
    hasNotes: Boolean(voiceNotes),
    hasArticle: Boolean(headline || preview || url),
  };
}

function draftFromRow(row, index) {
  if (typeof row === "string") {
    const text = row.trim();
    return text ? { id: String(index + 1), text } : null;
  }
  if (!row || typeof row !== "object") return null;
  const text = String(row.text || row.post || row.body || row.content || "").trim();
  if (!text) return null;
  return { id: String(row.id || index + 1), text };
}

export function parseVoiceDrafts(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();

  const tryParse = (blob) => {
    try {
      return JSON.parse(blob);
    } catch {
      return null;
    }
  };

  let parsed = tryParse(candidate);
  if (!parsed) {
    const obj = candidate.match(/\{[\s\S]*\}/) || candidate.match(/\[[\s\S]*\]/);
    if (obj) parsed = tryParse(obj[0]);
  }

  if (parsed) {
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.drafts)
        ? parsed.drafts
        : parsed.text
          ? [parsed]
          : [];
    return rows.map(draftFromRow).filter(Boolean).slice(0, 3);
  }

  const numbered = candidate
    .split(/\n(?=\s*(?:\d+[.)]|[-*])\s+)/)
    .map((s) => s.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim())
    .filter(Boolean);
  if (numbered.length >= 2) {
    return numbered.slice(0, 3).map((row, i) => ({ id: String(i + 1), text: row }));
  }

  const blocks = candidate
    .split(/\n---+\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (blocks.length >= 2) {
    return blocks.slice(0, 3).map((row, i) => ({ id: String(i + 1), text: row }));
  }

  return [{ id: "1", text: candidate }];
}

export function resolveVoiceDraftConfig(env = process.env) {
  const apiKey = String(
    env.VOICE_DRAFT_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || ""
  ).trim();
  const explicit = String(env.VOICE_DRAFT_PROVIDER || "")
    .trim()
    .toLowerCase();
  let provider = "openai";
  if (explicit === "anthropic" || explicit === "openai") {
    provider = explicit;
  } else if (apiKey.startsWith("sk-ant-")) {
    provider = "anthropic";
  } else if (!env.VOICE_DRAFT_API_KEY && !env.OPENAI_API_KEY && env.ANTHROPIC_API_KEY) {
    provider = "anthropic";
  }

  const defaultModel = provider === "anthropic" ? "claude-3-5-haiku-latest" : "gpt-4o-mini";
  const model = String(env.VOICE_DRAFT_MODEL || "").trim() || defaultModel;
  const defaultBase =
    provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1";
  const baseUrl = String(env.VOICE_DRAFT_BASE_URL || "")
    .trim()
    .replace(/\/$/, "") || defaultBase;

  return {
    apiKey,
    provider,
    model,
    baseUrl,
    enabled: Boolean(apiKey),
  };
}

export function openaiChatUrl(baseUrl) {
  const base = String(baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

export function anthropicMessagesUrl(baseUrl) {
  const base = String(baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
  if (base.endsWith("/messages")) return base;
  if (base.endsWith("/v1")) return `${base}/messages`;
  return `${base}/v1/messages`;
}

export function voiceDraftPublicStatus(env = process.env) {
  const visible = voiceDraftsVisible(env);
  const cfg = resolveVoiceDraftConfig(env);
  if (!visible) {
    return {
      ok: true,
      enabled: false,
      visible: false,
      draftsOnly: true,
      autopost: false,
      reason: "hidden",
      message: HIDDEN_MESSAGE,
      provider: null,
      model: null,
      docs: "/VOICE_DRAFTS.md",
    };
  }
  return {
    ok: true,
    enabled: cfg.enabled,
    visible: true,
    draftsOnly: true,
    autopost: false,
    reason: cfg.enabled ? null : "missing_api_key",
    message: cfg.enabled
      ? DRAFTS_ONLY_MESSAGE
      : MISSING_KEY_MESSAGE,
    provider: cfg.enabled ? cfg.provider : null,
    model: cfg.enabled ? cfg.model : null,
    docs: "/VOICE_DRAFTS.md",
  };
}

function extractLlmText(provider, json) {
  if (!json || typeof json !== "object") return "";
  if (provider === "anthropic") {
    const blocks = Array.isArray(json.content) ? json.content : [];
    return blocks
      .map((block) => (block && block.type === "text" ? String(block.text || "") : ""))
      .join("\n")
      .trim();
  }
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  return String(choice?.message?.content || choice?.text || "").trim();
}

function buildLlmRequest(cfg, prompt) {
  if (cfg.provider === "anthropic") {
    return {
      url: anthropicMessagesUrl(cfg.baseUrl),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: cfg.model,
        max_tokens: 800,
        temperature: 0.7,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      },
    };
  }
  return {
    url: openaiChatUrl(cfg.baseUrl),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: {
      model: cfg.model,
      temperature: 0.7,
      max_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    },
  };
}

async function fetchJson(fetchImpl, url, init, timeoutMs = FETCH_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { res, text, json };
  } finally {
    clearTimeout(timer);
  }
}

export async function generateVoiceDrafts({
  samples,
  notes,
  title,
  teaser,
  body,
  articleUrl,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  if (!voiceDraftsVisible(env)) {
    return failSoft("hidden", HIDDEN_MESSAGE, { visible: false });
  }

  const cfg = resolveVoiceDraftConfig(env);
  if (!cfg.apiKey) {
    return failSoft("missing_api_key", MISSING_KEY_MESSAGE, { visible: true });
  }

  const split = splitDraft(body);
  const prompt = assembleVoiceDraftPrompt({
    samples,
    notes,
    title,
    teaser: teaser || split.teaser,
    body: split.body || body,
    articleUrl,
  });

  if (!prompt.sampleCount && !prompt.hasNotes && !prompt.hasArticle) {
    return failSoft(
      "need_context",
      "Paste a few sample posts or voice notes, and add a title or teaser. Nothing was posted."
    );
  }

  const request = buildLlmRequest(cfg, prompt);
  let remote;
  try {
    remote = await fetchJson(fetchImpl, request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
  } catch (e) {
    return failSoft(
      "llm_unreachable",
      "The draft model did not respond. Publish still works. Nothing was posted.",
      { error: e?.message || "fetch_failed" }
    );
  }

  if (!remote.res.ok) {
    return failSoft(
      "llm_error",
      "Could not draft posts right now. Publish still works. Nothing was posted.",
      { status: remote.res.status }
    );
  }

  const rawText = extractLlmText(cfg.provider, remote.json) || remote.text;
  const drafts = parseVoiceDrafts(rawText);
  if (!drafts.length) {
    return failSoft(
      "empty_drafts",
      "The model returned no drafts. Nothing was posted."
    );
  }

  return {
    ok: true,
    draftsOnly: true,
    autopost: false,
    message: DRAFTS_ONLY_MESSAGE,
    drafts,
    provider: cfg.provider,
    model: cfg.model,
  };
}

/**
 * Connect-style handler for production (`server/index.mjs`) and Vite `npm run dev`.
 * Returns true if the request was fully answered.
 */
export async function tryHandleVoiceDraftRequest(req, res) {
  const method = req.method || "GET";
  const pathOnly = String(req.url || "").split("?")[0];
  if (!pathOnly.startsWith("/api/voice-drafts")) return false;

  if (method === "OPTIONS") {
    sendJson(res, 204, {});
    return true;
  }

  if ((method === "GET" || method === "HEAD") && pathOnly === "/api/voice-drafts/status") {
    sendJson(res, 200, voiceDraftPublicStatus());
    return true;
  }

  if (method === "POST" && (pathOnly === "/api/voice-drafts" || pathOnly === "/api/voice-drafts/generate")) {
    let parsed = {};
    try {
      const raw = await readIncomingBody(req);
      parsed = raw ? JSON.parse(raw) : {};
    } catch (e) {
      sendJson(res, e?.message === "body_too_large" ? 413 : 400, {
        ok: false,
        code: "invalid_json",
        draftsOnly: true,
        autopost: false,
        message: "Could not read the voice draft request. Nothing was posted.",
      });
      return true;
    }
    try {
      const result = await generateVoiceDrafts({
        samples: parsed.samples ?? parsed.voiceSamples,
        notes: parsed.notes ?? parsed.voiceNotes,
        title: parsed.title,
        teaser: parsed.teaser,
        body: parsed.body,
        articleUrl: parsed.articleUrl || parsed.url,
      });
      sendJson(res, 200, result);
    } catch (e) {
      sendJson(
        res,
        200,
        failSoft("draft_failed", "Could not draft posts. Publish still works. Nothing was posted.", {
          error: e?.message || "draft_failed",
        })
      );
    }
    return true;
  }

  sendJson(res, 404, { ok: false, code: "not_found", draftsOnly: true, autopost: false });
  return true;
}
