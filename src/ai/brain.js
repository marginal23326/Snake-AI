(function(global) {
    const hasRequire = typeof require !== 'undefined';
    const Config = hasRequire ? require('./config') : global.SnakeAI.Config;
    const Grid = hasRequire ? require('./grid') : global.SnakeAI.Grid;
    const getFoodDistanceMap = hasRequire ? require('./pathfinding') : global.SnakeAI.getFoodDistanceMap;
    const floodFill = hasRequire ? require('./floodfill') : global.SnakeAI;
    const alphaBeta = hasRequire ? require('./search') : global.SnakeAI.alphaBeta;
    const Zobrist = hasRequire ? require('./zobrist') : global.SnakeAI.Zobrist;
    const TT = hasRequire ? require('./tt') : global.SnakeAI.TT;
    
    const DIRS = Config.DIRS;
    const ADAPTIVE_MIN_DEPTH = 13;

    function getAdaptiveDepth(grid, state, requestedDepth) {
        if (requestedDepth >= ADAPTIVE_MIN_DEPTH) return requestedDepth;

        const meLen = (state.me.body && state.me.body.length) || 0;
        const enemyLen = (state.enemy.body && state.enemy.body.length) || 0;
        const occupied = meLen + enemyLen;
        const density = occupied / (grid.width * grid.height);
        // Endgame horizon guard: extend shallow searches in dense, low-mobility states.
        if (density >= 0.52 && meLen >= 30 && enemyLen >= 30) {
            return ADAPTIVE_MIN_DEPTH;
        }

        return requestedDepth;
    }

    function getSmartMoveDebug(me, enemy, foods, cols, rows) {
        const start = Date.now();
        const foodList = Array.isArray(foods) ? foods : (foods ? [foods] : []);
        const pBody = me.body || [];
        const aBody = enemy.body || [];

        // 1. Initialize Zobrist & Clear TT for new turn
        Zobrist.init(cols, rows);
        TT.clear();

        const state = {
            me: { body: pBody, health: me.health || 100 },
            enemy: { body: aBody, health: enemy.health || 100 },
            food: foodList,
            cols, rows
        };

        const grid = Grid.fromState({ pBody: state.me.body, aBody: state.enemy.body, food: state.food, cols, rows });
        
        state.distMap = getFoodDistanceMap(grid, state.food);

        // 3. Compute Initial Hash
        const initialHash = Zobrist.computeHash(grid, state.me.health, state.enemy.health);

        // 4. Single Pass Search
        const adaptiveDepth = getAdaptiveDepth(grid, state, Config.MAX_DEPTH);
        const result = alphaBeta(grid, state, adaptiveDepth, -Infinity, Infinity, 0, adaptiveDepth, initialHash);
        
        let moveDir = result.move ? result.move.dir : null;
        let logStr = `Score: ${Math.floor(result.score)}`;

        // FAILSAFE
        if (!moveDir) {
            logStr += " | FAILSAFE";
            const head = state.me.body[0];
            const neighbors = [
                { x: head.x, y: head.y + 1, dir: DIRS.UP },
                { x: head.x, y: head.y - 1, dir: DIRS.DOWN },
                { x: head.x - 1, y: head.y, dir: DIRS.LEFT },
                { x: head.x + 1, y: head.y, dir: DIRS.RIGHT }
            ];

            const safeMoves = neighbors
                .filter(n => grid.isSafe(n.x, n.y))
                .map(n => ({ ...n, space: floodFill(grid, n.x, n.y, 100).count }))
                .sort((a, b) => b.space - a.space);
            if (safeMoves.length > 0) {
                moveDir = safeMoves[0].dir;
            } else {
                moveDir = DIRS.UP; 
            }
        }

        const duration = Date.now() - start;
        logStr += ` | ${duration}ms`;

        const root = (typeof window !== 'undefined') ? window : global;
        if (root.SnakeAI) {
            root.SnakeAI.lastState = { grid, state };
        }

        return { bestMove: moveDir, logStr: logStr };
    }

    function runDebugAnalysis() {
        if (!global.SnakeAI.lastState) return console.log("No state to debug yet.");
        const { grid, state } = global.SnakeAI.lastState;

        console.clear();
        console.log("%c --- AI MIND READER (Depth " + Config.MAX_DEPTH + " Search) --- ", "background: #222; color: #bada55; font-size: 14px");

        const recorded = (global.SnakeAI && global.SnakeAI._lastAlphaBetaRoot) ? global.SnakeAI._lastAlphaBetaRoot : null;
        if (!recorded) {
            console.log("%c Engine's actual root decision: (none recorded yet). Run one decision tick first.", "color:orange");
            return;
        }

        const mvName = recorded.move ? (recorded.move.name || recorded.move.dir || JSON.stringify(recorded.move)) : "null";
        console.log("%c Engine's actual root decision (from alphaBeta at decision time):", "font-weight:700",
                    (mvName.name || mvName) , "| score:", recorded.score, "| depth:", recorded.rootDepth);

        if (recorded.children) {
            recorded.children.forEach(child => {
                const name = (child.move && child.move.name) ? child.move.name : `${child.coords.x},${child.coords.y}`;
                console.group(`${name} ${child.ate ? "(EAT)" : ""}`);
                console.log("Simulated move coords:", child.coords.x, child.coords.y);
                console.log("Raw recursion score (returned by alphaBeta):", child.rawRecursionScore);
                if (child.collisionPenalty !== 0) console.log("Collision penalty cap applied:", child.collisionPenalty);
                if (child.ate) console.log("EAT_REWARD applied:", Config.SCORES.EAT_REWARD);
                console.log("%c Final score used by root (after modifiers):", "font-weight:700", child.modifiedScore);
                console.groupEnd();
            });
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { getSmartMoveDebug, DIRS };
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.getSmartMoveDebug = getSmartMoveDebug;
        global.SnakeAI.runDebugAnalysis = runDebugAnalysis;
        global.SnakeAI.DIRS = DIRS;
    }
})(this);
