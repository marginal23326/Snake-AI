(function(global) {
    let cacheVisited = null;
    let cacheQueue = null;
    let cacheBodyMap = null;
    
    let cacheDirtyIndices = null;
    let visitedGen = 0;

    function floodFill(grid, startX, startY, maxDepth, snakeBody = null) {
        const width = grid.width;
        const height = grid.height;
        const size = width * height;
        const cells = grid.cells;

        if (!cacheVisited || cacheVisited.length !== size) {
            cacheVisited = new Int32Array(size);
            cacheQueue = new Int32Array(size);
            cacheBodyMap = new Int16Array(size);
            cacheBodyMap.fill(-1);
            cacheDirtyIndices = new Int32Array(size);
            visitedGen = 0;
        }

        const visited = cacheVisited;
        const queue = cacheQueue;
        const bodyMap = cacheBodyMap;
        const dirtyIndices = cacheDirtyIndices;

        visitedGen++;
        if (visitedGen > 2000000000) { visited.fill(0); visitedGen = 1; }
        
        let dirtyCount = 0;
        if (snakeBody) {
            for (let i = 0; i < snakeBody.length; i++) {
                const part = snakeBody[i];
                if (part.x >= 0 && part.x < width && part.y >= 0 && part.y < height) {
                    const idx = part.y * width + part.x;
                    bodyMap[idx] = i;
                    dirtyIndices[dirtyCount++] = idx;
                }
            }
        }

        let qHead = 0, qTail = 0;
        const startIdx = startY * width + startX;
        queue[qTail++] = startIdx;
        visited[startIdx] = visitedGen;
        
        let count = 1;
        let minTurnsToClear = Infinity;
        let hasFood = false;

        while(qHead < qTail) {
            if (count >= maxDepth) break;

            const currIdx = queue[qHead++];
            
            if (!hasFood && cells[currIdx] === 1) {
                hasFood = true;
            }

            const currX = currIdx % width;
            const currY = (currIdx / width) | 0;

            // UP
            if (currY > 0) processNeighbor(currIdx - width);
            // DOWN
            if (currY < height - 1) processNeighbor(currIdx + width);
            // LEFT
            if (currX > 0) processNeighbor(currIdx - 1);
            // RIGHT
            if (currX < width - 1) processNeighbor(currIdx + 1);
        }

        function processNeighbor(idx) {
            if (visited[idx] === visitedGen) return;

            // Safe is 0 (Empty) or 1 (Food)
            const val = cells[idx];
            if (val === 0 || val === 1) {
                visited[idx] = visitedGen;
                queue[qTail++] = idx;
                count++;
            } else if (snakeBody) {
                const bodyIndex = bodyMap[idx];
                if (bodyIndex !== -1) {
                    const turns = snakeBody.length - bodyIndex;
                    if (turns < minTurnsToClear) minTurnsToClear = turns;
                    visited[idx] = visitedGen; 
                }
            }
        }

        for (let i = 0; i < dirtyCount; i++) {
            bodyMap[dirtyIndices[i]] = -1;
        }

        return { count, minTurnsToClear, hasFood };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = floodFill;
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.floodFill = floodFill;
    }
})(this);