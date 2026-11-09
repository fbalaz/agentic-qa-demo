// Helper the generated tests use to create their own test data from a fixture written by the
// Test Data Agent (tests/generated/data/*.json), and to clean it up afterwards.
import type { APIRequestContext } from "@playwright/test";

export type BasketFixture = {
  owner: string;
  items: { sku: string; name: string; priceEur: number }[];
  shippingEur: number;
};

export async function createBasket(request: APIRequestContext, fixture: BasketFixture): Promise<{ basketId: string; url: string }> {
  const res = await request.post("/api/test-data/baskets", { data: fixture });
  if (!res.ok()) throw new Error(`could not create basket: ${res.status()}`);
  return res.json();
}

export async function deleteBasket(request: APIRequestContext, basketId: string, owner: string): Promise<void> {
  await request.delete(`/api/test-data/baskets/${basketId}?owner=${encodeURIComponent(owner)}`);
}
