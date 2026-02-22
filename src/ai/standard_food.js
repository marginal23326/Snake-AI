(function(global) {
    const STANDARD_FOOD_SETTINGS = Object.freeze({
        initialFood: 3,
        minimumFood: 1,
        foodSpawnChance: 15,
    });

    function pointKey(x, y) {
        return `${x},${y}`;
    }

    function getUnoccupiedPoints(width, height, snakes, food) {
        const occupied = new Set();

        for (const snake of snakes) {
            for (const part of snake.body) {
                occupied.add(pointKey(part.x, part.y));
            }
        }

        for (const item of food) {
            occupied.add(pointKey(item.x, item.y));
        }

        const points = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (!occupied.has(pointKey(x, y))) {
                    points.push({ x, y });
                }
            }
        }

        return points;
    }

    function shuffleInPlace(arr, randInt) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = randInt(i + 1);
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
    }

    function checkFoodNeedingPlacement(randInt, settings, currentFoodCount) {
        const minFood = settings.minimumFood || 0;
        const foodSpawnChance = settings.foodSpawnChance || 0;

        if (currentFoodCount < minFood) {
            return minFood - currentFoodCount;
        }

        if (foodSpawnChance > 0 && (100 - randInt(100)) < foodSpawnChance) {
            return 1;
        }

        return 0;
    }

    function placeFoodRandomlyAtPositions(randInt, food, count, positions) {
        let n = count;
        if (positions.length < n) {
            n = positions.length;
        }
        if (n <= 0) {
            return 0;
        }

        shuffleInPlace(positions, randInt);

        for (let i = 0; i < n; i++) {
            food.push(positions[i]);
        }

        return n;
    }

    function placeFoodRandomly(randInt, width, height, snakes, food, count) {
        const unoccupiedPoints = getUnoccupiedPoints(width, height, snakes, food);
        return placeFoodRandomlyAtPositions(randInt, food, count, unoccupiedPoints);
    }

    function applyStandardFoodSpawning(randInt, width, height, snakes, food, settings = STANDARD_FOOD_SETTINGS) {
        const foodNeeded = checkFoodNeedingPlacement(randInt, settings, food.length);
        if (foodNeeded <= 0) {
            return 0;
        }
        return placeFoodRandomly(randInt, width, height, snakes, food, foodNeeded);
    }

    function placeInitialStandardFood(randInt, width, height, snakes, food, settings = STANDARD_FOOD_SETTINGS) {
        const initialFood = settings.initialFood || 0;
        if (initialFood <= 0) {
            return 0;
        }
        return placeFoodRandomly(randInt, width, height, snakes, food, initialFood);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            STANDARD_FOOD_SETTINGS,
            placeInitialStandardFood,
            applyStandardFoodSpawning,
        };
    } else {
        global.SnakeAI = global.SnakeAI || {};
        global.SnakeAI.STANDARD_FOOD_SETTINGS = STANDARD_FOOD_SETTINGS;
        global.SnakeAI.placeInitialStandardFood = placeInitialStandardFood;
        global.SnakeAI.applyStandardFoodSpawning = applyStandardFoodSpawning;
    }
})(this);