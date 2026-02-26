use snake_domain::{Direction, Point};

use crate::{
    config::AiConfig,
    grid::Grid,
    heuristics::evaluate,
    model::{AgentState, SearchBuffers},
    tt::{TranspositionTable, TtFlag, TtMove},
    zobrist::Zobrist,
};

const QUIESCENCE_MAX_EXTENSIONS: usize = 8;

#[derive(Debug, Clone)]
pub struct RootChildRecord {
    pub mv: TtMove,
    pub raw_recursion_score: f64,
    pub collision_penalty: f64,
    pub ate: bool,
    pub modified_score: f64,
}

#[derive(Debug, Clone)]
pub struct SearchResult {
    pub score: f64,
    pub mv: Option<TtMove>,
    pub children: Vec<RootChildRecord>,
}

struct MoveList {
    moves: [TtMove; 4],
    count: usize,
}

impl MoveList {
    fn new() -> Self {
        Self {
            moves: [TtMove::default(); 4],
            count: 0,
        }
    }

    fn push(&mut self, m: TtMove) {
        self.moves[self.count] = m;
        self.count += 1;
    }

    fn as_mut_slice(&mut self) -> &mut [TtMove] {
        &mut self.moves[0..self.count]
    }
}

fn get_safe_neighbors(grid: &Grid, me: &AgentState, enemy: &AgentState) -> MoveList {
    let start = std::time::Instant::now();
    let res = get_safe_neighbors_inner(grid, me, enemy);
    crate::PERF_STATS.with(|s| {
        let mut st = s.borrow_mut();
        st.move_gen_calls += 1;
        st.move_gen_duration += start.elapsed();
    });
    res
}

fn get_safe_neighbors_inner(grid: &Grid, me: &AgentState, enemy: &AgentState) -> MoveList {
    let mut list = MoveList::new();
    let my_body = &me.body;
    if my_body.is_empty() {
        return list;
    }
    let opp_body = &enemy.body;
    let head = my_body[0];

    // Identify if tails are stacked/protected
    let mut my_tail = None;
    let mut my_tail_stacked = false;
    if my_body.len() > 1 {
        let tail = my_body[my_body.len() - 1];
        let prev = my_body[my_body.len() - 2];
        my_tail = Some(tail);
        my_tail_stacked = tail == prev;
    }

    let mut opp_tail = None;
    let mut opp_tail_stacked = false;
    let mut enemy_can_eat = false;

    if opp_body.len() > 1 {
        let tail = opp_body[opp_body.len() - 1];
        let prev = opp_body[opp_body.len() - 2];
        opp_tail = Some(tail);
        opp_tail_stacked = tail == prev;

        // Perform bitwise check for food adjacency
        if let Some(eh) = opp_body.first() {
            let eh_idx = grid.idx(eh.x, eh.y);
            let eh_bb = crate::bitboard::BitBoard::with_bit(eh_idx);
            if (grid.ctx.expand(eh_bb) & grid.food).any() {
                enemy_can_eat = true;
            }
        }
    }

    let dirs = [
        (0, 1, Direction::Up, 0usize),
        (0, -1, Direction::Down, 1usize),
        (-1, 0, Direction::Left, 2usize),
        (1, 0, Direction::Right, 3usize),
    ];

    for (dx, dy, dir, dir_int) in dirs {
        let nx = head.x + dx;
        let ny = head.y + dy;
        let mut is_safe = grid.is_safe(nx, ny);

        // Allow moving into own tail if it moves away
        if !is_safe {
            if let Some(my_tail_pos) = my_tail {
                if nx == my_tail_pos.x && ny == my_tail_pos.y && !my_tail_stacked {
                    is_safe = true;
                }
            }
            // Allow moving into enemy tail if it moves away, isn't stacked, AND they can't eat
            if !is_safe {
                if let Some(opp_tail_pos) = opp_tail {
                    if nx == opp_tail_pos.x && ny == opp_tail_pos.y && !opp_tail_stacked && !enemy_can_eat {
                        is_safe = true;
                    }
                }
            }
        }

        if is_safe {
            list.push(TtMove {
                x: nx,
                y: ny,
                dir,
                dir_int,
            });
        }
    }

    list
}

