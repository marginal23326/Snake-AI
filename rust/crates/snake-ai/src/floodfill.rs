use snake_domain::Point;

use crate::grid::Grid;

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
) -> FloodFillResult {
    if start_x < 0 || start_y < 0 || start_x >= grid.width || start_y >= grid.height {
        return FloodFillResult {
            count: 0,
            min_turns_to_clear: i32::MAX,
            has_food: false,
        };
    }

    let size = (grid.width * grid.height) as usize;
    let mut visited = vec![false; size];
    let mut queue = Vec::with_capacity(size);
    let mut body_map = vec![-1i32; size];

    if let Some(body) = snake_body {
        for (i, part) in body.iter().enumerate() {
            if part.x >= 0 && part.x < grid.width && part.y >= 0 && part.y < grid.height {
                body_map[grid.idx(part.x, part.y)] = i as i32;
            }
        }
    }

    let start_idx = grid.idx(start_x, start_y);
    visited[start_idx] = true;
    queue.push((start_x, start_y));

    let mut count = 1;
    let mut min_turns_to_clear = i32::MAX;
    let mut has_food = false;
    let mut head = 0usize;

    while head < queue.len() && count < max_depth {
        let (cx, cy) = queue[head];
        head += 1;

        if !has_food && grid.get(cx, cy) == 1 {
            has_food = true;
        }

        let neighbors = [(cx, cy - 1), (cx, cy + 1), (cx - 1, cy), (cx + 1, cy)];
        for (nx, ny) in neighbors {
            if nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height {
                continue;
            }
            let idx = grid.idx(nx, ny);
            if visited[idx] {
                continue;
            }

            let cell = grid.cells[idx];
            if cell == 0 || cell == 1 {
                visited[idx] = true;
                queue.push((nx, ny));
                count += 1;
            } else if let Some(body) = snake_body {
                let body_index = body_map[idx];
                if body_index != -1 {
                    let turns = body.len() as i32 - body_index;
                    min_turns_to_clear = min_turns_to_clear.min(turns);
                    visited[idx] = true;
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
