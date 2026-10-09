require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // Rede local de testes: 10 contas com 10.000 ETH de teste cada (o padrão seria 20)
    hardhat: { accounts: { count: 10 } },
    // Rede iniciada por `npx hardhat node` (chainId 31337)
    localhost: { url: "http://127.0.0.1:8545" },
  },
};
