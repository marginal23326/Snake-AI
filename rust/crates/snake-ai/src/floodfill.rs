use crate::{grid::Grid, model::SearchBuffers};
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
    snake_body: Option<&[Point]>,
    buffers: &mut SearchBuffers,
) -> FloodFillResult {
    let start = std::time::Instant::now();
    let res = flood_fill_inner(grid, start_x, start_y, max_depth, snake_body, buffers);
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
    snake_body: Option<&[Point]>,
    buffers: &mut SearchBuffers,
) -> FloodFillResult {
    if start_x < 0 || start_y < 0 || start_x >= grid.width || start_y >= grid.height {
        return FloodFillResult {
            count: 0,
            min_turns_to_clear: i32::MAX,
            has_food: false,
        };
    }

    buffers.ensure_adj(grid.width, grid.height);
    let generation = buffers.next_gen();
    let queue = &mut buffers.ff_queue;
    queue.clear();

    let width = grid.width;
    let cells = &grid.cells;

    let ff_gen = &mut buffers.ff_gen;
    let body_gen = &mut buffers.ff_body_gen;
    let body_map = &mut buffers.ff_body_map;

    let mut body_len = 0;
    if let Some(body) = snake_body {
        body_len = body.len() as i32;
        for (i, part) in body.iter().enumerate() {
            if part.x >= 0 && part.x < width && part.y >= 0 && part.y < grid.height {
                let idx = (part.y * width + part.x) as usize;
                body_gen[idx] = generation;
                body_map[idx] = i as i32;
            }
        }
    }

    let start_idx = (start_y * width + start_x) as usize;
    ff_gen[start_idx] = generation;
    queue.push(start_idx as u32);

    let mut count = 1;
    let mut min_turns_to_clear = i32::MAX;
    let mut has_food = false;
    let mut head = 0usize;

    let adj_len = &buffers.adj_len;
    let adj_list = &buffers.adj_list;

    while head < queue.len() && count < max_depth {
        let curr_idx = unsafe { *queue.get_unchecked(head) } as usize;
        head += 1;

        if !has_food && unsafe { *cells.get_unchecked(curr_idx) } == 1 {
            has_food = true;
        }

        let len = unsafe { *adj_len.get_unchecked(curr_idx) };
        let neighbors = unsafe { adj_list.get_unchecked(curr_idx) };

        for i in 0..len {
            let n_idx = unsafe { *neighbors.get_unchecked(i) };

            if unsafe { *ff_gen.get_unchecked(n_idx) } != generation {
                let cell = unsafe { *cells.get_unchecked(n_idx) };
                if cell <= 1 {
                    unsafe {
                        *ff_gen.get_unchecked_mut(n_idx) = generation;
                    }
                    queue.push(n_idx as u32);
                    count += 1;
                } else if snake_body.is_some() && unsafe { *body_gen.get_unchecked(n_idx) } == generation {
                    let b_idx = unsafe { *body_map.get_unchecked(n_idx) };
                    let turns = body_len - b_idx;
                    min_turns_to_clear = min_turns_to_clear.min(turns);
                    unsafe {
                        *ff_gen.get_unchecked_mut(n_idx) = generation;
                    }
                }
            }
        }
    }

    FloodFillResult {
        count,
        min_turns_to_clear,
        has_food,
    }
}
