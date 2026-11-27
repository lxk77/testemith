// Major dos Amigos — camada online. Roda por cima do jogo original sem mudar as regras.
// "host" = quem criou a sala (o jogo roda no navegador dele). "guest" = amigo.
(function () {
  "use strict";
  const SKEY = "mda-online-v1";
  const NET = { role: null, ws: null, code: "", key: "", senha: "", name: "", cid: "", seats: {}, online: new Set(), seat: -1,
    hostView: null, hostCur: null, hostBack: false, base: null, pending: {}, sig: "", dirty: false, status: "", got: false, retry: 0, lastSent: "" };
  window.NET = NET;
  const MINE = ["name", "color", "logo", "logoImg", "team", "tac", "plans", "captain"];
  const O = {}; // funções originais do jogo
  const rid = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, "0")).join(""); };
  const clean = s => String(s || "").replace(/[<>"'`\\&]/g, "").trim().slice(0, 18);
  const J = JSON.stringify;
  const store = (k, v) => { try { localStorage.setItem(k, J(v)); } catch (e) { } };
  const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const isHost = () => NET.role === "host", isGuest = () => NET.role === "guest";
  const me = () => (NET.seat >= 0 && typeof S !== "undefined" && S.mgrs && !S.mgrs[NET.seat]) ? -1 : NET.seat;

  // Timers num Web Worker: o navegador não freia o jogo quando a aba do dono fica em segundo plano.
  function workerTimers() {
    try {
      const w = new Worker(URL.createObjectURL(new Blob([
        "const t={};onmessage=e=>{const[c,id,ms]=e.data;if(c){t[id]=setInterval(()=>postMessage(id),ms)}else{clearInterval(t[id]);delete t[id]}}"], { type: "text/javascript" })));
      const fns = new Map(); let n = 1e9;
      const nativeClear = window.clearInterval.bind(window);
      w.onmessage = e => { const f = fns.get(e.data); if (f) f(); };
      window.setInterval = (f, ms) => { const id = ++n; fns.set(id, f); w.postMessage([1, id, ms || 0]); return id; };
      window.clearInterval = id => { if (fns.delete(id)) w.postMessage([0, id]); else nativeClear(id); };
    } catch (e) { }
  }

  // ---------- conexão ----------
  function connect() {
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
    NET.ws = ws;
    ws.onopen = () => ws.send(J(isHost() ? { t: "create", code: NET.code, key: NET.key, senha: NET.senha } : { t: "join", code: NET.code, cid: NET.cid, name: NET.name, senha: NET.senha }));
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
    ws.onclose = e => {
      if (NET.ws !== ws || !NET.role) return;
      if (e.code === 4000) { NET.status = "Sala aberta em outra aba"; bar(); return; }
      NET.status = "Reconectando…"; bar();
      setTimeout(connect, Math.min(1000 + NET.retry++ * 1000, 5000));
    };
  }
  window.chatTx = text => tx({ t: "chat", text, name: NET.name || (typeof S !== "undefined" && S.mgrs && S.mgrs[NET.seat] ? S.mgrs[NET.seat].name : "") || "" });
  const tx = o => { if (NET.ws && NET.ws.readyState === 1) NET.ws.send(J(o)); };
  const toGuest = (cid, data) => tx({ t: "to", cid, data });

  function onMsg(m) {
    if (m.t === "error") {
      // sala sumiu no meio do jogo (servidor reiniciou): espera o dono recriar
      if (m.code === "sala" && NET.got) { NET.status = "Esperando o dono da sala voltar…"; bar(); return NET.ws.close(); }
      const role = NET.role; NET.role = null; NET.ws.close();
      if (role && NET.installed) { sessionStorage.setItem("mda-err", m.msg); location.reload(); } else entry(m.msg);
      return;
    }
    if (m.t === "chat") { if (window.chatPush) window.chatPush(m); return; }
    if (isHost()) {
      if (m.t === "created") { NET.code = m.code; NET.retry = 0; NET.status = ""; NET.lastSent = ""; if (!NET.installed) startHost(); saveSession(); bar(); }
      else if (m.t === "join") hostJoin(m.cid, clean(m.name));
      else if (m.t === "leave") { NET.online.delete(m.cid); bar(); }
      else if (m.t === "handed") handDone();
      else if (m.t === "act") { try { hostAct(m.cid, m.a, m.v); } catch (e) { console.error(e); } }
    } else {
      if (m.t === "joined") { NET.retry = 0; NET.status = m.hostOnline ? "" : "Dono da sala desconectado"; if (!NET.installed) startGuest(); bar(); }
      else if (m.t === "state") applyState(m);
      else if (m.t === "seat") { const first = NET.seat !== m.seat; NET.seat = m.seat; if (first) { NET.base = null; NET.sig = ""; seatUI(); if (NET.got) O.render(), decorate(); } bar(); if (m.seat < 0) toast("Você está assistindo: o jogo já começou ou a sala está cheia."); }
      else if (m.t === "toast") toast(esc(String(m.msg)));
      else if (m.t === "hostgone") { NET.status = "Dono da sala desconectado. O jogo está parado."; bar(); }
      else if (m.t === "hostback") { NET.status = ""; bar(); }
      else if (m.t === "becomehost") becomeHost(m);
    }
  }
  setInterval.call(window, () => tx({ t: "ping" }), 25000); // mantém o plano grátis do Render acordado durante o jogo

  function saveSession() {
    if (isHost()) store(SKEY, { role: "host", code: NET.code, key: NET.key, name: NET.name, seats: NET.seats, hostUid: NET.hostUid, spectate: !!NET.spectate });
    try { sessionStorage.setItem("mda-senha", NET.senha); } catch (e) { }
  }

  // ---------- comum aos dois ----------
  function seatUI() { if (me() >= 0) { S.ui.bidAs = me(); S.ui.lineupOf = me(); } }
  const busy = () => { const a = document.activeElement; return !!drag || (a && (a.tagName === "SELECT" || (a.tagName === "INPUT" && /text|number/.test(a.type)))); };
  function safeRender() { if (busy()) { NET.dirty = true; return; } NET.dirty = false; render(); }
  document.addEventListener("focusout", () => setTimeout(() => { if (NET.role && NET.dirty && !busy()) { NET.dirty = false; render(); } }, 50));

  function installCommon() {
    NET.installed = true;
    document.getElementById("netentry")?.remove();
    for (const k of ["render", "save", "tacBox", "updClutch", "clutchPick", "startAuction", "resetAll", "closeLot", "applyBid", "passLot", "startLive", "nextAfterLive", "openSeries", "toTour", "go", "vetoAct", "setSpeed", "togglePause", "togglePauseA", "skipLive", "simSeries", "autoVeto", "setCfg", "cpuVetoHook", "vetoClock", "runLive", "startAuctionTimer"]) O[k] = window[k];
    window.render = () => { if (me() >= 0) { S.ui.bidAs = me(); if (S.view === "lineup" && S.ui.lineupOf == null) S.ui.lineupOf = me(); } O.render(); decorate(); };
    // cada um só vê a própria tática
    window.tacBox = i => i === me() ? tacPanel(i) : '<p class="mut small">Tática oculta para o adversário.</p>';
    // round decisivo: só quem está na vez vê as opções
    window.updClutch = () => {
      const C = S.live && S.live.clutch, el = document.getElementById("clutch");
      if (C && !C.reveal && el) {
        C.handoff = false;
        const s = curS(), who = [s.a, s.b][C.queue[0]];
        if (who !== me()) {
          const left = Math.max(0, Math.ceil((C.deadline - Date.now()) / 1000));
          el.className = "clutch on";
          el.innerHTML = `<div class="clbox"><div class="row between"><span class="kicker">Round decisivo</span><b class="cltime num">${left}s</b></div><h3>Esperando ${tname(who)}</h3><p class="mut">A jogada dele fica escondida até a revelação.</p></div>`;
          return;
        }
      }
      O.updClutch();
    };
  }

  // esconde/desativa o que não é seu
  function decorate() {
    const mineI = me(), off = el => { el.disabled = true; el.classList.add("net-off"); };
    const q = s => document.querySelectorAll(s);
    if (S.view === "lobby") {
      q(".prow").forEach((row, i) => {
        if (isGuest() && i !== mineI) row.querySelectorAll("button,input").forEach(off);
        if (isGuest() && i === mineI) row.querySelectorAll(".pill,.x").forEach(off);
        if (isHost() && i === mineI) row.querySelectorAll(".pill,.x").forEach(off);
        const m = S.mgrs[i], pill = row.querySelector(".pill");
        if (pill && m && !m.cpu) pill.textContent = i === mineI ? "VOCÊ" : (m.net === false ? "OFFLINE" : "AMIGO");
      });
      if (isGuest()) q(".lobby .rules button,.lobby .row.add button,.lobby .cta button,.lobby .testtog input,.hero button[onclick*=\"go(\"]").forEach(off);
      q(".row.add button").forEach(b => { if (b.textContent.includes("Humano")) b.remove(); });
      if (isHost() && !document.getElementById("spectog")) { const add = document.querySelector(".lobby .row.add"); if (add) { const b = document.createElement("button"); b.id = "spectog"; b.className = "btn glass sm"; b.textContent = NET.spectate ? "Jogar também" : "Só assistir"; b.onclick = () => setSpectate(!NET.spectate); add.appendChild(b); } }
      q(".lobby .panel p.mut").forEach(p => { if (p.textContent.startsWith("Humanos jogam")) p.textContent = "Cada amigo entra pelo link da sala, no próprio computador ou celular. Bots dão lance sozinhos."; });
    }
    if (S.view === "auction" && mineI < 0) q("#btns button, #bidc, #passb, #bidv").forEach(off);
    if (S.view === "lineup") {
      const i = S.ui.lineupOf ?? 0;
      if (i !== mineI) q("main select, main .pmark, main .prow2 button, main .benchp, main .capbtn, main .tacgrid button, main button[onclick^=\"autoPlan\"], main button[onclick^=\"copyPlan\"]").forEach(off);
      q("main input[onchange*=\"freeDrag\"], main button[onclick^=\"resetPosxy\"]").forEach(el => { if (isGuest()) off(el); });
    }
    if (S.view === "tour" && isGuest()) q("main button[onclick^=\"simSeries\"], main button[onclick^=\"ask(\"]").forEach(off);
    if (S.view === "tour" && isGuest()) q("main .match:not(.done) button[onclick^=\"openSeries\"]").forEach(b => b.textContent = "Aguardando");
    if (S.view === "series") {
      q("main button[onclick^=\"editPlan\"]").forEach(b => { if (!b.getAttribute("onclick").startsWith(`editPlan(${mineI},`)) b.closest(".row").remove(); });
      const s = S.tour && S.cur != null && curS();
      if (s && !s.maps.length) {
        const seq = vetoSeq(s.fmt), step = seq[s.veto.step], turn = step ? (step[0] ? s.b : s.a) : -2;
        if (turn !== mineI) {
          q("main .vcard").forEach(b => { b.disabled = true; b.classList.remove("can"); });
          const t = document.getElementById("vtime"); if (t) t.remove();
          q("main .vteam .mut").forEach(x => { if (x.textContent === "sua vez") x.textContent = "escolhendo…"; });
        }
      }
      const inIt = s && (s.a === mineI || s.b === mineI);
      if (isGuest()) {
        q("main .ctrls button, main button[onclick^=\"autoVeto\"]").forEach(off);
        if (!inIt) q("main button[onclick^=\"startLive\"], main button[onclick^=\"nextAfterLive\"]").forEach(off);
      }
    }
    if (isGuest()) q(".dock").forEach(d => d.remove());
    bar();
  }

  function bar() {
    if (!NET.role) return;
    let el = document.getElementById("netbar");
    if (!el) {
      el = document.createElement("div"); el.id = "netbar"; document.body.appendChild(el);
      el.addEventListener("click", e => {
        const a = e.target.dataset.a;
        if (a === "copy") { const link = location.origin + "/?sala=" + NET.code; (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast("Link copiado. Manda pros amigos."), () => prompt("Copie o link:", link)); }
        if (a === "min") el.classList.toggle("min");
        if (a === "hand") handMenu();
        if (a === "out" && (e.target.classList.contains("nb-stop") || confirm("Sair da sala?"))) { NET.role = null; try { sessionStorage.removeItem("mda-auto"); } catch (x) { } location.href = location.pathname; }
      });
    }
    document.body.classList.toggle("netspec", me() < 0);
    const n = isHost() && S.mgrs ? NET.online.size + 1 : null;
    const html = `<button data-a="min" class="nb-code" title="Recolher">Sala <b>${NET.code || "…"}</b></button><span class="nb-x">${NET.status ? `<em>${NET.status}</em>` : n ? `<span>${n} online</span>` : `<span>${isGuest() && me() < 0 ? "assistindo" : "conectado"}</span>`}<button data-a="copy">Copiar link</button>${isHost() && canHand() && NET.online.size ? `<button data-a="hand">Passar anfitrião</button>` : ""}${isGuest() && me() < 0 ? `<button data-a="out" class="nb-stop">Parar de assistir</button>` : `<button data-a="out">Sair</button>`}</span>`;
    if (el._h !== html) el.innerHTML = el._h = html;
  }

  // ---------- DONO DA SALA ----------
  const ensureUids = () => S.mgrs.forEach(m => { if (!m.uid) m.uid = rid(); });
  const seatOf = cid => NET.seats[cid] ? S.mgrs.findIndex(m => m.uid === NET.seats[cid] && (!m.cpu || m.awayBot)) : -1;
  // caiu no leilão: o time passa tudo por até 5 min; depois disso o bot assume até a pessoa voltar
  const AWAY_MS = 5 * 60 * 1000;
  function awayTick() {
    if (!isHost() || !S.mgrs) return;
    ensureUids(); markOnline(); NET.away = NET.away || {};
    const owned = new Set(Object.values(NET.seats)), now = Date.now(), A = S.auction, L = A && !A.done && A.lot;
    let changed = false;
    S.mgrs.forEach((m, i) => {
      if (m.uid === NET.hostUid || !owned.has(m.uid) || (m.cpu && !m.awayBot)) return;
      if (m.net) { delete NET.away[m.uid]; if (m.awayBot) { m.awayBot = false; m.cpu = false; changed = true; toast(`${esc(m.name)} voltou e reassumiu o time`); } return; }
      if (!A || A.done) return;
      const since = NET.away[m.uid] || (NET.away[m.uid] = now);
      if (now - since >= AWAY_MS) { if (!m.awayBot) { m.awayBot = true; m.cpu = true; changed = true; toast(`${esc(m.name)} ficou 5 min fora: o bot assumiu os lances`); } return; }
      if (L && !L.done && L.leader !== i && !L.passed.includes(i)) { L.passed.push(i); changed = true; }
    });
    if (changed) { if (S.view === "auction") paintDyn(); }
  }
  function markOnline() { const up = new Set([...NET.online].map(c => NET.seats[c])); S.mgrs.forEach(m => m.net = m.uid === NET.hostUid || up.has(m.uid)); }
  function hostSeat() { ensureUids(); if (NET.spectate) { NET.hostUid = null; return NET.seat = -1; } let i = S.mgrs.findIndex(m => m.uid === NET.hostUid); if (i < 0) { const owned = new Set(Object.values(NET.seats)); i = S.mgrs.findIndex(m => !m.cpu && !owned.has(m.uid)); if (i < 0) i = Math.max(0, S.mgrs.findIndex(m => !m.cpu)); NET.hostUid = S.mgrs[i].uid; } return NET.seat = i; }
  // ---------- passar o anfitrião / só assistir ----------
  const canHand = () => isHost() && S.mgrs && !(S.auction && !S.auction.done) && !(S.live && !S.live.over);
  function handTo(cid) {
    const uid = NET.seats[cid], m = S.mgrs.find(x => x.uid === uid); if (!uid || !m || !NET.online.has(cid)) return toast("Esse amigo não está online.");
    if (!canHand()) return toast("Dá pra passar o anfitrião no saguão ou entre as partidas.");
    save(); let game = null; try { game = localStorage.getItem(KEY); } catch (e) { }
    if (!game) return toast("Não deu pra preparar a sala. Tente de novo.");
    const myCid = rid(), seats = Object.assign({}, NET.seats); delete seats[cid]; if (NET.hostUid && !NET.spectate) seats[myCid] = NET.hostUid;
    NET.handing = { myCid, to: m.name };
    tx({ t: "handoff", cid, data: { game, seats, hostUid: uid } });
    toast(`Passando o comando pra ${esc(m.name)}…`);
    setTimeout(() => { if (NET.handing) { NET.handing = null; toast("Não deu pra passar o anfitrião. Tente de novo."); } }, 8000);
  }
  function handDone() {
    const h = NET.handing; if (!h) return; NET.handing = null;
    try { localStorage.removeItem(SKEY); } catch (e) { }
    sessionStorage.setItem("mda-cid", h.myCid); sessionStorage.setItem("mda-auto", J({ role: "guest", code: NET.code, name: NET.name }));
    NET.role = null; location.reload();
  }
  function becomeHost(m) {
    const d = m.data || {};
    try { localStorage.setItem(KEY, d.game); } catch (e) { return toast("Não deu pra assumir a sala: o navegador está sem espaço."); }
    store(SKEY, { role: "host", code: NET.code, key: m.key, name: NET.name, seats: d.seats || {}, hostUid: d.hostUid, spectate: false });
    sessionStorage.setItem("mda-auto", J({ role: "host", code: NET.code, name: NET.name }));
    NET.role = null; toast("Você agora é o anfitrião da sala."); setTimeout(() => location.reload(), 400);
  }
  function handMenu() {
    const list = [...NET.online].map(c => ({ c, m: S.mgrs.find(x => x.uid === NET.seats[c]) })).filter(x => x.m);
    document.getElementById("handmenu")?.remove();
    const el = document.createElement("div"); el.id = "handmenu"; el.className = "netmenu";
    el.innerHTML = `<div class="nm-box"><b>Passar o anfitrião</b><p>O jogo passa a rodar no navegador da pessoa escolhida. Você continua na sala como jogador.</p>${list.length ? list.map(x => `<button data-c="${x.c}">${esc(x.m.name)}</button>`).join("") : "<p><em>Nenhum amigo com time está online.</em></p>"}<button data-x="1" class="nm-x">Cancelar</button></div>`;
    el.addEventListener("pointerdown", e => { el._dn = e.target; });
    el.addEventListener("click", e => { const c = e.target.dataset.c; if (c) { el.remove(); handTo(c); } else if (e.target.dataset.x || (e.target === el && el._dn === el)) el.remove(); });
    document.body.appendChild(el);
  }
  function setSpectate(on) {
    if (!isHost() || S.auction) return;
    if (on) {
      const owned = new Set(Object.values(NET.seats));
      const rest = S.mgrs.filter(m => m.uid !== NET.hostUid);
      if (rest.length < 2) return toast("Precisa de pelo menos 2 times além de você. Adicione um bot.");
      S.mgrs = rest; NET.spectate = true; NET.hostUid = null;
      toast("Você vai só assistir. O jogo continua rodando no seu navegador: deixe a aba aberta.");
    } else {
      if (S.mgrs.length >= 8) return toast("Sala cheia: remova um bot antes.");
      const used = new Set(S.mgrs.map(m => m.color)); let color = 0; while (used.has(color) && color < 7) color++;
      const uid = rid(); S.mgrs.push({ name: NET.name || "Host", cpu: false, color, uid }); NET.spectate = false; NET.hostUid = uid;
    }
    hostSeat(); seatUI(); saveSession(); NET.lastSent = ""; save(); render();
  }
  window.setSpectate = setSpectate;

  function startHost() {
    installCommon();
    if (!NET.awayT) NET.awayT = setInterval(() => { try { awayTick(); } catch (e) { } }, 500);
    if (!NET.resume) { const theme = S.cfg.theme; S = fresh(); S.cfg.theme = theme; S.mgrs[0].name = NET.name || "Host"; NET.seats = {}; NET.hostUid = null; }
    hostSeat(); seatUI();
    window.save = () => { ensureUids(); O.save(); };
    // o jogo original recria a lista de técnicos: mantém quem é quem
    const keepIds = fn => (...a) => { const ids = S.mgrs.map(m => m.uid); const sv = window.save, rd = window.render; window.save = () => { }; window.render = () => { };
      try { fn(...a); } finally { window.save = sv; window.render = rd; S.mgrs.forEach((m, i) => m.uid = ids[i]); hostSeat(); seatUI(); } save(); render(); };
    window.startAuction = keepIds(O.startAuction);
    window.resetAll = keepIds(O.resetAll);
    window.closeLot = () => { O.closeLot(); S.ui.bidAs = me() >= 0 ? me() : 0; };
    // dono que só assiste não dá lance
    for (const k of ["bid"]) { const f = window[k]; window[k] = (...a) => { if (me() < 0) return toast("Você está só assistindo."); return f(...a); }; }
    window.applyBid = (i, np) => {
      const prev = S.auction.lot.leader, t = window.toast; window.toast = () => { };
      try { O.applyBid(i, np); } finally { window.toast = t; }
      if (prev != null && prev !== i && !mgr(prev).cpu) {
        const msg = `você foi superado por ${mgr(i).name}`;
        if (prev === me()) toast(`${esc(mgr(prev).name)}, ${esc(msg)}`);
        else Object.keys(NET.seats).forEach(c => { if (seatOf(c) === prev) toGuest(c, { t: "toast", msg: "Você foi superado por " + mgr(i).name }); });
      }
    };
    window.passLot = () => me() < 0 ? toast("Você está só assistindo.") : doPass(me());
    window.clutchPick = k => { const C = S.live && S.live.clutch; if (!C || C.reveal) return; const s = curS(); if ([s.a, s.b][C.queue[0]] !== me()) return; O.clutchPick(k); if (S.live.clutch) S.live.clutch.handoff = false; updClutch(); };
    window.vetoAct = m => { const s = curS(), st = vetoSeq(s.fmt)[s.veto.step]; if (!st) return; const t = st[0] ? s.b : s.a; if (!mgr(t).cpu && t !== me() && !NET.forced) return; O.vetoAct(m); };
    // o veto automático (bot ou tempo esgotado) precisa passar pela trava acima
    window.vetoClock = () => {
      clearInterval(vTimer); vTimer = null;
      if (S.view !== "series" || !S.tour) return;
      const s = curS(), seq = vetoSeq(s.fmt); if (s.maps.length || s.veto.step >= seq.length) return;
      const [who, act] = seq[s.veto.step], ti = who ? s.b : s.a; if (mgr(ti).cpu) return;
      if (!s.veto.deadline || s.veto.deadlineStep !== s.veto.step) { s.veto.deadline = Date.now() + 30000; s.veto.deadlineStep = s.veto.step; }
      vTimer = setInterval(() => {
        const el = document.getElementById("vtime"), left = Math.max(0, Math.ceil((s.veto.deadline - Date.now()) / 1000));
        if (el) { el.textContent = left + "s"; el.classList.toggle("hot", left <= 5); }
        if (left <= 0) { clearInterval(vTimer); vTimer = null; NET.forced = true; try { O.vetoAct(vetoPick(ti, who ? s.a : s.b, MAPS.filter(m => !s.veto.status[m]), act)); } finally { NET.forced = false; } }
      }, 250);
    };
    if (S.live && !S.live.over) S.live.paused = true;
    markOnline(); save(); render();
    if (S.auction && !S.auction.done) startAuctionTimer();
    setInterval(broadcast, 150);
  }

  function snapshot() {
    markOnline();
    const c = prepForSave(); delete c.ui;
    c.mgrs.forEach(m => delete m.uid);
    if (c.auction && c.auction.lot) { delete c.auction.lot.val; delete c.auction.lot.botAt; }
    delete c.cfg.theme; delete c.cfg.mute; delete c.cfg.noCine; c.cfg.test = false;
    return J({ data: c, back: S.ui.backSeries != null });
  }
  function broadcast() {
    if (!NET.ws || NET.ws.readyState !== 1 || NET.ws.bufferedAmount > 1e6) return;
    ensureUids(); hostSeat();
    NET.sentSeat = NET.sentSeat || {};
    NET.online.forEach(c => { const k = seatOf(c); if (NET.sentSeat[c] !== k) { NET.sentSeat[c] = k; toGuest(c, { t: "seat", seat: k }); } });
    const body = snapshot(); if (body === NET.lastSent) return;
    NET.lastSent = body;
    NET.ws.send(`{"t":"state","now":${Date.now()},${body.slice(1)}`);
  }

  function hostJoin(cid, name) {
    if (!cid) return;
    ensureUids(); NET.online.add(cid);
    let i = seatOf(cid), changed = false;
    const taken = () => new Set([...NET.online].filter(c => c !== cid).map(c => NET.seats[c]));
    const claim = k => { NET.seats[cid] = S.mgrs[k].uid; i = k; };
    if (i < 0 && name) { // voltou de outro aparelho/aba: recupera pelo nome
      const k = S.mgrs.findIndex(m => (!m.cpu || m.awayBot) && m.uid !== NET.hostUid && !taken().has(m.uid) && m.name.toLowerCase() === name.toLowerCase());
      if (k >= 0) claim(k);
    }
    if (i < 0 && !S.auction) {
      let nm = name || "Amigo", n = 2; while (S.mgrs.some(m => m.name.toLowerCase() === nm.toLowerCase())) nm = (name || "Amigo").slice(0, 15) + " " + n++;
      const used = new Set(S.mgrs.map(m => m.color)); let color = 0; while (used.has(color) && color < 7) color++;
      if (S.mgrs.length < 8) { S.mgrs.push({ name: nm, cpu: false, color, uid: rid() }); claim(S.mgrs.length - 1); changed = true; }
      else { const k = S.mgrs.findIndex(m => m.cpu); if (k >= 0) { S.mgrs[k] = { name: nm, cpu: false, color: S.mgrs[k].color, uid: rid() }; claim(k); changed = true; } }
    }
    saveSession();
    (NET.sentSeat = NET.sentSeat || {})[cid] = i; toGuest(cid, { t: "seat", seat: i });
    NET.lastSent = "";
    if (i >= 0) toast(`${esc(S.mgrs[i].name)} entrou`);
    if (changed || S.view === "lobby") { save(); safeRender(); }
    bar();
  }

  function doPass(i) {
    const L = S.auction && S.auction.lot; if (!L || L.done || i < 0 || L.leader === i) return;
    if (!L.passed.includes(i)) L.passed.push(i);
    paintDyn(); save();
  }

  function hostAct(cid, a, v) {
    const i = seatOf(cid);
    const no = msg => toGuest(cid, { t: "toast", msg });
    if (a === "hello") { NET.lastSent = ""; return (NET.sentSeat = NET.sentSeat || {})[cid] = i; toGuest(cid, { t: "seat", seat: i }); }
    if (i < 0) return;
    const m = mgr(i);
    if (a === "bid") {
      const L = S.auction && !S.auction.done && S.auction.lot; v = Math.floor(+v);
      if (!L || L.done || L.leader === i || need(m) <= 0 || !v) return;
      if (S.auction.paused) return no("O leilão está pausado.");
      const nxt = L.leader == null ? 1 : L.price + 1;
      if (v < nxt) return no("Alguém deu um lance antes. Mínimo agora: $" + nxt);
      if (v > maxBid(m)) return no("Seu lance máximo: $" + maxBid(m));
      applyBid(i, v);
    }
    else if (a === "pass") doPass(i);
    else if (a === "mine") applyMine(i, v || {});
    else if (a === "veto") {
      if (S.view !== "series" || !S.tour || !MAPS.includes(v)) return;
      const s = curS(), st = vetoSeq(s.fmt)[s.veto.step];
      if (!st || (st[0] ? s.b : s.a) !== i) return;
      NET.forced = true; try { O.vetoAct(v); } finally { NET.forced = false; }
    }
    else if (a === "clutch") {
      const C = S.live && S.live.clutch; if (!C || C.reveal || S.view !== "series") return;
      const s = curS(), t = C.queue[0];
      if ([s.a, s.b][t] !== i || typeof v !== "string" || v.length > 60 || !Object.keys(C.sides[t] === "T" ? CL_T : CL_CT).includes(v.split("|")[0])) return;
      O.clutchPick(v); if (S.live.clutch) S.live.clutch.handoff = false; updClutch();
    }
    else if (a === "ttready") { const T = S.live && S.live.tt, s0 = curS(); if (!T || !s0) return; const k = [s0.a, s0.b].indexOf(i); if (k >= 0) O.ttReady ? O.ttReady(k) : ttReady(k); }
    else if (a === "start" || a === "next") {
      if (S.view !== "series" || !S.tour) return no("Espere o dono da sala abrir a partida.");
      const s = curS(); if (s.a !== i && s.b !== i) return;
      if (a === "start" && s.maps.length && !s.done && !(S.live && S.live.si === S.cur)) startLive();
      if (a === "next" && S.live && S.live.over) nextAfterLive();
    }
  }

  // valida tudo que vem de um amigo antes de aplicar
  function applyMine(i, p) {
    const m = mgr(i), pre = !S.auction; let visual = false;
    if (typeof p.name === "string" && pre && clean(p.name)) { m.name = clean(p.name); visual = true; }
    if (Number.isInteger(p.color) && p.color >= 0 && p.color < PAL.length) { m.color = p.color; visual = true; }
    if (Number.isInteger(p.logo) && p.logo >= 0 && p.logo < EMB.length) { m.logo = p.logo; visual = true; }
    if ("team" in p && (p.team === null || (TEAMS.some(t => t.n === p.team) && teamOwner(p.team, i) < 0))) { m.team = p.team; visual = true; }
    if ("logoImg" in p && (p.logoImg === null || (typeof p.logoImg === "string" && p.logoImg.length < 200000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p.logoImg)))) { m.logoImg = p.logoImg; visual = true; }
    if (p.tac && typeof p.tac === "object") {
      const OPT = { eco: ECO_OPTS, T: T_OPTS, CT: CT_OPTS, post: POST_OPTS, style: STYLE_OPTS };
      m.tac = m.tac || { eco: "equil", T: "default", CT: "padrao" };
      for (const k in OPT) if (Object.keys(OPT[k]).includes(p.tac[k])) m.tac[k] = p.tac[k];
      for (const k of ["lurk", "anchor"]) if (k in p.tac && (p.tac[k] === "" || (m.roster || []).includes(p.tac[k]))) m.tac[k] = p.tac[k];
    }
    if (p.plans && m.plans && m.roster) {
      for (const mp of MAPS) {
        const pl = p.plans[mp];
        if (Array.isArray(pl) && pl.length === 5 && pl.every(x => x && m.roster.includes(x.name) && (x.weapon === "AWP" || x.weapon === "Rifle")) && new Set(pl.map(x => x.name)).size === 5)
          m.plans[mp] = pl.map(x => { const o = { name: x.name, weapon: x.weapon }; if (x.role && ROLE_PT[x.role]) o.role = x.role; return o; });
      }
      visual = true;
    }
    if (typeof p.captain === "string" && m.roster && m.roster.includes(p.captain)) { m.captain = p.captain; visual = true; }
    save();
    if (visual && S.view !== "auction" && !(S.view === "series" && S.live)) safeRender();
    else if (S.view === "auction") paintDyn();
  }

  // ---------- AMIGO ----------
  const act = (a, v) => tx({ t: "act", a, v });
  const mineOf = m => Object.fromEntries(MINE.map(k => [k, J(m[k] === undefined ? null : m[k])]));

  function syncMine() {
    if (me() < 0 || !S.mgrs[me()] || !NET.base) return;
    const now = mineOf(S.mgrs[me()]), patch = {}; let any = false;
    for (const k of MINE) if (now[k] !== NET.base[k]) { patch[k] = JSON.parse(now[k]); NET.base[k] = now[k]; NET.pending[k] = { v: now[k], until: Date.now() + 2500 }; any = true; }
    if (any) act("mine", patch);
  }

  function startGuest() {
    installCommon();
    const keep = { theme: S.cfg.theme, mute: S.cfg.mute, noCine: S.cfg.noCine };
    stopAuction(); stopLive();
    S = fresh(); Object.assign(S.cfg, keep); S.mgrs = [];
    S.mgrs = [{ name: NET.name || "Amigo", cpu: false, color: 0 }];
    const app = document.getElementById("app");
    app.innerHTML = `<main><div class="wrap"><div class="panel center"><h2>Entrando na sala ${NET.code}…</h2><p class="mut">Esperando o dono da sala.</p></div></div></main>`;
    // no navegador do amigo o jogo só desenha: quem calcula é o dono da sala
    window.save = syncMine; // nunca sobrescreve um jogo salvo neste navegador
    window.startAuctionTimer = () => { }; window.runLive = () => { }; window.cpuVetoHook = () => { };
    const only = () => toast("Só o dono da sala pode fazer isso.");
    for (const k of ["startAuction", "resetAll", "setSpeed", "togglePause", "togglePauseA", "skipLive", "simSeries", "autoVeto", "setCfg"]) window[k] = only;
    window.applyBid = (i, np) => act("bid", np);
    window.passLot = () => act("pass");
    window.vetoAct = m => act("veto", m);
    window.clutchPick = k => { act("clutch", k); };
    window.ttReady = () => { act("ttready", 1); const T = S.live && S.live.tt, s0 = curS(); if (T && s0) { T.ready[[s0.a, s0.b].indexOf(me())] = true; updTT(); } };
    window.startLive = () => act("start");
    window.nextAfterLive = () => act("next");
    window.toTour = () => S.tour ? O.go("tour") : toast("O Major começa quando o leilão acabar.");
    window.openSeries = k => { if (S.tour.series[k].done || (NET.hostView === "series" && NET.hostCur === k)) O.openSeries(k); else toast("O dono da sala abre a partida e você vai junto."); };
    window.vetoClock = () => {
      clearInterval(vTimer); vTimer = null;
      if (S.view !== "series" || !S.tour || !curS() || curS().maps.length) return;
      vTimer = setInterval(() => { const el = document.getElementById("vtime"), d = curS() && curS().veto.deadline; if (el && d) { const left = Math.max(0, Math.ceil((d - Date.now()) / 1000)); el.textContent = left + "s"; el.classList.toggle("hot", left <= 5); } }, 250);
    };
    setInterval(() => { if (S.view === "series" && S.live && S.live.clutch && !S.live.clutch.reveal) updClutch(); if (S.view === "series" && S.live && S.live.tt) updTT(); }, 250);
    act("hello");
  }

  function applyState(msg) {
    const D = msg.data, prev = S, first = !NET.got, off = Date.now() - msg.now;
    if (!D || !D.mgrs) return;
    if (D.live && D.live.tt) D.live.tt.deadline += off;
    if (D.live && D.live.clutch) { D.live.clutch.deadline += off; if (D.live.clutch.reveal) D.live.clutch.reveal += off; D.live.clutch.handoff = false; }
    if (D.tour) D.tour.series.forEach(s => { if (s.veto && s.veto.deadline) s.veto.deadline += off; });
    D.ui = prev.ui;
    for (const k of ["theme", "mute", "noCine"]) D.cfg[k] = prev.cfg[k];
    // minhas mudanças que ainda estão a caminho do dono não podem "voltar"
    const mm = me() >= 0 && D.mgrs[me()];
    if (mm) {
      NET.base = mineOf(mm);
      for (const k in NET.pending) {
        const p = NET.pending[k];
        if (NET.base[k] === p.v || Date.now() > p.until) delete NET.pending[k];
        else { mm[k] = JSON.parse(p.v); NET.base[k] = p.v; }
      }
    }
    // seguir o dono quando ele muda de tela (sem puxar ninguém só porque ele foi mexer na própria escalação)
    const hv = D.view, hc = D.cur ?? null;
    const moved = first || hv !== NET.hostView || hc !== NET.hostCur;
    const newAuction = !prev.auction && D.auction;
    const newLive = D.live && !D.live.over && (!prev.live || prev.live.si !== D.live.si || prev.live.mi !== D.live.mi);
    let view = prev.view, cur = prev.cur;
    if (moved && !(hv === "lineup" && msg.back)) { view = hv; cur = D.cur; }
    if (newAuction && !D.auction.done) view = "auction";
    if (newLive) { view = "series"; cur = D.live.si; }
    NET.hostView = hv; NET.hostCur = hc; NET.got = true;
    D.view = view; D.cur = cur;
    if (view === "series" && (cur == null || !D.tour || !D.tour.series[cur])) D.view = D.tour ? "tour" : "lobby";
    if (view === "auction" && !D.auction) D.view = "lobby";
    if (view === "lineup" && !(D.auction && D.auction.done)) D.view = D.auction ? "auction" : "lobby";
    if (!D.auction) D.ui.backSeries = null;
    S = D;
    if (first) seatUI();
    if (S.ui.lineupOf == null || !S.mgrs[S.ui.lineupOf]) S.ui.lineupOf = Math.max(0, me());
    S.ui.bidAs = me() >= 0 ? me() : 0;
    if (S.ui.profileOf != null && !S.mgrs[S.ui.profileOf]) S.ui.profileOf = null;
    paint(prev, first);
    effects(prev, first, newLive);
  }

  const sigOf = () => J([S.view, S.cur, S.cfg, S.mgrs, S.tour, S.auction && S.auction.done, S.posxy, !!S.live, S.live && S.live.over, S.live && S.live.si]);
  function paint(prev, first) {
    const A = S.auction, pA = prev.auction;
    if (!first && S.view === "auction" && prev.view === "auction" && A && pA && A.done === pA.done && document.getElementById("stage")) {
      const k = x => x.lot ? x.lot.name + "#" + x.idx : "";
      if (k(A) !== k(pA)) paintStage(); else paintDyn();
      return bar();
    }
    const L = S.live, pL = prev.live;
    if (!first && S.view === "series" && prev.view === "series" && S.cur === prev.cur && L && pL && !L.over && !pL.over && L.si === S.cur && document.getElementById("radar")) {
      updLive(); updClutch(); return bar();
    }
    const sig = sigOf();
    if (!first && sig === NET.sig) return bar();
    NET.sig = sig;
    const changedView = prev.view !== S.view || prev.cur !== S.cur;
    safeRender();
    if (first || changedView) { cam(); window.scrollTo(0, 0); }
  }

  // sons e animações que no jogo original saíam de quem calcula a partida
  function effects(prev, first, newLive) {
    if (first) return;
    const L = S.auction && S.auction.lot, P = prev.auction && prev.auction.lot;
    if (L && S.view === "auction") {
      if (P && P.name === L.name) {
        if (L.leader != null && (L.price !== P.price || L.leader !== P.leader)) { sfx(L.leader === me() ? "mybid" : "bid"); bump(); }
        if (L.done && !P.done) { sfx(L.leader != null ? "gavel" : "nobid"); anim(document.querySelector(".hcard"), "shake"); }
      }
    }
    const v = S.live, w = prev.live;
    if (newLive && S.view === "series") {
      const s = curS(), map = v.m.map;
      cine(`<div class="mi-art">${mapArt(map)}</div><div class="mapintro m-${map}"><span class="kicker">Mapa ${v.mi + 1} • ${s.fmt.toUpperCase()}</span><h2>${map}</h2><p>${esc(mgr(s.a).name)} × ${esc(mgr(s.b).name)}</p></div>`, 2300);
    }
    if (v && w && S.view === "series" && v.si === S.cur && v.si === w.si && v.mi === w.mi) {
      if (v.rd && (!w.rd || w.rd.n !== v.rd.n)) { roundCard(v.rd); sfx("round"); }
      else if (v.rd && w.rd && v.ev > w.ev && v.rd.feed[v.ev] && v.rd.feed[v.ev].k) sfx("kill");
      if (v.clutch && !w.clutch) sfx("clutch");
      if (v.over && !w.over) {
        const s = curS(), win = v.m.winner ? s.b : s.a; sfx("win");
        cine(`${burst(28)}<div class="stamp">${emblem(win, 110)}<b>${esc(mgr(win).name)}</b><span>vence ${v.m.map} por ${Math.max(...v.m.score)}–${Math.min(...v.m.score)}</span></div>`, 2200, `--c:${col(win)}`);
      }
    }
  }

  // ---------- tela de entrada ----------
  function entry(err) {
    let el = document.getElementById("netentry");
    if (!el) { el = document.createElement("div"); el.id = "netentry"; document.body.appendChild(el); }
    const saved = read(SKEY), inviteCode = (new URLSearchParams(location.search).get("sala") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
    const nm = esc(NET.name || read("mda-name") || ""), pw = esc(NET.senha || "");
    el.innerHTML = `<form class="ne-box" onsubmit="return false"><span class="ne-mark">$</span><h2>Major dos Amigos</h2>
      <p>${inviteCode ? "Você foi convidado pra sala <b>" + inviteCode + "</b>." : "Leilão de CS2 com a galera."}</p>
      ${err ? `<p class="ne-err">${esc(err)}</p>` : ""}
      <label>Seu nome<input id="ne-name" maxlength="18" value="${nm}" autocomplete="nickname" placeholder="Como te chamam"></label>
      <label>Senha do servidor <small>(se tiver)</small><input id="ne-pw" type="password" value="${pw}" autocomplete="current-password" placeholder="••••••"></label>
      <label>Código da sala<input id="ne-code" maxlength="5" value="${inviteCode}" placeholder="ABC12 (só pra entrar)" style="text-transform:uppercase"></label>
      <button type="submit" data-a="${inviteCode ? "join" : "create"}" class="ne-pri">${inviteCode ? "Entrar na sala" : "Criar sala"}</button>
      <span class="ne-or">ou</span><button type="button" data-a="${inviteCode ? "create" : "join"}">${inviteCode ? "Criar outra sala" : "Entrar com código"}</button>
      ${saved && saved.role === "host" ? `<button type="button" data-a="resume">Voltar pra minha sala ${esc(saved.code)}</button>` : ""}
      <button type="button" data-a="local" class="ne-link">Jogar só neste aparelho</button></form>`;
    el.onclick = e => {
      const a = e.target.dataset.a; if (!a) return;
      e.preventDefault();
      if (a === "local") { el.remove(); if (S.auction && !S.auction.done) startAuctionTimer(); return; }
      NET.name = clean(document.getElementById("ne-name").value);
      NET.senha = document.getElementById("ne-pw").value;
      const code = document.getElementById("ne-code").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (a !== "resume" && !NET.name) return entry("Digite seu nome.");
      if (a === "join" && code.length !== 5) return entry("O código da sala tem 5 caracteres.");
      store("mda-name", NET.name || read("mda-name") || "");
      if (a === "create" && saved && saved.role === "host" && !confirm("Criar uma sala nova apaga a partida salva da sala " + saved.code + ". Continuar?")) return;
      if (a === "join") begin("guest", { code });
      else if (a === "resume") begin("host", { code: saved.code, key: saved.key, name: saved.name, seats: saved.seats || {}, hostUid: saved.hostUid, spectate: !!saved.spectate, resume: true });
      else begin("host", { code: "", key: rid(), resume: false });
      e.target.disabled = true; e.target.textContent = "Conectando…";
    };
  }
  function begin(role, opts) {
    if (NET.ws) NET.ws.onclose = null;
    if (role === "host") workerTimersOnce();
    Object.assign(NET, opts, { role, retry: 0 });
    if (role === "guest") { NET.cid = sessionStorage.getItem("mda-cid") || rid(); sessionStorage.setItem("mda-cid", NET.cid); }
    sessionStorage.setItem("mda-auto", J({ role, code: NET.code, name: NET.name }));
    sessionStorage.setItem("mda-senha", NET.senha);
    connect();
  }
  let wt = false; function workerTimersOnce() { if (!wt) { wt = true; workerTimers(); } }

  const css = document.createElement("style");
  css.textContent = `
#netentry{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,7,11,.55);backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);overflow:auto}
.ne-box{position:relative;width:min(420px,100%);margin:auto;display:flex;flex-direction:column;gap:12px;padding:34px 28px 26px;border-radius:32px;background:radial-gradient(120% 70% at 0% 0%,rgba(255,138,31,.28),transparent 55%),radial-gradient(90% 60% at 100% 100%,rgba(77,163,255,.14),transparent 60%),rgba(14,16,22,.72);backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px);color:#eef1f8;box-shadow:0 40px 100px -30px rgba(0,0,0,.9);animation:neIn .6s cubic-bezier(.2,.8,.2,1) both}
.ne-box::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1.2px;background:linear-gradient(150deg,rgba(255,160,80,.95),rgba(255,255,255,.14) 25%,rgba(255,255,255,.04) 55%,rgba(120,180,255,.5));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
@keyframes neIn{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:none}}
.ne-box h2{margin:0 0 2px;text-align:center;font-size:30px;font-weight:600;letter-spacing:-.02em;background:linear-gradient(180deg,#fff,#b9c0cc);-webkit-background-clip:text;background-clip:text;color:transparent}.ne-box p{margin:0 0 8px;text-align:center;color:rgba(238,241,248,.6);font-size:14px}.ne-box .ne-err{color:#ff8b8b;opacity:1}
.ne-box label{position:relative;display:flex;flex-direction:column;gap:2px;font-size:11.5px;color:rgba(238,241,248,.55);padding:9px 20px 8px;border-radius:999px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.12);transition:border-color .2s,background .2s}
.ne-box label:focus-within{border-color:rgba(255,160,80,.7);background:rgba(255,255,255,.07);box-shadow:0 0 0 4px rgba(255,138,31,.12)}
.ne-box label small{display:inline;font-size:11px}.ne-box input{padding:2px 0;border:0;background:none;color:#fff;font:inherit;font-size:16px;outline:none}.ne-box input::placeholder{color:rgba(238,241,248,.3)}
.ne-box button{padding:14px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;font:inherit;font-weight:600;cursor:pointer;transition:transform .18s,box-shadow .25s,background .2s}.ne-box button:hover{transform:translateY(-1px);background:rgba(255,255,255,.1)}
.ne-mark{align-self:center;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:22px;color:#1d0d00;background:radial-gradient(circle at 35% 30%,#ffd29a,#ff8a1f 60%,#d8650a);box-shadow:0 0 0 6px rgba(255,138,31,.12),0 12px 40px -6px rgba(255,138,31,.7);margin-bottom:6px;animation:nePulse 3s ease-in-out infinite}@keyframes nePulse{50%{box-shadow:0 0 0 10px rgba(255,138,31,.06),0 12px 50px -4px rgba(255,138,31,.85)}}.ne-or{display:flex;align-items:center;gap:12px;font-size:12px;color:rgba(238,241,248,.4)}.ne-or::before,.ne-or::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.1)}.ne-box .ne-pri{margin-top:6px;background:#fff;border-color:#fff;color:#0b0d12;box-shadow:0 14px 34px -12px rgba(255,255,255,.55)}.ne-box .ne-pri:hover{background:#fff}.ne-box .ne-link{background:none;border:0;opacity:.6;text-decoration:underline;font-weight:400;padding:6px}
#netbar{position:fixed;right:12px;bottom:12px;z-index:90;display:flex;gap:8px;align-items:center;padding:8px 10px;border-radius:14px;background:rgba(14,16,26,.92);color:#fff;border:1px solid rgba(255,255,255,.14);font-size:13px;max-width:calc(100vw - 24px)}
#netbar button{border:0;border-radius:9px;padding:6px 10px;background:#262b40;color:#fff;font:inherit;cursor:pointer}#netbar .nb-code{background:none;padding:6px 2px}
#netbar .nb-x{display:flex;gap:8px;align-items:center;flex-wrap:wrap}#netbar em{color:#ffd23f;font-style:normal}#netbar.min .nb-x{display:none}
.net-off{opacity:.45!important;cursor:not-allowed!important;pointer-events:none}body:has(#netbar) .who{display:none}
body:has(#netbar) main{padding-bottom:70px}
.netmenu{position:fixed;inset:0;z-index:210;display:grid;place-items:center;padding:16px;background:rgba(8,8,16,.7);backdrop-filter:blur(8px)}
.nm-box{width:min(360px,100%);display:grid;gap:8px;padding:20px;border-radius:18px;background:#151826;color:#eef1f8;border:1px solid rgba(255,255,255,.14)}
.nm-box p{margin:0;opacity:.75;font-size:13.5px}.nm-box button{padding:11px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:#222638;color:#fff;font:inherit;font-weight:650;cursor:pointer;text-align:left}
.nm-box button:hover{border-color:#ff8a1f}.nm-box .nm-x{background:none;text-align:center;opacity:.7}
#netbar .nb-stop{background:#3a2430}
body.netspec #btns button,body.netspec #bidc,body.netspec #passb,body.netspec #bidv{opacity:.4;pointer-events:none}
@media(max-width:640px){#netbar{left:8px;right:8px;bottom:8px;font-size:12px;padding:6px 8px;gap:6px}#netbar button{padding:7px 9px}}
`;

  window.addEventListener("DOMContentLoaded", () => {
    if (location.protocol === "file:") return;
    document.head.appendChild(css);
    stopAuction(); // nada anda enquanto a pessoa não escolhe como jogar
    const err = sessionStorage.getItem("mda-err"); sessionStorage.removeItem("mda-err");
    let auto = null; try { auto = JSON.parse(sessionStorage.getItem("mda-auto")); } catch (e) { }
    NET.senha = sessionStorage.getItem("mda-senha") || "";
    if (err) { sessionStorage.removeItem("mda-auto"); return entry(err); }
    entry();
    // F5 no meio do jogo: volta sozinho pra sala
    const saved = read(SKEY);
    if (auto && auto.role === "guest") { NET.name = auto.name; begin("guest", { code: auto.code }); }
    else if (auto && auto.role === "host" && saved && saved.role === "host") begin("host", { code: saved.code, key: saved.key, name: saved.name, seats: saved.seats || {}, hostUid: saved.hostUid, spectate: !!saved.spectate, resume: true });
  });
})();
