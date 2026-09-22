// Local data store for the Rodin Pipeline dev/preview server (plain JS: no node typings needed).
// Settings and the autosaved work are kept as files in rodin-pipeline/user-data/, so they
// survive browser, profile and port changes.
//   GET    /__rodin/ping              -> "ok"
//   GET    /__rodin/data/<key>        -> file bytes (404 when missing)
//   PUT    /__rodin/data/<key>        -> writes the request body atomically
//   DELETE /__rodin/data/<key>        -> removes the file
import { promises as fs } from "node:fs";
import path from "node:path";

const userDataDir = new URL("./user-data", import.meta.url).pathname;
const keyPattern = /^[a-z][a-z0-9-]{0,40}$/;

async function handle(req, res, next) {
  const url = req.url ?? "";
  if (url === "/__rodin/ping") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end("ok");
    return;
  }
  const match = /^\/__rodin\/data\/([^/?#]+)$/.exec(url);
  if (!match) return next();
  const key = match[1];
  if (!keyPattern.test(key)) {
    res.statusCode = 400;
    res.end("bad key");
    return;
  }
  const file = path.join(userDataDir, key);
  try {
    if (req.method === "GET") {
      const data = await fs.readFile(file);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.end(data);
    } else if (req.method === "PUT") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      await fs.mkdir(userDataDir, { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, Buffer.concat(chunks));
      await fs.rename(tmp, file);
      res.statusCode = 204;
      res.end();
    } else if (req.method === "DELETE") {
      await fs.rm(file, { force: true });
      res.statusCode = 204;
      res.end();
    } else {
      res.statusCode = 405;
      res.end();
    }
  } catch (err) {
    const missing = err && err.code === "ENOENT";
    // A missing key answers 204 (not 404) so the browser console stays free of failed-load noise.
    res.statusCode = missing ? 204 : 500;
    if (missing) res.setHeader("X-Rodin-Missing", "1");
    res.end(missing ? undefined : String(err));
  }
}

export function userDataPlugin() {
  return {
    name: "rodin-user-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
  };
}
