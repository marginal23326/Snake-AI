(function(global) {
    const Config = (typeof require !== 'undefined') ? require('./config') : global.SnakeAI.Config;
    const evaluate = (typeof require !== 'undefined') ? require('./heuristics') : global.SnakeAI.evaluate;
    const TT = (typeof require !== 'undefined') ? require('./tt') : global.SnakeAI.TT;
    const Zobrist = (typeof require !== 'undefined') ? require('./zobrist') : global.SnakeAI.Zobrist;

    const DIRS_ARRAY = [
        { dx: 0, dy: 1, dir: Config.DIRS.UP, dirInt: 0 },
        { dx: 0, dy: -1, dir: Config.DIRS.DOWN, dirInt: 1 },
        { dx: -1, dy: 0, dir: Config.DIRS.LEFT, dirInt: 2 },
        { dx: 1, dy: 0, dir: Config.DIRS.RIGHT, dirInt: 3 }
    ];

    function getSafeNeighbors(grid, state) {
        const moves = [];
        const myBody = state.me.body;
        const oppBody = state.enemy.body;
        const myBodyLen = myBody.length;
        const oppBodyLen = oppBody.length;
        const head = myBody[0];

        let myTailX = -1, myTailY = -1, myTailStacked = false;
        if (myBodyLen > 1) {
            const tail = myBody[myBodyLen - 1];
            const prev = myBody[myBodyLen - 2];
            myTailX = tail.x; 
            myTailY = tail.y;
            myTailStacked = (tail.x === prev.x && tail.y === prev.y);
        }

        let oppTailX = -1, oppTailY = -1, oppTailStacked = false;
        let oppTailChecked = false;
        if (oppBodyLen > 1) {
            const tail = oppBody[oppBodyLen - 1];
            const prev = oppBody[oppBodyLen - 2];
            oppTailX = tail.x; 
            oppTailY = tail.y;
            oppTailStacked = (tail.x === prev.x && tail.y === prev.y);
            if (oppTailStacked) oppTailChecked = true; 
        }

        for (let i = 0; i < 4; i++) {
            const d = DIRS_ARRAY[i];
            const nx = head.x + d.dx;
            const ny = head.y + d.dy;

            let isSafe = grid.isSafe(nx, ny);

            // Allow moving into unstacked tails
            if (!isSafe) {
                if (nx === myTailX && ny === myTailY) {
                    if (!myTailStacked) isSafe = true;
                } else if (nx === oppTailX && ny === oppTailY) {
                    if (!oppTailChecked) {
                        const oppHead = oppBody[0];
                        oppTailStacked = (
                            grid.get(oppHead.x, oppHead.y - 1) === 1 ||
                            grid.get(oppHead.x, oppHead.y + 1) === 1 ||
                            grid.get(oppHead.x - 1, oppHead.y) === 1 ||
                            grid.get(oppHead.x + 1, oppHead.y) === 1
                        );
                        oppTailChecked = true;
                    }
                    if (!oppTailStacked) isSafe = true;
                }
            }

            if (isSafe) {
                moves.push({ x: nx, y: ny, dir: d.dir, dirInt: d.dirInt });
            }
        }

        return moves;
    }

    function rootTieBreaker(state, move) {
        const myBody = state.me.body;
        if (!myBody || myBody.length === 0) return 0;

        const enemyBody = state.enemy.body || [];
        const myLen = myBody.length;
        const enemyLen = enemyBody.length;

        let moveIntoEnemyTailPenalty = 0;
        if (enemyBody && enemyBody.length > 0) {
            const enemyTail = enemyBody[enemyBody.length - 1];
            if (move.x === enemyTail.x && move.y === enemyTail.y) {
                moveIntoEnemyTailPenalty = 0.5;
            }
        }

        let headContactBias = 0;
        if (enemyBody.length > 0) {
            const enemyHead = enemyBody[0];
            const distToEnemyHead = Math.abs(move.x - enemyHead.x) + Math.abs(move.y - enemyHead.y);
            if (distToEnemyHead === 1) {
                if (myLen > enemyLen) headContactBias += 2;
                else if (myLen < enemyLen) headContactBias -= 1000;
                else headContactBias -= 500;
            }
        }

        let tailBias = 0;
        if (state.cols && state.rows && myLen >= 20 && enemyLen >= 20) {
            const density = (myLen + enemyLen) / (state.cols * state.rows);
            if (density >= 0.4) {
                const myTail = myBody[myBody.length - 1];
                const tailDist = Math.abs(move.x - myTail.x) + Math.abs(move.y - myTail.y);
                tailBias = -tailDist;
            }
        }

        return tailBias + headContactBias - moveIntoEnemyTailPenalty;
    }

    /**
     * Negamax with Alpha-Beta pruning, TT, and History Heuristic.
     */
    function negamax(grid, state, depth, alpha, beta, side = 0, rootDepth = depth, currentHash = 0n, historyTable = null) {

        if (!historyTable) {
            // Index 0 for original player (me), Index 1 for opponent.
            historyTable = [
                new Int32Array(grid.width * grid.height * 4),
                new Int32Array(grid.width * grid.height * 4)
            ];
        }

        const originalAlpha = alpha;
        const ttEntry = TT.get(currentHash);

        // 1. TT Lookup
        if (depth !== rootDepth && ttEntry) {
            if (ttEntry.depth >= depth) {
                if (ttEntry.flag === TT.EXACT) {
                    return { score: ttEntry.score, move: ttEntry.move };
                } else if (ttEntry.flag === TT.LOWERBOUND) {
                    alpha = Math.max(alpha, ttEntry.score);
                } else if (ttEntry.flag === TT.UPPERBOUND) {
                    beta = Math.min(beta, ttEntry.score);
                }
                if (alpha >= beta) return { score: ttEntry.score, move: ttEntry.move };
            }
        }

        // 2. Terminal Conditions
        if (!state.me.body || state.me.body.length === 0 || state.me.health <= 0)
            return { score: Config.SCORES.LOSS - depth, move: null };
        if (!state.enemy.body || state.enemy.body.length === 0 || state.enemy.health <= 0)
            return { score: Config.SCORES.WIN + depth, move: null };
        if (depth === 0) {
            const score = side === 0
                ? evaluate(grid, state)
                : -evaluate(grid, { me: state.enemy, enemy: state.me, food: state.food });
            return { score, move: null };
        }

        // 3. Move Generation
        const head = state.me.body[0];
        const headIdx = head.y * grid.width + head.x;
        const moves = getSafeNeighbors(grid, state);

        if (moves.length === 0)
            return { score: Config.SCORES.LOSS - depth, move: null };

        // 4. Move Ordering
        const pvMove = (ttEntry && ttEntry.move) ? ttEntry.move : null;

        if (moves.length > 1) {
            const food = state.food;
            const foodLen = food.length;
            moves.sort((a, b) => {
                if (pvMove && a.x === pvMove.x && a.y === pvMove.y) return -1;
                if (pvMove && b.x === pvMove.x && b.y === pvMove.y) return 1;
                
                const histDiff = historyTable[side][headIdx * 4 + b.dirInt] - historyTable[side][headIdx * 4 + a.dirInt];
                if (histDiff !== 0) return histDiff;

                // Food Proximity
                let minA = 1000, minB = 1000;
                for (let i = 0; i < foodLen; i++) {
                    const f = food[i];
                    const dA = Math.abs(a.x - f.x) + Math.abs(a.y - f.y);
                    const dB = Math.abs(b.x - f.x) + Math.abs(b.y - f.y);
                    if (dA < minA) minA = dA;
                    if (dB < minB) minB = dB;
                }
                if (minA === minB) {
                    const cx = grid.width / 2, cy = grid.height / 2;
                    return (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy));
                }
                return minA - minB;
            });
        }

        let bestMove = moves[0];
        let bestScore = -Infinity;
        let bestTieBreak = -Infinity;
        const isRoot = (rootDepth === depth && side === 0);
        const childRecords = isRoot ? [] : null;

        // 5. Search Loop
        for (const move of moves) {
            let collisionPenalty = 0;
            if (side === 0) {
                const opponentHead = state.enemy.body[0];
                const dist = Math.abs(move.x - opponentHead.x) + Math.abs(move.y - opponentHead.y);
                if (dist === 1) {
                    const myLen = state.me.body.length;
                    const oppLen = state.enemy.body.length;
                    if (oppLen > myLen)  collisionPenalty = Config.SCORES.HEAD_ON_COLLISION;
                    else if (oppLen === myLen) collisionPenalty = Config.SCORES.DRAW;
                }
            }

            // --- DO MOVE ---
            const originalHeadVal = grid.get(move.x, move.y);
            const ateFood = (originalHeadVal === 1);

            let tailX = -1, tailY = -1, originalTailVal = 0, didModifyTail = false, clearedTailGrid = false;

            const newHead = { x: move.x, y: move.y };
            const newBody = [newHead, ...state.me.body];

            let nextHash = currentHash;
            const oldHealth = state.me.health;
            const newHealth = ateFood ? 100 : oldHealth - 1;
            const cellId = side === 0 ? 2 : 3;

            nextHash = Zobrist.xorHealth(nextHash, oldHealth, newHealth, side === 0);
            nextHash = Zobrist.xor(nextHash, move.x, move.y, originalHeadVal);
            nextHash = Zobrist.xor(nextHash, move.x, move.y, cellId);

            if (!ateFood) {
                const tail = newBody.pop();
                if (tail.x !== newHead.x || tail.y !== newHead.y) {
                    tailX = tail.x; tailY = tail.y;
                    originalTailVal = grid.get(tailX, tailY);
                    if (originalTailVal === cellId) {
                        grid.set(tailX, tailY, 0);
                        clearedTailGrid = true;
                    }
                    didModifyTail = true;
                    nextHash = Zobrist.xor(nextHash, tailX, tailY, cellId);
                }
            }
            grid.set(move.x, move.y, cellId);

            const nextState = {
                me: state.enemy,
                enemy: { body: newBody, health: newHealth },
                food: ateFood ? state.food.filter(f => f.x !== move.x || f.y !== move.y) : state.food,
            };

            // Recurse
            const child = negamax(grid, nextState, depth - 1, -beta, -alpha, 1 - side, rootDepth, nextHash, historyTable);

            // --- UNDO MOVE ---
            grid.set(move.x, move.y, originalHeadVal);
            if (didModifyTail && clearedTailGrid) grid.set(tailX, tailY, originalTailVal);

            // --- SCORING ---
            let modifiedScore = -child.score;

            if (collisionPenalty !== 0)
                modifiedScore = Math.min(modifiedScore, collisionPenalty);

            const terminalBand = Math.abs(modifiedScore) >= (Math.abs(Config.SCORES.WIN) * 0.9);
            if (ateFood && !terminalBand && modifiedScore > -50000000)
                modifiedScore += Config.SCORES.EAT_REWARD;

            const tieBreak = isRoot ? rootTieBreaker(state, move) : 0;

            if (isRoot) {
                childRecords.push({
                    move,
                    coords: { x: move.x, y: move.y },
                    rawRecursionScore: child.score,
                    collisionPenalty,
                    ate: !!ateFood,
                    modifiedScore,
                    tieBreak
                });
            }

            // --- ALPHA-BETA UPDATE
            if (
                modifiedScore > bestScore ||
                (Math.abs(modifiedScore - bestScore) <= 1e-9 && tieBreak > bestTieBreak)
            ) {
                bestScore = modifiedScore;
                bestMove = move;
                bestTieBreak = tieBreak;
            }
            if (bestScore > alpha) alpha = bestScore;

            // Cutoff
            if (alpha >= beta) break;
        }

        if (bestMove) {
            historyTable[side][headIdx * 4 + bestMove.dirInt] += (depth * depth);
        }

        // 6. Store in TT
        let ttFlag = TT.EXACT;
        if (bestScore <= originalAlpha) ttFlag = TT.UPPERBOUND;
        else if (bestScore >= beta)     ttFlag = TT.LOWERBOUND;
        TT.set(currentHash, depth, bestScore, ttFlag, bestMove);

        if (isRoot) {
            try {
                global.SnakeAI = global.SnakeAI || {};
                global.SnakeAI._lastAlphaBetaRoot = {
                    score: bestScore,
                    move: bestMove,
                    rootDepth,
                    timestamp: Date.now(),
                    children: childRecords
                };
            } catch (e) {}
        }

        return { score: bestScore, move: bestMove };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = negamax;
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.alphaBeta = negamax;
    }
})(this);
