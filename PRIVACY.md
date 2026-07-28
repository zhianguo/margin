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
