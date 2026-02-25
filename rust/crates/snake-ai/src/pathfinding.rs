use snake_domain::Point;

use crate::grid::Grid;

pub fn get_food_distance_map(grid: &Grid, foods: &[Point]) -> Vec<i16> {
    let start = std::time::Instant::now();
    let res = get_food_distance_map_inner(grid, foods);
    crate::PERF_STATS.with(|s| {
        let mut st = s.borrow_mut();
        st.distmap_calls += 1;
        st.distmap_duration += start.elapsed();
    });
    res
}

fn get_food_distance_map_inner(grid: &Grid, foods: &[Point]) -> Vec<i16> {
    let size = (grid.width * grid.height) as usize;
    let mut dist_map = vec![1000i16; size];
    let mut queue = Vec::with_capacity(size);

    for f in foods {
        if f.x < 0 || f.y < 0 || f.x >= grid.width || f.y >= grid.height {
            continue;
        }
        let idx = grid.idx(f.x, f.y);
        dist_map[idx] = 0;
        queue.push((f.x, f.y, 0i16));
    }

    let mut head = 0usize;
    while head < queue.len() {
        let (cx, cy, d) = queue[head];
        head += 1;
        let neighbors = [(cx, cy - 1), (cx, cy + 1), (cx - 1, cy), (cx + 1, cy)];

        for (nx, ny) in neighbors {
            if nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height {
                continue;
            }
            let idx = grid.idx(nx, ny);
            if dist_map[idx] == 1000 && grid.is_safe(nx, ny) {
                dist_map[idx] = d + 1;
                queue.push((nx, ny, d + 1));
            }
        }
    }

    dist_map
}
