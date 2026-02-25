use snake_domain::Point;

use crate::{
    config::AiConfig,
    floodfill::flood_fill,
    grid::Grid,
    model::{AgentState, SearchBuffers},
    voronoi::compute_voronoi,
};

#[inline]
fn manhattan(a: Point, b: Point) -> i32 {
    (a.x - b.x).abs() + (a.y - b.y).abs()
}

// WRAPPER FOR PROFILING
pub fn evaluate(
    grid: &mut Grid,
    me: &AgentState,
    enemy: &AgentState,
    food: &[Point],
    dist_map: Option<&[i16]>,
    cfg: &AiConfig,
    buffers: &mut SearchBuffers,
) -> f64 {
    let start = std::time::Instant::now();
    let res = evaluate_inner(grid, me, enemy, food, dist_map, cfg, buffers);
    crate::PERF_STATS.with(|s| {
        let mut st = s.borrow_mut();
        st.eval_calls += 1;
        st.eval_duration += start.elapsed();
    });
    res
}

fn evaluate_inner(
    grid: &mut Grid,
    me: &AgentState,
    enemy: &AgentState,
    food: &[Point],
    dist_map: Option<&[i16]>,
    cfg: &AiConfig,
    buffers: &mut SearchBuffers,
) -> f64 {
    if me.health <= 0 || me.body.is_empty() {
        return cfg.scores.loss;
    }
    if enemy.health <= 0 || enemy.body.is_empty() {
        return cfg.scores.win;
    }

    let mut score = 0.0;
    let occupancy = (me.body.len() + enemy.body.len()) as f64 / (grid.width * grid.height) as f64;
    let dense_tail_race = me.body.len() >= 20 && enemy.body.len() >= 20 && occupancy >= cfg.dense_tail_race_occupancy;

    score += me.body.len() as f64 * cfg.scores.length;

    let my_head = me.body[0];
    let enemy_head = enemy.body[0];

    let mut tail_is_safe = false;
    let mut original_tail_val = 0i8;
    if let Some(tail) = me.body.last().copied() {
        if me.health < 100 {
            tail_is_safe = true;
            original_tail_val = grid.get(tail.x, tail.y);
            grid.set(tail.x, tail.y, 0);
        }
    }

    let voronoi = compute_voronoi(grid, my_head, enemy_head, buffers);
    if tail_is_safe {
        let tail = me.body[me.body.len() - 1];
        grid.set(tail.x, tail.y, original_tail_val);
    }

    score += (voronoi.my_count - voronoi.enemy_count) as f64 * cfg.scores.territory_control;

    let mut i_am_in_death_trap = false;
    if voronoi.my_count < me.body.len() as i32 {
        let ff = flood_fill(grid, my_head.x, my_head.y, me.body.len() as i32 + 2, Some(&me.body), buffers);
        let physical_space = ff.count;
        let adjusted_escape_time = ff.min_turns_to_clear + if ff.has_food { 1 } else { 0 };
        let future_len = me.body.len() as i32 + if ff.has_food { 1 } else { 0 };

        let trapped = physical_space < future_len && physical_space < adjusted_escape_time;
        if trapped {
            i_am_in_death_trap = true;
            score += if dense_tail_race {
                cfg.scores.trap_danger * 0.001
            } else {
                cfg.scores.trap_danger
            };
        } else if physical_space >= future_len {
            score += cfg.scores.strategic_squeeze;
        }
    } else if voronoi.my_count < ((grid.width * grid.height) as f64 * 0.2) as i32 {
        score += cfg.scores.tight_spot;
    }

    if !i_am_in_death_trap && voronoi.enemy_count < enemy.body.len() as i32 {
        let en_head = enemy.body[0];
        let en_ff = flood_fill(grid, en_head.x, en_head.y, enemy.body.len() as i32 + 2, Some(&enemy.body), buffers);
        let en_space = en_ff.count;
        let en_escape = en_ff.min_turns_to_clear;
        let en_future_len = enemy.body.len() as i32 + if en_ff.has_food { 1 } else { 0 };
        if en_space < en_future_len && en_space < en_escape {
            score += if dense_tail_race {
                cfg.scores.enemy_trapped * 0.001
            } else {
                cfg.scores.enemy_trapped
            };
        }
    }

    let dist_to_opp = manhattan(my_head, enemy_head);
    if dist_to_opp == 1 && me.body.len() > enemy.body.len() {
        score += cfg.scores.kill_pressure;
    }

    if !food.is_empty() {
        let closest_dist = if let Some(map) = dist_map {
            map[(my_head.y * grid.width + my_head.x) as usize] as i32
        } else {
            food.iter().map(|f| manhattan(my_head, *f)).min().unwrap_or(9999)
        };

        if closest_dist > me.health {
            return cfg.scores.loss;
        }

        let buffer = me.health - closest_dist;
        let panic_value = if buffer > 0 {
            cfg.scores.food.intensity * (cfg.scores.food.threshold / (buffer as f64 + 1.0)).powf(cfg.scores.food.exponent)
        } else {
            cfg.scores.food.intensity * 100.0
        };
        score -= closest_dist as f64 * panic_value;
    }

    if me.body.len() > enemy.body.len() + 1 {
        score -= dist_to_opp as f64 * cfg.scores.aggression;
    }

    score
}
