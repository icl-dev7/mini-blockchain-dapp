"use strict";

const HARDHAT_RPC = "http://127.0.0.1:8545";
const HARDHAT_CHAIN_ID = 31337;
const pow = createPoW(ethers);
const $ = (id) => document.getElementById(id);

const state = {
  config: null, // frontend/contract.json, gravado pelo deploy
  mode: null, // "rpc" | "metamask"
  provider: null,
  rpcSigners: null,
  accounts: [],
  signer: null,
  contract: null,
  chain: [],
  difficulty: 0,
  owner: null,
  validReason: "",
  txs: [],
  miningAbort: null,
  editing: null, // índice do bloco com o editor de adulteração aberto
  tamper: null, // { index, data, newHash, powOk }
  refreshing: false,
  refreshAgain: false,
};

const STATUS = {
  mining: ["Minerando", "info"],
  signing: ["Aguardando assinatura", "warn"],
  pending: ["Pendente", "warn"],
  confirmed: ["Confirmada", "ok"],
  failed: ["Falhou", "bad"],
  cancelled: ["Cancelada", "bad"],
};

// ---------- utilidades ----------

const short = (h, n = 6) => (h ? `${h.slice(0, n + 2)}…${h.slice(-4)}` : "-");
const fmtInt = (n) => Number(n).toLocaleString("pt-BR");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function hashHtml(hash) {
  const zeros = hash.slice(2).match(/^0*/)[0].length;
  return `0x<span class="zeros">${hash.slice(2, 2 + zeros)}</span>${hash.slice(2 + zeros)}`;
}

function formatData(data) {
  try {
    const d = JSON.parse(data);
    if (d && typeof d === "object" && "de" in d && "para" in d) return `${d.de} → ${d.para}: ${d.valor}`;
  } catch {
    /* texto livre */
  }
  return data;
}

function accountLabel(address) {
  const i = state.accounts.findIndex((a) => a.toLowerCase() === address.toLowerCase());
  const owner = state.owner && address.toLowerCase() === state.owner.toLowerCase() ? " (dono)" : "";
  return i >= 0 && state.mode === "rpc" ? `Conta #${i} · ${short(address, 4)}${owner}` : `${short(address, 4)}${owner}`;
}

function friendlyError(err) {
  // ACTION_REJECTED vem do ethers; 4001 vem direto da carteira (EIP-1193)
  if (err && (err.code === "ACTION_REJECTED" || err.code === 4001)) return "Pedido recusado na carteira.";
  if (err && err.code === -32002) return "Já existe um pedido aberto no MetaMask. Clique no ícone da extensão para vê-lo.";
  return (
    (err && (err.reason || err.shortMessage || (err.info && err.info.error && err.info.error.message) || err.message)) ||
    String(err)
  );
}

function showBanner(kind, html) {
  const banner = $("banner");
  if (!kind) {
    banner.hidden = true;
    return;
  }
  banner.className = `banner ${kind}`;
  banner.innerHTML = html;
  banner.hidden = false;
}

function setBadge(text, kind = "") {
  const badge = $("netBadge");
  badge.textContent = text;
  badge.className = `badge ${kind}`;
}

function setEnabled(enabled) {
  for (const id of ["btnSend", "btnRefresh", "accountSelect"]) $(id).disabled = !enabled;
  if (state.mode === "metamask") $("accountSelect").disabled = true;
  if (!enabled) $("btnDifficulty").disabled = true;
}

// ---------- conexão ----------

