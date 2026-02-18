(function(global) {
    const TT = new Map();
    
    // Flags
    const EXACT = 0;
    const LOWERBOUND = 1; // Alpha
    const UPPERBOUND = 2; // Beta

    function clear() {
        TT.clear();
    }

    /**
     * @param {BigInt} hash 
     * @param {Number} depth 
     * @param {Number} score 
     * @param {Number} flag 
     * @param {Object} move 
     */
    function set(hash, depth, score, flag, move) {
        // Replacement strategy: Always replace if depth is greater or equal.
        // Or if different hash (collision handling not needed with Map + BigInt usually)
        
        const existing = TT.get(hash);
        if (existing && existing.depth > depth) {
            return; // Don't overwrite a deeper search result with a shallow one
        }

        TT.set(hash, {
            depth: depth,
            score: score,
            flag: flag,
            move: move
        });
    }

    function get(hash) {
        return TT.get(hash);
    }

    const TranspositionTable = {
        clear,
        set,
        get,
        EXACT,
        LOWERBOUND,
        UPPERBOUND
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = TranspositionTable;
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.TT = TranspositionTable;
    }
})(this);