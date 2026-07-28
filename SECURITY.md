# Security

Security updates are applied to the current `main` branch.

Please report suspected vulnerabilities using GitHub's private vulnerability
reporting feature for this repository. Do not put credentials, private
documents, provider responses, or other sensitive material in a public issue.
Public issues are appropriate for non-sensitive bugs and feature requests.

When deploying Margin, protect language-model and formula-recognition
endpoints with authentication, network controls, TLS outside trusted networks,
and an upstream global rate limit. Keep API keys in server-side environment
configuration rather than browser code or committed files.