async function rpcAlive() {
  try {
    const res = await fetch(HARDHAT_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function disconnect() {
  if (state.provider) {
    await state.provider.removeAllListeners();
    state.provider.destroy();
  }
  Object.assign(state, { provider: null, rpcSigners: null, accounts: [], signer: null, contract: null });
  setEnabled(false);
}

function setMode(mode) {
  state.mode = mode;
  $("btnRpc").classList.toggle("active", mode === "rpc");
  $("btnMetaMask").classList.toggle("active", mode === "metamask");
}

/** Conecta direto no nó do Hardhat e usa as 10 contas de teste dele. */
async function connectRpc() {
  await disconnect();
  setMode("rpc");
  setBadge("Conectando…");
  if (!(await rpcAlive())) {
    setBadge("Rede offline", "bad");
    showBanner(
      "error",
      "Não foi possível falar com a rede do Hardhat em <code>http://127.0.0.1:8545</code>. " +
        "Inicie o projeto com <code>iniciar.bat</code> (ou <code>npm start</code>) e clique em <b>Hardhat local</b>."
    );
    return;
  }
  const provider = new ethers.JsonRpcProvider(HARDHAT_RPC, HARDHAT_CHAIN_ID, {
    staticNetwork: true,
    pollingInterval: 1000,
  });
  state.provider = provider;
  state.rpcSigners = await provider.listAccounts();
  state.accounts = state.rpcSigners.map((s) => s.address);
  state.signer = state.rpcSigners[0];
  provider.on("block", () => refresh());
  await onSignerReady();
}

/** Conecta pela carteira MetaMask (a conta é escolhida no próprio MetaMask). */
async function connectMetaMask() {
  if (!window.ethereum) {
    showBanner(
      "warn",
      'MetaMask não encontrado neste navegador. Instale a extensão (<a href="https://metamask.io" target="_blank" rel="noopener">metamask.io</a>) ' +
        "ou use o botão <b>Hardhat local</b>, que não precisa de carteira."
    );
    return;
  }
  await disconnect();
  setMode("metamask");
  setBadge("Aguardando MetaMask…", "warn");
  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await ensureHardhatNetwork();
    const provider = new ethers.BrowserProvider(window.ethereum);
    state.provider = provider;
    state.signer = await provider.getSigner();
    state.accounts = [state.signer.address];
    provider.on("block", () => refresh());
    await onSignerReady();
  } catch (err) {
    setBadge("Desconectado");
    showBanner("error", "MetaMask: " + escapeHtml(friendlyError(err)));
  }
}

async function ensureHardhatNetwork() {
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (parseInt(chainId, 16) === HARDHAT_CHAIN_ID) return;
  const hexId = "0x" + HARDHAT_CHAIN_ID.toString(16);
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err) {
    const code = err.code || (err.data && err.data.originalError && err.data.originalError.code);
    if (code !== 4902) throw err; // 4902 = rede ainda não cadastrada na carteira
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: "Hardhat Local",
          rpcUrls: [HARDHAT_RPC],
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        },
      ],
    });
  }
}

async function onSignerReady() {
  const { address, abi } = state.config;
  $("contractAddr").textContent = address;
  if ((await state.provider.getCode(address)) === "0x") {
    setBadge("Contrato não encontrado", "bad");
    showBanner(
      "error",
      `Não há contrato em <code>${address}</code> nesta rede. A rede do Hardhat foi reiniciada? ` +
        "Rode o deploy de novo (<code>npm run deploy</code>, ou feche e abra o <code>iniciar.bat</code>) e recarregue a página."
    );
    return;
  }
  state.contract = new ethers.Contract(address, abi, state.signer);
  showBanner(null);
  setBadge(state.mode === "rpc" ? "Hardhat local · chainId 31337" : "MetaMask · chainId 31337", "ok");
  setEnabled(true);
  await refresh();
}

async function selectAccount(index) {
  state.signer = state.rpcSigners[index];
  state.contract = state.contract.connect(state.signer);
  await refresh();
}

// ---------- leitura do contrato ----------

