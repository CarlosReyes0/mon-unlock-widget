/**
 * Pure policy for slug / article-id reservation (mirrors Supabase register-article).
 * Article IDs are globally unique across publishers.
 */

export const REGISTRATION_STATUS = {
  reserved: "reserved",
  registered: "registered",
};

/**
 * @param {{
 *   existing: null | {
 *     publisher?: string | null,
 *     article_id?: string | null,
 *     article_id_hash?: string | null,
 *     registration_status?: string | null,
 *   },
 *   publisher: string,
 *   slug?: string,
 * }} input
 * @returns {{ ok: true, action: 'insert' | 'update' } | { ok: false, error: 'slug_taken', status: 409, publisher: string }}
 */
export function evaluateArticleReserve({ existing, publisher }) {
  const nextPublisher = String(publisher || "").trim().toLowerCase();
  if (!nextPublisher.startsWith("0x") || nextPublisher.length !== 42) {
    return { ok: false, error: "invalid_publisher", status: 400 };
  }

  if (!existing) {
    return { ok: true, action: "insert" };
  }

  const owner = String(existing.publisher || "").trim().toLowerCase();
  if (owner && owner !== nextPublisher) {
    return {
      ok: false,
      error: "slug_taken",
      status: 409,
      publisher: owner,
    };
  }

  return { ok: true, action: "update" };
}

/**
 * Build the row fields for a reserve / confirm write.
 * @param {{
 *   slug: string,
 *   articleIdHash: string,
 *   priceWei: string | number | bigint,
 *   publisher: string,
 *   teaser?: string | null,
 *   body?: string | null,
 *   confirmRegistered?: boolean,
 *   existingStatus?: string | null,
 * }} input
 */
export function buildArticleReserveRow(input) {
  const publisher = String(input.publisher || "").trim().toLowerCase();
  const priceWeiStr =
    typeof input.priceWei === "string" ? input.priceWei : String(input.priceWei);
  const confirm = Boolean(input.confirmRegistered);
  const prior = input.existingStatus || REGISTRATION_STATUS.reserved;
  const registration_status = confirm
    ? REGISTRATION_STATUS.registered
    : prior === REGISTRATION_STATUS.registered
      ? REGISTRATION_STATUS.registered
      : REGISTRATION_STATUS.reserved;

  return {
    article_id: String(input.slug || "").trim(),
    article_id_hash: String(input.articleIdHash || "").trim(),
    publisher,
    price_wei: priceWeiStr,
    teaser: input.teaser || null,
    body: input.body || null,
    active: true,
    registration_status,
    updated_at: new Date().toISOString(),
  };
}
