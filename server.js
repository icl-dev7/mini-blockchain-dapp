/**
 * Servidor estático mínimo para a interface (sem dependências).
 * Serve a pasta frontend/ e a biblioteca ethers instalada em node_modules.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "frontend");
const ALIASES = {
  "/vendor/ethers.umd.min.js": path.join(__dirname, "node_modules", "ethers", "dist", "ethers.umd.min.js"),
};
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function resolve(urlPath) {
  if (ALIASES[urlPath]) return ALIASES[urlPath];
  const file = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
  return file.startsWith(ROOT) ? file : null; // bloqueia ../
}

function start(port = Number(process.env.PORT) || 3000) {
  const server = http.createServer((req, res) => {
    const file = resolve(decodeURIComponent(req.url.split("?")[0]));
    if (!file) return res.writeHead(403).end();
    fs.readFile(file, (err, body) => {
      if (err) return res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Não encontrado");
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    });
  });
  return new Promise((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(port, "127.0.0.1", () => {
      console.log(`Interface disponível em http://localhost:${port}`);
      resolveStart(server);
    });
  });
}

if (require.main === module) start();

module.exports = { start };
