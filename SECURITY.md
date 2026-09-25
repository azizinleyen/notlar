# Security

Do not disclose a vulnerability together with meeting data or credentials in a public issue. The repository owner can enable **Security → Report a vulnerability** on GitHub. If private reporting is not enabled, establish a private contact method before sharing sensitive details.

Do not commit `.env` files, real OAuth client JSON files, API keys, private `.ics` links, local databases, recordings, or transcripts. These are covered by `.gitignore`, but check `git status` and `git diff --cached` before pushing.
