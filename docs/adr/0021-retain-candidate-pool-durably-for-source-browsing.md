# Retain candidate pool durably for source browsing

Musement retains collected candidate material metadata, summaries, and fingerprints durably in its local SQLite database rather than expiring them on a short fixed window.

Durable retention allows the user to browse collected materials by data source on demand and ensures that evergreen, high-quality candidates gathered weeks or months prior remain eligible for future online thematic pulls. Raw source text caches continue to be governed by source access policies, while derived metadata and candidate snapshots persist until explicitly exposed or cleared.
