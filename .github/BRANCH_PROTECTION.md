# Required checks for `main`

Configure repository branch protection to require:

## Build

- Frontend Build

## Security (required)

- npm audit (high+)
- Analyze *(CodeQL)*
- Gitleaks
- Crypto Static Guards
- Dependency Review *(pull requests only)*

Require the branch to be up to date and disable administrator bypass.

## Not required for merge (scheduled / informational)

- OpenSSF Scorecard (`ossf-scorecard.yml`)
