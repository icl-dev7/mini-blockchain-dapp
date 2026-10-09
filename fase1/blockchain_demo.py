"""
Mini blockchain de demonstração: hash, detecção de adulteração e prova de trabalho.
Execute: python blockchain_demo.py   (Python 3.8+, apenas biblioteca padrão)
"""
import hashlib
import json
import time


# ---------- Demo 1: um bloco e o seu hash ----------
class Block:
    def __init__(self, index, data, prev_hash, difficulty=0):
        self.index = index
        self.timestamp = time.time()
        self.data = data              # qualquer dado serializável em JSON
        self.prev_hash = prev_hash    # o elo que forma a cadeia
        self.nonce = 0                # número que os mineradores variam na PoW
        self.hash = self.mine(difficulty) if difficulty else self.compute_hash()

    def compute_hash(self):
        """SHA-256 sobre todos os campos: mudar um byte gera outro hash."""
        payload = json.dumps(
            [self.index, self.timestamp, self.data, self.prev_hash, self.nonce],
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode()).hexdigest()

    # ---------- Demo 3: prova de trabalho (PoW) ----------
    def mine(self, difficulty):
        """Procura um nonce para que o hash comece com `difficulty` zeros."""
        target = "0" * difficulty
        while True:
            h = self.compute_hash()
            if h.startswith(target):
                return h
            self.nonce += 1


class Blockchain:
    def __init__(self, difficulty=3):
        self.difficulty = difficulty
        self.chain = [Block(0, "Bloco gênese", "0" * 64, difficulty)]

    def add_block(self, data):
        prev = self.chain[-1]
        self.chain.append(Block(len(self.chain), data, prev.hash, self.difficulty))

    # ---------- Demo 2: validação ----------
    def is_valid(self):
        """Confere o hash de cada bloco, o seu elo e a prova de trabalho."""
        for i in range(1, len(self.chain)):
            cur, prev = self.chain[i], self.chain[i - 1]
            if cur.hash != cur.compute_hash():
                return False, f"Bloco {i}: o conteúdo não corresponde mais ao hash"
            if cur.prev_hash != prev.hash:
                return False, f"Bloco {i}: o elo com o bloco {i-1} está quebrado"
            if not cur.hash.startswith("0" * self.difficulty):
                return False, f"Bloco {i}: prova de trabalho ausente"
        return True, "Cadeia válida"


if __name__ == "__main__":
    # Demo 1: construir a cadeia
    bc = Blockchain(difficulty=4)
    t0 = time.time()
    bc.add_block({"de": "Alice", "para": "Bob", "valor": 50})
    bc.add_block({"de": "Bob", "para": "Carol", "valor": 20})
    print(f"2 blocos minerados em {time.time() - t0:.2f}s (dificuldade 4)")
    for b in bc.chain:
        print(f"#{b.index} nonce={b.nonce:<7} hash={b.hash[:16]}... anterior={b.prev_hash[:16]}...")
    print(bc.is_valid()[1], "\n")

    # Demo 2: adulterar o histórico
    print("Adulteração: o pagamento de Alice muda de 50 para 5000...")
    bc.chain[1].data["valor"] = 5000
    print(bc.is_valid()[1], "\n")

    # O atacante corrige o hash: ele não atende mais à prova de trabalho
    bc.chain[1].hash = bc.chain[1].compute_hash()
    print("O atacante recalcula o hash do bloco 1 (sem refazer a prova de trabalho)...")
    print(bc.is_valid()[1])

    # Demo 3: o custo da prova de trabalho cresce com a dificuldade
    print("\nCusto da prova de trabalho:")
    for d in range(1, 6):
        t = time.time()
        blk = Block(1, "demo", "0" * 64, d)
        print(f"  dificuldade {d}: {blk.nonce:>8} tentativas, {time.time() - t:.3f}s")