async function refresh() {
  if (!state.contract) return;
  if (state.refreshing) {
    state.refreshAgain = true; // não perde a atualização pedida durante outra leitura
    return;
  }
  state.refreshing = true;
  state.refreshAgain = false;
  try {
    const c = state.contract;
    const me = await state.signer.getAddress();
    const [chain, difficulty, owner, validity, balance, blockNumber] = await Promise.all([
      c.getChain(),
      c.difficulty(),
      c.owner(),
      c.isValid(),
      state.provider.getBalance(me),
      state.provider.getBlockNumber(),
    ]);
    const before = state.chain.length;
    state.chain = chain.map((b) => ({
      index: Number(b.index),
      timestamp: Number(b.timestamp),
      data: b.data,
      prevHash: b.prevHash,
      nonce: b.nonce,
      hash: b.hash,
      miner: b.miner,
      difficulty: Number(b.difficulty),
    }));
    if (before > 0 && state.chain.length > before) state.newFrom = before;
    state.difficulty = Number(difficulty);
    state.owner = owner;
    state.validReason = validity.reason;

    renderAccounts(me);
    $("balance").textContent = `${Number(ethers.formatEther(balance)).toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ETH`;
    $("ethBlock").textContent = fmtInt(blockNumber);
    renderStats(validity, me);
    // Só redesenha a cadeia se ela mudou: preserva a animação do bloco novo e o que estiver aberto
    const chainKey = [state.mode, state.owner, ...state.chain.map((b) => b.hash)].join("|");
    if (chainKey !== state.chainKey) {
      state.chainKey = chainKey;
      renderChain();
      renderTamperReport();
    }
  } catch (err) {
    showBanner("error", "Erro ao ler o contrato: " + escapeHtml(friendlyError(err)));
  } finally {
    state.refreshing = false;
    if (state.refreshAgain) refresh();
  }
}

function renderAccounts(me) {
  const select = $("accountSelect");
  const isOwner = me.toLowerCase() === state.owner.toLowerCase();
  if (state.mode === "rpc") {
    const current = state.accounts.indexOf(me);
    select.innerHTML = state.accounts.map((a, i) => `<option value="${i}">${escapeHtml(accountLabel(a))}</option>`).join("");
    select.value = String(current);
    $("accountHint").textContent = "Contas de teste do Hardhat (10.000 ETH falsos cada). Troque para ver quem minerou cada bloco.";
  } else {
    select.innerHTML = `<option>${escapeHtml(me)}${isOwner ? " (dono)" : ""}</option>`;
    $("accountHint").textContent = "Para trocar de conta, use o próprio MetaMask.";
  }
}

/** Troca o texto e dá um destaque rápido no cartão quando o valor muda. */
function setStat(id, text) {
  const el = $(id);
  if (el.textContent === String(text)) return;
  const changed = el.textContent !== "-";
  el.textContent = text;
  if (changed) {
    const card = el.closest(".stat");
    card.classList.remove("flash");
    void card.offsetWidth; // reinicia a animação
    card.classList.add("flash");
  }
}

function renderStats(validity, me) {
  const d = state.difficulty;
  setStat("statTotal", fmtInt(state.chain.length));
  setStat("statDifficulty", d);
  $("statDifficultyHint").textContent = `${"0".repeat(d) || "sem"} zeros · ≈ ${fmtInt(16 ** d)} tentativas por bloco`;
  const valid = $("statValid");
  valid.textContent = validity.valid ? "Íntegra ✓" : "Comprometida ✗";
  valid.className = `stat-value ${validity.valid ? "ok" : "bad"}`;
  const reason = validity.valid ? validity.reason : `Bloco #${validity.badIndex}: ${validity.reason}`;
  $("statValidReason").innerHTML = `${escapeHtml(reason)} · via <code>isValid()</code>`;
  $("statLastHash").innerHTML = hashHtml(state.chain[state.chain.length - 1].hash);

  const isOwner = me.toLowerCase() === state.owner.toLowerCase();
  const input = $("fDifficulty");
  if (document.activeElement !== input) input.value = d;
  $("btnDifficulty").disabled = !isOwner;
  $("diffHint").textContent = isOwner
    ? "Você é o dono do contrato."
    : `A conta ativa não é a dona (${short(state.owner, 4)}). A transação seria rejeitada.`;
}

// Ícone de elo de corrente entre dois blocos
const LINK_ICON =
  '<svg viewBox="0 0 32 20" aria-hidden="true"><rect x="2" y="5" width="16" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2.5"/><rect x="14" y="5" width="16" height="10" rx="5" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';

/** Hash curto com os zeros iniciais em destaque: 0x0000ab12…9fc3 */
function shortHashHtml(hash, n = 10) {
  const head = hash.slice(2, 2 + n);
  const zeros = head.match(/^0*/)[0].length;
  return `0x<span class="zeros">${head.slice(0, zeros)}</span>${head.slice(zeros)}…${hash.slice(-4)}`;
}

