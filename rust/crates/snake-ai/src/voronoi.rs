use crate::{grid::Grid, model::SearchBuffers};
use snake_domain::Point;

#[derive(Debug, Clone)]
pub struct VoronoiResult {
    pub my_count: i32,
    pub enemy_count: i32,
}

pub fn compute_voronoi(grid: &Grid, my_head: Point, enemy_head: Point, buffers: &mut SearchBuffers) -> VoronoiResult {
    let start = std::time::Instant::now();
    let res = compute_voronoi_inner(grid, my_head, enemy_head, buffers);
    crate::PERF_STATS.with(|s| {
        let mut st = s.borrow_mut();
        st.voronoi_calls += 1;
        st.voronoi_duration += start.elapsed();
    });
    res
}

fn compute_voronoi_inner(grid: &Grid, my_head: Point, enemy_head: Point, buffers: &mut SearchBuffers) -> VoronoiResult {
    buffers.ensure_adj(grid.width, grid.height);
    let generation = buffers.next_gen() as u32;
    let gen_mask = generation << 16;

    let mut my_front = std::mem::take(&mut buffers.v_my_front);
    let mut en_front = std::mem::take(&mut buffers.v_en_front);
    let mut next_my = std::mem::take(&mut buffers.v_next_my);
    let mut next_en = std::mem::take(&mut buffers.v_next_en);

    my_front.clear();
    en_front.clear();
    next_my.clear();
    next_en.clear();

    let v_visited = &mut buffers.v_visited;
    let width = grid.width;
    let m_idx = (my_head.y * width + my_head.x) as usize;
    let e_idx = (enemy_head.y * width + enemy_head.x) as usize;

    v_visited[m_idx] = gen_mask | 1; // layer 0, owner 1
    my_front.push(m_idx as u16);

    v_visited[e_idx] = gen_mask | 2; // layer 0, owner 2
    en_front.push(e_idx as u16);

    let mut my_count = 0;
    let mut enemy_count = 0;
    let mut layer = 1u32;

    let adj_len = &buffers.adj_len;
    let adj_list = &buffers.adj_list;
    let cells = &grid.cells;

    while !my_front.is_empty() || !en_front.is_empty() {
        let layer_mask = layer << 2;

        // 1. Expand MY front
        for &idx in my_front.iter() {
            let idx = idx as usize;

            let len = unsafe { *adj_len.get_unchecked(idx) };
            let neighbors = unsafe { adj_list.get_unchecked(idx) };

            for i in 0..len {
                let n_idx = unsafe { *neighbors.get_unchecked(i) };
                if unsafe { *cells.get_unchecked(n_idx) } <= 1 {
                    let vis = unsafe { *v_visited.get_unchecked(n_idx) };

                    // If generation does not match, it is unvisited!
                    if vis >> 16 != generation {
                        unsafe {
                            *v_visited.get_unchecked_mut(n_idx) = gen_mask | layer_mask | 1;
                        }
                        next_my.push(n_idx as u16);
                        my_count += 1;
                    }
                }
            }
        }

        // 2. Expand ENEMY front
        for &idx in en_front.iter() {
            let idx = idx as usize;
            let len = unsafe { *adj_len.get_unchecked(idx) };
            let neighbors = unsafe { adj_list.get_unchecked(idx) };

            for i in 0..len {
                let n_idx = unsafe { *neighbors.get_unchecked(i) };
                if unsafe { *cells.get_unchecked(n_idx) } <= 1 {
                    let vis = unsafe { *v_visited.get_unchecked(n_idx) };

                    if vis >> 16 != generation {
                        // Unvisited!
                        unsafe {
                            *v_visited.get_unchecked_mut(n_idx) = gen_mask | layer_mask | 2;
                        }
                        next_en.push(n_idx as u16);
                        enemy_count += 1;
                    } else if vis == (gen_mask | layer_mask | 1) {
                        // Tie! I reached this exact cell on THIS layer step! Revoke it!
                        unsafe {
                            *v_visited.get_unchecked_mut(n_idx) = gen_mask | layer_mask | 3;
                        }
                        my_count -= 1;
                    }
                }
            }
        }

        // Swap ping-pong queues
        my_front.clear();
        std::mem::swap(&mut my_front, &mut next_my);

        en_front.clear();
        std::mem::swap(&mut en_front, &mut next_en);

        layer += 1;
    }

    // Return the buffers so we can reuse them next call
    buffers.v_my_front = my_front;
    buffers.v_en_front = en_front;
    buffers.v_next_my = next_my;
    buffers.v_next_en = next_en;

    VoronoiResult { my_count, enemy_count }
}
