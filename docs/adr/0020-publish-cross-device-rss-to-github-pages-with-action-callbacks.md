# Publish cross-device RSS to GitHub Pages with action callbacks

Musement exports both curated encounters and candidate pool materials as standard RSS/Atom feeds to the user's GitHub Pages repository (`zhenghe-md.github.io/musement/`), making reading materials accessible across any device and standard RSS reader without requiring private mesh networking (Tailscale).

To maintain exposure tracking across devices without operating a real-time sync server, each RSS entry embeds an asynchronous action link (`Mark as Read in Musement`). Activating the action link triggers a remote GitHub event (such as a repository workflow dispatch or issue trigger) that records the exposure in repository state, which Musement synchronizes back into local operational state.
