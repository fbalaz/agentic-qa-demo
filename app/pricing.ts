export type Basket = {
  items: { sku: string; name: string; priceEur: number }[];
  shippingEur: number;
  coupon: string | null;
};

export function formatEur(v: number): string {
  return `€${v.toFixed(2)}`;
}

// AC-1..AC-3 (specs/acceptance-criteria.md): the coupon discounts goods only, never shipping.
// Planted product bugs (the broken build):
//   "no-discount": the coupon is accepted but the discount is never subtracted (€105.00).
//   "shipping":    the discount is also taken off shipping, i.e. 10% of the whole order (€94.50).
//                  Plausible from the user story wording, wrong per AC-3.
export type Bug = "none" | "no-discount" | "shipping";
export function pricing(b: Basket, coupons: Record<string, { percentOffGoods: number }>, bug: Bug) {
  const goodsEur = b.items.reduce((s, i) => s + i.priceEur, 0);
  const coupon = b.coupon ? coupons[b.coupon] : undefined;
  const base = bug === "shipping" ? goodsEur + b.shippingEur : goodsEur;
  const discountEur = coupon ? Math.round(base * coupon.percentOffGoods) / 100 : 0;
  const appliedDiscount = bug === "no-discount" ? 0 : discountEur;
  return {
    goodsEur,
    discountEur,
    discountShown: appliedDiscount > 0,
    totalEur: goodsEur - appliedDiscount + b.shippingEur,
  };
}
