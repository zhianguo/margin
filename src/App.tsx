import type { PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader";
import { EmptyState } from "./components/EmptyState";
import { ExplanationPanel } from "./components/ExplanationPanel";
import { LibraryRail } from "./components/LibraryRail";
import { PdfReader } from "./components/PdfReader";
import { SelectionPopover } from "./components/SelectionPopover";
import { demoSource, sourceFromFile } from "./lib/documents";
import { ExplainApiError, requestExplanation } from "./lib/explain";
import { renderPdfVisualCrop } from "./lib/formula-crop";
import {
  getEffectiveFormulaLatex,
  normalizeFormulaLatex
} from "./lib/formula-notation";
import {
  formulaImageDataUrlToBlob,
  FormulaRecognitionApiError,
  type FormulaRecognitionState,
  requestFormulaRecognition
} from "./lib/formula-recognition";
import {
  createHighlight,
  hasSelectionSourceChanged,
  isDiagramCandidateHighlight,
  isSameHighlightSelection,
  loadHighlights,
  saveHighlights,
  selectionRegionFromPages
} from "./lib/highlights";
import type {
  CapturedSelection,
  DocumentSource,
  ExplainMode,
  ExplanationRecord,
  Highlight,
  ProviderStatus
} from "./types";

function recordKey(highlightId: string, mode: ExplainMode): string {
  return `${highlightId}:${mode}`;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function withoutHighlightRecords(
  records: Record<string, ExplanationRecord>,
  highlightId: string
): Record<string, ExplanationRecord> {
  return Object.fromEntries(
    Object.entries(records).filter(
      ([, record]) => record.highlightId !== highlightId
    )
  );
}

function formulaSourceKey(highlight: Highlight): string {
  if (highlight.content.kind !== "formula") return highlight.content.kind;
  return JSON.stringify({
    region: highlight.content.region,
    previewImage: highlight.content.previewImage
  });
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function abortAllControllers(
  controllers: Map<string, AbortController>
): void {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigationRef = useRef<(pageNumber: number) => void>(() => undefined);
  const contextCache = useRef(new Map<number, string>());
  const requestControllers = useRef(new Map<string, AbortController>());
  const formulaRequestControllers = useRef(
    new Map<string, AbortController>()
  );
  const initialSourceRef = useRef<DocumentSource | null>(
    new URLSearchParams(window.location.search).get("demo") === "1"
      ? demoSource()
      : null
  );
  const [source, setSource] = useState<DocumentSource | null>(
    initialSourceRef.current
  );
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>(() =>
    initialSourceRef.current
      ? loadHighlights(initialSourceRef.current.id)
      : []
  );
  const highlightsRef = useRef(highlights);
  const [selection, setSelection] = useState<CapturedSelection | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, ExplanationRecord>>({});
  const [formulaRecognitionRecords, setFormulaRecognitionRecords] = useState<
    Record<string, FormulaRecognitionState>
  >({});
  const [mode, setMode] = useState<ExplainMode>("plain");
  const [currentPage, setCurrentPage] = useState(1);
  const [railOpen, setRailOpen] = useState(true);
  const [explanationOpen, setExplanationOpen] = useState(true);
  const [homeOpen, setHomeOpen] = useState(false);
  const [appError, setAppError] = useState("");
  const [providerStatus, setProviderStatus] =
    useState<ProviderStatus | null>(null);
  const [generatedVisualPreview, setGeneratedVisualPreview] = useState<
    string | undefined
  >();

  const activeHighlight = useMemo(
    () =>
      highlights.find((highlight) => highlight.id === activeHighlightId) ?? null,
    [activeHighlightId, highlights]
  );
  const activeRecord = activeHighlight
    ? records[recordKey(activeHighlight.id, mode)]
    : undefined;
  const activeFormulaRecognition = activeHighlight
    ? formulaRecognitionRecords[activeHighlight.id]
    : undefined;
  const activePersistedPreview =
    activeHighlight?.content.kind === "formula" ||
    activeHighlight?.content.kind === "diagram"
      ? activeHighlight.content.previewImage
      : undefined;
  const activeVisualPreview =
    generatedVisualPreview ?? activePersistedPreview;

  const releaseSource = useCallback((documentSource: DocumentSource | null) => {
    if (documentSource && !documentSource.isDemo && documentSource.url.startsWith("blob:")) {
      URL.revokeObjectURL(documentSource.url);
    }
  }, []);

  useEffect(() => {
    return () => {
      releaseSource(source);
      abortAllControllers(requestControllers.current);
      abortAllControllers(formulaRequestControllers.current);
    };
  }, [releaseSource, source]);

  useEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

  useEffect(() => {
    if (source) saveHighlights(source.id, highlights);
  }, [highlights, source]);

  useEffect(() => {
    setGeneratedVisualPreview(undefined);
    const content = activeHighlight?.content;
    if (!pdfDocument || !content || content.kind === "text" || !content.region) {
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | undefined;
    void renderPdfVisualCrop(
      pdfDocument,
      content.region,
      controller.signal,
      content.kind
    )
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setGeneratedVisualPreview(objectUrl);
      })
      .catch((error) => {
        if (!isAbortError(error)) setGeneratedVisualPreview(undefined);
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeHighlight, pdfDocument]);

  useEffect(() => {
    let active = true;
    const refreshProviderStatus = async () => {
      try {
        const response = await fetch("/api/health");
        if (!response.ok) return;
        const status = (await response.json()) as ProviderStatus;
        if (active) setProviderStatus(status);
      } catch {
        if (active) setProviderStatus(null);
      }
    };

    void refreshProviderStatus();
    const interval = window.setInterval(refreshProviderStatus, 15_000);
    window.addEventListener("focus", refreshProviderStatus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshProviderStatus);
    };
  }, []);

  const openSource = useCallback(
    (nextSource: DocumentSource) => {
      setSource((previous) => {
        releaseSource(previous);
        return nextSource;
      });
      const nextHighlights = loadHighlights(nextSource.id);
      highlightsRef.current = nextHighlights;
      setHighlights(nextHighlights);
      setActiveHighlightId(null);
      setSelection(null);
      setRecords({});
      setFormulaRecognitionRecords({});
      setMode("plain");
      setCurrentPage(1);
      setPdfDocument(null);
      contextCache.current.clear();
      abortAllControllers(requestControllers.current);
      abortAllControllers(formulaRequestControllers.current);
      setAppError("");
      setRailOpen(true);
      setExplanationOpen(true);
      setHomeOpen(false);
    },
    [releaseSource]
  );

  const openFile = useCallback(
    async (file: File) => {
      if (!isPdf(file)) {
        setAppError("Please choose a PDF file.");
        return;
      }
      if (file.size > 150 * 1024 * 1024) {
        setAppError("This first release supports PDFs up to 150 MB.");
        return;
      }

      try {
        openSource(await sourceFromFile(file));
      } catch {
        setAppError("The browser could not prepare this PDF.");
      }
    },
    [openSource]
  );

  const handleDocumentReady = useCallback((document: PDFDocumentProxy | null) => {
    setPdfDocument(document);
    contextCache.current.clear();
  }, []);

  const registerNavigation = useCallback(
    (goToPage: (pageNumber: number) => void) => {
      navigationRef.current = goToPage;
    },
    []
  );

  const getPageContext = useCallback(
    async (pageNumber: number): Promise<string> => {
      const cached = contextCache.current.get(pageNumber);
      if (cached !== undefined) return cached;
      if (!pdfDocument) return "";

      try {
        const page = await pdfDocument.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item) => {
            if ("str" in item && typeof item.str === "string") return item.str;
            return "";
          })
          .join(" ")
          .replace(/-\s+/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 16_000);
        contextCache.current.set(pageNumber, text);
        return text;
      } catch {
        return "";
      }
    },
    [pdfDocument]
  );

  const abortHighlightExplanations = useCallback((highlightId: string) => {
    for (const [key, controller] of requestControllers.current) {
      if (!key.startsWith(`${highlightId}:`)) continue;
      controller.abort();
      requestControllers.current.delete(key);
    }
  }, []);

  const abortHighlightFormulaRecognition = useCallback(
    (highlightId: string) => {
      formulaRequestControllers.current.get(highlightId)?.abort();
      formulaRequestControllers.current.delete(highlightId);
    },
    []
  );

  const runExplanation = useCallback(
    async (
      highlight: Highlight,
      explanationMode: ExplainMode,
      useExtractedText = false
    ) => {
      if (!source) return;
      const key = recordKey(highlight.id, explanationMode);
      requestControllers.current.get(key)?.abort();
      const controller = new AbortController();
      requestControllers.current.set(key, controller);

      setRecords((current) => ({
        ...current,
        [key]: {
          highlightId: highlight.id,
          mode: explanationMode,
          status: "loading",
          data: current[key]?.data
        }
      }));

      try {
        const pageNumber = highlight.pages[0]?.pageNumber ?? 1;
        const pageContext = await getPageContext(pageNumber);
        const selectedFormulaLatex = useExtractedText
          ? undefined
          : getEffectiveFormulaLatex(highlight);
        const result = await requestExplanation(
          {
            selectedText: highlight.text,
            ...(selectedFormulaLatex ? { selectedFormulaLatex } : {}),
            ...(highlight.content.kind === "diagram"
              ? {
                  visualContext: {
                    kind: "diagram" as const,
                    ...(highlight.content.layoutText
                      ? { layoutText: highlight.content.layoutText }
                      : {})
                  }
                }
              : {}),
            pageContext,
            pageNumber,
            documentTitle: source.name,
            mode: explanationMode
          },
          controller.signal
        );

        if (requestControllers.current.get(key) !== controller) return;
        setRecords((current) => ({
          ...current,
          [key]: {
            highlightId: highlight.id,
            mode: explanationMode,
            status: "success",
            data: result.explanation,
            model: result.model,
            provider: result.provider
          }
        }));
      } catch (error) {
        if (isAbortError(error)) {
          if (requestControllers.current.get(key) === controller) {
            setRecords((current) => {
              const record = current[key];
              if (record?.status !== "loading") return current;
              const { [key]: _removed, ...remaining } = current;
              return remaining;
            });
          }
          return;
        }
        if (requestControllers.current.get(key) !== controller) return;
        setRecords((current) => ({
          ...current,
          [key]: {
            highlightId: highlight.id,
            mode: explanationMode,
            status: "error",
            data: current[key]?.data,
            error:
              error instanceof Error
                ? error.message
                : "The passage could not be explained.",
            errorCode:
              error instanceof ExplainApiError ? error.code : undefined
          }
        }));
      } finally {
        if (requestControllers.current.get(key) === controller) {
          requestControllers.current.delete(key);
        }
      }
    },
    [getPageContext, source]
  );

  const recognizeAndExplain = useCallback(
    async (highlight: Highlight, explanationMode: ExplainMode) => {
      if (highlight.content.kind !== "formula") {
        await runExplanation(highlight, explanationMode);
        return;
      }
      const existingLatex = getEffectiveFormulaLatex(highlight);
      if (existingLatex) {
        await runExplanation(highlight, explanationMode);
        return;
      }
      if (!highlight.content.region && !highlight.content.previewImage) {
        await runExplanation(highlight, explanationMode);
        return;
      }

      abortHighlightFormulaRecognition(highlight.id);
      abortHighlightExplanations(highlight.id);
      setRecords((current) =>
        withoutHighlightRecords(current, highlight.id)
      );
      const controller = new AbortController();
      formulaRequestControllers.current.set(highlight.id, controller);
      const sourceKey = formulaSourceKey(highlight);

      setFormulaRecognitionRecords((current) => ({
        ...current,
        [highlight.id]: {
          highlightId: highlight.id,
          status: "loading"
        }
      }));

      try {
        let image: Blob | null = null;
        if (pdfDocument && highlight.content.region) {
          try {
            image = await renderPdfVisualCrop(
              pdfDocument,
              highlight.content.region,
              controller.signal
            );
          } catch (error) {
            if (isAbortError(error)) throw error;
          }
        }
        if (!image && highlight.content.previewImage) {
          image = formulaImageDataUrlToBlob(highlight.content.previewImage);
        }
        if (!image) {
          throw new FormulaRecognitionApiError(
            "The formula image could not be prepared. Wait for the PDF page to finish loading, then retry.",
            "INVALID_FORMULA_IMAGE"
          );
        }

        const result = await requestFormulaRecognition(image, controller.signal);
        const recognizedLatex = normalizeFormulaLatex(result.latex);
        if (!recognizedLatex) {
          throw new FormulaRecognitionApiError(
            "Formula OCR returned notation that KaTeX could not render.",
            "INVALID_FORMULA_RESPONSE"
          );
        }
        if (
          formulaRequestControllers.current.get(highlight.id) !== controller
        ) {
          return;
        }

        const latest = highlightsRef.current.find(
          (item) => item.id === highlight.id
        );
        if (
          !latest ||
          latest.content.kind !== "formula" ||
          formulaSourceKey(latest) !== sourceKey ||
          latest.content.notation?.correctedLatex
        ) {
          setFormulaRecognitionRecords((current) => {
            const { [highlight.id]: _removed, ...remaining } = current;
            return remaining;
          });
          return;
        }

        const updated: Highlight = {
          ...latest,
          content: {
            ...latest.content,
            notation: {
              ...latest.content.notation,
              recognizedLatex
            }
          }
        };
        const nextHighlights = highlightsRef.current.map((item) =>
          item.id === updated.id ? updated : item
        );
        highlightsRef.current = nextHighlights;
        setHighlights(nextHighlights);
        setRecords((current) =>
          withoutHighlightRecords(current, updated.id)
        );
        setFormulaRecognitionRecords((current) => {
          const { [updated.id]: _removed, ...remaining } = current;
          return remaining;
        });
        await runExplanation(updated, explanationMode);
      } catch (error) {
        if (isAbortError(error)) {
          if (
            formulaRequestControllers.current.get(highlight.id) === controller
          ) {
            setFormulaRecognitionRecords((current) => {
              const { [highlight.id]: _removed, ...remaining } = current;
              return remaining;
            });
          }
          return;
        }
        if (
          formulaRequestControllers.current.get(highlight.id) !== controller
        ) {
          return;
        }
        setFormulaRecognitionRecords((current) => ({
          ...current,
          [highlight.id]: {
            highlightId: highlight.id,
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : "The formula could not be transcribed.",
            errorCode:
              error instanceof FormulaRecognitionApiError
                ? error.code
              : "FORMULA_IMAGE_FAILED"
          }
        }));
      } finally {
        if (
          formulaRequestControllers.current.get(highlight.id) === controller
        ) {
          formulaRequestControllers.current.delete(highlight.id);
        }
      }
    },
    [
      abortHighlightExplanations,
      abortHighlightFormulaRecognition,
      pdfDocument,
      runExplanation
    ]
  );

  const explainHighlight = useCallback(
    (highlight: Highlight, explanationMode: ExplainMode) => {
      if (
        highlight.content.kind !== "formula" ||
        getEffectiveFormulaLatex(highlight) ||
        (!highlight.content.region && !highlight.content.previewImage)
      ) {
        void runExplanation(highlight, explanationMode);
      } else {
        void recognizeAndExplain(highlight, explanationMode);
      }
    },
    [recognizeAndExplain, runExplanation]
  );

  const keepSelection = useCallback(
    (openPanel: boolean): Highlight | null => {
      if (!selection || !source) return null;
      const existing = highlights.find(
        (highlight) =>
          isSameHighlightSelection(
            highlight,
            selection.text,
            selection.pages
          )
      );
      const selectedContent =
        existing?.content.kind === "text" &&
        selection.content.kind === "diagram"
          ? existing.content
          : selection.content;
      const selectionSourceChanged = existing
        ? hasSelectionSourceChanged(
            existing,
            selection.pages,
            selectedContent
          )
        : false;
      const highlight = existing
        ? selectionSourceChanged
          ? {
              ...existing,
              pages: selection.pages,
              content: selectedContent
            }
          : {
              ...existing,
              pages: selection.pages,
              content:
                existing.content.kind === "formula" &&
                selectedContent.kind === "formula"
                  ? {
                      ...existing.content,
                      ...selectedContent,
                      notation: existing.content.notation
                    }
                  : selectedContent
            }
        : createHighlight(
            source.id,
            selection.text,
            selection.pages,
            selection.content
          );

      if (existing && selectionSourceChanged) {
        abortHighlightFormulaRecognition(existing.id);
        abortHighlightExplanations(existing.id);
        setRecords((current) =>
          withoutHighlightRecords(current, existing.id)
        );
        setFormulaRecognitionRecords((current) => {
          const { [existing.id]: _removed, ...remaining } = current;
          return remaining;
        });
      }

      setHighlights((current) => {
        const next = existing
          ? current.map((item) => (item.id === existing.id ? highlight : item))
          : [highlight, ...current];
        highlightsRef.current = next;
        return next;
      });
      setActiveHighlightId(highlight.id);
      if (openPanel) setExplanationOpen(true);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      return highlight;
    },
    [
      abortHighlightExplanations,
      abortHighlightFormulaRecognition,
      highlights,
      selection,
      source
    ]
  );

  const explainSelection = useCallback(() => {
    const highlight = keepSelection(true);
    if (highlight) explainHighlight(highlight, mode);
  }, [explainHighlight, keepSelection, mode]);

  const handleModeChange = useCallback(
    (nextMode: ExplainMode) => {
      setMode(nextMode);
      if (!activeHighlight) return;
      const nextRecord = records[recordKey(activeHighlight.id, nextMode)];
      const hasAnyAnswer = Object.values(records).some(
        (record) =>
          record.highlightId === activeHighlight.id &&
          record.status === "success"
      );
      if (!nextRecord && hasAnyAnswer) {
        explainHighlight(activeHighlight, nextMode);
      }
    },
    [activeHighlight, explainHighlight, records]
  );

  const selectHighlight = useCallback((highlight: Highlight) => {
    setActiveHighlightId(highlight.id);
    setExplanationOpen(true);
    setSelection(null);
    navigationRef.current(highlight.pages[0]?.pageNumber ?? 1);
  }, []);

  const saveFormulaLatex = useCallback(
    (latex: string) => {
      if (!activeHighlightId) return;
      const normalized = normalizeFormulaLatex(latex);
      if (!normalized) return;
      abortHighlightFormulaRecognition(activeHighlightId);
      abortHighlightExplanations(activeHighlightId);
      setHighlights((current) => {
        const next = current.map((highlight) => {
          if (
            highlight.id !== activeHighlightId ||
            highlight.content.kind !== "formula"
          ) {
            return highlight;
          }
          return {
            ...highlight,
            content: {
              ...highlight.content,
              notation: {
                ...highlight.content.notation,
                correctedLatex: normalized
              }
            }
          };
        });
        highlightsRef.current = next;
        return next;
      });
      setRecords((current) =>
        withoutHighlightRecords(current, activeHighlightId)
      );
      setFormulaRecognitionRecords((current) => {
        const { [activeHighlightId]: _removed, ...remaining } = current;
        return remaining;
      });
    },
    [
      abortHighlightExplanations,
      abortHighlightFormulaRecognition,
      activeHighlightId
    ]
  );

  const resetFormulaLatex = useCallback(() => {
    if (!activeHighlightId) return;
    abortHighlightFormulaRecognition(activeHighlightId);
    abortHighlightExplanations(activeHighlightId);
    setHighlights((current) => {
      const next = current.map((highlight) => {
        if (
          highlight.id !== activeHighlightId ||
          highlight.content.kind !== "formula"
        ) {
          return highlight;
        }
        const recognizedLatex = highlight.content.notation?.recognizedLatex;
        return {
          ...highlight,
          content: {
            ...highlight.content,
            ...(recognizedLatex
              ? { notation: { recognizedLatex } }
              : { notation: undefined })
          }
        };
      });
      highlightsRef.current = next;
      return next;
    });
    setRecords((current) =>
      withoutHighlightRecords(current, activeHighlightId)
    );
    setFormulaRecognitionRecords((current) => {
      const { [activeHighlightId]: _removed, ...remaining } = current;
      return remaining;
    });
  }, [
    abortHighlightExplanations,
    abortHighlightFormulaRecognition,
    activeHighlightId
  ]);

  const treatActiveAsDiagram = useCallback(() => {
    if (!activeHighlight || activeHighlight.content.kind !== "text") return;
    const region = selectionRegionFromPages(activeHighlight.pages);
    if (!region) return;

    abortHighlightFormulaRecognition(activeHighlight.id);
    abortHighlightExplanations(activeHighlight.id);
    const updated: Highlight = {
      ...activeHighlight,
      content: { kind: "diagram", region }
    };
    setHighlights((current) => {
      const next = current.map((highlight) =>
        highlight.id === updated.id ? updated : highlight
      );
      highlightsRef.current = next;
      return next;
    });
    setRecords((current) =>
      withoutHighlightRecords(current, activeHighlight.id)
    );
    setFormulaRecognitionRecords((current) => {
      const { [activeHighlight.id]: _removed, ...remaining } = current;
      return remaining;
    });
  }, [
    abortHighlightExplanations,
    abortHighlightFormulaRecognition,
    activeHighlight
  ]);

  const treatActiveAsText = useCallback(() => {
    if (!activeHighlight || activeHighlight.content.kind !== "diagram") return;

    abortHighlightFormulaRecognition(activeHighlight.id);
    abortHighlightExplanations(activeHighlight.id);
    const updated: Highlight = {
      ...activeHighlight,
      content: { kind: "text" }
    };
    setHighlights((current) => {
      const next = current.map((highlight) =>
        highlight.id === updated.id ? updated : highlight
      );
      highlightsRef.current = next;
      return next;
    });
    setRecords((current) =>
      withoutHighlightRecords(current, activeHighlight.id)
    );
    setFormulaRecognitionRecords((current) => {
      const { [activeHighlight.id]: _removed, ...remaining } = current;
      return remaining;
    });
  }, [
    abortHighlightExplanations,
    abortHighlightFormulaRecognition,
    activeHighlight
  ]);

  const deleteActiveHighlight = useCallback(() => {
    if (!activeHighlightId) return;
    abortHighlightExplanations(activeHighlightId);
    abortHighlightFormulaRecognition(activeHighlightId);
    setHighlights((current) => {
      const next = current.filter(
        (highlight) => highlight.id !== activeHighlightId
      );
      highlightsRef.current = next;
      return next;
    });
    setRecords((current) =>
      withoutHighlightRecords(current, activeHighlightId)
    );
    setFormulaRecognitionRecords((current) => {
      const { [activeHighlightId]: _removed, ...remaining } = current;
      return remaining;
    });
    setActiveHighlightId(null);
  }, [
    abortHighlightExplanations,
    abortHighlightFormulaRecognition,
    activeHighlightId
  ]);

  const closeDocument = useCallback(() => {
    setSource((previous) => {
      releaseSource(previous);
      return null;
    });
    setPdfDocument(null);
    highlightsRef.current = [];
    setHighlights([]);
    setSelection(null);
    setActiveHighlightId(null);
    setRecords({});
    setFormulaRecognitionRecords({});
    abortAllControllers(requestControllers.current);
    abortAllControllers(formulaRequestControllers.current);
    contextCache.current.clear();
  }, [releaseSource]);

  const openHome = useCallback(() => {
    if (!source) return;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    setHomeOpen(true);
  }, [source]);

  const resumeReading = useCallback(() => {
    setHomeOpen(false);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(".reader-toolbar .page-indicator")
        ?.focus();
    });
  }, []);

  const closeCurrentDocument = useCallback(() => {
    closeDocument();
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(".empty-state .button-primary")
        ?.focus();
    });
  }, [closeDocument]);

  return (
    <div className="app">
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openFile(file);
          event.target.value = "";
        }}
      />

      <AppHeader
        source={source}
        homeOpen={homeOpen}
        explanationOpen={explanationOpen}
        onOpenFile={() => fileInputRef.current?.click()}
        onToggleExplanation={() => setExplanationOpen((open) => !open)}
        onHome={openHome}
      />

      {!source || homeOpen ? (
        <EmptyState
          onChooseFile={() => fileInputRef.current?.click()}
          onFileDrop={(file) => void openFile(file)}
          onOpenDemo={() => openSource(demoSource())}
          currentSource={source}
          onResume={source ? resumeReading : undefined}
          onCloseCurrent={source ? closeCurrentDocument : undefined}
          error={appError}
        />
      ) : null}

      {source ? (
        <main
          className={`reader-workspace${
            homeOpen ? " is-home-hidden" : ""
          }${railOpen ? " rail-is-open" : ""}${
            explanationOpen ? " explanation-is-open" : ""
          }`}
          aria-hidden={homeOpen || undefined}
          inert={homeOpen || undefined}
        >
          {railOpen ? (
            <LibraryRail
              currentPage={currentPage}
              numPages={pdfDocument?.numPages ?? 0}
              highlights={highlights}
              activeHighlightId={activeHighlightId}
              onGoToPage={(pageNumber) => navigationRef.current(pageNumber)}
              onSelectHighlight={selectHighlight}
              onCollapse={() => setRailOpen(false)}
            />
          ) : null}

          <PdfReader
            source={source}
            highlights={highlights}
            pendingSelection={selection}
            activeHighlightId={activeHighlightId}
            railOpen={railOpen}
            onOpenRail={() => setRailOpen(true)}
            onSelection={setSelection}
            onDocumentReady={handleDocumentReady}
            onPageChange={setCurrentPage}
            registerNavigation={registerNavigation}
          />

          {explanationOpen ? (
            <ExplanationPanel
              highlight={activeHighlight}
              mode={mode}
              record={activeRecord}
              formulaRecognition={activeFormulaRecognition}
              providerStatus={providerStatus}
              visualPreviewImage={activeVisualPreview}
              canTreatAsDiagram={Boolean(
                activeHighlight &&
                  isDiagramCandidateHighlight(activeHighlight)
              )}
              onModeChange={handleModeChange}
              onExplain={() => {
                if (activeHighlight) explainHighlight(activeHighlight, mode);
              }}
              onRecognizeFormula={() => {
                if (activeHighlight) {
                  void recognizeAndExplain(activeHighlight, mode);
                }
              }}
              onExplainWithExtractedText={() => {
                if (!activeHighlight) return;
                setFormulaRecognitionRecords((current) => {
                  const {
                    [activeHighlight.id]: _removed,
                    ...remaining
                  } = current;
                  return remaining;
                });
                void runExplanation(activeHighlight, mode, true);
              }}
              onSaveFormulaLatex={saveFormulaLatex}
              onResetFormulaLatex={resetFormulaLatex}
              onTreatAsDiagram={treatActiveAsDiagram}
              onTreatAsText={treatActiveAsText}
              onDelete={deleteActiveHighlight}
              onClose={() => setExplanationOpen(false)}
            />
          ) : null}
        </main>
      ) : null}

      {selection && !homeOpen ? (
        <SelectionPopover
          selection={selection}
          onHighlight={() => {
            keepSelection(false);
          }}
          onExplain={explainSelection}
        />
      ) : null}
    </div>
  );
}
