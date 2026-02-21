(function(global) {
    let qX = null, qY = null, qOwner = null, qDist = null;
    let dists = null, owners = null, visited = null;
    let searchId = 0;

    function computeVoronoi(grid, myHead, enemyHead) {
        const width = grid.width;
        const height = grid.height;
        const size = width * height;
        const cells = grid.cells;

        if (!qX || qX.length < size) {
            qX = new Int16Array(size);
            qY = new Int16Array(size);
            qOwner = new Int8Array(size);
            qDist = new Int16Array(size);
            dists = new Int16Array(size);
            owners = new Int8Array(size);
            visited = new Int32Array(size);
        }
        searchId++;
        let head = 0, tail = 0;

        const mIdx = myHead.y * width + myHead.x;
        dists[mIdx] = 0;
        owners[mIdx] = 1;
        visited[mIdx] = searchId;
        qX[tail] = myHead.x; qY[tail] = myHead.y; qOwner[tail] = 1; qDist[tail] = 0;
        tail++;

        const eIdx = enemyHead.y * width + enemyHead.x;
        dists[eIdx] = 0;
        owners[eIdx] = 2;
        visited[eIdx] = searchId;
        qX[tail] = enemyHead.x; qY[tail] = enemyHead.y; qOwner[tail] = 2; qDist[tail] = 0;
        tail++;

        let myCount = 0, enemyCount = 0;

        while (head < tail) {
            const cx = qX[head], cy = qY[head], co = qOwner[head], cd = qDist[head];
            head++;
            const nd = cd + 1;
            const currIdx = cy * width + cx;

            // Manually unrolled for performance
            // 1. UP
            if (cy > 0) {
                const idx = currIdx - width;
                const val = cells[idx];
                if (val === 0 || val === 1) {
                    if (visited[idx] !== searchId) {
                        visited[idx] = searchId; dists[idx] = nd; owners[idx] = co;
                        qX[tail] = cx; qY[tail] = cy - 1; qOwner[tail] = co; qDist[tail] = nd; tail++;
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
                const val = cells[idx];
                if (val === 0 || val === 1) {
                    if (visited[idx] !== searchId) {
                        visited[idx] = searchId; dists[idx] = nd; owners[idx] = co;
                        qX[tail] = cx; qY[tail] = cy + 1; qOwner[tail] = co; qDist[tail] = nd; tail++;
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
                const val = cells[idx];
                if (val === 0 || val === 1) {
                    if (visited[idx] !== searchId) {
                        visited[idx] = searchId; dists[idx] = nd; owners[idx] = co;
                        qX[tail] = cx - 1; qY[tail] = cy; qOwner[tail] = co; qDist[tail] = nd; tail++;
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
                const val = cells[idx];
                if (val === 0 || val === 1) {
                    if (visited[idx] !== searchId) {
                        visited[idx] = searchId; dists[idx] = nd; owners[idx] = co;
                        qX[tail] = cx + 1; qY[tail] = cy; qOwner[tail] = co; qDist[tail] = nd; tail++;
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