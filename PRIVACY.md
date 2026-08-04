# Privacy

Margin is designed so that the PDF file itself stays in the browser. Opening a
local PDF creates a browser Blob URL; Margin does not upload the complete PDF to
its application server.

## Information sent for an explanation

When you choose **Explain**, the browser sends the following to the Margin
application server and the configured language-model provider:

- the selected text;
- recognized, corrected, or geometry-derived formula and diagram text, when
  available;
- extracted text from the selected page, capped at 16,000 characters;
- the page number, explanation lens, and filename-derived document title.

PDF text is treated as untrusted source material in the model prompt. The
configured provider may log or retain requests according to its own policy.
Use a provider and transport appropriate for the sensitivity of the material.

## Optional web search

Web search is disabled unless the server operator sets `WEB_SEARCH_PROVIDER`,
and it runs only while the user has enabled **Include current web sources** for
the active selection. Activating a different selection resets the option to
off. If it remains enabled, regenerating or switching to an unexplained lens
can issue another search.

Margin pre-fills the editable query from the filename-derived document title
and selected text, or the recognized/corrected formula when available. If the
user submits it unchanged, the search provider receives those values. The user
can edit or remove them before submitting. The provider does not receive the
complete PDF or extracted page context; the only PDF-derived content it
receives is whatever remains in the approved query. Margin also sends
provider-dependent operational parameters such as freshness, safe-search mode,
language, and result limits.

Search providers may log queries and network metadata under their own policies.
A self-hosted SearXNG instance may also forward the query to its configured
upstream search engines.

Margin sends the search results' titles, snippets, and URLs to the configured
language-model provider, along with result identifiers, available publication
dates, and search time, together with the normal explanation material so the
model can synthesize the web context. Search and language-model providers may
therefore see different parts of the request:

- the search provider sees the approved query and operational search settings;
- the language-model provider sees the selected material, limited page context,
  query, and returned web-result metadata.

If the model cannot return a reliably cited web section, Margin may make one
additional request to the same language-model provider for the ordinary
explanation without web-result metadata. A failed or empty search does not
cause the selected PDF material to be sent to the search provider beyond the
approved query.

Opening a cited URL is a separate browser visit to that external site and is
subject to the site's own logging and privacy practices. Search and LLM
credentials remain in server-side configuration and are not sent to the
browser. See [SEARCH.md](SEARCH.md) for configuration and operational details.

## Formula recognition

When optional formula recognition is enabled, Margin sends only the bounded
image crop around the selected formula through the application server to the
configured OCR service. It does not send the full PDF or full-page image to
that service.

Compact diagram selections use a locally saved page crop for display and do
not require formula OCR.

## Browser storage

Saved highlights are stored in the browser's local storage under a derived
document identifier. A saved record can contain selected text, page-relative
rectangles, corrected notation, and bounded formula or diagram preview images.
Closing a PDF does not delete its saved highlights.

To remove one saved selection, open it from **Margin notes** and use the
trash-can button on its selected-content card. To remove all locally stored
Margin data, clear site data for the Margin origin in your browser.

## Application and infrastructure logs

This source tree does not include analytics, advertising trackers, a user
database, or application telemetry. The application uses short-lived
rate-limiting state, and hosting infrastructure may independently record
network and request metadata. Operators of a hosted deployment should publish
their own retention and access policy.

Provider URLs and API keys are server-side configuration and are not included
in the browser bundle.