fn root_tie_breaker(me: &AgentState, enemy: &AgentState, cols: i32, rows: i32, mv: TtMove) -> f64 {
    if me.body.is_empty() {
        return 0.0;
    }

    let my_len = me.body.len();
    let enemy_len = enemy.body.len();

    let mut move_into_enemy_tail_penalty = 0.0;
    if let Some(enemy_tail) = enemy.body.last().copied() {
        if mv.x == enemy_tail.x && mv.y == enemy_tail.y {
            move_into_enemy_tail_penalty = 0.5;
        }
    }

    let mut head_contact_bias = 0.0;
    if let Some(enemy_head) = enemy.body.first().copied() {
        let dist = (mv.x - enemy_head.x).abs() + (mv.y - enemy_head.y).abs();
        if dist == 1 {
            if my_len > enemy_len {
                head_contact_bias += 2.0;
            } else if my_len < enemy_len {
                head_contact_bias -= 1000.0;
            } else {
                head_contact_bias -= 500.0;
            }
        }
    }

    let mut tail_bias = 0.0;
    if cols > 0 && rows > 0 && my_len >= 20 && enemy_len >= 20 {
        let density = (my_len + enemy_len) as f64 / (cols * rows) as f64;
        if density >= 0.4 {
            let my_tail = me.body[my_len - 1];
            let tail_dist = (mv.x - my_tail.x).abs() + (mv.y - my_tail.y).abs();
            tail_bias = -(tail_dist as f64);
        }
    }

    tail_bias + head_contact_bias - move_into_enemy_tail_penalty
}

fn should_extend_leaf(grid: &Grid, me: &AgentState, enemy: &AgentState, cfg: &AiConfig) -> bool {
    let my_len = me.body.len();
    let enemy_len = enemy.body.len();
    if my_len < 20 || enemy_len < 20 {
        return false;
    }

    let occ = (my_len + enemy_len) as f64 / (grid.width * grid.height) as f64;
    if occ < cfg.dense_tail_race_occupancy {
        return false;
    }

    let my_moves = get_safe_neighbors(grid, me, enemy).count;
    if my_moves <= 2 {
        return true;
    }

    get_safe_neighbors(grid, enemy, me).count <= 2
}

