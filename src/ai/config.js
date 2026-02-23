(function(global) {
    const DIRS = {
        UP:    { x:  0, y:  1, name: "UP" },
        DOWN:  { x:  0, y: -1, name: "DOWN" },
        LEFT:  { x: -1, y:  0, name: "LEFT" },
        RIGHT: { x:  1, y:  0, name: "RIGHT" },
    };

    const Config = {
        DIRS: DIRS,
        MAX_DEPTH: 6,
        DENSE_TAIL_RACE_OCCUPANCY: 0.5,
        GA: {
            SELF_PLAY_ENABLED: true,
            SELF_PLAY_SNAPSHOT_INTERVAL: 5,
            SELF_PLAY_RECENT_COUNT: 5,
            SELF_PLAY_HOF_COUNT: 4,
            SELF_PLAY_MAX_POOL: 8,
            SELF_PLAY_GAMES: 4,
            HTTP_GAMES: 0,
            STAGED_EVAL_ENABLED: true,
            STAGED_QUICK_GAMES: 4,
            STAGED_QUICK_HTTP_GAMES: 2,
            STAGED_QUICK_SELF_GAMES: 2,
            STAGED_QUICK_MAX_TURNS_RATIO: 0.55,
            STAGED_REFINE_TOP_FRACTION: 0.5,
            VALIDATION_GAMES: 10,
            PROGRESS_LEVEL: 0,
            PROGRESS_MATCH_EVERY: 1,
            VERIFY_CANDIDATES: true,
            VERIFY_DEPTHS: [1, 2, 3, 4, 5, 6, 7, 8],
            VERIFY_MAX_ATTEMPTS: 200,
            HTTP_LEGACY_PORTS: [7000, 8000],
        },
        SCORES: {
            WIN:  1000000000,
            LOSS: -1000000000,
            DRAW: -100000000,

            TRAP_DANGER:       -169851244,
            STRATEGIC_SQUEEZE: -49293830,
            ENEMY_TRAPPED:     123914592,

            HEAD_ON_COLLISION: -169301651,
            TIGHT_SPOT:        -76786.239,

            LENGTH:            3299.936,
            EAT_REWARD:        4761.59,

            TERRITORY_CONTROL: 3771.179,
            KILL_PRESSURE:     226090.149,

            FOOD: {
                INTENSITY: 1603.242,
                THRESHOLD: 12.906,
                EXPONENT:  1.721,
            },

            AGGRESSION: 8332.109,
        },

        /** Deep-merge new values into this Config object in-place. */
        update: function(src) {
            (function merge(target, source) {
                for (const key of Object.keys(source)) {
                    if (
                        source[key] !== null &&
                        typeof source[key] === 'object' &&
                        !Array.isArray(source[key]) &&
                        typeof target[key] === 'object'
                    ) {
                        merge(target[key], source[key]);
                    } else {
                        target[key] = source[key];
                    }
                }
            })(this, src);
        },

        /** Return a plain snapshot of the tunable values. */
        snapshot: function() {
            return {
                SCORES: {
                    TRAP_DANGER:       this.SCORES.TRAP_DANGER,
                    HEAD_ON_COLLISION: this.SCORES.HEAD_ON_COLLISION,
                    TIGHT_SPOT:        this.SCORES.TIGHT_SPOT,
                    LENGTH:            this.SCORES.LENGTH,
                    EAT_REWARD:        this.SCORES.EAT_REWARD,
                    TERRITORY_CONTROL: this.SCORES.TERRITORY_CONTROL,
                    KILL_PRESSURE:     this.SCORES.KILL_PRESSURE,
                    ENEMY_TRAPPED:     this.SCORES.ENEMY_TRAPPED,
                    STRATEGIC_SQUEEZE: this.SCORES.STRATEGIC_SQUEEZE,
                    FOOD: { ...this.SCORES.FOOD },
                    AGGRESSION:        this.SCORES.AGGRESSION,
                }
            };
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Config;
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.Config = Config;
    }
})(this);
