// Major dos Amigos — servidor de salas.
// Ele não roda o jogo: o navegador de quem cria a sala roda a partida, e o
// servidor só repassa o estado (dono -> amigos) e as jogadas (amigos -> dono).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const SENHA = process.env.SENHA || "";
const ROOM_TTL = 6 * 60 * 60 * 1000;
const PUB = path.join(__dirname, "public");
const FILES = { "/": ["index.html", "text/html"], "/index.html": ["index.html", "text/html"], "/online.js": ["online.js", "text/javascript"] };

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/healthz") { res.writeHead(200); return res.end("ok"); }
  const f = Object.prototype.hasOwnProperty.call(FILES, url) && FILES[url];
  if (!f) { res.writeHead(404); return res.end("Not found"); }
  const gz = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  const head = { "Content-Type": f[1] + "; charset=utf-8", "Cache-Control": "no-cache", "X-Robots-Tag": "noindex" };
  if (gz) head["Content-Encoding"] = "gzip";
  res.writeHead(200, head);
  const stream = fs.createReadStream(path.join(PUB, f[0]));
  (gz ? stream.pipe(require("zlib").createGzip()) : stream).pipe(res);
});

const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024, perMessageDeflate: { threshold: 2048 } });
const rooms = new Map(); // code -> { key, host, guests: Map<cid, ws>, last, seen }

const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(typeof obj === "string" ? obj : JSON.stringify(obj)); };
const hash = s => crypto.createHash("sha256").update(String(s)).digest();
const senhaOk = s => !SENHA || crypto.timingSafeEqual(hash(s || ""), hash(SENHA));
const newCode = () => { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let c; do c = Array.from({ length: 5 }, () => A[crypto.randomInt(A.length)]).join(""); while (rooms.has(c)); return c; };

wss.on("connection", ws => {
  let room = null, role = null, cid = null;
  ws.alive = true;
  ws.on("pong", () => ws.alive = true);
  ws.on("error", () => {});

  ws.on("message", raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "ping") return send(ws, { t: "pong" });

    if (!role) {
      if (m.t !== "create" && m.t !== "join") return;
      if (!senhaOk(m.senha)) return send(ws, { t: "error", code: "senha", msg: "Senha incorreta." });
      let code = String(m.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
      if (m.t === "create") {
        const key = String(m.key || "");
        if (key.length < 16) return;
        let r = code && rooms.get(code);
        if (r && r.key !== key) { code = ""; r = null; }
        if (!r) { code = code || newCode(); r = { key, host: null, guests: new Map(), last: null, seen: Date.now() }; rooms.set(code, r); }
        if (r.host && r.host !== ws) r.host.close(4000, "outra aba assumiu a sala");
        r.host = ws; room = r; role = "host";
        send(ws, { t: "created", code });
        for (const [id, g] of r.guests) { send(g, { t: "hostback" }); send(ws, { t: "join", cid: id, name: g.playerName }); }
      } else {
        const r = rooms.get(code);
        if (!r) return send(ws, { t: "error", code: "sala", msg: "Sala não encontrada. Confira o código." });
        cid = String(m.cid || "").slice(0, 40);
        if (cid.length < 16) return;
        if (!r.guests.has(cid) && r.guests.size >= 20) return send(ws, { t: "error", code: "cheia", msg: "Sala cheia." });
        const old = r.guests.get(cid);
        r.guests.set(cid, ws); if (old && old !== ws) old.close(4000, "reconectado");
        ws.playerName = String(m.name || "").slice(0, 18);
        room = r; role = "guest";
        send(ws, { t: "joined", code, hostOnline: !!r.host });
        if (r.last) send(ws, r.last);
        send(r.host, { t: "join", cid, name: ws.playerName });
      }
      return;
    }

    room.seen = Date.now();
    if (role === "host") {
      if (room.host !== ws) return;
      if (m.t === "state") { room.last = raw.toString(); for (const g of room.guests.values()) send(g, room.last); }
      else if (m.t === "to") send(room.guests.get(m.cid), m.data);
      else if (m.t === "handoff") { const g = room.guests.get(String(m.cid)); if (!g || !m.data) return; send(g, { t: "becomehost", key: room.key, data: m.data }); send(ws, { t: "handed" }); }
    } else if (m.t === "act") {
      if (raw.length > 400 * 1024) return;
      send(room.host, { t: "act", cid, a: m.a, v: m.v });
    }
  });

  ws.on("close", () => {
    if (!room) return;
    if (role === "host" && room.host === ws) { room.host = null; room.seen = Date.now(); for (const g of room.guests.values()) send(g, { t: "hostgone" }); }
    if (role === "guest" && room.guests.get(cid) === ws) { room.guests.delete(cid); send(room.host, { t: "leave", cid }); }
  });
});

setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
  for (const [code, r] of rooms) if (!r.host && !r.guests.size && Date.now() - r.seen > ROOM_TTL) rooms.delete(code);
}, 30000).unref();

server.listen(PORT, () => console.log(`Major dos Amigos em http://localhost:${PORT}${SENHA ? " (com senha)" : " (sem senha)"}`));
