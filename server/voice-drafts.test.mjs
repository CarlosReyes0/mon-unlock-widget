import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DRAFTS_ONLY_MESSAGE,
  MISSING_KEY_MESSAGE,
  SYSTEM_PROMPT,
  anthropicMessagesUrl,
  assembleVoiceDraftPrompt,
  generateVoiceDrafts,
  normalizeVoiceSamples,
  openaiChatUrl,
  parseVoiceDrafts,
  resolveVoiceDraftConfig,
  splitDraft,
  voiceDraftPublicStatus,
  voiceDraftsVisible,
} from "./voice-drafts.mjs";

const KEYS = [
  "VOICE_DRAFT_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "VOICE_DRAFT_PROVIDER",
  "VOICE_DRAFT_MODEL",
  "VOICE_DRAFT_BASE_URL",
];
const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

test.afterEach(() => {
  for (const k of KEYS) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
});

test("normalizeVoiceSamples splits --- or blank lines and caps length", () => {
  assert.deepEqual(normalizeVoiceSamples(""), []);
  assert.deepEqual(normalizeVoiceSamples(["  one  ", "", "two"]), ["one", "two"]);
  const split = normalizeVoiceSamples("First post\n\nSecond post");
  assert.deepEqual(split, ["First post", "Second post"]);
  const dashed = normalizeVoiceSamples("A\n---\nB\n---\nC");
  assert.deepEqual(dashed, ["A", "B", "C"]);
  const long = "x".repeat(600);
  assert.equal(normalizeVoiceSamples([long])[0].endsWith("…"), true);
  assert.ok(normalizeVoiceSamples([long])[0].length <= 501);
  const many = Array.from({ length: 12 }, (_, i) => `post ${i + 1}`);
  assert.equal(normalizeVoiceSamples(many).length, 8);
});

test("splitDraft respects --- fold like Write", () => {
  const split = splitDraft("Free teaser\n---\nPaid body here");
  assert.equal(split.teaser, "Free teaser");
  assert.equal(split.body, "Paid body here");
});

test("assembleVoiceDraftPrompt includes samples, notes, article, and drafts-only", () => {
  const prompt = assembleVoiceDraftPrompt({
    samples: ["Walking home in the rain. That's the post.", "Unlock if you want the rest."],
    notes: "Short. Dry. No hype.",
    title: "July rain walk",
    teaser: "Walking home in the rain.",
    body: "The rest of the piece continues after the fold.",
    articleUrl: "https://mon-unlock-widget-production.up.railway.app/articles/july-rain-walk",
  });
  assert.match(prompt.system, /DRAFTS ONLY/i);
  assert.match(prompt.system, /Never claim a post was published/i);
  assert.doesNotMatch(prompt.system, /call the X API|POST \/2\/tweets|auto-post/i);
  assert.match(prompt.user, /Walking home in the rain/);
  assert.match(prompt.user, /Short\. Dry/);
  assert.match(prompt.user, /July rain walk/);
  assert.match(prompt.user, /articles\/july-rain-walk/);
  assert.match(prompt.user, /do not post/i);
  assert.equal(prompt.sampleCount, 2);
  assert.equal(prompt.hasNotes, true);
  assert.equal(prompt.hasArticle, true);
  assert.equal(prompt.system, SYSTEM_PROMPT);
});

test("parseVoiceDrafts reads JSON, fenced JSON, and numbered fallback", () => {
  const json = parseVoiceDrafts(
    JSON.stringify({ drafts: [{ text: "One" }, { text: "Two" }, { text: "Three" }, { text: "Four" }] })
  );
  assert.equal(json.length, 3);
  assert.equal(json[0].text, "One");

  const fenced = parseVoiceDrafts('Sure.\n```json\n{"drafts":[{"text":"Alpha"},{"text":"Beta"}]}\n```');
  assert.equal(fenced.length, 2);
  assert.equal(fenced[1].text, "Beta");

  const numbered = parseVoiceDrafts("1. First draft\n2. Second draft\n3. Third draft");
  assert.equal(numbered.length, 3);
  assert.equal(numbered[0].text, "First draft");
});

test("resolveVoiceDraftConfig prefers VOICE_DRAFT_API_KEY and detects Anthropic", () => {
  const openai = resolveVoiceDraftConfig({
    VOICE_DRAFT_API_KEY: "sk-test",
  });
  assert.equal(openai.enabled, true);
  assert.equal(openai.provider, "openai");
  assert.equal(openai.model, "gpt-4o-mini");

  const ant = resolveVoiceDraftConfig({
    ANTHROPIC_API_KEY: "sk-ant-test",
  });
  assert.equal(ant.provider, "anthropic");
  assert.equal(ant.model, "claude-3-5-haiku-latest");

  const empty = resolveVoiceDraftConfig({});
  assert.equal(empty.enabled, false);
  assert.equal(empty.apiKey, "");
});