function renderChain() {
  const list = $("chain");
  const t = state.tamper;
  const newFrom = state.newFrom;
  state.newFrom = null; // a animação de bloco novo roda uma vez só
  list.innerHTML = "";
  state.chain.forEach((block, i) => {
    if (i > 0) {
      const link = document.createElement("li");
      const broken = t && t.index === i - 1 && t.newHash !== block.prevHash;
      link.className = "link" + (broken ? " broken" : "");
      link.setAttribute(
        "aria-label",
        broken
          ? `Elo quebrado: o prevHash do bloco ${i} não bate com o hash recalculado do bloco ${i - 1}`
          : `Elo: o prevHash do bloco ${i} é o hash do bloco ${i - 1}`
      );
      link.innerHTML = `${LINK_ICON}<code>${broken ? "✗ quebrado" : short(block.prevHash, 4)}</code>`;
      list.appendChild(link);
    }
    const card = blockCard(block);
    if (newFrom != null && i >= newFrom) card.classList.add("is-new");
    list.appendChild(card);
  });

  state.loopWidth = 0;
  const looping = marqueeAllowed();
  list.classList.toggle("marquee", looping);
  if (looping) addLoopCopies(list);
  if (newFrom != null) {
    // Mostra o bloco novo: segura a esteira por alguns segundos e vai até ele
    marquee.holdUntil = performance.now() + 5000;
    showBlock(state.chain.length - 1);
  }
}

// ---------- esteira infinita da cadeia ----------

const SPEED = 0.035; // px por milissegundo (cerca de 35 px/s)
const narrowScreen = matchMedia("(max-width: 700px)");
const marquee = { pos: 0, last: 0, hovering: false, focused: false, dragging: false, holdUntil: 0 };

/** A esteira só roda na cadeia horizontal e sem simulação de adulteração aberta. */
function marqueeAllowed() {
  return !narrowScreen.matches && state.editing == null && !state.tamper;
}

/**
 * Para o loop parecer infinito, repete a cadeia depois de um marcador "recomeça".
 * As cópias são só visuais: escondidas de leitores de tela e fora da ordem do Tab.
 */
function addLoopCopies(list) {
  const originals = [...list.children];
  const gap = document.createElement("li");
  gap.className = "loop-gap";
  gap.setAttribute("aria-hidden", "true");
  gap.innerHTML = "<span>↺ recomeça</span>";
  list.appendChild(gap);
  const setWidth = gap.offsetLeft + gap.offsetWidth - originals[0].offsetLeft;
  if (!(setWidth > 0)) {
    gap.remove(); // página ainda sem medidas (aba oculta): tenta de novo no próximo desenho
    return;
  }
  const copies = Math.ceil(list.clientWidth / setWidth) + 1;
  for (let c = 0; c < copies; c++) {
    for (const el of [...originals, gap]) {
      const copy = el.cloneNode(true);
      copy.classList.add("clone");
      copy.classList.remove("is-new");
      copy.setAttribute("aria-hidden", "true");
      copy.querySelectorAll("button, summary").forEach((f) => f.setAttribute("tabindex", "-1"));
      list.appendChild(copy);
    }
  }
  state.loopWidth = setWidth;
}

function marqueeRunning() {
  return (
    state.loopWidth > 0 &&
    !marquee.hovering &&
    !marquee.focused &&
    !marquee.dragging &&
    !document.hidden &&
    performance.now() > marquee.holdUntil
  );
}

function tick(now) {
  const list = $("chain");
  const dt = marquee.last ? Math.min(now - marquee.last, 100) : 0;
  marquee.last = now;
  if (marqueeRunning()) {
    // scrollLeft arredonda para pixels inteiros; a posição real fica em marquee.pos
    marquee.pos += dt * SPEED;
    if (marquee.pos >= state.loopWidth) marquee.pos -= state.loopWidth;
    list.scrollLeft = marquee.pos;
  }
  requestAnimationFrame(tick);
}

