const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const createPoW = require("../frontend/pow.js");

const pow = createPoW(ethers);
const DIFFICULTY = 3;

describe("MiniBlockchain", function () {
  async function deploy() {
    const [owner, alice, bob] = await ethers.getSigners();
    const contract = await ethers.deployContract("MiniBlockchain", [DIFFICULTY]);
    return { contract, owner, alice, bob };
  }

  async function mineFor(contract, signer, data) {
    const index = await contract.totalBlocks();
    const prevHash = await contract.lastHash();
    const difficulty = await contract.difficulty();
    return pow.mine({ index, prevHash, miner: signer.address, data, difficulty });
  }

  it("cria o bloco gênese", async function () {
    const { contract, owner } = await loadFixture(deploy);
    expect(await contract.totalBlocks()).to.equal(1n);
    const genesis = await contract.getBlock(0);
    expect(genesis.data).to.equal("Bloco gênese");
    expect(genesis.prevHash).to.equal(ethers.ZeroHash);
    expect(await contract.owner()).to.equal(owner.address);
  });

  it("o hash calculado em JavaScript é igual ao do contrato", async function () {
    const { contract, alice } = await loadFixture(deploy);
    const args = [5n, ethers.id("x"), alice.address, '{"valor":50}', 123n];
    expect(pow.computeHash(...args)).to.equal(await contract.computeHash(...args));
  });

  it("aceita um bloco com prova de trabalho válida e o encadeia", async function () {
    const { contract, alice } = await loadFixture(deploy);
    const data = JSON.stringify({ de: "Alice", para: "Bob", valor: 50 });
    const prevHash = await contract.lastHash();
    const { nonce, hash } = await mineFor(contract, alice, data);

    await expect(contract.connect(alice).addBlock(data, nonce))
      .to.emit(contract, "BlockMined")
      .withArgs(1n, hash, alice.address, nonce, data);

    const block = await contract.getBlock(1);
    expect(block.prevHash).to.equal(prevHash);
    expect(block.hash).to.equal(hash);
    expect(block.miner).to.equal(alice.address);
    expect(hash.slice(2, 2 + DIFFICULTY)).to.equal("0".repeat(DIFFICULTY));
    const [valid, , reason] = await contract.isValid();
    expect(valid).to.equal(true);
    expect(reason).to.equal("Cadeia válida");
  });

  it("rejeita um bloco sem prova de trabalho", async function () {
    const { contract, alice } = await loadFixture(deploy);
    const data = "sem mineração";
    const index = await contract.totalBlocks();
    const prevHash = await contract.lastHash();
    // procura um nonce que NÃO atenda à dificuldade
    let nonce = 0;
    while (pow.meetsDifficulty(pow.computeHash(index, prevHash, alice.address, data, nonce), DIFFICULTY)) nonce++;
    await expect(contract.connect(alice).addBlock(data, nonce)).to.be.revertedWith(
      "Prova de trabalho inválida: o hash não começa com zeros suficientes"
    );
  });

  it("o nonce minerado por uma conta não serve para outra", async function () {
    const { contract, alice, bob } = await loadFixture(deploy);
    const data = "roubo de nonce";
    const { nonce } = await mineFor(contract, alice, data);
    // chance de 1 em 16^3 de o hash do Bob também passar; o teste usa o resultado real
    const index = await contract.totalBlocks();
    const bobHash = pow.computeHash(index, await contract.lastHash(), bob.address, data, nonce);
    if (!pow.meetsDifficulty(bobHash, DIFFICULTY)) {
      await expect(contract.connect(bob).addBlock(data, nonce)).to.be.reverted;
    }
  });

  it("rejeita dados vazios", async function () {
    const { contract, alice } = await loadFixture(deploy);
    await expect(contract.connect(alice).addBlock("", 0)).to.be.revertedWith(
      "Os dados do bloco não podem ser vazios"
    );
  });

  it("só o dono altera a dificuldade, até o máximo", async function () {
    const { contract, owner, alice } = await loadFixture(deploy);
    await expect(contract.connect(alice).setDifficulty(1)).to.be.revertedWith(
      "Apenas o dono do contrato pode fazer isso"
    );
    await expect(contract.connect(owner).setDifficulty(7)).to.be.revertedWith("Dificuldade acima do máximo");
    await expect(contract.connect(owner).setDifficulty(2))
      .to.emit(contract, "DifficultyChanged")
      .withArgs(DIFFICULTY, 2);
    expect(await contract.difficulty()).to.equal(2n);
  });

  it("guarda a dificuldade de cada bloco e continua válida após mudar a dificuldade", async function () {
    const { contract, owner, alice } = await loadFixture(deploy);
    const first = await mineFor(contract, alice, "a");
    await contract.connect(alice).addBlock("a", first.nonce);
    await contract.connect(owner).setDifficulty(4);
    const second = await mineFor(contract, alice, "b");
    await contract.connect(alice).addBlock("b", second.nonce);

    expect((await contract.getBlock(1)).difficulty).to.equal(3n);
    expect((await contract.getBlock(2)).difficulty).to.equal(4n);
    expect((await contract.getChain()).length).to.equal(3);
    expect((await contract.isValid())[0]).to.equal(true);
  });
});
