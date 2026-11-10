import { test, expect } from "@playwright/test";
import fixture from "./data/checkout-01-save10.json" with { type: "json" };
import { createBasket, deleteBasket, type BasketFixture } from "../support/basket";

// CHECKOUT-01: SAVE10 gives 10% off goods only; shipping is never discounted.
// Example basket: headphones EUR 100 goods, EUR 5 shipping.
// Expected after SAVE10: goods EUR 90.00, shipping EUR 5.00, total EUR 95.00.

const basketFixture = fixture as BasketFixture;

test.describe("CHECKOUT-01 SAVE10 coupon", () => {
  let basketId: string;
  let basketUrl: string;

  test.beforeEach(async ({ request }) => {
    const basket = await createBasket(request, basketFixture);
    basketId = basket.basketId;
    basketUrl = basket.url;
  });

  test.afterEach(async ({ request }) => {
    if (basketId) {
      await deleteBasket(request, basketId, basketFixture.owner);
    }
  });

  test("AC-1/AC-2/AC-3: SAVE10 shows confirmation and reduces goods by 10% only", async ({ page }) => {
    await page.goto(basketUrl);

    // Before applying the code: no discount.
    await expect(page.getByTestId("order-total")).toHaveText("€105.00");

    await page.getByTestId("coupon-input").fill("SAVE10");
    await page.getByTestId("apply-coupon").click();

    // AC-1: confirmation message is shown with exact text.
    await expect(page.getByText("Coupon SAVE10 applied", { exact: true })).toBeVisible();

    // AC-2: 10% off goods (EUR 100 -> EUR 90).
    await expect(page.getByTestId("goods-total")).toHaveText("€90.00");

    // AC-3: shipping is not discounted and the total is EUR 95.00.
    await expect(page.getByTestId("shipping")).toHaveText("€5.00");
    await expect(page.getByTestId("order-total")).toHaveText("€95.00");
  });
});
