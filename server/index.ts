import "dotenv/config";

import { fileURLToPath } from "node:url";
import path from "node:path";
import express, {
  type NextFunction,
  type Request,
  type Response
} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import {
  FormulaProviderError,
  getFormulaProviderStatus,
  MAX_FORMULA_IMAGE_BYTES,
  recognizeFormula,
  resolveFormulaProviderConfig
} from "./formula.js";
import {
  ExplainRequestSchema,
  generateExplanation,
  getProviderStatus,
  LlmProviderError,
  resolveProviderConfig
} from "./llm.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const isProduction = process.env.NODE_ENV === "production";
const providerConfig = resolveProviderConfig(process.env);
const formulaProviderConfig = resolveFormulaProviderConfig(process.env);

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", "blob:"],
        fontSrc: ["'self'", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        workerSrc: ["'self'", "blob:"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

const explainLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many explanation requests. Please wait a moment and try again.",
    code: "RATE_LIMITED"
  }
});

const formulaLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many formula recognition requests. Please wait a moment and try again.",
    code: "RATE_LIMITED"
  }
});

const formulaRoute = "/api/formula/recognize";
const isFormulaRoute = (request: Request) =>
  request.path.replace(/\/+$/, "") === formulaRoute;

app.post(
  formulaRoute,
  (_request: Request, response: Response, next: NextFunction) => {
    response.set("Cache-Control", "no-store");
    next();
  },
  formulaLimiter,
  express.raw({
    type: () => true,
    limit: MAX_FORMULA_IMAGE_BYTES,
    inflate: false
  }),
  async (request: Request, response: Response) => {
    const abortController = new AbortController();
    const abortProviderRequest = () => abortController.abort();
    const abortOnResponseClose = () => {
      if (!response.writableEnded) abortController.abort();
    };
    request.once("aborted", abortProviderRequest);
    response.once("close", abortOnResponseClose);

    try {
      const image =
        request.body instanceof Uint8Array
          ? request.body
          : new Uint8Array();
      response.json(
        await recognizeFormula(
          formulaProviderConfig,
          image,
          request.headers["content-type"],
          abortController.signal
        )
      );
    } catch (error) {
      const providerError =
        error instanceof FormulaProviderError
          ? error
          : new FormulaProviderError(
              "Formula recognition failed unexpectedly.",
              "FORMULA_PROVIDER_REQUEST_FAILED"
            );
      console.error("[formula]", providerError.message);
      response.status(providerError.status).json({
        error: providerError.message,
        code: providerError.code
      });
    } finally {
      request.off("aborted", abortProviderRequest);
      response.off("close", abortOnResponseClose);
    }
  }
);

app.all(formulaRoute, (_request: Request, response: Response) => {
  response
    .status(405)
    .set("Cache-Control", "no-store")
    .json({ error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" });
});

app.use(
  (
    error: unknown,
    request: Request,
    response: Response,
    next: NextFunction
  ) => {
    if (!isFormulaRoute(request)) {
      next(error);
      return;
    }

    const parserError = error as {
      status?: number;
      type?: string;
    };
    response.set("Cache-Control", "no-store");
    if (
      parserError.status === 413 ||
      parserError.type === "entity.too.large"
    ) {
      response.status(413).json({
        error: "The formula image exceeds the 2 MiB limit.",
        code: "FORMULA_IMAGE_TOO_LARGE"
      });
      return;
    }
    if (parserError.type === "encoding.unsupported") {
      response.status(415).json({
        error: "Compressed formula image requests are not supported.",
        code: "UNSUPPORTED_FORMULA_IMAGE"
      });
      return;
    }
    next(error);
  }
);

app.use(express.json({ limit: "64kb" }));

app.get("/api/health", async (_request: Request, response: Response) => {
  const [llmStatus, formulaStatus] = await Promise.all([
    getProviderStatus(providerConfig),
    getFormulaProviderStatus(formulaProviderConfig)
  ]);
  response.json({
    ok: true,
    ...llmStatus,
    formulaRecognition: formulaStatus
  });
});

app.post(
  "/api/explain",
  explainLimiter,
  async (request: Request, response: Response) => {
    response.set("Cache-Control", "no-store");
    const parsedRequest = ExplainRequestSchema.safeParse(request.body);

    if (!parsedRequest.success) {
      response.status(400).json({
        error: "The selected passage or page context is invalid.",
        code: "INVALID_REQUEST",
        issues: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
      return;
    }

    try {
      response.json(
        await generateExplanation(providerConfig, parsedRequest.data)
      );
    } catch (error) {
      const providerError =
        error instanceof LlmProviderError
          ? error
          : new LlmProviderError(
              "The explanation service failed unexpectedly.",
              "MODEL_REQUEST_FAILED"
            );

      console.error(`[explain:${providerConfig.provider}]`, providerError.message);
      response.status(providerError.status).json({
        error: providerError.message,
        code: providerError.code
      });
    }
  }
);

if (isProduction) {
  const currentFile = fileURLToPath(import.meta.url);
  const staticRoot = path.resolve(path.dirname(currentFile), "../dist");

  app.use(express.static(staticRoot, { index: false }));
  app.use((request: Request, response: Response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }

    response.sendFile(path.join(staticRoot, "index.html"));
  });
}

app.listen(port, () => {
  console.log(
    `Margin API listening on http://localhost:${port} (${providerConfig.label}: ${providerConfig.model})`
  );
});
