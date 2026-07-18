# Separate human-owned configuration from operational state

Musement stores user-owned settings such as the Interest Profile, Configured Sources, and Attention Budget in human-readable, manually editable configuration files. It stores application-owned operational state such as Daily Editions, Exposures, feedback, Selection Traces, Generation Attempts, consumer checkpoints, and the Handoff Outbox in one local SQLite database.

This boundary keeps deliberate preferences inspectable and portable while giving immutable edition creation and ordered event publication transactional durability. A local embedded database satisfies those needs without requiring the first-user MVP to operate a database server.
