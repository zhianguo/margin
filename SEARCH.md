# Current web sources

Margin can optionally add current web sources to an explanation. Search is
disabled by default: the server operator must configure either SearXNG or
Tavily, and the user must enable **Include current web sources** for the active
selection. Activating a different selection resets the option to off. Normal
PDF explanations continue to work without a search provider.

Search is independent of the language-model provider. For example, Margin can
retrieve sources from a private SearXNG instance and ask a separately running
llama.cpp model to synthesize them.

## Deploy private SearXNG with `start.sh`

The simplest deployment runs SearXNG in a hardened Docker container on the
same system as Margin. Install Docker Engine and `curl`, make sure the account
running Margin can access the local Docker daemon, then run:

```bash
./start.sh --start-searxng
```

This one command:

- pulls Margin's pinned official SearXNG image when it is not already present;
- creates or reuses the managed `margin-searxng` container;
- exposes it only at `http://127.0.0.1:8888`;
- enables the JSON response format required by Margin;
- waits for both the health endpoint and JSON search endpoint;
- starts Margin with `WEB_SEARCH_PROVIDER=searxng` and the correct loopback URL.

No search entries are required in `.env` when this option is used. The launcher
does not start llama.cpp: keep the language-model provider in its own terminal
or on its separate HTTP-accessible system. For example:

```bash
./start.sh --provider-url http://llama-host:8080/v1 --start-searxng
```

To start every bundled companion—local SearXNG and Formula OCR—before Margin:

```bash
./start.sh --provider-url http://llama-host:8080/v1 \
  --start-searxng --start-formula-ocr
```

The container runs as an unprivileged user with a read-only root filesystem,
all Linux capabilities dropped, and `no-new-privileges`. Its port is bound to
loopback, a random SearXNG secret is passed through a temporary mode-`0600`
file, and that file is removed immediately after container creation. The
launcher refuses to replace a same-named container unless it carries Margin's
management label.

SearXNG settings are mounted read-only from
[`services/searxng/settings.yml`](services/searxng/settings.yml). Cached data is
kept in the named Docker volume `margin-searxng-data`, so it survives container
replacement. The detached container remains running when Margin stops and uses
Docker's `unless-stopped` restart policy. Later runs of the same command reuse
it, or start it if it was stopped. The settings file is fingerprinted; changing
it causes the next launcher run to replace the managed container so the new
settings take effect.

Useful management commands are:

```bash
docker logs -f margin-searxng
docker restart margin-searxng
docker stop margin-searxng
docker start margin-searxng
```

Verify the deployment directly:

```bash
curl http://127.0.0.1:8888/healthz
curl --get 'http://127.0.0.1:8888/search' \
  --data-urlencode 'q=Margin PDF reader' \
  --data-urlencode 'format=json'
```

The launcher accepts these optional environment settings:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SEARXNG_PORT` | `8888` | Loopback host port, from `1` to `65535` |
| `SEARXNG_IMAGE` | Pinned official image in `start.sh` | Compatible official image tag or digest using SearXNG UID/GID `977:977` |
| `SEARXNG_START_TIMEOUT_SECONDS` | `120` | Readiness timeout, from `1` to `600` seconds |

For example, to use port 8899:

```bash
SEARXNG_PORT=8899 ./start.sh --start-searxng
```

To update SearXNG, review its current migration notes, choose a tested official
image tag or digest that retains the container's `977:977` SearXNG user, and
run the launcher with `SEARXNG_IMAGE` set. A changed image causes the managed
container to be replaced while preserving the named cache volume:

```bash
SEARXNG_IMAGE=docker.io/searxng/searxng:VERSION \
  ./start.sh --start-searxng
```

The official
[SearXNG container installation guide](https://docs.searxng.org/admin/installation-docker)
documents its container, Compose, volume, and upgrade options. Margin's
single-container launcher is intended for a private local instance. Use the
official Compose deployment, a reverse proxy, TLS, authentication, and network
access controls before operating a shared or public instance.

Docker normally requires either rootless Docker, membership in the daemon's
access group, or elevated privileges. The launcher tries direct access first
and falls back to `sudo` when available. Docker daemon access is effectively
root-level control of the host, so grant it only to trusted accounts.

Stopping or replacing the container does not delete `margin-searxng-data`.
Removing that named volume explicitly deletes its cached data. Do that only
when the data is no longer needed.

## Use an existing or remote SearXNG instance

Use a SearXNG instance that you operate or trust. Its JSON response format must
be enabled. In the instance's `settings.yml`, include `json` under
`search.formats`:

```yaml
search:
  formats:
    - html
    - json
```

Restart SearXNG after changing its settings, then verify the API directly:

```bash
curl --get 'http://127.0.0.1:8888/search' \
  --data-urlencode 'q=Margin PDF reader' \
  --data-urlencode 'format=json'
