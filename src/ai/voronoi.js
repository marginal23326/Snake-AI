(function(global) {
    let qData = null;
    let dists = null, owners = null, visited = null;
    let searchId = 0;

    function computeVoronoi(grid, myHead, enemyHead) {
        const width = grid.width;
        const height = grid.height;
        const size = width * height;
        const cells = grid.cells;

        if (!qData || qData.length < size) {
            qData = new Int32Array(size);
            dists = new Int16Array(size);
            owners = new Int8Array(size);
            visited = new Int32Array(size);
        }
        searchId++;
        let head = 0, tail = 0;

        const mIdx = myHead.y * width + myHead.x;
        dists[mIdx] = 0; owners[mIdx] = 1; visited[mIdx] = searchId;
        qData[tail++] = (myHead.y << 16) | (myHead.x << 8) | 1;

        const eIdx = enemyHead.y * width + enemyHead.x;
        dists[eIdx] = 0; owners[eIdx] = 2; visited[eIdx] = searchId;
        qData[tail++] = (enemyHead.y << 16) | (enemyHead.x << 8) | 2;

        let myCount = 0, enemyCount = 0;

        while (head < tail) {
            const p = qData[head++];
            
            const cy = p >> 16;
            const cx = (p >> 8) & 0xFF;
            const co = p & 0xFF;

            const currIdx = cy * width + cx;
            const nd = dists[currIdx] + 1;

            // 1. UP
            if (cy > 0) {
                const idx = currIdx - width;
                if (cells[idx] <= 1) {
                    if (visited[idx] !== searchId) {
                        visited[idx] = searchId; dists[idx] = nd; owners[idx] = co;
                        qData[tail++] = ((cy - 1) << 16) | (cx << 8) | co;
                        if (co === 1) myCount++; else enemyCount++;
                    } else if (dists[idx] === nd && owners[idx] !== co && owners[idx] !== 3) {
                        if (owners[idx] === 1) myCount--; else if (owners[idx] === 2) enemyCount--;
                        owners[idx] = 3; 
                    }
                }
            }
            // 2. DOWN
            if (cy < height - 1) {
                const idx = currIdx + width;
                if (cells[idx] <= 1) {
                    if (visited[idx] !== searchId) {
                        visited[idx] = searchId; dists[idx] = nd; owners[idx] = co;
                        qData[tail++] = ((cy + 1) << 16) | (cx << 8) | co;
                        if (co === 1) myCount++; else enemyCount++;
                    } else if (dists[idx] === nd && owners[idx] !== co && owners[idx] !== 3) {
                        if (owners[idx] === 1) myCount--; else if (owners[idx] === 2) enemyCount--;
                        owners[idx] = 3; 
                    }
                }
            }
            // 3. LEFT
            if (cx > 0) {
                const idx = currIdx - 1;
                if (cells[idx] <= 1) {
                    if (visited[idx] !== searchId) {
                        visited[idx] = searchId; dists[idx] = nd; owners[idx] = co;
                        qData[tail++] = (cy << 16) | ((cx - 1) << 8) | co;
                        if (co === 1) myCount++; else enemyCount++;
                    } else if (dists[idx] === nd && owners[idx] !== co && owners[idx] !== 3) {
                        if (owners[idx] === 1) myCount--; else if (owners[idx] === 2) enemyCount--;
                        owners[idx] = 3; 
                    }
                }
            }
            // 4. RIGHT
            if (cx < width - 1) {
                const idx = currIdx + 1;
                if (cells[idx] <= 1) {
                    if (visited[idx] !== searchId) {
                        visited[idx] = searchId; dists[idx] = nd; owners[idx] = co;
                        qData[tail++] = (cy << 16) | ((cx + 1) << 8) | co;
                        if (co === 1) myCount++; else enemyCount++;
                    } else if (dists[idx] === nd && owners[idx] !== co && owners[idx] !== 3) {
                        if (owners[idx] === 1) myCount--; else if (owners[idx] === 2) enemyCount--;
                        owners[idx] = 3; 
                    }
                }
            }
        }
        return { myCount, enemyCount, owners, visited, searchId };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = computeVoronoi;
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.computeVoronoi = computeVoronoi;
    }
})(this);