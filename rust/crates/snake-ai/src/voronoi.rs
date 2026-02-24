use snake_domain::Point;

use crate::grid::Grid;

#[derive(Debug, Clone)]
pub struct VoronoiResult {
    pub my_count: i32,
    pub enemy_count: i32,
}

pub fn compute_voronoi(grid: &Grid, my_head: Point, enemy_head: Point) -> VoronoiResult {
    let size = (grid.width * grid.height) as usize;
    let mut dists = vec![i16::MAX; size];
    let mut owners = vec![0i8; size];
    let mut visited = vec![false; size];
    let mut queue = Vec::with_capacity(size);

    let m_idx = grid.idx(my_head.x, my_head.y);
    dists[m_idx] = 0;
    owners[m_idx] = 1;
    visited[m_idx] = true;
    queue.push((my_head.x, my_head.y, 1i8));

    let e_idx = grid.idx(enemy_head.x, enemy_head.y);
    dists[e_idx] = 0;
    owners[e_idx] = 2;
    visited[e_idx] = true;
    queue.push((enemy_head.x, enemy_head.y, 2i8));

    let mut my_count = 0;
    let mut enemy_count = 0;
    let mut head = 0usize;

    while head < queue.len() {
        let (cx, cy, owner) = queue[head];
        head += 1;
        let curr_idx = grid.idx(cx, cy);
        let next_dist = dists[curr_idx] + 1;

        let neighbors = [(cx, cy - 1), (cx, cy + 1), (cx - 1, cy), (cx + 1, cy)];
        for (nx, ny) in neighbors {
            if nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height {
                continue;
            }
            let idx = grid.idx(nx, ny);
            if grid.cells[idx] > 1 {
                continue;
            }

            if !visited[idx] {
                visited[idx] = true;
                dists[idx] = next_dist;
                owners[idx] = owner;
                queue.push((nx, ny, owner));
                if owner == 1 {
                    my_count += 1;
                } else {
                    enemy_count += 1;
                }
            } else if dists[idx] == next_dist && owners[idx] != owner && owners[idx] != 3 {
                if owners[idx] == 1 {
                    my_count -= 1;
                } else if owners[idx] == 2 {
                    enemy_count -= 1;
                }
                owners[idx] = 3;
            }
        }
    }

    VoronoiResult {
        my_count,
        enemy_count,
    }
}
