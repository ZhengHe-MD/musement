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
npm link
musement init
```

Edit `~/.musement/config.yaml` before generating an edition. Replace the example source, add deliberate Enduring and Current Interest statements, and adjust the Attention Budget. Operational state is user-scoped too: the SQLite database is stored at `~/.musement/musement.sqlite`, and temporary source content is stored under `~/.musement/raw-material-cache/`.

Commands use those user-scoped paths from every working directory. Pass explicit global `--config` and `--data-dir` options only when you intentionally want an isolated installation.

Editorial generation can take several minutes because it uses high-effort reasoning. `provider_timeout_seconds` defaults to 300 and may be set between 30 and 900 seconds in `~/.musement/config.yaml`; increasing it changes only how long Musement waits and does not change provider billing or authentication.

Verify the subscription-backed provider separately:

```sh
npm run build
musement doctor
npm run provider:smoke
```

`doctor` reports the active authentication mode and current rate-limit state. The smoke test uses the same zero-filesystem, zero-network editorial permission profile as production. A provider or subscription outage fails the smoke test and later remains a retryable Generation Attempt; Musement never switches to separately billed API usage.

## Daily use

```sh
musement today
musement today --html > edition-review.html
open edition-review.html # macOS
musement trace 2026-07-18
musement trace 2026-07-18 --html > historical-edition-review.html
open historical-edition-review.html # macOS
musement feedback 2026-07-18 --slot important --kind good-pick
musement select 2026-07-18 --slot important
musement outbox --after 0
```

`today` generates on first access and returns the same frozen edition thereafter. `generate` is an equivalent explicit command suitable for `cron` or `launchd`; Musement has no built-in scheduler.

`today --html` and `generate --html` write a unified Edition Review to stdout: the three encounters first, followed by assembly decisions and the progressively disclosed Selection Trace. The standalone document is responsive, printable, supports English and Chinese interface labels, and contains no scripts or external assets. Collected text is escaped before rendering. `--html` and `--json` are mutually exclusive.

The footer identifies the editorial vendor and model and reports total, input, cached-input, output, and reasoning-output tokens when the provider supplied usage metadata. Editions frozen before token tracking was added remain unchanged and show that token usage was not recorded.

`trace DATE --html` writes the same unified Edition Review for an existing historical edition. Plain `trace DATE` continues to emit Selection Trace JSON.

Topic-level `not-useful` feedback creates a pending Soft Suppression proposal. Review and resolve proposals explicitly:

```sh
musement proposals --status pending
musement proposal-confirm PROPOSAL_ID
musement proposal-reject PROPOSAL_ID
```

After one month and at least 20 editions, review and record the one-time MVP evaluation:

```sh
musement evaluation
musement evaluation-record \
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
