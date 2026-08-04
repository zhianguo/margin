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

Optional web search is also server-side and remains disabled until
`WEB_SEARCH_PROVIDER` is configured. Point `SEARXNG_BASE_URL` or
`TAVILY_BASE_URL` only at a service you trust. Protect a private SearXNG
instance with network controls and, outside a trusted network, TLS and
authentication; public SearXNG instances are not dependable application
backends.

A submitted search query is disclosed to the configured search service, and a
SearXNG instance can disclose it to its enabled upstream engines. Returned
titles, snippets, and URLs are untrusted web content. Margin treats them as
source material rather than instructions, removes markup, rejects non-HTTP(S)
result URLs, and bounds the returned content. These controls do not establish
that a source is correct or benign, so users should still verify important
claims by opening the cited sources. Do not place secrets in an editable search
query.

Keep search-service credentials in the server's ignored `.env` file for local
deployments or protected secret bindings when hosted. In the local Express
server, search is performed inside the rate-limited `/api/explain` request;
hosted operators should also enforce an upstream global rate limit. Restrict
configuration changes to administrators. See [SEARCH.md](SEARCH.md) for the
search-specific trust boundaries and troubleshooting guidance.