function setupMarquee() {
  const list = $("chain");
  list.addEventListener("pointerenter", () => (marquee.hovering = true));
  list.addEventListener("pointerleave", () => (marquee.hovering = false));
  list.addEventListener("pointerdown", () => (marquee.dragging = true));
  addEventListener("pointerup", () => (marquee.dragging = false));
  list.addEventListener("focusin", () => (marquee.focused = true));
  list.addEventListener("focusout", () => (marquee.focused = false));
  // Rolagem manual (roda do mouse, barra): a esteira continua de onde a pessoa deixou
  list.addEventListener("scroll", () => {
    if (Math.abs(list.scrollLeft - marquee.pos) > 2) marquee.pos = list.scrollLeft;
  });
  const relayout = () => {
    if (state.chain.length) renderChain();
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && marqueeAllowed() && !state.loopWidth && state.chain.length) renderChain();
  });
  narrowScreen.addEventListener("change", relayout);
  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, 250);
  });
  requestAnimationFrame(tick);
}

function blockCard(b) {
  const t = state.tamper;
  const editingThis = t && t.index === b.index;
  const tampered = editingThis && t.newHash !== b.hash;
  const linkBroken = t && t.index === b.index - 1 && t.newHash !== b.prevHash;
  const data = editingThis ? t.data : b.data;

  const li = document.createElement("li");
  li.className = "block" + (b.index === 0 ? " genesis" : "") + (tampered || linkBroken ? " broken" : "");
  li.setAttribute("aria-label", `Bloco ${b.index}${tampered ? ", adulterado na simulação" : linkBroken ? ", elo quebrado na simulação" : ""}`);
  li.innerHTML = `
    <div class="block-head">
      <span class="block-num">#${b.index}</span>
      ${b.index === 0 ? '<span class="block-tag">gênese</span>' : `<span class="block-tag">dificuldade ${b.difficulty}</span>`}
    </div>
    <div class="block-data">${escapeHtml(formatData(data))}</div>
    <dl class="hash-rows">
      <div><dt>hash</dt><dd><code>${shortHashHtml(b.hash)}</code></dd></div>
      ${editingThis ? `<div class="recalc"><dt>hash recalculado</dt><dd><code>${shortHashHtml(t.newHash)}</code></dd></div>` : ""}
      <div><dt>anterior</dt><dd><code>${shortHashHtml(b.prevHash)}</code></dd></div>
    </dl>
    <div class="block-meta"><span>nonce ${fmtInt(b.nonce)}</span><span>${escapeHtml(accountLabel(b.miner))}</span></div>
    <details>
      <summary>Detalhes</summary>
      <dl class="block-fields">
        <dt>hash</dt><dd><code>${hashHtml(b.hash)}</code></dd>
        <dt>prevHash</dt><dd><code>${hashHtml(b.prevHash)}</code></dd>
        <dt>horário</dt><dd>${new Date(b.timestamp * 1000).toLocaleString("pt-BR")}</dd>
        <dt>dados</dt><dd><code>${escapeHtml(data)}</code></dd>
      </dl>
    </details>
    ${b.index > 0 && state.editing !== b.index ? `<div class="block-actions"><button type="button" class="small" data-action="edit" data-index="${b.index}">Simular adulteração</button></div>` : ""}`;

  if (state.editing === b.index) {
    const editor = document.createElement("div");
    editor.className = "tamper-edit";
    editor.innerHTML = `
      <label for="tamperInput">Dados adulterados (só na tela)</label>
      <textarea id="tamperInput" rows="2"></textarea>
      <div class="actions">
        <button type="button" class="primary small" data-action="recalc" data-index="${b.index}">Recalcular hash</button>
        <button type="button" class="small" data-action="undo">Desfazer</button>
      </div>`;
    editor.querySelector("textarea").value = data;
    li.appendChild(editor);
  }
  return li;
}

// ---------- simulação de adulteração (Demo 2 da fase 1) ----------

