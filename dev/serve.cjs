// Static server for the browser harness (dev/harness), laid out like a Foundry server:
//   /modules/starcrafting/*  -> this repository
//   /systems/dnd5e/*, /lib/*, /css, /fonts, /icons, /ui, /sounds -> the local Foundry install
//   anything else            -> dev/harness
// It listens on this computer only and never serves files outside those folders.
// Run with Foundry's bundled Node (set FOUNDRY_APP / FOUNDRY_DATA if Foundry is installed elsewhere):
//   ELECTRON_RUN_AS_NODE=1 "<Foundry>/Foundry Virtual Tabletop.exe" dev/serve.cjs   then open http://localhost:8731
const http = require("http"), fs = require("fs"), path = require("path");

const REPO = path.resolve(__dirname, "..");
const firstExisting = paths => paths.find(p => p && fs.existsSync(p)) ?? paths.find(Boolean);
const APP = firstExisting([
  process.env.FOUNDRY_APP,
  "C:/Program Files/Foundry Virtual Tabletop/resources/app",
  "C:/Program Files/Foundry10/Foundry Virtual Tabletop/resources/app"
]);
const DATA = firstExisting([
  process.env.FOUNDRY_DATA,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "FoundryVTT", "Data")
]);
const HARNESS = path.join(__dirname, "harness");
const ROUTES = [
  ["/modules/starcrafting/", REPO],
  ["/systems/dnd5e/", path.join(DATA, "systems", "dnd5e")],
  ["/lib/", path.join(APP, "node_modules")],
  ["/css/", path.join(APP, "public", "css")],
  ["/fonts/", path.join(APP, "public", "fonts")],
  ["/icons/", path.join(APP, "public", "icons")],
  ["/ui/", path.join(APP, "public", "ui")],
  ["/sounds/", path.join(APP, "public", "sounds")]
];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".hbs": "text/plain", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".wav": "audio/wav" };
const PORT = Number(process.env.PORT) || 8731;

/** The file a URL maps to, or null if it would fall outside its folder */
function resolveFile(url) {
  const route = ROUTES.find(([prefix]) => url.startsWith(prefix));
  const base = path.resolve(route ? route[1] : HARNESS);
  const rel = route ? url.slice(route[0].length) : (url === "/" ? "index.html" : url.slice(1));
  const file = path.resolve(base, rel);
  return (file === base) || file.startsWith(base + path.sep) ? file : null;
}

http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent(req.url.split("?")[0]);
  } catch {
    res.writeHead(400);
    return res.end("bad request");
  }
  const file = resolveFile(url);
  if ( !file ) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  fs.readFile(file, (err, data) => {
    if ( err ) {
      res.writeHead(404);
      return res.end(`not found: ${url}`);
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`Starcrafting harness on http://localhost:${PORT}`));
