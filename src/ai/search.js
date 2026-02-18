(function(global) {
    const Config = (typeof require !== 'undefined') ? require('./config') : global.SnakeAI.Config;
    const evaluate = (typeof require !== 'undefined') ? require('./heuristics') : global.SnakeAI.evaluate;
    const TT = (typeof require !== 'undefined') ? require('./tt') : global.SnakeAI.TT;
    const Zobrist = (typeof require !== 'undefined') ? require('./zobrist') : global.SnakeAI.Zobrist;

    function getSafeNeighbors(grid, head, snake) {
        const moves = [];
        const body = snake.body;
        const bodyLen = body.length;
        
        let tailX = -1, tailY = -1;
        let isTailStacked = false;

        if (bodyLen > 1) {
            const tail = body[bodyLen - 1];
            const tailPrev = body[bodyLen - 2];
            tailX = tail.x;
            tailY = tail.y;
            isTailStacked = (tailX === tailPrev.x && tailY === tailPrev.y);
        }

        const dirs = Config.DIRS;
        const dirKeys = ["UP", "DOWN", "LEFT", "RIGHT"];

        for (let i = 0; i < 4; i++) {
            const d = dirs[dirKeys[i]];
            const nx = head.x + d.x;
            const ny = head.y + d.y;

            let isSafe = grid.isSafe(nx, ny);

            // Tail chasing logic
            if (!isSafe && nx === tailX && ny === tailY) {
                const isEatingFood = (grid.get(nx, ny) === 1);
                if (!isTailStacked && !isEatingFood) {
                    isSafe = true;
                }
            }

            if (isSafe) {
                moves.push({ x: nx, y: ny, dir: d });
            }
        }

        return moves;
    }

    /**
     * Alpha-Beta with Transposition Table
     * @param {BigInt} currentHash - The Zobrist hash of the current state
     */
    function alphaBeta(grid, state, depth, alpha, beta, isMaximizing, rootDepth = depth, currentHash = 0n) {
        const originalAlpha = alpha;

        // 1. Transposition Table Lookup
        // We skip TT at root (depth === rootDepth) to ensure we get the full root move list/debug info
        if (depth !== rootDepth) {
            const ttEntry = TT.get(currentHash);
            if (ttEntry && ttEntry.depth >= depth) {
                if (ttEntry.flag === TT.EXACT) {
                    return { score: ttEntry.score, move: ttEntry.move };
                } else if (ttEntry.flag === TT.LOWERBOUND) {
                    alpha = Math.max(alpha, ttEntry.score);
                } else if (ttEntry.flag === TT.UPPERBOUND) {
                    beta = Math.min(beta, ttEntry.score);
                }

                if (alpha >= beta) {
                    return { score: ttEntry.score, move: ttEntry.move };
                }
            }
        }

        // 2. Terminal Conditions
        if (!state.me.body || state.me.body.length === 0 || state.me.health <= 0)
            return { score: Config.SCORES.LOSS - depth, move: null };
        if (!state.enemy.body || state.enemy.body.length === 0 || state.enemy.health <= 0)
            return { score: Config.SCORES.WIN + depth, move: null };
        if (depth === 0) return { score: evaluate(grid, state), move: null };

        // 3. Move Generation
        const currentSnake = isMaximizing ? state.me : state.enemy;
        const opponentSnake = isMaximizing ? state.enemy : state.me;
        const head = currentSnake.body[0];

        const moves = getSafeNeighbors(grid, head, currentSnake);

        if (moves.length === 0) {
            return { score: isMaximizing ? Config.SCORES.LOSS - depth : Config.SCORES.WIN + depth, move: null };
        }

        // 4. Move Sorting
        let pvMove = null;
        const ttEntry = TT.get(currentHash);
        if (ttEntry && ttEntry.move) {
            pvMove = ttEntry.move;
        }

        if (moves.length > 1) {
            const food = state.food;
            const foodLen = food.length;

            moves.sort((a, b) => {
                // PV Move First
                if (pvMove) {
                    if (a.x === pvMove.x && a.y === pvMove.y) return -1;
                    if (b.x === pvMove.x && b.y === pvMove.y) return 1;
                }

                let minA = 1000, minB = 1000;
                for (let i = 0; i < foodLen; i++) {
                    const f = food[i];
                    const distA = Math.abs(a.x - f.x) + Math.abs(a.y - f.y);
                    const distB = Math.abs(b.x - f.x) + Math.abs(b.y - f.y);
                    if (distA < minA) minA = distA;
                    if (distB < minB) minB = distB;
                }
                if (minA === minB) {
                    const cx = grid.width / 2;
                    const cy = grid.height / 2;
                    return (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy));
                }
                return minA - minB;
            });
        }

        let bestMove = moves[0];
        let bestScore = isMaximizing ? -Infinity : Infinity;
        const isRootMax = (rootDepth === depth && isMaximizing);
        const childRecords = isRootMax ? [] : null;

        // 5. Search Loop
        for (const move of moves) {
            let collisionPenalty = 0;
            
            // Head-on collision check
            if (isMaximizing) {
                const opponentHead = opponentSnake.body[0];
                const dist = Math.abs(move.x - opponentHead.x) + Math.abs(move.y - opponentHead.y);
                if (dist === 1) {
                    const myLen = currentSnake.body.length;
                    const oppLen = opponentSnake.body.length;
                    if (oppLen > myLen) collisionPenalty = Config.SCORES.HEAD_ON_COLLISION; 
                    else if (oppLen === myLen) collisionPenalty = Config.SCORES.DRAW; 
                }
            }

            // --- DO MOVE & INCREMENTAL HASH ---
            const originalHeadVal = grid.get(move.x, move.y);
            const ateFood = (originalHeadVal === 1);
            
            let tailX = -1, tailY = -1;
            let originalTailVal = 0; 
            let didModifyTail = false;

            const newHead = { x: move.x, y: move.y };
            const newCurrentBody = [ newHead, ...currentSnake.body ];

            // Start calculating next hash
            let nextHash = currentHash;

            // Remove what was there (Empty or Food)
            const oldHealth = isMaximizing ? state.me.health : state.enemy.health;
            const newHealth = ateFood ? 100 : oldHealth - 1;

            // Update hash with health change
            nextHash = Zobrist.xorHealth(nextHash, oldHealth, newHealth, isMaximizing);

            nextHash = Zobrist.xor(nextHash, move.x, move.y, originalHeadVal);
            // Add New Head (2 for Me, 3 for Enemy)
            const myId = isMaximizing ? 2 : 3;
            nextHash = Zobrist.xor(nextHash, move.x, move.y, myId);

            if (!ateFood) {
                const tail = newCurrentBody.pop(); 
                if (tail.x !== newHead.x || tail.y !== newHead.y) {
                    tailX = tail.x;
                    tailY = tail.y;
                    originalTailVal = grid.get(tailX, tailY);
                    
                    // Modify Grid
                    grid.set(tailX, tailY, 0);
                    didModifyTail = true;

                    // 2. Tail Change in Hash:
                    nextHash = Zobrist.xor(nextHash, tailX, tailY, myId);
                }
            }

            // Update Grid Head
            grid.set(move.x, move.y, myId);

            const nextState = {
                me: isMaximizing ? { body: newCurrentBody, health: ateFood ? 100 : state.me.health - 1 } : state.me,
                enemy: isMaximizing ? state.enemy : { body: newCurrentBody, health: ateFood ? 100 : state.enemy.health - 1 },
                food: ateFood ? state.food.filter(f => f.x !== move.x || f.y !== move.y) : state.food,
            };

            // Recurse
            const child = alphaBeta(grid, nextState, depth - 1, alpha, beta, !isMaximizing, rootDepth, nextHash);

            // --- UNDO MOVE (Backtracking) ---
            grid.set(move.x, move.y, originalHeadVal); 
            if (didModifyTail) {
                grid.set(tailX, tailY, originalTailVal);
            }

            // --- SCORING ---
            let modifiedScore = child.score;
            if (isMaximizing && collisionPenalty !== 0) {
                modifiedScore = Math.min(modifiedScore, collisionPenalty);
            }
            if (ateFood) {
                const DEATH_THRESHOLD = -50000000; 
                if (isMaximizing) {
                    if (modifiedScore > DEATH_THRESHOLD) modifiedScore += Config.SCORES.EAT_REWARD;
                } else {
                    if (modifiedScore < -DEATH_THRESHOLD) modifiedScore -= Config.SCORES.EAT_REWARD;
                }
            }

            // Debug recording
            if (isRootMax) {
                childRecords.push({
                    move: move,
                    coords: { x: move.x, y: move.y },
                    rawRecursionScore: child.score,
                    collisionPenalty,
                    ate: !!ateFood,
                    modifiedScore
                });
            }

            if (isMaximizing) {
                if (modifiedScore > bestScore) { bestScore = modifiedScore; bestMove = move; }
                alpha = Math.max(alpha, bestScore);
            } else {
                if (modifiedScore < bestScore) { bestScore = modifiedScore; bestMove = move; }
                beta = Math.min(beta, bestScore);
            }
            if (beta <= alpha) break;
        }

        // 6. Store in Transposition Table
        // We do not store root nodes usually if we want to force re-eval, but storing them helps.
        let ttFlag = TT.EXACT;
        if (bestScore <= originalAlpha) ttFlag = TT.UPPERBOUND;
        else if (bestScore >= beta) ttFlag = TT.LOWERBOUND;

        TT.set(currentHash, depth, bestScore, ttFlag, bestMove);

        // Debug Root Info
        if (isRootMax) {
            try {
                global.SnakeAI = global.SnakeAI || {};
                global.SnakeAI._lastAlphaBetaRoot = {
                    score: bestScore,
                    move: bestMove,
                    rootDepth: rootDepth,
                    timestamp: Date.now(),
                    children: childRecords
                };
            } catch (e) {}
        }

        return { score: bestScore, move: bestMove };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = alphaBeta;
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.alphaBeta = alphaBeta;
    }
})(this);