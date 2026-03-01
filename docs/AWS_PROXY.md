# AWS Lambda Proxy for fal.ai API

> Architecture spec for securing the fal.ai API key behind an AWS Lambda proxy so it never ships on user machines.

---

## Problem

The Snip app calls fal.ai APIs directly from the Electron main process (`src/main/animation/animation.js`). The API key is stored in each user's local config (`~/Library/Application Support/snip/snip-config.json` → `falApiKey`). This is insecure for distribution — the key is exposed on every machine and can be extracted trivially.

---

## Architecture Overview

```
┌─────────────────────┐
│   Snip macOS Client  │
│  (animation.js)      │
│                      │
│  Signs request with  │
│  HMAC-SHA256 using   │
│  build-time secret   │
└──────────┬───────────┘
           │ HTTPS
           │ Headers: x-api-key, x-timestamp, x-signature
           ▼
┌─────────────────────────────────────────┐
│          API Gateway (REST API)          │
│                                          │
│  • Requires API key (x-api-key header)   │
│  • Usage plan: throttle + quota          │
│  • Routes /fal/* to Lambda               │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│         Lambda (Node.js 20)              │
│                                          │
│  1. Validate HMAC signature              │
│  2. Reject if timestamp > 30s old        │
│  3. Fetch fal.ai key from Secrets Mgr    │
│  4. Proxy request to fal.ai              │
│  5. Return response to client            │
└──────────────────┬──────────────────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
┌──────────────────┐  ┌────────────────┐
│ Secrets Manager   │  │   fal.ai API   │
│                   │  │                │
│ • fal-api-key     │  │ queue.fal.run  │
│ • hmac-secret     │  │ rest.fal.ai    │
└──────────────────┘  └────────────────┘
```

### Three Security Layers

1. **API Gateway API key** — blocks unauthenticated requests before they reach Lambda
2. **HMAC request signing** — proves the request came from a genuine Snip build (shared secret injected at build time)
3. **Rate limiting** — API Gateway usage plan caps requests per second and per month, limiting damage even if all secrets are extracted

---

## AWS Infrastructure

### API Gateway

REST API with the following configuration:

| Setting | Value | Why |
|---------|-------|-----|
| API type | REST API | Supports API key requirement + usage plans |
| API key required | `true` on all methods | First auth layer — rejects requests without `x-api-key` |
| Usage plan | 5 req/s burst, 2 req/s steady, 1000/month quota | Caps abuse; one animation ≈ 4 requests |
| Stage | `prod` | Single stage |
| CORS | Disabled | Not a browser API — Electron main process uses `https` module |

**Routes:**

| Method | Resource | Purpose |
|--------|----------|---------|
| `POST` | `/fal/storage/upload/initiate` | Initiate fal.ai file upload |
| `PUT` | `/fal/storage/upload/{proxy+}` | Upload image to pre-signed URL |
| `POST` | `/fal/queue/{proxy+}` | Submit job to fal.ai queue |
| `GET` | `/fal/queue/{proxy+}` | Poll job status / fetch result |

All routes use Lambda proxy integration.

### Lambda

| Setting | Value |
|---------|-------|
| Runtime | Node.js 20.x |
| Architecture | arm64 (Graviton — cheaper) |
| Memory | 256 MB |
| Timeout | 120 seconds (fal.ai polling can take up to 2 min) |
| Handler | `index.handler` |

The Lambda function:

1. **Validates HMAC** — rejects requests that fail signature check or have expired timestamps
2. **Fetches secrets** — retrieves `fal-api-key` and `hmac-shared-secret` from Secrets Manager (cached per cold start)
3. **Proxies to fal.ai** — rewrites the request path, injects the fal.ai `Authorization: Key ...` header, forwards the body
4. **Returns response** — passes fal.ai's response (status, headers, body) back to the client

### Secrets Manager

Two secrets stored as plaintext strings:

| Secret Name | Value |
|-------------|-------|
| `snip/fal-api-key` | The fal.ai API key (`key-...`) |
| `snip/hmac-shared-secret` | Random 64-char hex string used for HMAC signing |

### IAM

Lambda execution role with minimal permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": [
        "arn:aws:secretsmanager:REGION:ACCOUNT:secret:snip/fal-api-key-*",
        "arn:aws:secretsmanager:REGION:ACCOUNT:secret:snip/hmac-shared-secret-*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

No other AWS services, no database, no S3 buckets.

---

## Lambda Function Design

### Request Validation

```
Client sends:
  x-api-key:    <API Gateway key>          ← validated by API Gateway before Lambda
  x-timestamp:  <Unix epoch seconds>       ← validated by Lambda
  x-signature:  <HMAC-SHA256 hex digest>   ← validated by Lambda

Signature = HMAC-SHA256(hmac-shared-secret, timestamp + ":" + requestBody)
```

