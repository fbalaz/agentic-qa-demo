> **Poznámka (2. 11.):** dema na pódiu idú z videí vložených v Keynote. Tento runbook použi pri **nahrávaní videí** (kapitola 8 v `priprava-na-prednasku.md`), nie na pódiu.

# Postup na pódiu

## Týždne pred konferenciou

1. `npm install` a `npx playwright install chromium`.
2. Skopíruj `.env.example` do `.env` a vlož `ANTHROPIC_API_KEY` z console.anthropic.com (alebo sa prihlás cez `ant auth login`).
3. Skús jeden živý beh každej konfigurácie: `npm run measure -- --runs 1`.
4. Ak to funguje, spusti merania pre slidy: `npm run measure -- --runs 10`. Čísla z tabuľky daj na slide 8 a 14 a povedz, z koľkých behov sú.
5. Vyber jeden reálny beh voľného tímu, v ktorom agent zmenil test na €105.00, a jeden beh tímu s pravidlami. Ich priečinky v `runs/` si zálohuj, sú to tvoje dema.
6. Ak voľný tím chybu v niektorých behoch sám zachytí, je to v poriadku. Povedz to na pódiu.

## Pred prednáškou

```bash
npm run reset
npm run viewer          # nechaj bežať, otvor http://localhost:4000
npm run app             # :3000 správna verzia
npm run app:bug         # :3001 chybná verzia
```

Otvor si okná vopred: prehliadač s viewerom, prehliadač s `localhost:3001/cart/demo`, terminál s veľkým písmom. Vypni notifikácie.

## Počas prednášky

| Slide | Čo spraviť |
|---|---|
| 4 Demo 1 | `npm run replay -- runs/<tvoj-beh-loose> --pace 1`, potom vo vieweri vyber nový beh a daj Play (2×). |
| 5 What did we just fix | V termináli spusti testy z behu na oboch verziách (príkazy nižšie). Na chybnej prejdú, na správnej zlyhajú. |
| 6 Assumption laundering | Samostatný experiment bez akceptačných kritérií. Vo vieweri vyber svoj beh `loose-no-ac` a potom `rules-no-ac` (zastaví sa a pýta sa človeka). Povedz, že nejde o hlavné demo. |
| 8 The bill | Vo vieweri ukáž dlaždice tokenov a žlté „re-read“ a „re-run“ na časovej osi. |
| 11 Permissions | Vo vieweri pri behu s pravidlami ukáž „🔒 denied“ v riadku Execution. |
| 12 Quality gates | `npm run gate:sensitivity` naživo (pred tým skopíruj testy z behu s pravidlami do `tests/generated`). |
| 13 Demo 2 | `npm run replay -- runs/<tvoj-beh-rules> --pace 1`, vo vieweri Play, na konci sa spýtaj publika a klikni „Bug in product“. |
| 14 Observe | Vo vieweri vyber v „compare with“ beh voľného tímu. Ukáže sa tabuľka porovnania. |

Testy z behu na oboch verziách (slide 5):

```bash
cp -r runs/<beh>/tests-generated/* tests/generated/
BASE_URL=http://localhost:3001 npx playwright test   # chybná verzia: prejde
BASE_URL=http://localhost:3000 npx playwright test   # správna verzia: zlyhá
```

## Záloha

Ak nefunguje nič s modelom ani sieťou: `npm run replay -- scripted-loose` a `npm run replay -- scripted-rules`. Viewer ich označí ako „SCRIPTED REHEARSAL · NOT A MODEL RUN“. Povedz publiku, že ide o pripravený scenár.
