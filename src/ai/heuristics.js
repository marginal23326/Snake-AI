(function(global) {
    const Config = (typeof require !== 'undefined') ? require('./config') : global.SnakeAI.Config;
    const floodFill = (typeof require !== 'undefined') ? require('./floodfill') : global.SnakeAI.floodFill;
    const computeVoronoi = (typeof require !== 'undefined') ? require('./voronoi') : global.SnakeAI.computeVoronoi;

    function manhattan(p1, p2) {
        return Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y);
    }

    function evaluate(grid, state, debug = false) {
        const me = state.me; 
        const enemy = state.enemy;
        const breakdown = {}; 

        if (me.health <= 0) return debug ? { total: Config.SCORES.LOSS, reason: "Dead" } : Config.SCORES.LOSS;
        if (enemy.health <= 0) return debug ? { total: Config.SCORES.WIN, reason: "Enemy Dead" } : Config.SCORES.WIN;

        let score = 0;
        const occupancy = (me.body.length + enemy.body.length) / (grid.width * grid.height);
        const denseTailRace = (
            me.body.length >= 20 &&
            enemy.body.length >= 20 &&
            occupancy >= Config.DENSE_TAIL_RACE_OCCUPANCY
        );

        // 1. Length
        const lengthScore = me.body.length * Config.SCORES.LENGTH;
        score += lengthScore;
        if (debug) breakdown.length = lengthScore;

        const myHead = me.body[0];
        const enemyHead = enemy.body[0];
        
        // Handle Tail Safety for the simulation
        let tailIsSafe = false;
        let originalTailVal = 0;
        const tail = me.body[me.body.length - 1];
        if (tail && me.health < 100) {
            tailIsSafe = true;
            originalTailVal = grid.get(tail.x, tail.y);
            grid.set(tail.x, tail.y, 0); 
        }

        // 2. Voronoi Territory Control
        const voronoi = computeVoronoi(grid, myHead, enemyHead);
        
        if (tailIsSafe) grid.set(tail.x, tail.y, originalTailVal);

        // A. Territory Score
        const territoryScore = (voronoi.myCount - voronoi.enemyCount) * Config.SCORES.TERRITORY_CONTROL;
        score += territoryScore;

        let iAmInDeathTrap = false; 

        if (voronoi.myCount < me.body.length) {
            
            const ffResult = floodFill(grid, myHead.x, myHead.y, me.body.length + 2, me.body);
            
            const physicalSpace = ffResult.count;
            const adjustedEscapeTime = ffResult.minTurnsToClear + (ffResult.hasFood ? 1 : 0);
            const futureLength = me.body.length + (ffResult.hasFood ? 1 : 0);

            const isTrapped = (physicalSpace < futureLength) && (physicalSpace < adjustedEscapeTime);

            if (isTrapped) {
                iAmInDeathTrap = true;
                const trapDeathPenalty = denseTailRace
                    ? (Config.SCORES.TRAP_DANGER * 0.001)
                    : Config.SCORES.TRAP_DANGER;
                score += trapDeathPenalty;
                if (debug) breakdown.trapDeath = trapDeathPenalty;
            } else if (physicalSpace >= futureLength) {
                const pressurePenalty = Config.SCORES.STRATEGIC_SQUEEZE; 
                score += pressurePenalty;
                if (debug) breakdown.pressure = pressurePenalty;
            }
        } 
        else if (voronoi.myCount < grid.width * grid.height * 0.2) {
             score += Config.SCORES.TIGHT_SPOT;
             if (debug) breakdown.tight = Config.SCORES.TIGHT_SPOT;
        }

        // 3. Enemy Trap Detection
        if (!iAmInDeathTrap && voronoi.enemyCount < enemy.body.length) {
            const enemyHead = enemy.body[0];
            const enFF = floodFill(grid, enemyHead.x, enemyHead.y, enemy.body.length + 2, enemy.body);
            
            const enSpace = enFF.count;
            const enTimeToEscape = enFF.minTurnsToClear;
            const enFutureLen = enemy.body.length + (enFF.hasFood ? 1 : 0);

            if (enSpace < enFutureLen && enSpace < enTimeToEscape) {
                const enemyTrappedBonus = denseTailRace
                    ? (Config.SCORES.ENEMY_TRAPPED * 0.001)
                    : Config.SCORES.ENEMY_TRAPPED;
                score += enemyTrappedBonus;
                if (debug) breakdown.killThreat = enemyTrappedBonus;
            }
        }

        // 4. Tactical Kill Pressure
        const distToOpp = manhattan(myHead, enemyHead);
        if (distToOpp === 1 && me.body.length > enemy.body.length) {
            const killScore = Config.SCORES.KILL_PRESSURE;
            score += killScore;
            if (debug) breakdown.killPressure = killScore;
        }

        // 4. Food
        let foodScore = 0;
        if (state.food && state.food.length > 0) {
            let closestDist = 9999;
            if (state.distMap) {
                const headIdx = myHead.y * grid.width + myHead.x;
                closestDist = state.distMap[headIdx];
            } else {
                for(const f of state.food) {
                    const d = manhattan(myHead, f);
                    if (d < closestDist) closestDist = d;
                }
            }

            if (closestDist > me.health) {
                return debug ? { total: Config.SCORES.LOSS, reason: "Starvation" } : Config.SCORES.LOSS;
            }

            let panicValue = 0;
            const buffer = me.health - closestDist;
            
            if (buffer > 0) {
                panicValue = Config.SCORES.FOOD.INTENSITY * 
                    Math.pow(Config.SCORES.FOOD.THRESHOLD / (buffer + 1), Config.SCORES.FOOD.EXPONENT);
            } else {
                panicValue = Config.SCORES.FOOD.INTENSITY * 100;
            }
            foodScore -= closestDist * panicValue;
        }
        score += foodScore;
        if (debug) breakdown.foodCurve = Math.floor(foodScore);

        // 5. Aggression
        let aggroScore = 0;
        if (me.body.length > enemy.body.length + 1) {
            aggroScore = -(distToOpp * Config.SCORES.AGGRESSION);
        }
        score += aggroScore;
        if (debug) breakdown.aggro = aggroScore;

        if (debug) {
            breakdown.total = score;
            return breakdown;
        }
        return score;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = evaluate;
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.evaluate = evaluate;
    }
})(this);