Validation steps:

1. Extract `x-timestamp` and `x-signature` from headers
2. Reject if `|now - timestamp| > 30` seconds (prevents replay attacks)
3. Compute expected signature: `HMAC-SHA256(secret, timestamp + ":" + body)`
4. Reject if `x-signature !== expected` (timing-safe comparison)

### Route Mapping

The Lambda maps incoming API Gateway paths to fal.ai endpoints:

| Incoming Path | Proxied To |
|---------------|------------|
| `POST /fal/storage/upload/initiate` | `https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3` |
| `POST /fal/queue/fal-ai/*` | `https://queue.fal.run/fal-ai/*` |
| `GET /fal/queue/fal-ai/*` | `https://queue.fal.run/fal-ai/*` |

The pre-signed upload URL returned by fal.ai (for the actual image upload to their CDN) is passed back to the client. The client uploads directly to fal.ai's CDN using that pre-signed URL — this avoids routing large image payloads through Lambda.

### Secrets Caching

Secrets are fetched once on cold start and cached in module-scope variables:

```js
let cachedFalKey = null;
let cachedHmacSecret = null;

async function getSecrets() {
  if (cachedFalKey) return { falKey: cachedFalKey, hmacSecret: cachedHmacSecret };
  // ... fetch from Secrets Manager, cache, return
}
```

This avoids a Secrets Manager call on every warm invocation.

### Error Responses

| Scenario | Status | Body |
|----------|--------|------|
| Missing `x-timestamp` or `x-signature` | 401 | `{ "error": "Missing authentication headers" }` |
| Timestamp expired (>30s) | 401 | `{ "error": "Request expired" }` |
| Invalid HMAC signature | 403 | `{ "error": "Invalid signature" }` |
| fal.ai upstream error | fal's status | fal.ai error body passed through |
| Lambda timeout | 504 | API Gateway default |

---

## Client-Side Changes

### File: `src/main/animation/animation.js`

Currently, `animation.js` makes direct HTTPS requests to two fal.ai hosts:

- `queue.fal.run` — job submission + polling (via `falRequest()`)
- `rest.fal.ai` — storage upload initiation (via `uploadToFal()`)

**Changes needed:**

1. **Redirect requests** — point `falRequest()` and `uploadToFal()` at the API Gateway URL instead of fal.ai directly
2. **Add signing headers** — every request gets `x-api-key`, `x-timestamp`, and `x-signature`
3. **Remove `Authorization: Key ...` header** — the Lambda injects this server-side
4. **Keep direct CDN upload** — the pre-signed upload URL from fal.ai still goes directly to their CDN (no change to step 2 of `uploadToFal()`)

### HMAC Signing Helper

New function in `animation.js` (or a shared module):

```js
function signRequest(body) {
  var crypto = require('crypto');
  var config = require('./build-config');
  var timestamp = Math.floor(Date.now() / 1000).toString();
  var payload = timestamp + ':' + (body || '');
  var signature = crypto.createHmac('sha256', config.HMAC_SECRET)
    .update(payload)
    .digest('hex');
  return {
    'x-api-key': config.API_GATEWAY_KEY,
    'x-timestamp': timestamp,
    'x-signature': signature
  };
}
```

### Build-Time Secret Injection

A pre-build script generates `src/main/build-config.js` from environment variables:

```js
// scripts/generate-build-config.js
var fs = require('fs');
var path = require('path');

var content = [
  "'use strict';",
  "module.exports = {",
  "  API_GATEWAY_URL: " + JSON.stringify(process.env.API_GATEWAY_URL || '') + ",",
  "  API_GATEWAY_KEY: " + JSON.stringify(process.env.API_GATEWAY_KEY || '') + ",",
  "  HMAC_SECRET: " + JSON.stringify(process.env.FAL_PROXY_SECRET || '') + "",
  "};"
].join('\n');

fs.writeFileSync(
  path.join(__dirname, '..', 'src', 'main', 'build-config.js'),
  content
);
```

- **`.gitignore`**: add `src/main/build-config.js`
- **Dev fallback**: if `build-config.js` is missing (local dev), fall back to direct fal.ai calls with the local API key from config (current behavior)

### Remove `falApiKey` from Config

Once the proxy is deployed:

- Remove `getFalApiKey()` / `setFalApiKey()` from `src/main/store.js`
- Remove the Settings > Animation API key input from `src/renderer/home.js` / `home.html`
- `checkSupport()` returns `true` if `build-config.js` exists with a valid `API_GATEWAY_URL` (instead of checking for a local API key)

---

## Build Pipeline Changes

