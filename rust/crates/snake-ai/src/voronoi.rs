use crate::bitboard::BitBoard;
use crate::grid::Grid;
use crate::model::SearchBuffers;
use snake_domain::Point;

#[derive(Debug, Clone)]
pub struct VoronoiResult {
    pub my_count: i32,
    pub enemy_count: i32,
}

pub fn compute_voronoi(grid: &Grid, my_head: Point, enemy_head: Point, _buffers: &mut SearchBuffers) -> VoronoiResult {
    let start = std::time::Instant::now();
    let res = compute_voronoi_inner(grid, my_head, enemy_head);
    crate::PERF_STATS.with(|s| {
        let mut st = s.borrow_mut();
        st.voronoi_calls += 1;
        st.voronoi_duration += start.elapsed();
    });
    res
}

fn compute_voronoi_inner(grid: &Grid, my_head: Point, enemy_head: Point) -> VoronoiResult {
    let mut my_front = BitBoard::with_bit(grid.idx(my_head.x, my_head.y));
    let mut en_front = BitBoard::with_bit(grid.idx(enemy_head.x, enemy_head.y));

    let mut visited = my_front | en_front;
    let safe_cells = grid.safe_cells();
    let ctx = &grid.ctx;

    let mut my_count = 0;
    let mut enemy_count = 0;

    loop {
        // Expand fronts radially in 1 cycle
        my_front = ctx.expand(my_front) & safe_cells & !visited;
        en_front = ctx.expand(en_front) & safe_cells & !visited;

        // Strip tie states so neither player claims them
        let ties = my_front & en_front;
        my_front &= !ties;
        en_front &= !ties;

        // Mark current front and ties as visited so they aren't processed again
        visited |= my_front | en_front | ties;

        let my_new = my_front.count_ones() as i32;
        let en_new = en_front.count_ones() as i32;

        my_count += my_new;
        enemy_count += en_new;

        if my_new == 0 && en_new == 0 {
            break;
        }
    }

    VoronoiResult { my_count, enemy_count }
}
