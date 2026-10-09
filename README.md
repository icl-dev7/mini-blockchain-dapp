# Mini Blockchain DApp (Fase 2)

Interface web para interagir com o contrato inteligente **MiniBlockchain**, implantado numa blockchain local de testes executada com o **Hardhat**.

O contrato é a versão on-chain da mini blockchain da fase 1 ([`fase1/blockchain_demo.py`](fase1/blockchain_demo.py)): blocos com hash, encadeamento pelo hash anterior, prova de trabalho e validação da cadeia.

Apresentação do projeto: [`docs/apresentacao.pdf`](docs/apresentacao.pdf).

## Como rodar

Pré-requisito: [Node.js](https://nodejs.org) 18 ou mais novo.

**Jeito mais fácil (Windows):** dê dois cliques em **`iniciar.bat`**. Na primeira vez ele instala as dependências. Depois ele:

1. sobe a rede local do Hardhat em `http://127.0.0.1:8545` (chainId 31337);
2. implanta o contrato e grava os dois blocos do Demo 1 da fase 1 (Alice → Bob 50, Bob → Carol 20);
3. abre a interface em `http://localhost:3000`.

Deixe a janela aberta enquanto usa a interface. Para encerrar tudo, feche a janela ou aperte Ctrl+C.

**Pelo terminal (qualquer sistema):**

```bash
npm install
npm start
```

Ou passo a passo, em terminais separados:

```bash
npx hardhat node                                     # 1. rede local
npx hardhat run scripts/deploy.js --network localhost # 2. deploy
node server.js                                       # 3. interface
```

**Testes automatizados do contrato:** `npm test`

## Usando a interface

| Área | O que faz | Função do contrato |
|---|---|---|
| Conexão (canto superior) | **Hardhat local** conecta direto no nó, sem carteira, usando as 10 contas de teste. **MetaMask** conecta pela carteira e troca para a rede Hardhat. | — |
| Conta ativa (topo) | Escolhe com qual conta de teste assinar e mostra o saldo. | — |
| Painel de estado | Total de blocos, dificuldade, **Integridade da cadeia** ("Íntegra ✓", vinda de `isValid()`) e último hash. Atualiza sozinho a cada novo bloco. | `totalBlocks`, `difficulty`, `isValid`, `getChain` (leitura) |
| Cadeia de blocos | Os blocos lado a lado, ligados por elos (o hash anterior de cada um), deslizando em loop infinito. O selo "↺ recomeça" marca só a repetição da animação. Pausa com o mouse em cima, durante a simulação de adulteração e por 5 s quando entra um bloco novo. No celular, fica vertical e parada. | `getChain` (leitura) |
| Nova transação | Minera o bloco no navegador (barra de progresso, tentativas, hashes/s e nonce) e envia. | `addBlock` (escrita) |
| Transações | Cada transação passa pelas etapas Minerar → Assinar → Pendente → **Confirmada** (hash, bloco, gas) ou **Falhou** (motivo), com avisos no canto da tela. | — |
| "Enviar sem minerar" | Envia com nonce 0 para ver o contrato **rejeitar** por falta de prova de trabalho. | `addBlock` (revert) |
| Configurações e dados do contrato | Seção recolhível no fim da página. O dono (conta #0) muda quantos zeros o hash precisa ter; com outra conta o botão fica bloqueado. Mostra também o endereço do contrato e o bloco Ethereum atual. | `setDifficulty` (escrita, só dono) |
| Simular adulteração | Repete o Demo 2 da fase 1: altera os dados **só na tela**, recalcula o hash com `computeHash()` e mostra o hash quebrado, a prova de trabalho ausente e o elo seguinte quebrado. O relatório aparece no topo da cadeia, com os botões "Ver bloco" e "Desfazer simulação". A Integridade da cadeia continua "Íntegra". | `computeHash` (leitura, `pure`) |

### Usando com MetaMask (opcional)

1. No MetaMask, importe uma conta de teste: *Adicionar conta → Importar conta* e cole a chave privada da **Account #0** (o dono), que aparece no topo do arquivo `hardhat-node.log`. São chaves públicas e conhecidas do Hardhat: nunca use essas contas em redes reais.
2. Clique em **MetaMask** na interface. Ela pede para adicionar ou trocar para a rede "Hardhat Local" (chainId 31337).
3. Se a rede do Hardhat for reiniciada e o MetaMask reclamar de *nonce*, vá em *Configurações → Avançado → Limpar dados da aba de atividades*.

## Da fase 1 para a fase 2

| Fase 1 (Python) | Fase 2 (Solidity) |
|---|---|
| `Block.compute_hash()` com SHA-256 | `computeHash()` com keccak256 sobre `(index, prevHash, minerador, dados, nonce)` |
| `Block.mine()` procura o nonce | A **interface** minera ([`frontend/pow.js`](frontend/pow.js)); o contrato só confere com `meetsDifficulty()` |
| `Blockchain.add_block()` | `addBlock(dados, nonce)`, que rejeita o bloco sem prova de trabalho válida |
| `Blockchain.is_valid()` | `isValid()`, com as mesmas três checagens e mensagens |
| `bc.chain[1].data["valor"] = 5000` funcionava | **Impossível**: não existe função de edição, e o dado está gravado na blockchain |

Escolhas de projeto:

- **O minerador entra no hash.** Assim ninguém copia o nonce que outra conta minerou e envia como se fosse seu.
- **O timestamp não entra no hash.** O minerador não sabe antes em que bloco Ethereum a transação vai entrar. O horário vem de `block.timestamp`.
- **Cada bloco guarda a dificuldade com que foi minerado.** Assim mudar a dificuldade não invalida os blocos antigos.

## Estrutura

```
contracts/MiniBlockchain.sol    contrato
scripts/deploy.js               deploy + blocos iniciais + gera frontend/contract.json
scripts/start.js                sobe rede, deploy e interface com um comando
test/MiniBlockchain.test.js     8 testes (Mocha + Chai)
frontend/index.html, style.css  interface
frontend/app.js                 conexão (ethers v6), leitura, escrita e estados das transações
frontend/pow.js                 prova de trabalho (usada pelo navegador e pelo deploy)
server.js                       servidor estático da interface (sem dependências)
fase1/blockchain_demo.py        entrega da fase 1
docs/apresentacao.pdf           slides da apresentação
```

## Problemas comuns

- **"Rede offline"**: a rede do Hardhat não está rodando. Abra o `iniciar.bat`.
- **"Não há contrato nesse endereço"**: a rede foi reiniciada e perdeu o estado (ela fica só na memória). Rode o deploy de novo e recarregue a página. O `iniciar.bat` já faz isso.
- **Porta 3000 ou 8545 ocupada**: feche outra janela do projeto que esteja aberta.
