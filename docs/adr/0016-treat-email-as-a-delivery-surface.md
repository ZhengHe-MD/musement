# Treat email as a delivery surface

Musement may self-deliver the canonical Daily Edition as an HTML email from and to a user-authorized Gmail account. Email is a presentation surface, not a newsletter subscription, unread queue, reminder system, or completion signal: a missed or failed delivery creates no debt, and Musement never sends failure or pressure emails.

The Gmail adapter requests send-only access and records successful delivery locally to suppress ordinary duplicate runs. It does not request mailbox read access merely to guarantee remote deduplication, so an ambiguous network failure after Gmail accepts a message may cause a duplicate retry. This preserves least-privilege authorization at the cost of a narrow at-least-once delivery edge case.

The adapter keeps its narrow delivery receipt in a permission-restricted JSON sidecar rather than the canonical SQLite store. The receipt coordinates an external side effect but is not domain history, and keeping it beside the adapter avoids implying that a database transaction can atomically include Gmail. This decision supersedes ADR 0013 only for adapter-owned email-delivery receipts; all canonical operational state remains in SQLite.
