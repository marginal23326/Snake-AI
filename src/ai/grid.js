(function(global) {
    class Grid {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            // 0: Empty, 1: Food, 2: My Body, 3: Enemy Body
            this.cells = new Int8Array(width * height).fill(0);
        }

        _idx(x, y) {
            return y * this.width + x;
        }

        get(x, y) {
            if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 9; // Out of bounds
            return this.cells[this._idx(x, y)];
        }

        set(x, y, val) {
            if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                this.cells[this._idx(x, y)] = val;
            }
        }

        isSafe(x, y) {
            const val = this.get(x, y);
            // Safe: Empty (0) or Food (1)
            return val === 0 || val === 1;
        }

        clone() {
            const newGrid = new Grid(this.width, this.height);
            newGrid.cells.set(this.cells);
            return newGrid;
        }

        static fromState(state) {
            // state expects: { cols, rows, food, pBody, aBody }
            const g = new Grid(state.cols, state.rows);
            
            // Place Food
            if (state.food) {
                state.food.forEach(f => g.set(f.x, f.y, 1));
            }

            // Place Player (Me) - Mark everything as 2
            if (state.pBody) {
                state.pBody.forEach(p => {
                    g.set(p.x, p.y, 2); 
                });
            }

            // Place AI (Enemy) - Mark everything as 3
            if (state.aBody) {
                state.aBody.forEach(p => {
                    g.set(p.x, p.y, 3);
                });
            }

            return g;
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Grid;
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.Grid = Grid;
    }
})(this);