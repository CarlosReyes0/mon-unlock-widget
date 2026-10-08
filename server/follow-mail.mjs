/**
 * Confirm + new-post email. The postal line is rendered only from config.
 * New-post sending is gated in follows.mjs (flag + POSTAL_ADDRESS).
 */
import { escapeHtml } from "./article-og.mjs";
import {
  emailFromAddress,
  postalAddress,
  publicOrigin,
  safeHeaderName,
  teaserForEmail,
  unsubscribeToken,
  usdPriceParts,
} from "./follow-core.mjs";

function escapeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function confirmEmail({ author, token, env }) {
  const origin = publicOrigin(env);
  const name = safeHeaderName(author, "this writer");
  const url = `${origin}/follow/confirm?t=${encodeURIComponent(token)}`;
  const postal = postalAddress(env);
  const subject = `Confirm you want ${name}'s new posts`;
  const text = [
    `Confirm you want ${name}'s new posts on Open Paywall.`,
    "",
    "Follow free. Pay only for what you read.",
    "",
    "Open this link, then click Confirm. Opening the link does not confirm by itself:",
    url,
    "",
    "The link expires in 48 hours.",
    "",
    `Free. ${name} will see your email. Unsubscribe anytime.`,
    postal ? `\n${postal}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
  const html = `<!doctype html>
<html><body style="font-family:Georgia,serif;color:#111827;line-height:1.5;">
  <p>Confirm you want <strong>${escapeHtml(name)}</strong>'s new posts on Open Paywall.</p>
  <p>Follow free. Pay only for what you read.</p>
  <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:0.7rem 1rem;border-radius:999px;">Confirm</a></p>
  <p style="font-size:0.9rem;color:#57534e;">The button opens a page where you confirm. Email scanners that only open the link will not subscribe you. The link expires in 48 hours.</p>
  <p style="font-size:0.9rem;color:#57534e;">Free. ${escapeHtml(name)} will see your email. Unsubscribe anytime.</p>
  ${postal ? `<p style="font-size:0.8rem;color:#78716c;">${escapeHtml(postal)}</p>` : ""}
</body></html>`;
  return {
    kind: "confirm",
    fromHeader: `"Open Paywall" <${emailFromAddress(env)}>`,
    to: null,
    subject,
    text,
    html,
    headers: {},
    replyTo: null,
  };
}

export function newPostEmail({ article, follow, env }) {
  const origin = publicOrigin(env);
  const author = safeHeaderName(article?.author, "A writer");
  const title = escapeText(article?.title) || "New post";
  const teaser = teaserForEmail(article?.teaser);
  const price = usdPriceParts(article);
  const slug = encodeURIComponent(article.article_id);
  const url = `${origin}/articles/${slug}?ref=follow&unlock=1`;
  const token = unsubscribeToken(follow.id, String(env.FOLLOW_TOKEN_SECRET || ""));
  const unsubUrl = `${origin}/api/follows/unsubscribe?t=${encodeURIComponent(token)}`;
  const postal = postalAddress(env);
  const fromAddr = emailFromAddress(env);
  const text = [
    author,
    "",
    title,
    "",
    teaser,
    "",
    price.line,
    "",
    `${price.button}`,
    url,
    "",
    `You're getting this because you followed ${author} on Open Paywall.`,
    `Unfollow ${author}: ${unsubUrl}`,
    `Stop all Open Paywall emails: ${unsubUrl}`,
    "",
    postal,
  ]
    .filter((line) => line !== undefined && line !== null)
    .join("\n");
  const html = `<!doctype html>
<html><body style="font-family:Georgia,serif;color:#111827;line-height:1.5;max-width:36rem;">
  <p style="margin:0 0 0.25rem;color:#57534e;">${escapeHtml(author)}</p>
  <h1 style="font-size:1.4rem;line-height:1.25;margin:0 0 0.75rem;">${escapeHtml(title)}</h1>
  ${teaser ? `<p>${escapeHtml(teaser)}</p>` : ""}
  <p><strong>${escapeHtml(price.line)}</strong></p>
  <p><a href="${escapeHtml(url)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:0.75rem 1.1rem;border-radius:999px;">${escapeHtml(price.button)}</a></p>
  <p style="font-size:0.85rem;color:#57534e;">You're getting this because you followed ${escapeHtml(author)} on Open Paywall.</p>
  <p style="font-size:0.85rem;"><a href="${escapeHtml(unsubUrl)}">Unfollow ${escapeHtml(author)}</a></p>
  <p style="font-size:0.85rem;"><a href="${escapeHtml(unsubUrl)}">Stop all Open Paywall emails</a></p>
  <p style="font-size:0.8rem;color:#78716c;">${escapeHtml(postal)}</p>
</body></html>`;
  const mailto = `mailto:unsubscribe@mail.openpaywall.app?subject=${encodeURIComponent("unsubscribe")}`;
  return {
    kind: "new_post",
    fromHeader: `"${author} via Open Paywall" <${fromAddr}>`,
    to: follow.follower_email,
    subject: title,
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>, <${mailto}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    idempotencyKey: `follow-${article.notificationId}-${follow.id}`,
    replyTo: null,
  };
}

/**
 * @param {object} message
 * @param {NodeJS.ProcessEnv} env
 */
export async function sendResendEmail(message, env) {
  const key = String(env?.RESEND_API_KEY || "").trim();
  if (!key) {
    const err = new Error("email_not_configured");
    err.code = "email_not_configured";
    err.status = 503;
    throw err;
  }
  const payload = {
    from: message.fromHeader,
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: message.headers || {},
  };
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (message.idempotencyKey) headers["Idempotency-Key"] = message.idempotencyKey;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const name = data?.name || data?.error || data?.message || `resend_${res.status}`;
    const err = new Error(String(name));
    err.code = String(name);
    err.status = res.status;
    throw err;
  }
  return { ok: true, id: data?.id || null };
}
