use std::cell::RefCell;
use std::sync::{OnceLock, RwLock};
use std::time::Instant;

use snake_domain::{Direction, Point};

use crate::{
    config::AiConfig,
    floodfill::flood_fill,
    grid::Grid,
    model::{AgentState, SearchBuffers},
    pathfinding::get_food_distance_map,
    search::{RootChildRecord, negamax},
    tt::TranspositionTable,
    zobrist::Zobrist,
};

#[derive(Debug, Clone)]
pub struct Decision {
    pub best_move: Direction,
    pub score: f64,
    pub log: String,
    pub root_children: Vec<RootChildRecord>,
    pub pv: Vec<Direction>,
}

struct BrainMemory {
    zobrist: Option<Zobrist>,
    max_grid: usize,
}

thread_local! {
    static BRAIN_MEM: RefCell<BrainMemory> = RefCell::new(BrainMemory { zobrist: None, max_grid: 0 });
}

static GLOBAL_TT: OnceLock<RwLock<TranspositionTable>> = OnceLock::new();

fn get_tt() -> &'static RwLock<TranspositionTable> {
    GLOBAL_TT.get_or_init(|| RwLock::new(TranspositionTable::new(1 << 20)))
}

fn fallback_move(grid: &Grid, me: &AgentState, buffers: &mut SearchBuffers) -> Direction {
    if me.body.is_empty() {
        return Direction::Up;
    }
    let head = me.body.head();
    let neighbors = [
        (head.x, head.y + 1, Direction::Up),
        (head.x, head.y - 1, Direction::Down),
        (head.x - 1, head.y, Direction::Left),
        (head.x + 1, head.y, Direction::Right),
    ];

    let mut candidates = Vec::new();
    for (x, y, dir) in neighbors {
        if grid.is_safe(x, y) {
            let ff = flood_fill(grid, x, y, 100, Some(&me.body), None, buffers);
            candidates.push((ff.count, dir));
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.first().map(|c| c.1).unwrap_or(Direction::Up)
}

pub fn decide_move_debug(me: AgentState, enemy: AgentState, foods: Vec<Point>, cols: i32, rows: i32, cfg: &AiConfig) -> Decision {
    // Reset global profiler
    crate::PERF_STATS.with(|s| *s.borrow_mut() = crate::PerfStats::default());

    let started = Instant::now();
    let grid = Grid::from_state(cols, rows, &foods, &me.body, &enemy.body);
    let dist_map_vec = get_food_distance_map(&grid);

    let (zobrist, initial_hash) = BRAIN_MEM.with(|mem_cell| {
        let mut mem_ref = mem_cell.borrow_mut();
        let size = (cols * rows) as usize;
        if size > mem_ref.max_grid || mem_ref.zobrist.as_ref().map_or(true, |z| z.width != cols || z.height != rows) {
            mem_ref.zobrist = Some(Zobrist::new(cols, rows));
            mem_ref.max_grid = size;
        }
        let z = mem_ref.zobrist.clone().unwrap();
        let hash = z.compute_hash(&grid, me.health, enemy.health);
        (z, hash)
    });

    let tt_size = match cfg.max_depth {
        0..=2 => 1 << 10,
        3..=4 => 1 << 14,
        5..=6 => 1 << 16,
        7..=8 => 1 << 18,
        _ => 1 << 20,
    };

    let tt_lock = get_tt();
    {
        let mut tt_write = tt_lock.write().unwrap();
        tt_write.prepare_for_search(tt_size);
    }
    let tt = tt_lock.read().unwrap();

    let num_threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);

    let (selected, score, root_children, pv, aggregated_stats) = std::thread::scope(|s| {
        let mut handles = vec![];

        for thread_id in 0..num_threads {
            let mut t_grid = grid.clone();
            let mut t_me = me.clone();
            let mut t_enemy = enemy.clone();
            let mut t_foods = foods.clone();
            let t_dist_map = dist_map_vec.clone();
            let t_cfg = cfg.clone();
            let t_zobrist = zobrist.clone();
            let t_tt = &*tt; // Borrow the read lock

            handles.push(s.spawn(move || {
                // Initialize thread-local profiler state
                crate::PERF_STATS.with(|s| *s.borrow_mut() = crate::PerfStats::default());

                let size = (cols * rows) as usize;
                let used_history = size * 4;
                let mut history = [vec![0; used_history], vec![0; used_history]];
                let mut buffers = SearchBuffers::new(size);

                let res = negamax(
                    &mut t_grid,
                    &mut t_me,
                    &mut t_enemy,
                    &mut t_foods,
                    Some(&t_dist_map),
                    t_cfg.max_depth,
                    f64::NEG_INFINITY,
                    f64::INFINITY,
                    0,
                    t_cfg.max_depth,
                    initial_hash,
                    &mut history,
                    &t_cfg,
                    t_tt,
                    &t_zobrist,
                    0,
                    &mut buffers,
                    thread_id,
                );

                // Return search result + this thread's profiler stats
                let thread_stats = crate::PERF_STATS.with(|s| s.take());
                (res, thread_stats)
            }));
        }

        let mut primary_res = None;
        let mut total_stats = crate::PerfStats::default();

        for (i, handle) in handles.into_iter().enumerate() {
            let (res, stats) = handle.join().unwrap();

            total_stats.negamax_calls += stats.negamax_calls;
            total_stats.eval_calls += stats.eval_calls;
            total_stats.eval_duration += stats.eval_duration;
            total_stats.voronoi_calls += stats.voronoi_calls;
            total_stats.voronoi_duration += stats.voronoi_duration;
            total_stats.floodfill_calls += stats.floodfill_calls;
            total_stats.floodfill_duration += stats.floodfill_duration;
            total_stats.move_gen_calls += stats.move_gen_calls;
            total_stats.move_gen_duration += stats.move_gen_duration;
            total_stats.distmap_calls += stats.distmap_calls;
            total_stats.distmap_duration += stats.distmap_duration;

            if i == 0 {
                let mut fallback_buffers = SearchBuffers::new((cols * rows) as usize);
                let mv = res
                    .mv
                    .map(|m| m.dir)
                    .unwrap_or_else(|| fallback_move(&grid, &me, &mut fallback_buffers));
                primary_res = Some((mv, res.score, res.children, res.pv.moves[0..res.pv.len].to_vec()));
            }
        }

        let (best_move, score, children, pv) = primary_res.unwrap();
        (best_move, score, children, pv, total_stats)
    });

    crate::PERF_STATS.with(|s| *s.borrow_mut() = aggregated_stats);

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
        println!("Nodes (All Cores): {}", st.negamax_calls);
        println!("Eval: {:>8} calls, {:?}", st.eval_calls, st.eval_duration);
        println!("Voronoi: {:>8} calls, {:?}", st.voronoi_calls, st.voronoi_duration);
        println!("Floodfill: {:>8} calls, {:?}", st.floodfill_calls, st.floodfill_duration);
        println!("MoveGen: {:>8} calls, {:?}", st.move_gen_calls, st.move_gen_duration);
        println!("DistMap: {:>8} calls, {:?}", st.distmap_calls, st.distmap_duration);
        println!("======\n");
    });

    Decision {
        best_move: selected,
        score,
        log,
        root_children,
        pv,
    }
}