async function simulateTamper(index, newData) {
  const b = state.chain[index];
  // Usa a função pura computeHash() do próprio contrato
  const newHash = await state.contract.computeHash(b.index, b.prevHash, b.miner, newData, b.nonce);
  state.tamper = { index, data: newData, newHash, powOk: pow.meetsDifficulty(newHash, b.difficulty) };
  renderChain();
  renderTamperReport();
  // O relatório fica no topo da cadeia; leva a tela até ele para não passar despercebido
  $("tamperReport").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/** Rola a cadeia até um bloco e o deixa à vista. */
function showBlock(index) {
  const card = [...$("chain").querySelectorAll(".block:not(.clone)")].at(index);
  if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
}

function renderTamperReport() {
  const box = $("tamperReport");
  const t = state.tamper;
  if (!t || !state.chain[t.index]) {
    box.hidden = true;
    return;
  }
  const b = state.chain[t.index];
  const next = state.chain[t.index + 1];
  const items = [];
  if (t.newHash === b.hash) {
    items.push("Os dados são iguais aos originais, então o hash não mudou.");
  } else {
    items.push(
      `<b>Bloco #${b.index}: o conteúdo não corresponde mais ao hash.</b> Guardado: <code>${short(b.hash, 8)}</code>, recalculado por <code>computeHash()</code>: <code>${short(t.newHash, 8)}</code>.`
    );
    items.push(
      t.powOk
        ? "Por coincidência o novo hash ainda tem os zeros exigidos."
        : `Se o atacante trocar o hash guardado, a <b>prova de trabalho fica ausente</b>: o novo hash não começa com ${b.difficulty} zeros. Ele teria que minerar de novo (≈ ${fmtInt(16 ** b.difficulty)} tentativas).`
    );
    items.push(
      next
        ? `<b>Bloco #${next.index}: o elo com o bloco #${b.index} está quebrado</b>, e todos os blocos seguintes também teriam que ser reminerados.`
        : "Este é o último bloco, mas qualquer bloco novo já apontaria para o hash original."
    );
  }
  box.innerHTML = `
    <strong>Simulação de adulteração do bloco #${b.index}</strong>
    <ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>
    <div class="ok-line">Na blockchain real nada mudou: isValid() continua retornando "${escapeHtml(state.validReason)}". O contrato não tem nenhuma função para editar blocos.</div>
    <div class="actions">
      <button type="button" class="small" data-action="show" data-index="${b.index}">Ver bloco #${b.index}</button>
      <button type="button" class="small" data-action="undo">Desfazer simulação</button>
    </div>`;
  box.hidden = false;
}

// ---------- escrita no contrato ----------

// Etapas mostradas em cada transação; o status indica em qual ela está
const STEPS = ["Minerar", "Assinar", "Pendente", "Confirmada"];
const STEP_OF = { mining: 0, signing: 1, pending: 2, confirmed: 3 };

function addTx(title, { mines = true, skipLabel = "Sem minerar" } = {}) {
  const entry = { id: Date.now() + Math.random(), title, status: "signing", step: 1, mines, skipLabel, fresh: true, time: new Date() };
  state.txs.push(entry);
  renderTxs();
  return entry;
}

function updateTx(entry, patch) {
  const previous = entry.status;
  Object.assign(entry, patch);
  if (entry.status in STEP_OF) entry.step = STEP_OF[entry.status];
  renderTxs();
  if (entry.status !== previous) notifyTx(entry);
}

function notifyTx(tx) {
  if (tx.status === "signing" && state.mode === "metamask") toast("warn", "Confirme no MetaMask", tx.title);
  if (tx.status === "pending") toast("info", "Transação enviada", `${tx.title} · aguardando inclusão num bloco`);
  if (tx.status === "confirmed") toast("ok", "Transação confirmada", `${tx.title} · bloco Ethereum ${fmtInt(tx.block)}`);
  if (tx.status === "failed") toast("bad", "Transação falhou", tx.error || tx.title);
  if (tx.status === "cancelled") toast("bad", "Mineração cancelada", tx.title);
}

function stepsHtml(tx) {
  return `<ol class="steps" aria-label="Etapas">${STEPS.map((name, i) => {
    let cls = "";
    if (i === 0 && !tx.mines) cls = "";
    else if (tx.status === "confirmed" || i < tx.step) cls = "done";
    else if (i === tx.step) cls = tx.status === "failed" || tx.status === "cancelled" ? "fail" : "current";
    const label = i === 0 && !tx.mines ? tx.skipLabel : name;
    return `<li class="${cls}">${label}</li>`;
  }).join("")}</ol>`;
}

function renderTxs() {
  $("txEmpty").hidden = state.txs.length > 0;
  $("txList").innerHTML = state.txs
    .slice()
    .reverse()
    .map((tx) => {
      const [label, kind] = STATUS[tx.status];
      const meta = [`${tx.time.toLocaleTimeString("pt-BR")}`];
      if (tx.detail) meta.push(escapeHtml(tx.detail));
      if (tx.hash) meta.push(`tx: <code>${short(tx.hash, 10)}</code>`);
      if (tx.block != null) meta.push(`incluída no bloco Ethereum ${fmtInt(tx.block)} · gas usado ${fmtInt(tx.gas)}`);
      const html = `<li class="tx${tx.fresh ? " is-new" : ""}">
        <div class="tx-head"><span class="tx-title">${escapeHtml(tx.title)}</span><span class="badge ${kind}">${label}</span></div>
        ${stepsHtml(tx)}
        <div class="tx-meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div>
        ${tx.error ? `<div class="tx-error">${escapeHtml(tx.error)}</div>` : ""}
      </li>`;
      tx.fresh = false;
      return html;
    })
    .join("");
}

/** Aviso flutuante no canto da tela; some sozinho. */
function toast(kind, title, message) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
  const box = $("toasts");
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 300);
  }, kind === "bad" ? 7000 : 4500);
}

