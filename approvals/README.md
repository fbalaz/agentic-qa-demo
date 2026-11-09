# Human approvals

The `assertion-diff` gate fails when a change modifies an expected value in a test.
A human approves such a change by adding a file here named after the test file, for example
`approvals/checkout-01.spec.ts.yaml`:

```yaml
file: tests/generated/checkout-01.spec.ts
approved_by: Filip
reason: AC-3 changed in ac-v3, shipping is now discounted
```
