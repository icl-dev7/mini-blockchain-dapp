/**
 * Um comando para tudo: sobe a rede local do Hardhat, implanta o contrato,
 * inicia a interface e abre o navegador. Ctrl+C encerra tudo.
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { start: startFrontend } = require("../server");

const ROOT = path.join(__dirname, "..");
const RPC_URL = "http://127.0.0.1:8545";
const FRONTEND_URL = "http://localhost:3000";

async function rpcReady() {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else child.kill("SIGINT");
}

function openBrowser(url) {
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

async function main() {
  let node = null;
  if (await rpcReady()) {
    console.log("Rede Hardhat já está rodando em " + RPC_URL);
  } else {
    console.log("Iniciando a rede local do Hardhat (log em hardhat-node.log)...");
    const log = fs.openSync(path.join(ROOT, "hardhat-node.log"), "w");
    node = spawn("npx hardhat node", { cwd: ROOT, shell: true, stdio: ["ignore", log, log] });
    if (!(await waitFor(rpcReady, 60000))) {
      stop(node);
      throw new Error("A rede do Hardhat não respondeu em 60 s. Veja hardhat-node.log.");
    }
  }

  const shutdown = () => {
    stop(node);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("Implantando o contrato...");
  const deploy = spawnSync("npx hardhat run scripts/deploy.js --network localhost", {
    cwd: ROOT,
    shell: true,
    stdio: "inherit",
  });
  if (deploy.status !== 0) {
    stop(node);
    throw new Error("O deploy falhou.");
  }

  await startFrontend(3000);
  openBrowser(FRONTEND_URL);
  console.log("\nTudo pronto. Deixe esta janela aberta; Ctrl+C encerra a rede e a interface.");
}

main().catch((err) => {
  console.error("\n" + err.message);
  process.exit(1);
});