### New Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `FAL_PROXY_SECRET` | CI secret | HMAC shared secret (same value as in Secrets Manager) |
| `API_GATEWAY_URL` | CI secret | API Gateway invoke URL (e.g., `https://abc123.execute-api.us-east-1.amazonaws.com/prod`) |
| `API_GATEWAY_KEY` | CI secret | API Gateway API key value |

### Build Script Integration

Add to `package.json` scripts:

```json
{
  "prebuild": "node scripts/generate-build-config.js && node-gyp rebuild"
}
```

Or in `scripts/build-signed.sh`, add before the `electron-builder` step:

```bash
# Generate build-time config with proxy secrets
node scripts/generate-build-config.js
```

### CI Workflow

The GitHub Actions workflow (or equivalent) needs:

```yaml
env:
  FAL_PROXY_SECRET: ${{ secrets.FAL_PROXY_SECRET }}
  API_GATEWAY_URL: ${{ secrets.API_GATEWAY_URL }}
  API_GATEWAY_KEY: ${{ secrets.API_GATEWAY_KEY }}
```

---

## Security Considerations

### Secret in Binary

The HMAC secret and API Gateway key are embedded in the packaged Electron app. A determined attacker can extract them from the asar or binary. Mitigations:

1. **Obfuscation** — split the secret into fragments, XOR with a key, reassemble at runtime. This raises the effort from "search for string" to "reverse engineer logic."
2. **API Gateway throttling** — even with all secrets extracted, the usage plan caps requests to 2/s steady and 1000/month. An attacker can't run up a large bill.
3. **Rotation** — secrets can be rotated by updating Secrets Manager + pushing a new app build. Old builds stop working immediately (HMAC secret mismatch) or on next cold start (fal.ai key).

### No Database

All validation is stateless:

- **API key** — validated by API Gateway (managed service)
- **HMAC** — computed from shared secret + timestamp (no lookup needed)
- **Timestamp** — compared to current time (no nonce storage)
- **Rate limiting** — enforced by API Gateway usage plan (managed service)

This eliminates the need for DynamoDB, Redis, or any persistent state in the Lambda.

### Replay Attacks

The 30-second timestamp window prevents replaying captured requests after a short delay. Within the 30-second window, an intercepted request could technically be replayed, but:

- It would hit the same fal.ai endpoint with the same parameters (no useful attack surface)
- API Gateway rate limiting caps the volume
- HTTPS encryption prevents interception in transit

### Abuse Scenarios

| Scenario | Mitigation |
|----------|------------|
| Attacker extracts HMAC secret from binary | API Gateway throttle limits damage; rotate secret + push update |
| Attacker discovers API Gateway URL | API key required; no key = 403 |
| Attacker has API key + HMAC secret | Throttle caps at 1000 req/month; monitor CloudWatch for anomalies |
| Stolen fal.ai API key (impossible — never leaves AWS) | N/A — key is only in Secrets Manager |

---

## Migration Path

### Phase 1: Deploy AWS Infrastructure

1. Create Secrets Manager entries for `snip/fal-api-key` and `snip/hmac-shared-secret`
2. Deploy Lambda function with the proxy logic
3. Create API Gateway REST API with routes, API key, and usage plan
4. Test end-to-end with `curl`:
   ```bash
   TIMESTAMP=$(date +%s)
   BODY='{"content_type":"image/png","file_name":"test.png"}'
   SIG=$(echo -n "${TIMESTAMP}:${BODY}" | openssl dgst -sha256 -hmac "$HMAC_SECRET" | awk '{print $2}')

   curl -X POST "https://<api-gw>/prod/fal/storage/upload/initiate" \
     -H "x-api-key: $API_KEY" \
     -H "x-timestamp: $TIMESTAMP" \
     -H "x-signature: $SIG" \
     -H "Content-Type: application/json" \
     -d "$BODY"
   ```

### Phase 2: Update Client

1. Create `scripts/generate-build-config.js`
2. Add `src/main/build-config.js` to `.gitignore`
3. Modify `animation.js` to use proxy when `build-config.js` is available
4. Keep direct fal.ai fallback for local dev (uses `falApiKey` from config)

### Phase 3: Remove Local Key

1. Remove `getFalApiKey()` / `setFalApiKey()` from `store.js`
2. Remove Settings > Animation API key UI
3. Update `checkSupport()` to check for proxy config instead
4. Update docs: `ARCHITECTURE.md`, `DEVOPS.md`, `USER_FLOWS.md`, `PRODUCT.md`

---

## Cost Estimate

| Service | Cost | Notes |
|---------|------|-------|
| Lambda | ~$0 | Free tier covers 1M requests/month |
| API Gateway | ~$3.50/million requests | Likely <$1/month for typical usage |
| Secrets Manager | $0.80/month | 2 secrets × $0.40 each |
| fal.ai | $0.08–0.15/animation | Same as current (no change) |
| **Total AWS** | **~$1/month** | Excluding fal.ai usage |
