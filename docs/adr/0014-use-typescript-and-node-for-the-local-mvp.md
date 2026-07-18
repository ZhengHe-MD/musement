# Use TypeScript and Node for the local MVP

The first-user MVP uses strict TypeScript on Node.js 24 for its headless core and CLI. This gives the experimental Codex app-server boundary generated protocol types, built-in SQLite access, one runtime for CLI and network adapters, and fast schema-driven tests without committing Musement's domain to the provider protocol. The choice applies to the local MVP rather than requiring future hosted or graphical surfaces to use the same stack.
