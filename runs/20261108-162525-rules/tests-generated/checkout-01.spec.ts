// @requirement CHECKOUT-01@ac-v2
import { test, expect } from '@playwright/test';
import fixture from './data/checkout-01.json' with { type: 'json' };
import { createBasket, deleteBasket } from '../support/basket';

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

test('SAVE10 gives 10% off goods; shipping stays; total 95', async ({ page }) => {
  await page.goto(url);
  await page.getByTestId('coupon-input').fill('SAVE10');
  await page.getByTestId('apply-coupon').click();
  await expect(page.getByText('Coupon SAVE10 applied')).toBeVisible();
  await expect(page.getByTestId('goods-total')).toContainText('90.00');
  await expect(page.getByTestId('shipping')).toContainText('5.00');
  await expect(page.getByTestId('order-total')).toHaveText('€95.00');
});
