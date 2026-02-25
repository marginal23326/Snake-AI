use std::cell::RefCell;
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

struct BrainMemory {
    tt: TranspositionTable,
    history: [Vec<i32>; 2],
    buffers: SearchBuffers,
    zobrist: Option<Zobrist>,
    max_grid: usize,
}

impl BrainMemory {
    fn new() -> Self {
        Self {
            tt: TranspositionTable::new(1 << 20), 
            history: [vec![], vec![]],
            buffers: SearchBuffers::new(0),
            zobrist: None,
            max_grid: 0,
        }
    }

    fn prepare(&mut self, cols: i32, rows: i32, depth: usize) {
        let size = (cols * rows) as usize;
        let used_history = size * 4;
        
        if size > self.max_grid {
            self.history = [vec![0; used_history], vec![0; used_history]];
            self.buffers = SearchBuffers::new(size);
            self.max_grid = size;
        } else {
            self.history[0][0..used_history].fill(0);
            self.history[1][0..used_history].fill(0);
        }

        let needs_new_zobrist = self.zobrist.as_ref().map_or(true, |z| z.width != cols || z.height != rows);
        if needs_new_zobrist {
            self.zobrist = Some(Zobrist::new(cols, rows));
        }

        let tt_size = match depth {
            0..=2 => 1 << 10,
            3..=4 => 1 << 14,
            5..=6 => 1 << 16,
            7..=8 => 1 << 18,
            _ => 1 << 20,
        };
        self.tt.prepare_for_search(tt_size);
    }
}

thread_local! {
    static BRAIN_MEM: RefCell<BrainMemory> = RefCell::new(BrainMemory::new());
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

    let (selected, score, root_children) = BRAIN_MEM.with(|mem_cell| {
        let mut mem_ref = mem_cell.borrow_mut();
        mem_ref.prepare(cols, rows, cfg.max_depth);

        let initial_hash = mem_ref.zobrist.as_ref().unwrap().compute_hash(&grid, me.health, enemy.health);

        let BrainMemory { ref mut history, ref mut tt, ref mut buffers, ref zobrist, .. } = *mem_ref;
        let zobrist_ref = zobrist.as_ref().unwrap();

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
            history,
            cfg,
            tt,
            zobrist_ref,
            0,
            buffers,
        );

        let selected = result
            .mv
            .map(|m: TtMove| m.dir)
            .unwrap_or_else(|| fallback_move(&grid, &me, buffers));

        (selected, result.score, result.children)
    });

    let mut log = format!("Score: {}", score.floor() as i64);
    if root_children.is_empty() {
        log.push_str(" | FAILSAFE");
    }
    let elapsed = started.elapsed();
    log.push_str(&format!(" | {}ms", elapsed.as_millis()));

    crate::PERF_STATS.with(|s| {
        let st = s.borrow();
        println!("PROFILING:");
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
        score,
        log,
        root_children,
    }
}