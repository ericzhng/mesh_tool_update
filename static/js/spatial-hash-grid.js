class SpatialHashGrid {
    constructor(bounds, dimensions) {
        this.bounds = bounds;
        this.dimensions = dimensions;
        this.cells = new Map();
    }

    getCellIndex(position) {
        const x = Math.floor((position.x - this.bounds.min[0]) / this.dimensions[0]);
        const y = Math.floor((position.y - this.bounds.min[1]) / this.dimensions[1]);
        return `${x},${y}`;
    }

    insert(node) {
        const index = this.getCellIndex(node);
        if (!this.cells.has(index)) {
            this.cells.set(index, []);
        }
        this.cells.get(index).push(node);
    }

    query(bounds) {
        const results = new Set();
        const startX = Math.floor((bounds.min[0] - this.bounds.min[0]) / this.dimensions[0]);
        const startY = Math.floor((bounds.min[1] - this.bounds.min[1]) / this.dimensions[1]);
        const endX = Math.floor((bounds.max[0] - this.bounds.min[0]) / this.dimensions[0]);
        const endY = Math.floor((bounds.max[1] - this.bounds.min[1]) / this.dimensions[1]);

        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                const index = `${x},${y}`;
                if (this.cells.has(index)) {
                    this.cells.get(index).forEach(node => results.add(node));
                }
            }
        }
        return Array.from(results);
    }
    
    queryPoint(position, radius) {
        const searchBounds = {
            min: [position.x - radius, position.y - radius],
            max: [position.x + radius, position.y + radius]
        };
        return this.query(searchBounds);
    }

    remove(node) {
        const index = this.getCellIndex(node);
        if (this.cells.has(index)) {
            const cellNodes = this.cells.get(index);
            const nodeIndex = cellNodes.indexOf(node);
            if (nodeIndex > -1) {
                cellNodes.splice(nodeIndex, 1);
            }
        }
    }
}