```

Add the following to Margin's ignored `.env` file:

```dotenv
WEB_SEARCH_PROVIDER=searxng
SEARXNG_BASE_URL=http://127.0.0.1:8888
WEB_SEARCH_MAX_RESULTS=5
WEB_SEARCH_TIMEOUT_MS=10000
```

`SEARXNG_BASE_URL` defaults to `http://127.0.0.1:8888` only when
`WEB_SEARCH_PROVIDER=searxng`. Set `SEARXNG_API_KEY` as well if the private
deployment or its reverse proxy accepts a bearer token. Margin sends this value
in the `Authorization: Bearer ...` header. Leave the key unset for an instance
that does not require it.

The URL is resolved by the Margin server, not by the browser:

- use `http://127.0.0.1:8888` when Margin and SearXNG run directly on the same
  host;
- use a private LAN URL such as `http://192.168.1.20:8888` when they run on
  separate trusted machines;
- when Margin runs in a container, `127.0.0.1` refers to that container. Use the
  SearXNG service name on a shared container network, or a host address that the
  container can reach.

Plain HTTP is appropriate only on loopback or a trusted private network. Use
HTTPS and authentication across an untrusted network. The
[SearXNG Search API documentation](https://docs.searxng.org/dev/search_api.html)
describes its JSON format and freshness parameters.

SearXNG is a separate
[AGPL-3.0 service](https://github.com/searxng/searxng/blob/master/LICENSE).
It is not incorporated into Margin's MIT-licensed source. Public SearXNG
instances commonly disable JSON, change availability, or rate-limit automated
requests, so they are not dependable application backends.

## Quick setup with Tavily

Create an account in the
[Tavily dashboard](https://app.tavily.com), obtain an API key, and check
Tavily's current free-tier allowance and provider terms. Do not commit the key.
Add this to the ignored `.env` file:

```dotenv
WEB_SEARCH_PROVIDER=tavily
TAVILY_API_KEY=your_api_key_here
WEB_SEARCH_MAX_RESULTS=5
WEB_SEARCH_TIMEOUT_MS=10000
```

Leave `TAVILY_BASE_URL` unset for the standard Tavily service. Set it only when
using an approved proxy or compatible endpoint. Margin sends
`TAVILY_API_KEY` as a bearer token. Tavily's
[API introduction](https://docs.tavily.com/documentation/api-reference/introduction)
documents authentication and the search endpoint.

Restart Margin after changing `.env`. Configure only one search provider at a
time; the value of `WEB_SEARCH_PROVIDER` selects which provider-specific
settings are used. Removing `WEB_SEARCH_PROVIDER` disables search.

## Using current sources

Margin initializes the proposed query from the filename-derived document title
and the selected text, or the recognized/corrected formula when one is
available. The query is limited to 300 characters and remains editable. If it
is submitted unchanged, that title and selected content are disclosed to the
search provider.

Open a selected or saved passage in the explanation panel:

1. Enable **Include current web sources**.
2. Review or edit the proposed query. Remove private names, unpublished results,
   or other text that should not leave the system.
3. Choose the desired freshness.
4. Choose **Explain this passage**, **Regenerate**, or another explanation lens.

Choosing **Explain** in the selection popover starts the first explanation
immediately without web search. Enable web search in the resulting panel and
choose **Regenerate** to add current sources. While the option remains enabled,
later regenerations and automatic explanations for other lenses can run another
search. Activating a different selection turns it off.

Margin labels current-source material separately from its explanation of the
paper and shows result citations. Search freshness is a preference, not a
guarantee: coverage and date filtering depend on the provider and its upstream
engines.

## Data flow

```text
PDF in the browser
    │
    ├─ selected passage + limited page context ───────────────┐
    │                                                         │
    └─ user-approved query + search controls                  │
                         │                                    │
                         ▼                                    │
               configured search provider                    │
                         │                                    │
                         ▼                                    │
                 titles + snippets + URLs                     │
                         │                                    │
                         └────────────────────────────────────┤
                                                              ▼
                                                    configured LLM
                                                              │
                                                              ▼
                                               explanation + citations
```

The only PDF-derived content sent to the search provider is the submitted
query. Because Margin pre-fills it from the filename-derived title and selected
content, those values are included unless the user edits them out. The provider
does not receive the full PDF or extracted page context. Depending on the
provider, Margin also sends operational search parameters such as freshness,
safe-search mode, language, and result limits. SearXNG can pass the query to
its configured upstream engines.

The configured LLM receives the normal explanation material plus the query and
returned result IDs, titles, snippets, URLs, available publication dates, and
search time. Provider credentials remain in the Margin server process and are
never included in the browser bundle. See [PRIVACY.md](PRIVACY.md) for the
complete disclosure boundary.

## Configuration reference

| Variable | Required | Meaning |
| --- | --- | --- |
| `WEB_SEARCH_PROVIDER` | To enable search | `searxng` or `tavily`; omit to disable |
| `WEB_SEARCH_MAX_RESULTS` | No | Maximum results supplied to the LLM; default `5` |
| `WEB_SEARCH_TIMEOUT_MS` | No | Search request timeout in milliseconds; default `10000` |
| `SEARXNG_BASE_URL` | No | SearXNG origin; defaults to `http://127.0.0.1:8888` when SearXNG is selected |
| `SEARXNG_API_KEY` | No | Credential for a protected SearXNG deployment or reverse proxy |
| `TAVILY_API_KEY` | For Tavily | Tavily server-side API key |
| `TAVILY_BASE_URL` | No | Optional approved proxy or compatible Tavily base URL |
| `WEB_SEARCH_BASE_URL` | No | Shared fallback base URL; a provider-specific base URL takes precedence |
| `WEB_SEARCH_API_KEY` | No | Shared fallback credential; a provider-specific key takes precedence |

Lowering the result limit reduces latency and the amount of third-party text
sent to the LLM. The result limit is constrained to `1`–`10`. The timeout
covers the search request; a short timeout can produce failures when SearXNG
waits on slow upstream engines.

The health response reports whether the configuration is syntactically usable;
it does not contact the search provider. Connectivity is checked by the first
web-enabled explanation request.

## Trust, citations, and limitations

- Web-result titles, snippets, and URLs are untrusted input. Margin treats them
  as evidence, not as instructions to the model.
- Margin removes markup and script/style/template blocks from result text,
  accepts only HTTP(S) result URLs without embedded credentials, deduplicates
  URLs, and limits response and field sizes. These checks reduce exposure but
  do not make the source content trustworthy.
- A citation identifies the search result used for a claim; it does not prove
  that the page is correct, current, or accurately represented by its snippet.
  Margin accepts claim citations only when their IDs match returned results,
  but users must still verify important claims at the cited site.
- Margin uses search-result snippets and URLs. It does not guarantee full-page
  retrieval or access to paywalled, authenticated, blocked, or dynamically
  rendered pages.
- Search indexes can be incomplete or stale. Publication dates may be missing,
  and different engines interpret freshness differently.
- SearXNG officially documents `day`, `month`, and `year` time ranges. The
  **Past week** choice may be unsupported by a particular SearXNG version or
  engine; use **Past month** or **Any time** in that case.
- Opening a citation contacts the external site directly from the browser.
- Search providers and upstream engines may log queries and network metadata.
  Never place credentials or sensitive unpublished material in a query.
- Keep SearXNG private or protect it with authentication, network restrictions,
  and TLS outside a trusted LAN. Keep Tavily and proxy credentials server-side.
- Apply server-side rate limits and usage monitoring appropriate to the
  deployment. A hosted Tavily account may incur usage under its current terms.

## Troubleshooting

### Search is unavailable or unconfigured

Confirm that `.env` contains exactly one supported value:

```dotenv
WEB_SEARCH_PROVIDER=searxng
```

or:

```dotenv
WEB_SEARCH_PROVIDER=tavily
```

Restart Margin after editing `.env`. If the variable is absent, search is
intentionally disabled. For Tavily, also confirm that `TAVILY_API_KEY` is set.

### SearXNG returns 403

A 403 commonly means that `format=json` is not enabled. Add `json` to
`search.formats` in `settings.yml`, restart SearXNG, and repeat the direct
`curl` test above. Also check authentication or access rules on any reverse
proxy in front of the instance.

### The provider returns 429

The search provider or a SearXNG upstream engine is rate-limiting requests.
Wait before retrying, reduce repeated searches, and inspect the provider or
SearXNG logs. Tavily users should check their dashboard and current plan terms.
SearXNG operators may need to adjust enabled engines or instance limits.

### Margin cannot connect

Run the direct API test from the same host or container as the Margin server.
Remember that `127.0.0.1` inside a container is not the container host. Check
the base URL, DNS, firewall, reverse proxy, authentication, and whether the
service listens on the intended interface.

### Search times out or returns no useful results

Try a shorter, more specific query, relax the freshness setting, or increase
`WEB_SEARCH_TIMEOUT_MS`. SearXNG freshness support varies by engine. When a
web-enabled request returns no usable results—or the search provider cannot be
reached—Margin still returns the ordinary PDF explanation and shows a
non-fatal web-search notice. Edit the query or freshness and choose
**Regenerate** to try the current-source section again.

### The model rejects the grounded response or citations

Web-enabled explanations require the model to return the usual structured JSON
plus a separate web summary and claims cited with the registered result IDs.
If the model cannot produce that grounded format, Margin retries once without
the web context, preserves the ordinary explanation when that retry succeeds,
and shows a notice that current sources were unavailable. This fallback can
therefore make a second model request. With a weaker local model, reduce
`WEB_SEARCH_MAX_RESULTS`, simplify the query, or disable web search for that
explanation.