/** Envia, acompanha os estados (assinatura → pendente → confirmada/falhou) e atualiza a tela. */
async function sendTx(entry, send) {
  updateTx(entry, { status: "signing" });
  const tx = await send();
  updateTx(entry, { status: "pending", hash: tx.hash });
  const receipt = await tx.wait();
  updateTx(entry, {
    status: receipt.status === 1 ? "confirmed" : "failed",
    block: receipt.blockNumber,
    gas: receipt.gasUsed,
  });
  await refresh();
}

async function onSubmitBlock(event) {
  event.preventDefault();
  const payload = { de: $("fDe").value.trim(), para: $("fPara").value.trim(), valor: Number($("fValor").value) };
  const data = JSON.stringify(payload);
  const skipPow = $("fSkipPow").checked;
  const entry = addTx(`addBlock: ${payload.de} → ${payload.para}: ${payload.valor}`, { mines: !skipPow });
  $("btnSend").disabled = true;

  try {
    const miner = await state.signer.getAddress();
    const [index, prevHash, difficulty] = await Promise.all([
      state.contract.totalBlocks(),
      state.contract.lastHash(),
      state.contract.difficulty(),
    ]);
    let nonce = 0;
    if (skipPow) {
      updateTx(entry, { detail: "Sem mineração: nonce 0" });
    } else {
      updateTx(entry, { status: "mining", detail: `Procurando hash com ${difficulty} zeros…` });
      const mined = await mineWithUi({ index, prevHash, miner, data, difficulty: Number(difficulty) });
      nonce = mined.nonce;
      updateTx(entry, {
        detail: `Minerado: nonce ${fmtInt(mined.nonce)} em ${fmtInt(mined.tries)} tentativas (${(mined.ms / 1000).toFixed(2)} s)`,
      });
    }
    await sendTx(entry, () => state.contract.addBlock(data, nonce));
  } catch (err) {
    const cancelled = err.message === "Mineração cancelada";
    updateTx(entry, { status: cancelled ? "cancelled" : "failed", error: friendlyError(err) });
  } finally {
    $("btnSend").disabled = !state.contract;
    $("btnCancel").hidden = true;
  }
}

