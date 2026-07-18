# Version events by breaking change

Each Musement event has a stable type and integer version. Backward-compatible optional additions retain the current version, while removal, renaming, retyping, or semantic changes create a new version; recorded events remain immutable, and consumers ignore unknown fields while declaring their supported versions. This allows contracts to grow without rewriting history or silently breaking downstream pipelines.
