/**
 * Implanta o MiniBlockchain na rede local, repete as transações da fase 1
 * e grava frontend/contract.json (endereço + ABI) para a interface.
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const createPoW = require("../frontend/pow.js");

const DIFFICULTY = 4;

async function main() {
  const { ethers } = hre;
  const pow = createPoW(ethers);
  const [owner, alice, bob] = await ethers.getSigners();

  const contract = await ethers.deployContract("MiniBlockchain", [DIFFICULTY]);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`MiniBlockchain implantado em ${address} (dono: ${owner.address})`);

  // Mesmos blocos do Demo 1 da fase 1
  const seed = [
    [alice, { de: "Alice", para: "Bob", valor: 50 }],
    [bob, { de: "Bob", para: "Carol", valor: 20 }],
  ];
  for (const [signer, payload] of seed) {
    const data = JSON.stringify(payload);
    const index = await contract.totalBlocks();
    const prevHash = await contract.lastHash();
    const mined = await pow.mine({ index, prevHash, miner: signer.address, data, difficulty: DIFFICULTY });
    await (await contract.connect(signer).addBlock(data, mined.nonce)).wait();
    console.log(`  bloco #${index} minerado: nonce=${mined.nonce} (${mined.tries} tentativas, ${mined.ms} ms)`);
  }

  const [valid, , reason] = await contract.isValid();
  console.log(`  isValid(): ${valid} (${reason})`);

  const artifact = await hre.artifacts.readArtifact("MiniBlockchain");
  const { chainId } = await ethers.provider.getNetwork();
  const config = { address, chainId: Number(chainId), abi: artifact.abi, deployedAt: new Date().toISOString() };
  const out = path.join(__dirname, "..", "frontend", "contract.json");
  fs.writeFileSync(out, JSON.stringify(config, null, 2));
  console.log(`  configuração da interface gravada em ${path.relative(process.cwd(), out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
