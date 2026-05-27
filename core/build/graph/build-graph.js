/**
 * Build DAG — nodes and edges for incremental rebuild
 * @module core/build/graph/build-graph
 */

class BuildGraph {
  constructor() {
    /** @type {Map<string, { id: string, kind: string, hash: string, meta?: Record<string, unknown> }>} */
    this.nodes = new Map();
    /** @type {Array<{ from: string, to: string, kind: string }>} */
    this.edges = [];
  }

  /**
   * @param {string} id
   * @param {string} kind
   * @param {string} hash
   * @param {Record<string, unknown>} [meta]
   */
  addNode(id, kind, hash, meta = {}) {
    this.nodes.set(id, { id, kind, hash, meta });
  }

  /**
   * @param {string} from
   * @param {string} to
   * @param {string} kind
   */
  addEdge(from, to, kind) {
    this.edges.push({ from, to, kind });
  }

  /**
   * @returns {{ nodes: object[], edges: object[] }}
   */
  toJSON() {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges],
    };
  }

  /**
   * @param {string} nodeId
   * @returns {string[]} dependent node ids (transitive downstream)
   */
  dependentsOf(nodeId) {
    const out = new Set();
    const queue = [nodeId];
    while (queue.length) {
      const cur = queue.shift();
      for (const e of this.edges) {
        if (e.from === cur && !out.has(e.to)) {
          out.add(e.to);
          queue.push(e.to);
        }
      }
    }
    return [...out];
  }
}

module.exports = { BuildGraph };
