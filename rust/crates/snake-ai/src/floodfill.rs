use crate::bitboard::BitBoard;
use crate::grid::Grid;
use crate::model::SearchBuffers;
use snake_domain::Point;

#[derive(Debug, Clone, Copy)]
pub struct FloodFillResult {
    pub count: i32,
    pub min_turns_to_clear: i32,
    pub has_food: bool,
}

pub fn flood_fill(
    grid: &Grid,
    start_x: i32,
    start_y: i32,
    max_depth: i32,
    my_body: Option<&[Point]>,
    enemy_body: Option<&[Point]>,
    _buffers: &mut SearchBuffers,
) -> FloodFillResult {
    let start = std::time::Instant::now();
    let res = flood_fill_inner(grid, start_x, start_y, max_depth, my_body, enemy_body);
    crate::PERF_STATS.with(|s| {
        let mut st = s.borrow_mut();
        st.floodfill_calls += 1;
        st.floodfill_duration += start.elapsed();
    });
    res
}

fn flood_fill_inner(
    grid: &Grid,
    start_x: i32,
    start_y: i32,
    max_depth: i32,
    my_body: Option<&[Point]>,
    enemy_body: Option<&[Point]>,
) -> FloodFillResult {
    if start_x < 0 || start_y < 0 || start_x >= grid.width || start_y >= grid.height {
        return FloodFillResult {
            count: 0,
            min_turns_to_clear: i32::MAX,
            has_food: false,
        };
    }

    let mut front = BitBoard::with_bit(grid.idx(start_x, start_y));
    let mut visited = front;

    let safe_cells = grid.safe_cells();
    let food_cells = grid.food;

    let mut count = 1;
    let mut min_turns_to_clear = i32::MAX;
    let mut has_food = false;

    let my_mask = my_body.map_or(BitBoard::empty(), |b| {
        let mut m = BitBoard::empty();
        for p in b {
            if p.x >= 0 && p.x < grid.width && p.y >= 0 && p.y < grid.height {
                m.set(grid.idx(p.x, p.y));
            }
        }
        m
    });

    let en_mask = enemy_body.map_or(BitBoard::empty(), |b| {
        let mut m = BitBoard::empty();
        for p in b {
            if p.x >= 0 && p.x < grid.width && p.y >= 0 && p.y < grid.height {
                m.set(grid.idx(p.x, p.y));
            }
        }
        m
    });

    // Start depth at 1 because we are looking at neighbors
    for depth in 1..=max_depth {
        if !has_food && (visited & food_cells).any() {
            has_food = true;
        }

        let expanded_all = grid.ctx.expand(front) & !visited;

        // Helper closure to calculate escape time: max(travel_time, vanish_time)
        let check_hits = |hits: BitBoard, body: &[Point], current_min: &mut i32| {
            if hits.any() {
                let len = body.len() as i32;
                for (i, pt) in body.iter().enumerate() {
                    if pt.x >= 0 && pt.x < grid.width && pt.y >= 0 && pt.y < grid.height {
                        if hits.get(grid.idx(pt.x, pt.y)) {
                            let vanish_time = len - i as i32;
                            let escape_time = depth.max(vanish_time);
                            *current_min = (*current_min).min(escape_time);
                        }
                    }
                }
            }
        };

        if let Some(body) = my_body {
            check_hits(expanded_all & my_mask, body, &mut min_turns_to_clear);
        }

        if let Some(body) = enemy_body {
            check_hits(expanded_all & en_mask, body, &mut min_turns_to_clear);
        }

        front = expanded_all & safe_cells;
        if front.is_empty() {
            break;
        }

        visited |= front;
        count += front.count_ones() as i32;
    }

    FloodFillResult {
        count,
        min_turns_to_clear,
        has_food,
    }
}
