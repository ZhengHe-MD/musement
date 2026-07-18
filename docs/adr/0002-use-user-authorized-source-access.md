# Use user-authorized source access

Musement may integrate authenticated platforms through configurable adapters using user-supplied official API tokens or OAuth grants with minimum read permissions. Secrets must stay outside source configuration, repository files, prompts, and logs; the system will not accept raw account passwords, reuse access to bypass paywalls, or ingest protected content when permitted access is unavailable, though it may retain and recommend a link.
