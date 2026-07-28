import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const cliArguments = process.argv.slice(2);
const positionalArguments = cliArguments.filter(
  (argument) => !argument.startsWith("--")
);
const targetUrl =
  positionalArguments[0] ?? "http://127.0.0.1:8787/?demo=1";
const screenshotPath =
  positionalArguments[1] ?? join(tmpdir(), "margin-smoke.png");
const exerciseSelection = cliArguments.includes("--exercise");
const uploadLocalPdf = cliArguments.includes("--upload-local");
const exerciseDiagram = cliArguments.includes("--diagram-page11");
const exerciseHomeResume = cliArguments.includes("--home-resume");
const debuggingPort = 9333;
const userDataDirectory = await mkdtemp(join(tmpdir(), "margin-chrome-"));
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--window-size=1440,1000",
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${userDataDirectory}`,
    "about:blank"
  ],
  { stdio: ["ignore", "ignore", "ignore"] }
);

async function waitForDebugger() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chrome debugging endpoint did not start.");
}

let socket;
let homeScreenshotPath;

try {
  await waitForDebugger();
  const pageResponse = await fetch(
    `http://127.0.0.1:${debuggingPort}/json/new?${encodeURIComponent(targetUrl)}`,
    { method: "PUT" }
  );
  const page = await pageResponse.json();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let messageId = 0;
  const pending = new Map();
  const browserMessages = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }

    if (message.method === "Runtime.exceptionThrown") {
      browserMessages.push(
        `exception: ${message.params.exceptionDetails.text} ${
          message.params.exceptionDetails.exception?.description ?? ""
        }`
      );
    }
    if (message.method === "Runtime.consoleAPICalled") {
      browserMessages.push(
        `console.${message.params.type}: ${message.params.args
          .map((argument) => argument.value ?? argument.description ?? "")
          .join(" ")}`
      );
    }
    if (message.method === "Log.entryAdded") {
      browserMessages.push(
        `${message.params.entry.level}: ${message.params.entry.text}`
      );
    }
  });

  function command(method, params = {}) {
    messageId += 1;
    socket.send(JSON.stringify({ id: messageId, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(messageId, { resolve, reject });
    });
  }

  await Promise.all([
    command("DOM.enable"),
    command("Page.enable"),
    command("Runtime.enable"),
    command("Log.enable")
  ]);
  await command("Page.navigate", { url: targetUrl });

  if (uploadLocalPdf) {
    let fileInput;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      fileInput = await command("Runtime.evaluate", {
        expression: `document.querySelector('input[type="file"]')`
      });
      if (fileInput.result.objectId) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!fileInput?.result.objectId) {
      throw new Error("PDF file input did not become available.");
    }
    const localPdfPath = resolve(
      process.env.SMOKE_PDF_PATH || "public/demo-paper.pdf"
    );
    await command("DOM.setFileInputFiles", {
      objectId: fileInput.result.objectId,
      files: [localPdfPath]
    });
    console.log(JSON.stringify({ uploaded: basename(localPdfPath) }));
  } else {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await new Promise((resolve) => setTimeout(resolve, 8_000));

  if (exerciseHomeResume) {
    const adjustmentResult = await command("Runtime.evaluate", {
      expression: `(() => {
        const page = document.querySelector(".page-indicator")?.textContent
          ?.replace(/\\s+/g, "") || "";
        const zoom = document.querySelector(".zoom-value")?.textContent?.trim() || "";
        const nextButton = document.querySelector('[aria-label="Next page"]');
        const zoomInButton = document.querySelector('[aria-label="Zoom in"]');
        if (!zoomInButton) {
          return { error: "Zoom in was not available" };
        }
        const advancePage = Boolean(nextButton && !nextButton.disabled);
        zoomInButton.click();
        return { page, zoom, advancePage };
      })()`,
      returnByValue: true
    });
    const adjustment = adjustmentResult.result.value;
    if (adjustment.error) {
      throw new Error(
        `Home/Resume smoke test failed: ${adjustment.error}.`
      );
    }

    let adjustedState;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const result = await command("Runtime.evaluate", {
        expression: `(() => ({
          page: document.querySelector(".page-indicator")?.textContent
            ?.replace(/\\s+/g, "") || "",
          zoom: document.querySelector(".zoom-value")?.textContent?.trim() || ""
        }))()`,
        returnByValue: true
      });
      adjustedState = result.result.value;
      if (adjustedState.zoom !== adjustment.zoom) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (adjustedState?.zoom === adjustment.zoom) {
      throw new Error(
        `Home/Resume smoke test could not establish non-default reader state: ${JSON.stringify(
          { before: adjustment, after: adjustedState }
        )}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 750));

    if (adjustment.advancePage) {
      const nextClick = await command("Runtime.evaluate", {
        expression: `(() => {
          const button = document.querySelector('[aria-label="Next page"]');
          if (!button || button.disabled) return false;
          button.click();
          return true;
        })()`,
        returnByValue: true
      });
      if (!nextClick.result.value) {
        throw new Error(
          "Home/Resume smoke test could not advance to a non-default page."
        );
      }

      for (let attempt = 0; attempt < 50; attempt += 1) {
        const result = await command("Runtime.evaluate", {
          expression: `(() => ({
            page: document.querySelector(".page-indicator")?.textContent
              ?.replace(/\\s+/g, "") || "",
            zoom: document.querySelector(".zoom-value")?.textContent?.trim() || ""
          }))()`,
          returnByValue: true
        });
        adjustedState = result.result.value;
        if (adjustedState.page !== adjustment.page) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (adjustedState?.page === adjustment.page) {
        throw new Error(
          `Home/Resume smoke test could not establish a non-default page: ${JSON.stringify(
            { before: adjustment, after: adjustedState }
          )}`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    const initialResult = await command("Runtime.evaluate", {
      expression: `(() => {
        const reader = document.querySelector(".pdf-reader");
        const workspace = document.querySelector(".reader-workspace");
        const homeButton = document.querySelector('[aria-label="Margin home"]');
        const isVisible = (element) => Boolean(
          element &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden"
        );
        if (!reader || !workspace || !homeButton) {
          return {
            error: "reader, workspace, or Home button was not available"
          };
        }
        if (!isVisible(reader)) {
          return { error: "reader was not visible before opening Home" };
        }

        window.__marginHomeResumeSmokeReader = reader;
        const initial = {
          page: document.querySelector(".page-indicator")?.textContent
            ?.replace(/\\s+/g, "") || "",
          zoom: document.querySelector(".zoom-value")?.textContent?.trim() || "",
          renderedCanvases: [...reader.querySelectorAll("canvas")].filter(
            (canvas) => canvas.width > 0 && canvas.height > 0
          ).length,
          textCharacters: [...reader.querySelectorAll(".textLayer")]
            .map((layer) => layer.textContent || "")
            .join(" ")
            .length,
          readerVisible: isVisible(reader),
          loadError: reader.querySelector(".pdf-error")?.textContent?.trim() || ""
        };
        homeButton.click();
        return { initial };
      })()`,
      returnByValue: true
    });
    const initialHomeResumeState = initialResult.result.value;
    if (initialHomeResumeState.error) {
      throw new Error(
        `Home/Resume smoke test failed: ${initialHomeResumeState.error}.`
      );
    }

    let homeState;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const result = await command("Runtime.evaluate", {
        expression: `(() => {
          const reader = document.querySelector(".pdf-reader");
          const workspace = document.querySelector(".reader-workspace");
          const buttons = [...document.querySelectorAll("button")];
          const resumeButton = buttons.find((button) =>
            button.textContent?.trim().startsWith("Resume reading")
          );
          const closeButton = buttons.find((button) =>
            button.textContent?.trim().startsWith("Close current PDF")
          );
          const isVisible = (element) => Boolean(
            element &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== "hidden"
          );
          return {
            resumeAvailable: Boolean(resumeButton),
            closeAvailable: Boolean(closeButton),
            readerRetained:
              Boolean(reader) &&
              reader === window.__marginHomeResumeSmokeReader,
            readerVisible: isVisible(reader),
            workspaceHidden: Boolean(
              workspace &&
              (workspace.hidden ||
                workspace.getAttribute("aria-hidden") === "true" ||
                workspace.hasAttribute("inert"))
            ),
            renderedCanvases: reader
              ? [...reader.querySelectorAll("canvas")].filter(
                  (canvas) => canvas.width > 0 && canvas.height > 0
                ).length
              : 0,
            textCharacters: reader
              ? [...reader.querySelectorAll(".textLayer")]
                  .map((layer) => layer.textContent || "")
                  .join(" ")
                  .length
              : 0,
            loadError: reader?.querySelector(".pdf-error")?.textContent?.trim() || ""
          };
        })()`,
        returnByValue: true
      });
      homeState = result.result.value;
      if (
        homeState.resumeAvailable &&
        homeState.closeAvailable &&
        homeState.readerRetained &&
        !homeState.readerVisible
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (
      !homeState?.resumeAvailable ||
      !homeState.closeAvailable ||
      !homeState.readerRetained ||
      homeState.readerVisible ||
      !homeState.workspaceHidden ||
      homeState.loadError ||
      homeState.renderedCanvases <
        initialHomeResumeState.initial.renderedCanvases ||
      homeState.textCharacters <
        initialHomeResumeState.initial.textCharacters
    ) {
      throw new Error(
        `Home/Resume smoke test failed while Home was open: ${JSON.stringify(
          homeState
        )}`
      );
    }

    homeScreenshotPath = screenshotPath.replace(
      /(\.[^./]+)?$/,
      "-home$1"
    );
    const homeScreenshot = await command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    await writeFile(
      homeScreenshotPath,
      Buffer.from(homeScreenshot.data, "base64")
    );

    const resumeClick = await command("Runtime.evaluate", {
      expression: `(() => {
        const button = [...document.querySelectorAll("button")].find(
          (candidate) =>
            candidate.textContent?.trim().startsWith("Resume reading")
        );
        if (!button) return false;
        button.click();
        return true;
      })()`,
      returnByValue: true
    });
    if (!resumeClick.result.value) {
      throw new Error("Home/Resume smoke test failed: Resume was not clickable.");
    }

    let resumedState;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const result = await command("Runtime.evaluate", {
        expression: `(() => {
          const reader = document.querySelector(".pdf-reader");
          const workspace = document.querySelector(".reader-workspace");
          const isVisible = (element) => Boolean(
            element &&
            element.getClientRects().length > 0 &&
            getComputedStyle(element).visibility !== "hidden"
          );
          return {
            page: document.querySelector(".page-indicator")?.textContent
              ?.replace(/\\s+/g, "") || "",
            zoom: document.querySelector(".zoom-value")?.textContent?.trim() || "",
            readerRetained:
              Boolean(reader) &&
              reader === window.__marginHomeResumeSmokeReader,
            readerVisible: isVisible(reader),
            workspaceHidden: Boolean(
              workspace &&
              (workspace.hidden ||
                workspace.getAttribute("aria-hidden") === "true" ||
                workspace.hasAttribute("inert"))
            ),
            renderedCanvases: reader
              ? [...reader.querySelectorAll("canvas")].filter(
                  (canvas) => canvas.width > 0 && canvas.height > 0
                ).length
              : 0,
            textCharacters: reader
              ? [...reader.querySelectorAll(".textLayer")]
                  .map((layer) => layer.textContent || "")
                  .join(" ")
                  .length
              : 0,
            loadError: reader?.querySelector(".pdf-error")?.textContent?.trim() || ""
          };
        })()`,
        returnByValue: true
      });
      resumedState = result.result.value;
      if (
        resumedState.readerRetained &&
        resumedState.readerVisible &&
        resumedState.page === initialHomeResumeState.initial.page &&
        resumedState.zoom === initialHomeResumeState.initial.zoom &&
        resumedState.renderedCanvases >=
          initialHomeResumeState.initial.renderedCanvases &&
        resumedState.textCharacters >=
          initialHomeResumeState.initial.textCharacters
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (
      !resumedState?.readerRetained ||
      !resumedState.readerVisible ||
      resumedState.workspaceHidden ||
      resumedState.loadError ||
      resumedState.page !== initialHomeResumeState.initial.page ||
      resumedState.zoom !== initialHomeResumeState.initial.zoom ||
      resumedState.renderedCanvases <
        initialHomeResumeState.initial.renderedCanvases ||
      resumedState.textCharacters <
        initialHomeResumeState.initial.textCharacters
    ) {
      throw new Error(
        `Home/Resume smoke test failed after Resume: ${JSON.stringify({
          initial: initialHomeResumeState.initial,
          resumed: resumedState
        })}`
      );
    }

    console.log(
      JSON.stringify({
        homeResume: {
          initial: initialHomeResumeState.initial,
          home: homeState,
          resumed: resumedState
        }
      })
    );
  }

  if (exerciseDiagram) {
    await command("Runtime.evaluate", {
      expression: `document.querySelector('[data-page-slot="11"]')?.scrollIntoView({ block: "start" })`
    });

    let diagramLayerReady = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const layerState = await command("Runtime.evaluate", {
        expression: `(() => {
          const page = document.querySelector('[data-pdf-page="11"]');
          return Boolean(
            page?.querySelector("canvas")?.width &&
            page?.querySelector(".textLayer span[role='presentation']")
          );
        })()`,
        returnByValue: true
      });
      if (layerState.result.value) {
        diagramLayerReady = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!diagramLayerReady) {
      throw new Error("Page 11 text layer did not become available.");
    }

    const diagramSelection = await command("Runtime.evaluate", {
      expression: `(() => {
        const page = document.querySelector('[data-pdf-page="11"]');
        const pageRect = page.getBoundingClientRect();
        const spans = [...page.querySelectorAll(".textLayer span[role='presentation']")];
        const diagramSpans = spans.filter((span) => {
          const bounds = span.getBoundingClientRect();
          const centerX = (bounds.left + bounds.right) / 2;
          const centerY = (bounds.top + bounds.bottom) / 2;
          const x = (centerX - pageRect.left) / pageRect.width;
          const y = (centerY - pageRect.top) / pageRect.height;
          return x >= 0.43 && x <= 0.56 && y >= 0.22 && y <= 0.34;
        });
        const first = diagramSpans[0];
        const last = diagramSpans.at(-1);
        if (!first?.firstChild || !last?.firstChild) {
          return { error: "diagram glyphs not found", count: diagramSpans.length };
        }

        const firstRect = first.getBoundingClientRect();
        const lastRect = last.getBoundingClientRect();
        first.dispatchEvent(new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: firstRect.left + 1,
          clientY: firstRect.top + firstRect.height / 2
        }));
        const range = document.createRange();
        range.setStart(first.firstChild, 0);
        range.setEnd(last.firstChild, last.firstChild.textContent.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        last.dispatchEvent(new MouseEvent("mouseup", {
          bubbles: true,
          button: 0,
          clientX: lastRect.right - 1,
          clientY: lastRect.top + lastRect.height / 2
        }));
        return {
          count: diagramSpans.length,
          text: selection.toString()
        };
      })()`,
      returnByValue: true
    });
    await new Promise((resolve) => setTimeout(resolve, 750));

    const keepResult = await command("Runtime.evaluate", {
      expression: `(() => {
        const button = [...document.querySelectorAll(".selection-popover button")]
          .find((candidate) => candidate.textContent?.includes("Keep"));
        if (!button) return "selection popover not found";
        button.click();
        return "diagram kept";
      })()`,
      returnByValue: true
    });
    console.log(
      JSON.stringify({
        diagramSelection: diagramSelection.result.value,
        diagramAction: keepResult.result.value
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  if (exerciseSelection) {
    const selectionResult = await command("Runtime.evaluate", {
      expression: `(() => {
        const target = [...document.querySelectorAll(".textLayer span")].find(
          (span) => span.textContent?.includes("The denominator contains")
        );
        if (!target) return "selection target not found";
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return target.textContent;
      })()`,
      returnByValue: true
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const actionResult = await command("Runtime.evaluate", {
      expression: `(() => {
        const button = document.querySelector(".selection-popover button");
        if (!button) return "selection popover not found";
        button.click();
        return "explanation requested";
      })()`,
      returnByValue: true
    });
    console.log(
      JSON.stringify({
        selected: selectionResult.result.value,
        action: actionResult.result.value
      })
    );

    for (let attempt = 0; attempt < 90; attempt += 1) {
      const answerState = await command("Runtime.evaluate", {
        expression: `JSON.stringify({
          answer: document.querySelector(".explanation-answer")?.innerText.slice(0, 500) || "",
          error: document.querySelector(".explanation-error")?.innerText || "",
          loading: Boolean(document.querySelector(".explanation-loading"))
        })`,
        returnByValue: true
      });
      const parsed = JSON.parse(answerState.result.value);
      if (parsed.answer || parsed.error || !parsed.loading) {
        console.log(JSON.stringify({ explanation: parsed }));
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  const state = await command("Runtime.evaluate", {
    expression: `JSON.stringify({
      title: document.title,
      canvases: document.querySelectorAll(".pdf-page-shell canvas").length,
      renderedCanvases: [...document.querySelectorAll(".pdf-page-shell canvas")].filter(
        (canvas) => canvas.width > 0 && canvas.height > 0
      ).length,
      textLayers: document.querySelectorAll(".pdf-page-shell .textLayer").length,
      pages: document.querySelectorAll("[data-pdf-page]").length,
      loading: Boolean(document.querySelector(".document-loading")),
      error: document.querySelector(".pdf-error")?.textContent?.trim() || "",
      documentName: document.querySelector(".document-name")?.textContent?.trim() || "",
      hasExpectedText: [...document.querySelectorAll(".textLayer")].some(
        (layer) => layer.textContent?.includes("The denominator contains")
      ),
      diagram: {
        visible: Boolean(document.querySelector(".selection-diagram")),
        image: Boolean(document.querySelector(".selection-diagram img")),
        formulaControls: Boolean(
          document.querySelector(".selection-diagram .formula-enter-button, .selection-diagram .formula-recognition-status")
        ),
        rawText: document.querySelector(".diagram-extracted-details")?.textContent?.trim() || "",
        highlightedRects: document.querySelectorAll(
          '[data-pdf-page="11"] .highlight-rect'
        ).length
      },
      bodyText: document.body.innerText.slice(0, 500)
    })`,
    returnByValue: true
  });
  const parsedState = JSON.parse(state.result.value);
  const screenshot = await command("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  console.log(JSON.stringify(parsedState));
  if (browserMessages.length > 0) {
    console.log(browserMessages.join("\n"));
  }
  console.log(`Screenshot: ${screenshotPath}`);
  if (homeScreenshotPath) {
    console.log(`Home screenshot: ${homeScreenshotPath}`);
  }

  if (
    parsedState.error ||
    parsedState.loading ||
    parsedState.pages < 1 ||
    parsedState.canvases < 1 ||
    parsedState.renderedCanvases < 1 ||
    parsedState.textLayers < 1 ||
    (uploadLocalPdf &&
      !exerciseDiagram &&
      (parsedState.pages !== 3 ||
        parsedState.documentName !== "demo-paper" ||
        !parsedState.hasExpectedText)) ||
    (exerciseDiagram &&
      (!parsedState.diagram.visible ||
        !parsedState.diagram.image ||
        parsedState.diagram.formulaControls ||
        parsedState.diagram.highlightedRects < 1)) ||
    browserMessages.some((message) =>
      /blob:.*connect-src|connect-src.*blob:/i.test(message)
    )
  ) {
    throw new Error(
      `PDF smoke test failed: ${parsedState.error || "the document did not finish rendering."}`
    );
  }
} finally {
  socket?.close();
  chrome.kill("SIGTERM");
  await new Promise((resolve) => {
    if (chrome.exitCode !== null) resolve();
    else chrome.once("exit", resolve);
  });
  await rm(userDataDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}
