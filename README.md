# Musement

Musement is a local, single-user knowledge-exploration system. It creates one small, immutable Daily Edition with three Selection Slots—Important, Personally Interesting, and Wildcard—without creating an unread queue or missed-day debt.

## Requirements

- Node.js 24 or newer
- Codex CLI with ChatGPT sign-in (`codex login status`)
- Network access to the public sources you configure and to the Codex provider
- Optional: Tailscale for private browser access to the full HTML edition

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

## On-Demand Use & Candidate Pool

```sh
# Daily collection & RSS export
musement collect

# On-demand curated encounters with optional direction
musement pull
musement pull -n 3 --direction "Quantum Physics"
musement pull --html > encounter.html
open encounter.html # macOS

# Candidate pool browsing & source management
musement pool
musement pool list --source arxiv-physics
musement pool mark-read FINGERPRINT
musement pool mark-read --source arxiv-physics

# Export RSS feeds to GitHub Pages
musement feeds publish
```

`collect` gathers fresh materials from configured sources, syncs remote read callbacks from GitHub, and updates RSS feeds. `pull` runs online AI editorial ranking to select fresh, novel, unexposed discoveries on demand based on your curiosity direction.

## Daily Edition (Legacy Push Mode)

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

## Gmail self-delivery on macOS

Create a Google Cloud **Desktop app** OAuth client, enable the Gmail API for that project, and download its credential JSON. Authorize the Gmail account that should act as both sender and receiver:

```sh
musement gmail-auth --credentials ~/Downloads/client_secret_....json
```

The command requests identity/email plus the send-only `gmail.send` scope. It stores the resulting authorization in macOS Keychain under `com.musement.gmail-oauth`; tokens are never written to Musement configuration, operational state, logs, or the repository. The downloaded OAuth client JSON remains user-managed and should not be committed.

Test one delivery, then install the user LaunchAgent:

```sh
musement deliver
musement schedule install --time 08:30
musement schedule status
```

The schedule uses the Mac's timezone and requires it to match `timezone` in `~/.musement/config.yaml`. Logs are written to `~/.musement/logs/`. A successful date is recorded in `~/.musement/email-deliveries.json`, so ordinary reruns report that it was already delivered. Generation, provider, and Gmail failures remain retryable and send no failure email. Remove the job with `musement schedule remove`.

Google OAuth projects with an External audience in **Testing** expire non-basic refresh tokens after seven days. For durable unattended delivery, publish the personal OAuth app to **In production** and authorize again; an unverified personal app may show Google's warning during that one-time authorization.

## Private HTML sharing with Tailscale

Musement can expose only the current Edition Review at a private tailnet URL and add that URL to later Gmail deliveries. It discovers the installing user's own Tailscale DNS name; no account, hostname, or tailnet is hard-coded.

On macOS with Tailscale already connected:

```sh
musement share install
musement share publish
musement share status
```

`share install` creates a localhost-only web server LaunchAgent and configures only the `/musement/today` Tailscale Serve path. The first install may require enabling HTTPS Certificates in the Tailscale admin console. `share publish` writes today's already-canonical Edition Review to the stable URL; later `musement deliver` runs update the page before Gmail delivery. The site sends `no-store` headers and exposes no dated archive.

The default localhost port is `43187`. Use `--port` to avoid a local conflict and `--tailscale PATH` when the Tailscale CLI is outside common installation locations. Remove only Musement's route and service with:

```sh
musement share remove
```

The site server itself is platform-neutral. Users on another operating system can run `musement share serve --port PORT` under their own service manager and point Tailscale Serve's `/musement/today` path at `http://127.0.0.1:PORT/today`; automatic lifecycle installation currently uses macOS LaunchAgents.

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
