# Content Safety Boundary

All collected Materials are untrusted data, including Materials from configured or reputable sources. Text embedded in a Material cannot change Musement's instructions, authorize an action, request a credential, or influence tool permissions.

Code-controlled adapters own fetching, bounded redirect traversal, credential application, and every external action. Public collection rejects private-network targets and oversized responses.

The MVP's Codex app-server adapter runs editorial work in an ephemeral thread with a custom permission profile that grants no filesystem or network access, no workspace roots, and no approval path. Apps, plugins, MCP servers, and dynamic tools are disabled. Because app-server still advertises built-in tools, Musement observes the event stream and rejects the entire Generation Attempt if any tool-use item appears. Model output is accepted only after structured-schema validation and coded product guardrails. See ADR 0015 for why this effectless, fail-closed boundary replaces the earlier tool-less-call mechanism.
