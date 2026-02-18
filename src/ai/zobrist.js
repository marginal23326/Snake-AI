(function(global) {
    const TABLE = [];
    const MY_HEALTH_TABLE = [];
    const ENEMY_HEALTH_TABLE = [];
    let isInit = false;
    let _width = 0;
    let _height = 0;

    function init(width, height) {
        if (isInit && _width === width && _height === height) return;
        _width = width;
        _height = height;
        
        TABLE.length = 0;
        for (let x = 0; x < width; x++) {
            TABLE[x] = [];
            for (let y = 0; y < height; y++) {
                TABLE[x][y] = {};
                [1, 2, 3].forEach(p => {
                    TABLE[x][y][p] = BigInt("0x" + Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''));
                });
            }
        }

        for (let h = 0; h <= 100; h++) {
            MY_HEALTH_TABLE[h] = BigInt("0x" + Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''));
            ENEMY_HEALTH_TABLE[h] = BigInt("0x" + Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''));
        }

        isInit = true;
    }

    function computeHash(grid, myHealth, enemyHealth) {
        if (!isInit) init(grid.width, grid.height);

        let h = 0n;

        // 1. Hash the Grid Pieces
        for (let x = 0; x < grid.width; x++) {
            for (let y = 0; y < grid.height; y++) {
                const piece = grid.get(x, y);
                // Only hash pieces 1, 2, or 3 (Food, Me, Enemy)
                if (piece >= 1 && piece <= 3) {
                    const val = (TABLE[x] && TABLE[x][y]) ? TABLE[x][y][piece] : undefined;
                    if (val !== undefined) {
                        h ^= val;
                    }
                }
            }
        }

        // 2. Hash the Health (with safety fallbacks)
        const myIdx = Math.max(0, Math.min(100, Math.floor(myHealth || 0)));
        const enIdx = Math.max(0, Math.min(100, Math.floor(enemyHealth || 0)));

        const myHealthVal = MY_HEALTH_TABLE[myIdx] || 0n;
        const enHealthVal = ENEMY_HEALTH_TABLE[enIdx] || 0n;

        h ^= myHealthVal;
        h ^= enHealthVal;

        return h;
    }

    function xor(currentHash, x, y, piece) {
        if (piece <= 0 || !TABLE[x] || !TABLE[x][y] || !TABLE[x][y][piece]) return currentHash;
        return currentHash ^ TABLE[x][y][piece];
    }

    function xorHealth(currentHash, oldHealth, newHealth, isMe) {
        const table = isMe ? MY_HEALTH_TABLE : ENEMY_HEALTH_TABLE;
        
        // Optimization: Remove BigInt() wrapper since currentHash is already BigInt
        // Fallback '|| 0n' handles the very first root call safely
        let h = currentHash || 0n; 
        
        const oIdx = Math.max(0, Math.min(100, Math.floor(oldHealth || 0)));
        const nIdx = Math.max(0, Math.min(100, Math.floor(newHealth || 0)));

        const oldVal = table[oIdx] || 0n;
        const newVal = table[nIdx] || 0n;

        return h ^ oldVal ^ newVal;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { init, computeHash, xor, xorHealth };
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.Zobrist = { init, computeHash, xor, xorHealth };
    }
})(this);