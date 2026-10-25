import { TIER_LABEL, type Tier } from "@/lib/subjects";

/** Silver / Gold / Platinum label for a subject score (the drawn badges come with the PDF stage). */
export default function TierBadge({ tier }: { tier: Tier | null }) {
  if (!tier) return <span className="pill">No badge</span>;
  return <span className={`tier tier-${tier.toLowerCase()}`} data-testid="tier">{TIER_LABEL[tier]}</span>;
}