pub fn negamax(
    grid: &mut Grid,
    me: &mut AgentState,
    enemy: &mut AgentState,
    food: &mut Vec<Point>,
    dist_map: Option<&[i16]>,
    depth: usize,
    mut alpha: f64,
    mut beta: f64,
    side: usize,
    root_depth: usize,
    current_hash: u64,
    history_table: &mut [Vec<i32>; 2],
    cfg: &AiConfig,
    tt: &mut TranspositionTable,
    zobrist: &Zobrist,
    q_depth: usize,
    buffers: &mut SearchBuffers,
) -> SearchResult {
    crate::PERF_STATS.with(|s| s.borrow_mut().negamax_calls += 1);

    let original_alpha = alpha;
    let tt_entry = tt.get(current_hash);

    if depth != root_depth {
        if let Some(entry) = tt_entry {
            if (entry.depth as usize) >= depth {
                match entry.flag {
                    TtFlag::Exact => {
                        return SearchResult {
                            score: entry.score,
                            mv: entry.mv,
                            children: Vec::new(),
                        };
                    }
                    TtFlag::LowerBound => alpha = alpha.max(entry.score),
                    TtFlag::UpperBound => beta = beta.min(entry.score),
                }
                if alpha >= beta {
                    return SearchResult {
                        score: entry.score,
                        mv: entry.mv,
                        children: Vec::new(),
                    };
                }
            }
        }
    }

    if me.body.is_empty() || me.health <= 0 {
        return SearchResult {
            score: cfg.scores.loss - depth as f64,
            mv: None,
            children: Vec::new(),
        };
    }
    if enemy.body.is_empty() || enemy.health <= 0 {
        return SearchResult {
            score: cfg.scores.win + depth as f64,
            mv: None,
            children: Vec::new(),
        };
    }

    if depth == 0 {
        if root_depth >= 3 && q_depth < QUIESCENCE_MAX_EXTENSIONS && should_extend_leaf(grid, me, enemy, cfg) {
            return negamax(
                grid,
                me,
                enemy,
                food,
                dist_map,
                1,
                alpha,
                beta,
                side,
                root_depth,
                current_hash,
                history_table,
                cfg,
                tt,
                zobrist,
                q_depth + 1,
                buffers,
            );
        }

        let score = if side == 0 {
            evaluate(grid, me, enemy, food, dist_map, cfg, buffers)
        } else {
            -evaluate(grid, enemy, me, food, dist_map, cfg, buffers)
        };
        return SearchResult {
            score,
            mv: None,
            children: Vec::new(),
        };
    }

    let head = me.body[0];
    let head_idx = (head.y * grid.width + head.x) as usize;
    let mut move_list = get_safe_neighbors(grid, me, enemy);
    if move_list.count == 0 {
        return SearchResult {
            score: cfg.scores.loss - depth as f64,
            mv: None,
            children: Vec::new(),
        };
    }

    let moves = move_list.as_mut_slice();
    let pv_move = tt_entry.and_then(|e| e.mv);

    if moves.len() > 1 {
        moves.sort_by(|a, b| {
            if let Some(pv) = pv_move {
                if a.x == pv.x && a.y == pv.y {
                    return std::cmp::Ordering::Less;
                }
                if b.x == pv.x && b.y == pv.y {
                    return std::cmp::Ordering::Greater;
                }
            }

            let hist_a = history_table[side][head_idx * 4 + a.dir_int];
            let hist_b = history_table[side][head_idx * 4 + b.dir_int];
            if hist_a != hist_b {
                return hist_b.cmp(&hist_a);
            }

            let mut min_a = 1000;
            let mut min_b = 1000;
            for f in food.iter() {
                let da = (a.x - f.x).abs() + (a.y - f.y).abs();
                let db = (b.x - f.x).abs() + (b.y - f.y).abs();
                min_a = min_a.min(da);
                min_b = min_b.min(db);
            }
            if min_a == min_b {
                let cx = grid.width as f64 / 2.0;
                let cy = grid.height as f64 / 2.0;
                let ca = (a.x as f64 - cx).abs() + (a.y as f64 - cy).abs();
                let cb = (b.x as f64 - cx).abs() + (b.y as f64 - cy).abs();
                return ca.partial_cmp(&cb).unwrap_or(std::cmp::Ordering::Equal);
            }
            min_a.cmp(&min_b)
        });
    }

    let is_root = root_depth == depth && side == 0;
    let mut child_records = Vec::new();
    let mut best_move = moves[0];
    let mut best_score = f64::NEG_INFINITY;
    let mut best_tie_break = f64::NEG_INFINITY;

    for &mv in moves.iter() {
        let mut collision_penalty = 0.0;
        let mut kill_threat_bonus = 0.0;
        if side == 0 && !enemy.body.is_empty() {
            let opp_head = enemy.body[0];
            let dist = (mv.x - opp_head.x).abs() + (mv.y - opp_head.y).abs();
            if dist == 1 {
                let my_len = me.body.len();
                let opp_len = enemy.body.len();
                if opp_len > my_len {
                    collision_penalty = cfg.scores.head_on_collision;
                } else if opp_len == my_len {
                    collision_penalty = cfg.scores.draw;
                } else {
                    kill_threat_bonus = cfg.scores.kill_pressure;
                }
            }
        }

        let tie_break = if is_root {
            root_tie_breaker(me, enemy, grid.width, grid.height, mv)
        } else {
            0.0
        };

        let original_head_val = grid.get(mv.x, mv.y);
        let ate_food = original_head_val == 1;

        let mut tail_restore: Option<(i32, i32, i8)> = None;
        let mut popped_tail = None;

        let mut next_hash = current_hash;
        let old_health = me.health;
        let new_health = if ate_food { 100 } else { old_health - 1 };

        me.health = new_health;
        me.body.insert(0, snake_domain::Point { x: mv.x, y: mv.y });

        let cell_id: i8 = if side == 0 { 2 } else { 3 };

        next_hash = zobrist.xor_health(next_hash, old_health, new_health, side == 0);
        next_hash = zobrist.xor(next_hash, mv.x, mv.y, original_head_val);
        next_hash = zobrist.xor(next_hash, mv.x, mv.y, cell_id);

        if !ate_food {
            if let Some(tail) = me.body.pop() {
                popped_tail = Some(tail);
                if tail.x != mv.x || tail.y != mv.y {
                    let original_tail_val = grid.get(tail.x, tail.y);
                    // Only clear the tail if it was genuinely ours (handling stacking)
                    if original_tail_val == cell_id {
                        grid.set(tail.x, tail.y, 0);
                        tail_restore = Some((tail.x, tail.y, original_tail_val));
                    }
                    next_hash = zobrist.xor(next_hash, tail.x, tail.y, cell_id);
                }
            }
        }

        grid.set(mv.x, mv.y, cell_id);

        let mut ate_food_idx = None;
        if ate_food {
            if let Some(idx) = food.iter().position(|f| f.x == mv.x && f.y == mv.y) {
                food.swap_remove(idx);
                ate_food_idx = Some(idx);
            }
        }

        let child = negamax(
            grid,
            enemy,
            me,
            food,
            None,
            depth - 1,
            -beta,
            -alpha,
            1 - side,
            root_depth,
            next_hash,
            history_table,
            cfg,
            tt,
            zobrist,
            q_depth,
            buffers,
        );

        grid.set(mv.x, mv.y, original_head_val);
        if let Some((tx, ty, tv)) = tail_restore {
            grid.set(tx, ty, tv);
        }

        if let Some(idx) = ate_food_idx {
            food.push(snake_domain::Point { x: mv.x, y: mv.y });
            let last = food.len() - 1;
            food.swap(idx, last);
        }

        me.body.remove(0);
        if let Some(tail) = popped_tail {
            me.body.push(tail);
        }
        me.health = old_health;

        let mut modified_score = -child.score;

        if collision_penalty < 0.0 {
            modified_score = modified_score.min(collision_penalty);
        }

        let terminal_band = modified_score.abs() >= cfg.scores.win.abs() * 0.9;
        if !terminal_band {
            if kill_threat_bonus > 0.0 {
                modified_score += kill_threat_bonus;
            }
            if ate_food && modified_score > -50_000_000.0 {
                modified_score += cfg.scores.eat_reward;
            }
        }

        if is_root {
            let my_len = me.body.len() + if ate_food { 1 } else { 0 };
            let enemy_len = enemy.body.len();
            let dense_tail_race = my_len >= 20
                && enemy_len >= 20
                && ((my_len + enemy_len) as f64 / (grid.width * grid.height) as f64) >= cfg.dense_tail_race_occupancy;

            me.body.insert(0, snake_domain::Point { x: mv.x, y: mv.y });
            let emulated_tail = if !ate_food { me.body.pop() } else { None };

            let continuation_moves = get_safe_neighbors(grid, me, enemy).count;

            if continuation_moves == 0 {
                modified_score += cfg.scores.trap_danger;
            }

            if dense_tail_race && !enemy.body.is_empty() {
                let enemy_head = enemy.body[0];
                let enemy_head_dist = (mv.x - enemy_head.x).abs() + (mv.y - enemy_head.y).abs();
                if continuation_moves == 1 && enemy_head_dist <= 5 {
                    modified_score -= cfg.scores.territory_control.abs() * 120.0;
                }
                if let Some(enemy_tail) = enemy.body.last().copied()
                    && mv.x == enemy_tail.x
                    && mv.y == enemy_tail.y
                {
                    modified_score -= cfg.scores.territory_control.abs() * 2.0;
                }
            }

            me.body.remove(0);
            if let Some(t) = emulated_tail {
                me.body.push(t);
            }
        }

        if is_root {
            child_records.push(RootChildRecord {
                mv,
                raw_recursion_score: child.score,
                collision_penalty,
                ate: ate_food,
                modified_score,
            });
        }

        if modified_score > best_score || ((modified_score - best_score).abs() <= 1e-9 && tie_break > best_tie_break) {
            best_score = modified_score;
            best_move = mv;
            best_tie_break = tie_break;
        }
        if best_score > alpha {
            alpha = best_score;
        }
        if alpha >= beta {
            break;
        }
    }

    history_table[side][head_idx * 4 + best_move.dir_int] += (depth * depth) as i32;
    let tt_flag = if best_score <= original_alpha {
        TtFlag::UpperBound
    } else if best_score >= beta {
        TtFlag::LowerBound
    } else {
        TtFlag::Exact
    };
    tt.set(current_hash, depth, best_score, tt_flag, Some(best_move));

    SearchResult {
        score: best_score,
        mv: Some(best_move),
        children: child_records,
    }
}
