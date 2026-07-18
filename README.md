# Musement

Musement is a local, single-user knowledge-exploration system. It creates one small, immutable Daily Edition with three Selection Slots—Important, Personally Interesting, and Wildcard—without creating an unread queue or missed-day debt.

## Requirements

- Node.js 24 or newer
- Codex CLI with ChatGPT sign-in (`codex login status`)
- Network access to the public sources you configure and to the Codex provider

## Install and configure

```sh
npm install
npm run build
node dist/cli.js init
```

Edit `musement.yaml` before generating an edition. Replace the example source, add deliberate Enduring and Current Interest statements, and adjust the Attention Budget. Configuration remains human-readable; operational state is stored under `.musement/`.

Verify the subscription-backed provider separately:

```sh
npm run build
node dist/cli.js doctor
npm run provider:smoke
```

`doctor` reports the active authentication mode and current rate-limit state. The smoke test uses the same zero-filesystem, zero-network editorial permission profile as production. A provider or subscription outage fails the smoke test and later remains a retryable Generation Attempt; Musement never switches to separately billed API usage.

## Daily use

```sh
node dist/cli.js today
node dist/cli.js trace 2026-07-18
node dist/cli.js feedback 2026-07-18 --slot important --kind good-pick
node dist/cli.js select 2026-07-18 --slot important
node dist/cli.js outbox --after 0
```

`today` generates on first access and returns the same frozen edition thereafter. `generate` is an equivalent explicit command suitable for `cron` or `launchd`; Musement has no built-in scheduler.

Topic-level `not-useful` feedback creates a pending Soft Suppression proposal. Review and resolve proposals explicitly:

```sh
node dist/cli.js proposals --status pending
node dist/cli.js proposal-confirm PROPOSAL_ID
node dist/cli.js proposal-reject PROPOSAL_ID
```

After one month and at least 20 editions, review and record the one-time MVP evaluation:

```sh
node dist/cli.js evaluation
node dist/cli.js evaluation-record \
  --worthwhile DISCOVERY_ID_1 DISCOVERY_ID_2 DISCOVERY_ID_3 DISCOVERY_ID_4 DISCOVERY_ID_5 \
  --continue yes
```

## Verification

```sh
npm test
npm run check
npm run build
```

The detailed product contracts live in [`docs/product/`](docs/product/README.md), and the domain language is defined in [`CONTEXT.md`](CONTEXT.md).
