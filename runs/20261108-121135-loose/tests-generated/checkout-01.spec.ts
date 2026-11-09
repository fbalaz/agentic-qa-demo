import { test, expect } from '@playwright/test';
import headphones from './data/checkout-01-headphones.json' with { type: 'json' };
import small from './data/checkout-01-small-basket.json' with { type: 'json' };
import { createBasket, deleteBasket } from '../support/basket';

for (const [label, fixture, total] of [
  ['headphones basket', headphones, '€95.00'],
  ['small basket', small, '€50.00'],
] as const) {
  test.describe(label, () => {
    let basketId = '';
    let url = '';
    test.beforeEach(async ({ request }) => {
      const b = await createBasket(request, fixture);
      basketId = b.basketId;
      url = b.url;
    });
    test.afterEach(async ({ request }) => {
      await deleteBasket(request, basketId, fixture.owner);
    });

    test(`SAVE10 applies 10% to goods only (${label})`, async ({ page }) => {
      await page.goto(url);
      await page.getByTestId('coupon-input').fill('SAVE10');
      await page.getByTestId('apply-coupon').click();
      await expect(page.getByText('Coupon SAVE10 applied')).toBeVisible();
      await expect(page.getByTestId('shipping')).toHaveText('€5.00');
      await expect(page.getByTestId('order-total')).toHaveText(total);
    });
  });
}
