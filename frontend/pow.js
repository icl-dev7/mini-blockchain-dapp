/**
 * Prova de trabalho compatível com MiniBlockchain.sol.
 * Usado pela interface (navegador) e pelo script de deploy (Node).
 * Recebe a biblioteca ethers v6 como parâmetro: createPoW(ethers).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.createPoW = factory;
})(typeof self !== "undefined" ? self : this, function createPoW(ethers) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  // Mesma ordem de abi.encode(index, prevHash, miner, data, nonce) no contrato
  const TYPES = ["uint256", "bytes32", "address", "string", "uint256"];
  // Cabeçalho do abi.encode: 5 palavras de 32 bytes; o nonce é a 5ª (offset 128)
  const NONCE_OFFSET = 128;

  function computeHash(index, prevHash, miner, data, nonce) {
    return ethers.keccak256(coder.encode(TYPES, [index, prevHash, miner, data, nonce]));
  }

  function meetsDifficulty(hash, difficulty) {
    return hash.startsWith("0".repeat(Number(difficulty)), 2);
  }

  // Escreve o nonce nos 8 últimos bytes da palavra (suficiente até 2^53)
  function writeNonce(bytes, nonce) {
    let n = nonce;
    for (let i = NONCE_OFFSET + 31; i >= NONCE_OFFSET + 24; i--) {
      bytes[i] = n % 256;
      n = Math.floor(n / 256);
    }
  }

  /**
   * Procura um nonce cujo hash comece com `difficulty` zeros.
   * Codifica os dados uma vez e só troca os bytes do nonce a cada tentativa.
   */
  async function mine({ index, prevHash, miner, data, difficulty, batchSize = 4000, onProgress, signal }) {
    const bytes = ethers.getBytes(coder.encode(TYPES, [index, prevHash, miner, data, 0]));
    const target = "0".repeat(Number(difficulty));
    const started = Date.now();
    let nonce = 0;
    for (;;) {
      for (let i = 0; i < batchSize; i++, nonce++) {
        writeNonce(bytes, nonce);
        const hash = ethers.keccak256(bytes);
        if (hash.startsWith(target, 2)) {
          return { nonce, hash, tries: nonce + 1, ms: Date.now() - started };
        }
      }
      if (signal && signal.aborted) throw new Error("Mineração cancelada");
      if (onProgress) onProgress({ tries: nonce, ms: Date.now() - started });
      await new Promise((resolve) => setTimeout(resolve, 0)); // devolve o controle à tela
    }
  }

  return { computeHash, meetsDifficulty, mine };
});