test("chat URL helpers do not double the path", () => {
  assert.equal(openaiChatUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
  assert.equal(
    openaiChatUrl("http://127.0.0.1:9/v1/chat/completions"),
    "http://127.0.0.1:9/v1/chat/completions"
  );
  assert.equal(anthropicMessagesUrl("https://api.anthropic.com"), "https://api.anthropic.com/v1/messages");
  assert.equal(
    anthropicMessagesUrl("https://api.anthropic.com/v1/messages"),
    "https://api.anthropic.com/v1/messages"
  );
});

test("status never leaks a key and flags drafts-only", () => {
  const hidden = voiceDraftPublicStatus({ VOICE_DRAFT_API_KEY: "sk-secret-value-do-not-leak" });
  assert.equal(hidden.visible, false);
  assert.equal(hidden.enabled, false);
  assert.equal(hidden.reason, "hidden");
  assert.equal(JSON.stringify(hidden).includes("sk-secret-value-do-not-leak"), false);
  assert.equal(voiceDraftsVisible({}), false);
  assert.equal(voiceDraftsVisible({ VOICE_DRAFTS_VISIBLE: "true" }), true);

  const off = voiceDraftPublicStatus({ VOICE_DRAFTS_VISIBLE: "true" });
  assert.equal(off.enabled, false);
  assert.equal(off.visible, true);
  assert.equal(off.autopost, false);
  assert.equal(off.draftsOnly, true);
  assert.match(off.message, /VOICE_DRAFT_API_KEY/);
  assert.equal(off.provider, null);

  const on = voiceDraftPublicStatus({
    VOICE_DRAFTS_VISIBLE: "true",
    VOICE_DRAFT_API_KEY: "sk-secret-value-do-not-leak",
  });
  assert.equal(on.enabled, true);
  assert.equal(on.visible, true);
  assert.equal(JSON.stringify(on).includes("sk-secret-value-do-not-leak"), false);
  assert.equal(on.autopost, false);
  assert.match(on.message, /Drafts only/i);
});

test("hidden drafts never call the model, even with a key", async () => {
  let called = 0;
  const out = await generateVoiceDrafts({
    samples: ["A sample post."],
    title: "Hello",
    env: { VOICE_DRAFT_API_KEY: "sk-test" },
    fetchImpl: async () => {
      called += 1;
      throw new Error("should not fetch");
    },
  });
  assert.equal(called, 0);
  assert.equal(out.ok, false);
  assert.equal(out.code, "hidden");
  assert.equal(out.visible, false);
  assert.equal(out.autopost, false);
});

test("missing key fails soft without calling the LLM", async () => {
  let called = 0;
  const out = await generateVoiceDrafts({
    samples: ["A sample post."],
    title: "Hello",
    env: { VOICE_DRAFTS_VISIBLE: "true" },
    fetchImpl: async () => {
      called += 1;
      throw new Error("should not fetch");
    },
  });
  assert.equal(called, 0);
  assert.equal(out.ok, false);
  assert.equal(out.code, "missing_api_key");
  assert.equal(out.autopost, false);
  assert.match(out.message, /VOICE_DRAFT_API_KEY/);
  assert.match(MISSING_KEY_MESSAGE, /never auto-post/i);
});

test("mocked OpenAI returns 2–3 editable drafts and never posts", async () => {
  const seen = [];
  const out = await generateVoiceDrafts({
    samples: ["Walking home in the rain. That's the post."],
    notes: "Dry. Short.",
    title: "July rain walk",
    body: "Walking home in the rain.\n---\nPaid rest.",
    articleUrl: "https://example.com/articles/july-rain-walk",
    env: {
      VOICE_DRAFTS_VISIBLE: "true",
      VOICE_DRAFT_API_KEY: "sk-test",
      VOICE_DRAFT_BASE_URL: "http://llm.test/v1",
    },
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    drafts: [
                      { text: "Walking home in the rain — rest is behind the fold." },
                      { text: "July rain walk is up. Fifty cents if you want the rest." },
                      { text: "If this landed, the rest is on Open Paywall." },
                    ],
                  }),
                },
              },
            ],
          }),
      };
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.draftsOnly, true);
  assert.equal(out.autopost, false);
  assert.equal(out.drafts.length, 3);
  assert.match(out.drafts[0].text, /Walking home/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "http://llm.test/v1/chat/completions");
  assert.equal(seen[0].auth, "Bearer sk-test");
  assert.match(seen[0].body.messages[0].content, /DRAFTS ONLY/i);
  assert.match(seen[0].body.messages[1].content, /Dry\. Short/);
  assert.match(DRAFTS_ONLY_MESSAGE, /Nothing posts/);
});

test("mocked Anthropic path extracts text blocks", async () => {
  const out = await generateVoiceDrafts({
    samples: ["one liner"],
    title: "Hi",
    env: {
      VOICE_DRAFTS_VISIBLE: "true",
      ANTHROPIC_API_KEY: "sk-ant-test",
      VOICE_DRAFT_BASE_URL: "http://llm.test",
    },
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "http://llm.test/v1/messages");
      assert.equal(init.headers["x-api-key"], "sk-ant-test");
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            content: [{ type: "text", text: '{"drafts":[{"text":"A"},{"text":"B"}]}' }],
          }),
      };
    },
  });
  assert.equal(out.ok, true);
  assert.equal(out.provider, "anthropic");
  assert.equal(out.drafts.length, 2);
});

test("LLM 500 fails soft and does not look like a post", async () => {
  const out = await generateVoiceDrafts({
    samples: ["sample"],
    title: "Hi",
    env: {
      VOICE_DRAFTS_VISIBLE: "true",
      VOICE_DRAFT_API_KEY: "sk-test",
      VOICE_DRAFT_BASE_URL: "http://llm.test/v1",
    },
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: "boom" }),
    }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, "llm_error");
  assert.equal(out.autopost, false);
  assert.match(out.message, /Nothing was posted/);
});
