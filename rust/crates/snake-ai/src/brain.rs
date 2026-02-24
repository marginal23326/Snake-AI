use std::time::Instant;

use snake_domain::{Direction, Point};

use crate::{
    config::AiConfig,
    floodfill::flood_fill,
    grid::Grid,
    model::{AgentState, SearchState},
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

fn fallback_move(grid: &Grid, me: &AgentState) -> Direction {
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
            let ff = flood_fill(grid, x, y, 100, None);
            candidates.push((ff.count, dir));
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.first().map(|c| c.1).unwrap_or(Direction::Up)
}

pub fn decide_move_debug(
    me: AgentState,
    enemy: AgentState,
    foods: Vec<Point>,
    cols: i32,
    rows: i32,
    cfg: &AiConfig,
) -> Decision {
    let started = Instant::now();
    let mut grid = Grid::from_state(cols, rows, &foods, &me.body, &enemy.body);

    let mut state = SearchState {
        me,
        enemy,
        food: foods,
        cols,
        rows,
        dist_map: None,
    };
    state.dist_map = Some(get_food_distance_map(&grid, &state.food));

    let zobrist = Zobrist::new(cols, rows);
    let initial_hash = zobrist.compute_hash(&grid, state.me.health, state.enemy.health);
    let mut tt = TranspositionTable::default();
    let mut history_table = [
        vec![0i32; (cols * rows * 4) as usize],
        vec![0i32; (cols * rows * 4) as usize],
    ];
    tt.clear();

    let result = negamax(
        &mut grid,
        &state,
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
    );

    let selected = result
        .mv
        .map(|m: TtMove| m.dir)
        .unwrap_or_else(|| fallback_move(&grid, &state.me));
    let mut log = format!("Score: {}", result.score.floor() as i64);
    if result.mv.is_none() {
        log.push_str(" | FAILSAFE");
    }
    log.push_str(&format!(" | {}ms", started.elapsed().as_millis()));

    Decision {
        best_move: selected,
        score: result.score,
        log,
        root_children: result.children,
    }
}
