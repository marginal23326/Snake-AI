(function(global) {
    /**
     * Creates a grid where each cell contains the real distance to the closest food
     */
    function getFoodDistanceMap(grid, foods) {
        const width = grid.width;
        const height = grid.height;
        // Initialize with a high number (representing unreachable)
        const distMap = new Int16Array(width * height).fill(1000);
        const queue = [];

        // Start BFS from all food locations simultaneously
        foods.forEach(f => {
            const idx = f.y * width + f.x;
            distMap[idx] = 0;
            queue.push({ x: f.x, y: f.y, d: 0 });
        });

        let head = 0;
        while (head < queue.length) {
            const curr = queue[head++];

            const neighbors = [
                { x: curr.x, y: curr.y - 1 },
                { x: curr.x, y: curr.y + 1 },
                { x: curr.x - 1, y: curr.y },
                { x: curr.x + 1, y: curr.y }
            ];

            for (const n of neighbors) {
                if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
                    const idx = n.y * width + n.x;
                    // If we haven't visited this tile AND it's a safe tile to walk on
                    if (distMap[idx] === 1000 && grid.isSafe(n.x, n.y)) {
                        distMap[idx] = curr.d + 1;
                        queue.push({ x: n.x, y: n.y, d: curr.d + 1 });
                    }
                }
            }
        }
        return distMap;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = getFoodDistanceMap;
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.getFoodDistanceMap = getFoodDistanceMap;
    }
})(this);