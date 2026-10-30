import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function loadApiHandler(filename) {
  const filePath = resolve(process.cwd(), "api", filename);
  return import(pathToFileURL(filePath).href);
}

function localApiPlugin() {
  const routes = {
    "/api/ai": () => loadApiHandler("ai.js"),
    "/api/admin": () => loadApiHandler("admin.js"),
    "/api/index-book": () => loadApiHandler("index-book.js"),
    "/api/ask-book": () => loadApiHandler("ask-book.js"),
  };

  return {
    name: "campusflow-local-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const route = routes[(req.url || "").split("?")[0]];
        if (!route) return next();

        try {
          if (req.method === "POST") {
            const body = [];
            for await (const chunk of req) body.push(chunk);
            const rawBody = Buffer.concat(body).toString("utf8");
            req.body = rawBody ? JSON.parse(rawBody) : {};
          }

          const { default: handler } = await route();
          const response = {
            status(code) {
              res.statusCode = code;
              return this;
            },
            setHeader(name, value) {
              res.setHeader(name, value);
              return this;
            },
            json(payload) {
              if (!res.headersSent) {
                res.setHeader("Content-Type", "application/json; charset=utf-8");
              }
              res.end(JSON.stringify(payload));
              return res;
            },
          };

          await handler(req, response);
        } catch (error) {
          console.error("Local API route failed:", error);
          if (!res.headersSent) {
            res.statusCode = error instanceof SyntaxError ? 400 : 500;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          if (!res.writableEnded) {
            res.end(JSON.stringify({ error: error instanceof SyntaxError ? "Request body must be valid JSON." : "Local API route failed." }));
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const [name, value] of Object.entries(env)) {
    if (process.env[name] === undefined) process.env[name] = value;
  }

  return {
    plugins: [react(), localApiPlugin()],
    server: { host: "0.0.0.0" },
  };
});
