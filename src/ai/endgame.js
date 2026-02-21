(function(global) {
    // Shared typed arrays for speed
    let em_fill = null;
    let ee_fill = null;
    let fillGen = 0;

    function solveEndgame(grid, state, voronoiData, my_food_distance, ply = 0) {
        if (state.me.body.length + state.enemy.body.length < 18) return null;

        const width = grid.width;
        const height = grid.height;
        const size = width * height;
        
        if (!em_fill || em_fill.length < size) {
            em_fill = new Int32Array(size);
            ee_fill = new Int32Array(size);
        }

        fillGen++;
        if (fillGen > 2000000000) {
            em_fill.fill(0);
            ee_fill.fill(0);
            fillGen = 1;
        }

        const owners = voronoiData.owners;
        const visited = voronoiData.visited;
        const searchId = voronoiData.searchId;

        const my_len = state.me.body.length;
        const opp_len = state.enemy.body.length;

        let my_black = 0, my_white = 0;
        let en_black = 0, en_white = 0;

        let isBlackRowStart = true;
        let idx = 0;

        // 1. Dilation and Parity Area Size Calculation
        for (let y = 0; y < height; y++) {
            let isBlack = isBlackRowStart;
            for (let x = 0; x < width; x++, idx++) {
                if (visited[idx] === searchId) {
                    let owner = owners[idx];
                    
                    if (owner === 3) {
                        if (my_len > opp_len) owner = 1;
                        else if (opp_len > my_len) owner = 2;
                    }
                    
                    if (owner === 1) {
                        isBlack ? my_black++ : my_white++;
                        em_fill[idx] = fillGen;
                        if (x > 0) em_fill[idx - 1] = fillGen;
                        if (x < width - 1) em_fill[idx + 1] = fillGen;
                        if (y > 0) em_fill[idx - width] = fillGen;
                        if (y < height - 1) em_fill[idx + width] = fillGen;
                    } else if (owner === 2) {
                        isBlack ? en_black++ : en_white++;
                        ee_fill[idx] = fillGen;
                        if (x > 0) ee_fill[idx - 1] = fillGen;
                        if (x < width - 1) ee_fill[idx + 1] = fillGen;
                        if (y > 0) ee_fill[idx - width] = fillGen;
                        if (y < height - 1) ee_fill[idx + width] = fillGen;
                    }
                }
                isBlack = !isBlack;
            }
            isBlackRowStart = !isBlackRowStart;
        }

        const my_over = Math.abs(my_black - my_white);
        const my_area_size = my_black + my_white - my_over + Math.min(my_over, 1);

        const en_over = Math.abs(en_black - en_white);
        const enemy_area_size = en_black + en_white - en_over + Math.min(en_over, 1);

        // 2. Tail Chase Distance Calculation
        const my_body = state.me.body;
        const e_body = state.enemy.body;

        let my_tail_dist = 0;
        let enemey_tail_dist = 0;
        let counter = 1;

        let t_idx = my_body[my_len - 1].y * width + my_body[my_len - 1].x;
        let t_owner = (visited[t_idx] === searchId) ? owners[t_idx] : 0;
        if (em_fill[t_idx] === fillGen && !(opp_len > my_len && t_owner === 2)) my_tail_dist = counter;
        if (ee_fill[t_idx] === fillGen && !(my_len > opp_len && t_owner === 1)) enemey_tail_dist = counter;

        for (let i = my_len - 2; i >= 0; i--) {
            if (my_tail_dist !== 0 && enemey_tail_dist !== 0) break;
            const idx = my_body[i].y * width + my_body[i].x;
            if (my_tail_dist === 0 && em_fill[idx] === fillGen) my_tail_dist = counter;
            if (enemey_tail_dist === 0 && ee_fill[idx] === fillGen) enemey_tail_dist = counter;
            counter++;
        }
        if (my_tail_dist === 0) my_tail_dist = counter;
        if (enemey_tail_dist === 0) enemey_tail_dist = counter;

        counter = 1;
        let my_etail_dist = 0;
        let enemey_etail_dist = 0;

        t_idx = e_body[opp_len - 1].y * width + e_body[opp_len - 1].x;
        t_owner = (visited[t_idx] === searchId) ? owners[t_idx] : 0;
        if (em_fill[t_idx] === fillGen && !(opp_len > my_len && t_owner === 2)) my_etail_dist = counter;
        if (ee_fill[t_idx] === fillGen && !(my_len > opp_len && t_owner === 1)) enemey_etail_dist = counter;

        for (let i = opp_len - 2; i >= 0; i--) {
            if (!(counter < my_tail_dist || counter < enemey_tail_dist)) break; 
            if (my_etail_dist !== 0 && enemey_etail_dist !== 0) break;

            const idx = e_body[i].y * width + e_body[i].x;
            if (my_etail_dist === 0 && em_fill[idx] === fillGen) my_etail_dist = counter;
            if (enemey_etail_dist === 0 && ee_fill[idx] === fillGen) enemey_etail_dist = counter;
            counter++;
        }
        if (my_etail_dist === 0) my_etail_dist = counter;
        if (enemey_etail_dist === 0) enemey_etail_dist = counter;

        my_tail_dist = Math.min(my_tail_dist, my_etail_dist);
        enemey_tail_dist = Math.min(enemey_tail_dist, enemey_etail_dist);

        // 3. Win/Loss Mathematical Deduction
        let loser = null;
        if (my_area_size < my_tail_dist && state.enemy.health > my_area_size) {
            if (enemy_area_size < enemey_tail_dist && state.me.health > enemy_area_size) {
                if (my_area_size < enemy_area_size) loser = 0; 
                else if (enemy_area_size < my_area_size) loser = 1; 
            } else {
                loser = 0; 
            }
        } else if (enemy_area_size < enemey_tail_dist && state.me.health > enemy_area_size) {
            loser = 1; 
        } else if (state.me.health < my_food_distance) {
            loser = 0; 
        }

        // 4. Return Absolute Score
        if (loser !== null) {
            const BASE_ENDGAME = 500000000; 
            if (loser === 1) return BASE_ENDGAME - (ply * 1000) - enemy_area_size;
            else return -BASE_ENDGAME + (ply * 1000) + my_area_size;
        }

        return null;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = solveEndgame;
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.solveEndgame = solveEndgame;
    }
})(this);