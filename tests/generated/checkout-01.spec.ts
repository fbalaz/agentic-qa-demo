// @requirement CHECKOUT-01@ac-v2
import { test, expect } from '@playwright/test';
import fixture from './data/checkout-01.json' with { type: 'json' };
import { createBasket, deleteBasket } from '../support/basket';

let basketId: string;
let url: string;

test.beforeEach(async ({ request }) => {
  ({ basketId, url } = await createBasket(request, fixture));
});

test.afterEach(async ({ request }) => {
  await deleteBasket(request, basketId, fixture.owner);
});

test('SAVE10 gives 10% off goods, shipping unchanged, total 95.00', async ({ page }) => {
  await page.goto(url);
  await page.getByTestId('coupon-input').fill('SAVE10');
  await page.getByTestId('apply-coupon').click();

  await expect(page.getByTestId('coupon-message')).toContainText('Coupon SAVE10 applied');
  await expect(page.getByTestId('shipping')).toHaveText('€5.00');
  await expect(page.getByTestId('order-total')).toHaveText('€95.00');
});
