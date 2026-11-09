// Tiny checkout app used as the "product under test".
//   PORT=3000 tsx app/server.ts                  -> correct build
//   DISCOUNT_BUG=1 PORT=3001 tsx app/server.ts          -> broken build: coupon is accepted, total does not change (€105.00)
//   DISCOUNT_BUG=shipping PORT=3001 tsx app/server.ts   -> broken build: the discount also covers shipping (€94.50)
import http from "node:http";
import { pricing, formatEur, type Basket, type Bug } from "./pricing.js";

const PORT = Number(process.env.PORT ?? 3000);
const RAW_BUG = process.env.DISCOUNT_BUG ?? "0";
const BUG: Bug = RAW_BUG === "shipping" ? "shipping" : RAW_BUG === "0" || RAW_BUG === "" ? "none" : "no-discount";
const BUILD = BUG === "none" ? "correct" : "broken";

const COUPONS: Record<string, { percentOffGoods: number }> = { SAVE10: { percentOffGoods: 10 } };

// Seeded demo basket so the page works without the Test Data Agent.
const baskets = new Map<string, Basket & { owner: string }>([
  ["demo", { owner: "seed", items: [{ sku: "HEADPHONES", name: "Headphones", priceEur: 100 }], shippingEur: 5, coupon: null }],
]);
let nextId = 1;

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function cartPage(id: string, b: Basket): string {
  const p = pricing(b, COUPONS, BUG);
  const rows = b.items
    .map((i) => `<tr><td>${i.name}</td><td class="num">${formatEur(i.priceEur)}</td></tr>`)
    .join("");
  const discountRow = p.discountShown
    ? `<tr><td>Discount (${b.coupon})</td><td class="num" data-testid="discount">-${formatEur(p.discountEur)}</td></tr>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Checkout</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;color:#1f2937}
 table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #e5e7eb}
 .num{text-align:right}.total td{font-weight:700;font-size:1.2em;border:none}
 form{display:flex;gap:8px;margin:20px 0}input{flex:1;padding:8px}button{padding:8px 16px}
 .msg{color:#047857}.err{color:#b91c1c}
</style></head><body>
<h1>Your basket</h1>
<table>
 ${rows}
 <tr><td>Subtotal</td><td class="num" data-testid="goods-total">${formatEur(p.goodsEur)}</td></tr>
 ${discountRow}
 <tr><td>Shipping</td><td class="num" data-testid="shipping">${formatEur(b.shippingEur)}</td></tr>
 <tr class="total"><td>Total</td><td class="num" data-testid="order-total">${formatEur(p.totalEur)}</td></tr>
</table>
<form method="post" action="/cart/${id}/coupon">
 <input name="code" data-testid="coupon-input" placeholder="Coupon code" aria-label="Coupon code">
 <button type="submit" data-testid="apply-coupon">Apply</button>
</form>
${b.coupon ? `<p class="msg" data-testid="coupon-message">Coupon ${b.coupon} applied</p>` : ""}

</body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const parts = url.pathname.split("/").filter(Boolean);

    // The build name is only for the demo harness (orchestrator/apps.ts). Agents must not learn which build they test.
    if (url.pathname === "/health") return json(res, 200, req.headers["x-demo-harness"] === "1" ? { ok: true, build: BUILD } : { ok: true });

    // Test data API (sandbox). Each basket has an owner; only the owner may delete it.
    if (url.pathname === "/api/test-data/baskets" && req.method === "POST") {
      const body = await readBody(req);
      const id = `t${nextId++}`;
      baskets.set(id, { owner: String(body.owner ?? "unknown"), items: body.items ?? [], shippingEur: Number(body.shippingEur ?? 0), coupon: null });
      return json(res, 201, { basketId: id, url: `/cart/${id}` });
    }
    if (parts[0] === "api" && parts[1] === "test-data" && parts[2] === "baskets" && parts[3] && req.method === "DELETE") {
      const b = baskets.get(parts[3]);
      if (!b) return json(res, 404, { error: "not found" });
      if (b.owner !== url.searchParams.get("owner")) return json(res, 403, { error: "basket belongs to another owner" });
      baskets.delete(parts[3]);
      return json(res, 200, { deleted: parts[3] });
    }
    if (url.pathname === "/api/test-data/reset" && req.method === "POST") {
      for (const [id, b] of baskets) if (b.owner !== "seed") baskets.delete(id);
      for (const b of baskets.values()) b.coupon = null;
      return json(res, 200, { reset: true });
    }

    // Shop UI
    if (parts[0] === "cart" && parts[1]) {
      const b = baskets.get(parts[1]);
      if (!b) { res.writeHead(404); return res.end("Basket not found"); }
      if (parts[2] === "coupon" && req.method === "POST") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const code = new URLSearchParams(raw).get("code")?.trim().toUpperCase() ?? "";
        if (COUPONS[code]) b.coupon = code;
        res.writeHead(303, { location: `/cart/${parts[1]}` });
        return res.end();
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(cartPage(parts[1], b));
    }
    if (url.pathname === "/") { res.writeHead(302, { location: "/cart/demo" }); return res.end(); }

    res.writeHead(404);
    res.end("Not found");
  } catch (e) {
    json(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => console.log(`checkout app (${BUILD} build) on http://localhost:${PORT}`));
