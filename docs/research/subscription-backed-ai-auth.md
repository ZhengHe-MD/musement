# Subscription-backed AI authentication

Research date: 2026-07-18

## Conclusion

A personal, local Musement installation can use an existing ChatGPT or Claude subscription through the provider's supported agent runtime. This does not turn the subscription into a general-purpose API account: subscription credentials are scoped to Codex or Claude Code/Agent SDK workflows, while ordinary model API calls remain separately authenticated and billed.

For a personal-local experiment, prefer OpenAI's Codex SDK or app server with ChatGPT sign-in because OpenAI explicitly documents app integration, managed OAuth, token refresh, and device-code login. Keep this behind Musement's shared AI capability boundary because it is a delegated agent runtime rather than the ordinary OpenAI API.

For any multi-user, hosted, or product use, use the provider's commercial API authentication and billing. Do not pool a subscription, forward one user's token to other users, or disguise third-party traffic as native client traffic.

## OpenAI and Codex

OpenAI documents two Codex authentication modes: ChatGPT sign-in for subscription access and an API key for usage-based access. The Codex CLI, IDE extension, and desktop app support both modes for local work; API-key activity is billed through the OpenAI Platform account at standard API rates. [OpenAI Codex authentication](https://developers.openai.com/codex/auth)

OpenAI describes the Codex SDK as a way to control local Codex agents programmatically, including embedding Codex in an application or internal workflow. [OpenAI Codex SDK](https://developers.openai.com/codex/sdk)

For a custom local application, the Codex app server is the clearest supported OAuth boundary. In its managed ChatGPT mode, the app server owns the browser OAuth flow, persists credentials, and refreshes them automatically. It also supports a device-code flow for clients where a localhost browser callback is unsuitable. An external-token mode exists, but OpenAI marks it experimental and makes the host application responsible for the token lifecycle. [OpenAI Codex app server](https://developers.openai.com/codex/app-server)

Codex access tokens are a separate enterprise mechanism. They are currently available to ChatGPT Business and Enterprise workspaces and are intended for trusted, non-interactive local workflows using Codex CLI or an app-server client. They do not authenticate general OpenAI API calls; those continue to require Platform API keys. [OpenAI Codex access tokens](https://developers.openai.com/codex/enterprise/access-tokens)

Therefore, a local Musement adapter may delegate work to Codex through the SDK or app server and let the user complete the official ChatGPT login. It should not extract Codex credentials from local storage or present them as ordinary OpenAI API credentials.

## Anthropic and Claude Code

Claude Code supports browser login with Claude Pro, Max, Team, and Enterprise subscriptions. For unattended local scripts or CI, `claude setup-token` creates a one-year, inference-only OAuth token that is supplied as `CLAUDE_CODE_OAUTH_TOKEN`; the token is for Claude Code surfaces, cannot access connectors or Remote Control, and is not read in bare mode. [Claude Code authentication](https://code.claude.com/docs/en/authentication)

Anthropic currently states that Claude Agent SDK, `claude -p`, and third-party application usage still draw from subscription usage limits. A planned move to separate monthly Agent SDK credits was paused on 2026-06-15, and Anthropic says it will announce an updated plan before any change takes effect. This makes subscription-backed Agent SDK use possible today but a volatile foundation for product architecture. [Anthropic subscription and Agent SDK notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

The permission boundary is narrow. Anthropic says subscription plans are for their subscribers, recommends API-key or supported-cloud authentication for third-party tools, prohibits misrepresenting tool identity or routing third-party traffic against subscription limits, and directs developers building tools for others to use commercial API authentication. [Anthropic account-authentication policy](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account) The Agent SDK quickstart likewise says third-party developers may not offer Claude login or subscription rate limits without prior approval. [Claude Agent SDK quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)

The general Claude API remains a separate product. Its documented authentication mechanisms are a Console API key or Workload Identity Federation; the latter exchanges an identity-provider token for a short-lived API bearer token but does not reuse a consumer subscription. [Claude API authentication](https://platform.claude.com/docs/en/manage-claude/authentication) Anthropic explicitly says a paid Claude subscription does not include Claude API or Console access. [Claude subscription and API separation](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-do-i-have-to-pay-separately-to-use-the-claude-api-and-console)

Anthropic's `ant auth login` is another OAuth flow, but it authenticates local scripts to a Claude Console workspace. It avoids manually managing an API key; it does not move that usage onto the consumer subscription. [Claude Platform CLI authentication](https://platform.claude.com/docs/en/cli-sdks-libraries/cli/authentication)

Therefore, a personal Musement adapter may use the Claude Agent SDK or `claude -p` with the official Claude Code login or setup token. It should not send a recovered Claude Code token directly to the Messages API, and a shared deployment should use a Console API key or supported workload identity instead.

## OpenClaw as an implementation precedent

OpenClaw demonstrates one implementation pattern: keep subscription OAuth and direct API-key billing as distinct authentication profiles, route subscription-backed work through the Codex app-server runtime, and use Platform API keys for non-agent OpenAI APIs. It also implements browser and device-code login rather than importing another client's stored OAuth material. [OpenClaw OAuth documentation](https://docs.openclaw.ai/oauth) [OpenClaw OpenAI provider documentation](https://github.com/openclaw/openclaw/blob/main/docs/providers/openai.md)

OpenClaw is useful engineering precedent, not an authoritative statement of OpenAI or Anthropic policy. Provider documentation remains the source of truth.

## Recommendation for Musement

For the personal-local first version:

- Keep the existing shared AI capability boundary so clustering, summarization, assessment, and selection do not know how authentication works.
- If avoiding incremental API cost is important, implement one optional local delegated-runtime adapter. Prefer Codex app server plus ChatGPT managed OAuth because its application and OAuth contracts are more explicit than Anthropic's currently changing subscription-backed Agent SDK policy.
- Store no password and do not copy credentials from another application's files. Let the provider runtime own browser login, refresh, logout, and secure storage.
- Show the active authentication and billing mode in diagnostics so a user can tell subscription usage from API-key usage.
- Treat subscription rate limits as a normal degraded state: pause and retry later rather than silently switching to paid API usage.

For a multi-user or hosted version:

- Use an OpenAI Platform API key, Anthropic Console API key, or the provider's supported workload identity mechanism.
- Use separate credentials, spend limits, and audit trails for each environment or tenant boundary.
- Never share one person's subscription token, expose it to a browser client, or proxy unrelated users through it.
- Do not promise that a personal subscription covers application traffic; subscription scope and limits can change independently of Musement.
