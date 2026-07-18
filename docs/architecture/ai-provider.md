# AI Provider Boundary

## Capability boundary

Musement's selection pipeline depends on AI capabilities rather than provider APIs, SDKs, credentials, or billing models. A provider adapter supplies structured clustering, summarization, assessment, and selection operations and reports the provider, model, prompt, and output-schema versions used.

The MVP implements one adapter: Codex app server with ChatGPT-managed OAuth. Codex owns browser or device-code login, credential storage, refresh, logout, entitlement checks, and rate-limit reporting.

## Authentication modes

The boundary may later support multiple provider-owned authentication modes, including:

- Vendor-Managed Subscription Authentication.
- Commercial API credentials.
- Supported workload identity.
- Local models that require no remote authentication.

Vendor-Managed Subscription Authentication is available only when the provider officially permits the intended third-party and deployment model. The adapter asks the vendor runtime to authenticate and receives an authenticated capability; Musement does not read, export, proxy, or emulate the vendor's credential.

Each user authenticates their own provider account. Subscription limits are not pooled across users, and a personal subscription adapter is not exposed as a shared or hosted service.

## Billing safety

Diagnostics show the active provider, authentication mode, and relevant rate-limit state. Reaching a subscription limit leaves the current Generation Attempt pending or failed until work can resume; it does not freeze a Daily Edition. Musement never silently changes authentication mode or falls back to separately billed API usage.
