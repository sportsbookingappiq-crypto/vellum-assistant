# 0003: Phone-number login

Status: accepted for the login method. The SMS provider is not chosen yet.

## Context

ANU users sign in with their phone number. No SMS delivery provider has been chosen. The platform's WorkOS setup covers web sign-in, but it does not settle one-time-code delivery to a phone.

## Decision

- The flow has three steps: request a code for an E.164 phone number, verify the six-digit code, then issue a short-lived session token.
- Codes come from a CSPRNG. Only a keyed hash (HMAC with a server-side secret) is stored. A code expires after five minutes and allows five attempts. Requests are rate-limited per phone number and per client address.
- Delivery sits behind an `OtpSender` interface. Two implementations are planned:
  - `dev` sends nothing and returns the code. It is allowed only when `ANU_ENV` is `dev` or `test`.
  - A real SMS provider, added once it is chosen.
- Fail closed: the server refuses to start with the `dev` sender when `ANU_ENV` is `staging` or `production`.
- Phone numbers are personal data. Logs never contain a full number. Examples in docs and tests use the reserved `555-0100` to `555-0199` range.

## Consequences

- Phase 3 of the plan can build the whole login flow and its tests before any SMS vendor is chosen.
- Choosing the vendor later means writing one `OtpSender` implementation. Nothing else changes.
