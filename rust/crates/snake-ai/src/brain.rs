use std::time::Instant;

use snake_domain::{Direction, Point};

use crate::{
    config::AiConfig,
    floodfill::flood_fill,
    grid::Grid,
    model::{AgentState, SearchBuffers},
    pathfinding::get_food_distance_map,
    search::{RootChildRecord, negamax},
    tt::{TranspositionTable, TtMove},
    zobrist::Zobrist,
};

#[derive(Debug, Clone)]
pub struct Decision {
    pub best_move: Direction,
    pub score: f64,
    pub log: String,
    pub root_children: Vec<RootChildRecord>,
}

fn fallback_move(grid: &Grid, me: &AgentState, buffers: &mut SearchBuffers) -> Direction {
    if me.body.is_empty() {
        return Direction::Up;
    }
    let head = me.body[0];
    let neighbors = [
        (head.x, head.y + 1, Direction::Up),
        (head.x, head.y - 1, Direction::Down),
        (head.x - 1, head.y, Direction::Left),
        (head.x + 1, head.y, Direction::Right),
    ];

    let mut candidates = Vec::new();
    for (x, y, dir) in neighbors {
        if grid.is_safe(x, y) {
            let ff = flood_fill(grid, x, y, 100, None, buffers);
            candidates.push((ff.count, dir));
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.first().map(|c| c.1).unwrap_or(Direction::Up)
}

pub fn decide_move_debug(
    mut me: AgentState,
    mut enemy: AgentState,
    mut foods: Vec<Point>,
    cols: i32,
    rows: i32,
    cfg: &AiConfig,
) -> Decision {
    crate::PERF_STATS.with(|s| *s.borrow_mut() = crate::PerfStats::default());

    let started = Instant::now();
    let mut grid = Grid::from_state(cols, rows, &foods, &me.body, &enemy.body);
    let dist_map_vec = get_food_distance_map(&grid, &foods);

    let zobrist = Zobrist::new(cols, rows);
    let initial_hash = zobrist.compute_hash(&grid, me.health, enemy.health);
    let mut tt = TranspositionTable::default();
    let mut history_table = [vec![0i32; (cols * rows * 4) as usize], vec![0i32; (cols * rows * 4) as usize]];
    tt.clear();

    let mut buffers = SearchBuffers::new((cols * rows) as usize);

    let result = negamax(
        &mut grid,
        &mut me,
        &mut enemy,
        &mut foods,
        Some(&dist_map_vec),
        cfg.max_depth,
        f64::NEG_INFINITY,
        f64::INFINITY,
        0,
        cfg.max_depth,
        initial_hash,
        &mut history_table,
        cfg,
        &mut tt,
        &zobrist,
        0,
        &mut buffers,
    );

    let selected = result
        .mv
        .map(|m: TtMove| m.dir)
        .unwrap_or_else(|| fallback_move(&grid, &me, &mut buffers));

    let mut log = format!("Score: {}", result.score.floor() as i64);
    if result.mv.is_none() {
        log.push_str(" | FAILSAFE");
    }
    let elapsed = started.elapsed();
    log.push_str(&format!(" | {}ms", elapsed.as_millis()));

    crate::PERF_STATS.with(|s| {
        let st = s.borrow();
        println!("=== PROFILING ===");
        println!("Total time: {:?}", elapsed);
        println!("Nodes: {}", st.negamax_calls);
        println!("Eval: {:>8} calls, {:?}", st.eval_calls, st.eval_duration);
        println!("Voronoi: {:>8} calls, {:?}", st.voronoi_calls, st.voronoi_duration);
        println!("Floodfill: {:>8} calls, {:?}", st.floodfill_calls, st.floodfill_duration);
        println!("MoveGen: {:>8} calls, {:?}", st.move_gen_calls, st.move_gen_duration);
        println!("DistMap: {:>8} calls, {:?}", st.distmap_calls, st.distmap_duration);
        println!("ShortDist: {:>8} calls, {:?}", st.shortest_dist_calls, st.shortest_dist_duration);
        println!("======\n");
    });

    Decision {
        best_move: selected,
        score: result.score,
        log,
        root_children: result.children,
    }
}
