// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MiniBlockchain
 * @notice Versão on-chain da mini blockchain da fase 1 (fase1/blockchain_demo.py).
 *
 * Cada bloco guarda dados, o hash do bloco anterior (o elo da cadeia) e um nonce.
 * Quem adiciona um bloco precisa "minerar" fora da cadeia: encontrar um nonce tal que
 * keccak256(index, prevHash, minerador, dados, nonce) comece com `difficulty` zeros
 * hexadecimais. O contrato só confere a prova de trabalho, que é barato.
 *
 * Diferença em relação à fase 1: não existe nenhuma função para editar um bloco.
 * A adulteração que era possível no Python é impossível aqui.
 */
contract MiniBlockchain {
    struct Block {
        uint256 index;
        uint256 timestamp; // timestamp do bloco Ethereum que incluiu a transação
        string data; // texto livre; a interface usa JSON {"de","para","valor"}
        bytes32 prevHash;
        uint256 nonce;
        bytes32 hash;
        address miner;
        uint8 difficulty; // dificuldade exigida quando o bloco foi minerado
    }

    uint8 public constant MAX_DIFFICULTY = 6;
    uint256 public constant MAX_DATA_LENGTH = 1024;

    address public immutable owner;
    uint8 public difficulty;
    Block[] private chain;

    event BlockMined(
        uint256 indexed index,
        bytes32 hash,
        address indexed miner,
        uint256 nonce,
        string data
    );
    event DifficultyChanged(uint8 previous, uint8 current);

    modifier onlyOwner() {
        require(msg.sender == owner, unicode"Apenas o dono do contrato pode fazer isso");
        _;
    }

    constructor(uint8 initialDifficulty) {
        require(initialDifficulty <= MAX_DIFFICULTY, unicode"Dificuldade acima do máximo");
        owner = msg.sender;
        difficulty = initialDifficulty;

        // Bloco gênese: como na fase 1, não é validado pela prova de trabalho.
        string memory genesisData = unicode"Bloco gênese";
        bytes32 genesisHash = computeHash(0, bytes32(0), msg.sender, genesisData, 0);
        chain.push(Block(0, block.timestamp, genesisData, bytes32(0), 0, genesisHash, msg.sender, 0));
        emit BlockMined(0, genesisHash, msg.sender, 0, genesisData);
    }

    // ---------- Escrita ----------

    /// @notice Adiciona um bloco. `nonce` precisa ter sido minerado para o próximo índice.
    function addBlock(string calldata data, uint256 nonce) external returns (bytes32) {
        require(bytes(data).length > 0, unicode"Os dados do bloco não podem ser vazios");
        require(bytes(data).length <= MAX_DATA_LENGTH, unicode"Dados grandes demais (máx. 1024 bytes)");

        uint256 index = chain.length;
        bytes32 prevHash = chain[index - 1].hash;
        bytes32 h = computeHash(index, prevHash, msg.sender, data, nonce);
        require(
            meetsDifficulty(h, difficulty),
            unicode"Prova de trabalho inválida: o hash não começa com zeros suficientes"
        );

        chain.push(Block(index, block.timestamp, data, prevHash, nonce, h, msg.sender, difficulty));
        emit BlockMined(index, h, msg.sender, nonce, data);
        return h;
    }

    function setDifficulty(uint8 newDifficulty) external onlyOwner {
        require(newDifficulty <= MAX_DIFFICULTY, unicode"Dificuldade acima do máximo");
        emit DifficultyChanged(difficulty, newDifficulty);
        difficulty = newDifficulty;
    }

    // ---------- Leitura ----------

    function totalBlocks() external view returns (uint256) {
        return chain.length;
    }

    function lastHash() external view returns (bytes32) {
        return chain[chain.length - 1].hash;
    }

    function getBlock(uint256 index) external view returns (Block memory) {
        require(index < chain.length, unicode"Bloco inexistente");
        return chain[index];
    }

    function getChain() external view returns (Block[] memory) {
        return chain;
    }

    /// @notice Mesma validação de Blockchain.is_valid() da fase 1.
    /// @return valid se a cadeia é íntegra, badIndex o primeiro bloco inválido e reason o motivo.
    function isValid() external view returns (bool valid, uint256 badIndex, string memory reason) {
        for (uint256 i = 1; i < chain.length; i++) {
            Block storage cur = chain[i];
            Block storage prev = chain[i - 1];
            if (cur.hash != computeHash(cur.index, cur.prevHash, cur.miner, cur.data, cur.nonce)) {
                return (false, i, unicode"O conteúdo não corresponde mais ao hash");
            }
            if (cur.prevHash != prev.hash) {
                return (false, i, unicode"O elo com o bloco anterior está quebrado");
            }
            if (!meetsDifficulty(cur.hash, cur.difficulty)) {
                return (false, i, unicode"Prova de trabalho ausente");
            }
        }
        return (true, 0, unicode"Cadeia válida");
    }

    /// @notice O minerador entra no hash para que ninguém copie o nonce de outra pessoa.
    function computeHash(
        uint256 index,
        bytes32 prevHash,
        address miner,
        string memory data,
        uint256 nonce
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(index, prevHash, miner, data, nonce));
    }

    /// @notice true se o hash começa com `zeros` dígitos hexadecimais iguais a zero.
    function meetsDifficulty(bytes32 h, uint8 zeros) public pure returns (bool) {
        if (zeros == 0) return true;
        return uint256(h) >> (256 - 4 * uint256(zeros)) == 0;
    }
}