async function mineWithUi(params) {
  const box = $("miningBox");
  box.hidden = false;
  box.classList.remove("done");
  $("miningTitle").textContent = `Minerando bloco #${params.index} (dificuldade ${params.difficulty})…`;
  $("miningNonce").textContent = "-";
  $("miningHash").textContent = "";
  $("miningBar").style.width = "0%";
  $("btnCancel").hidden = false;
  state.miningAbort = new AbortController();
  // Em média são 16^d tentativas; a barra mostra a chance de já ter achado (1 - e^(-t/esperado))
  const expected = 16 ** params.difficulty;

  const mined = await pow.mine({
    ...params,
    signal: state.miningAbort.signal,
    onProgress: ({ tries, ms }) => {
      $("miningTries").textContent = `${fmtInt(tries)} de ≈ ${fmtInt(expected)}`;
      $("miningRate").textContent = ms ? `${fmtInt(Math.round((tries / ms) * 1000))} hashes/s` : "-";
      $("miningBar").style.width = `${Math.round((1 - Math.exp(-tries / expected)) * 100)}%`;
    },
  }).catch((err) => {
    box.hidden = true;
    throw err;
  });

  box.classList.add("done");
  $("miningBar").style.width = "100%";
  $("miningTitle").textContent = "Bloco minerado!";
  $("miningTries").textContent = fmtInt(mined.tries);
  $("miningRate").textContent = mined.ms ? `${fmtInt(Math.round((mined.tries / mined.ms) * 1000))} hashes/s` : "-";
  $("miningNonce").textContent = fmtInt(mined.nonce);
  $("miningHash").innerHTML = hashHtml(mined.hash);
  return mined;
}

async function onSubmitDifficulty(event) {
  event.preventDefault();
  const value = Number($("fDifficulty").value);
  const entry = addTx(`setDifficulty(${value})`, { mines: false, skipLabel: "Não minera" });
  try {
    await sendTx(entry, () => state.contract.setDifficulty(value));
  } catch (err) {
    updateTx(entry, { status: "failed", error: friendlyError(err) });
  }
}

// ---------- inicialização ----------

function onChainClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const index = Number(button.dataset.index);
  if (button.dataset.action === "edit") {
    state.editing = index;
    if (state.tamper && state.tamper.index !== index) state.tamper = null;
    renderChain(); // sem a esteira: a cadeia para enquanto a simulação está aberta
    renderTamperReport();
    showBlock(index);
    $("tamperInput").focus({ preventScroll: true });
  } else if (button.dataset.action === "recalc") {
    simulateTamper(index, $("tamperInput").value).catch((err) =>
      showBanner("error", "Erro na simulação: " + escapeHtml(friendlyError(err)))
    );
  } else if (button.dataset.action === "show") {
    showBlock(index);
  } else if (button.dataset.action === "undo") {
    state.editing = null;
    state.tamper = null;
    renderChain();
    renderTamperReport();
  }
}

async function init() {
  $("btnRpc").addEventListener("click", connectRpc);
  $("btnMetaMask").addEventListener("click", connectMetaMask);
  $("btnRefresh").addEventListener("click", refresh);
  $("accountSelect").addEventListener("change", (e) => selectAccount(Number(e.target.value)));
  $("txForm").addEventListener("submit", onSubmitBlock);
  $("diffForm").addEventListener("submit", onSubmitDifficulty);
  $("btnCancel").addEventListener("click", () => state.miningAbort && state.miningAbort.abort());
  $("chain").addEventListener("click", onChainClick);
  $("tamperReport").addEventListener("click", onChainClick); // botões "Ver bloco" e "Desfazer" do relatório
  setupMarquee();

  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on("accountsChanged", () => state.mode === "metamask" && connectMetaMask());
    window.ethereum.on("chainChanged", () => state.mode === "metamask" && connectMetaMask());
  }

  try {
    const res = await fetch("contract.json", { cache: "no-store" });
    if (!res.ok) throw new Error(res.statusText);
    state.config = await res.json();
  } catch {
    setBadge("Sem contrato", "bad");
    showBanner(
      "error",
      "Arquivo <code>contract.json</code> não encontrado: o contrato ainda não foi implantado. Rode <code>iniciar.bat</code> (ou <code>npm start</code>)."
    );
    return;
  }
  // Conecta pelo Hardhat por padrão, a menos que o usuário já tenha escolhido o MetaMask
  if (!state.mode) await connectRpc();
}

init();
