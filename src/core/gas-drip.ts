/** What checkout should do when POST /api/relay/gas cannot drip. */

export function gasDripNeedsCardFallback(status: number): boolean {
  return status === 429 || status === 503;
}

/** Short copy shown above Apple Pay, Google Pay, and card. */
export function gasDripFallbackCopy(status: number): string {
  if (status === 429) {
    return "Free network gas is used up for today. Pay with Apple Pay, Google Pay, or card.";
  }
  return "Network gas isn't available right now. Pay with Apple Pay, Google Pay, or card.";
}
