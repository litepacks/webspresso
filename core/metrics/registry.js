/**
 * Webspresso Prometheus-Compatible Metrics Registry
 * Zero-dependency: In-memory counter, gauge, and histogram metrics with standard Prometheus exposition format.
 *
 * @module core/metrics/registry
 */

'use strict';

/**
 * Format label object into Prometheus label string
 * e.g. { method: 'GET', status: '200' } -> '{method="GET",status="200"}'
 * @param {Record<string, string|number>} labels
 * @returns {string}
 */
function formatLabels(labels) {
  if (!labels || Object.keys(labels).length === 0) return '';
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `{${parts.join(',')}}`;
}

/**
 * Create a cache key for labels
 * @param {Record<string, string|number>} labels
 * @returns {string}
 */
function labelsKey(labels) {
  if (!labels || Object.keys(labels).length === 0) return '';
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

class Counter {
  constructor(name, help = '') {
    this.name = name;
    this.help = help;
    this.type = 'counter';
    this.values = new Map(); // labelKey -> { labels, value }
  }

  inc(labelsOrValue = 1, maybeValue = 1) {
    let labels = {};
    let val = 1;

    if (typeof labelsOrValue === 'object' && labelsOrValue !== null) {
      labels = labelsOrValue;
      val = typeof maybeValue === 'number' ? maybeValue : 1;
    } else if (typeof labelsOrValue === 'number') {
      val = labelsOrValue;
    }

    if (val < 0) return; // Counters only go up

    const key = labelsKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += val;
    } else {
      this.values.set(key, { labels, value: val });
    }
  }

  get(labels = {}) {
    const item = this.values.get(labelsKey(labels));
    return item ? item.value : 0;
  }

  reset() {
    this.values.clear();
  }

  toPrometheus() {
    const lines = [];
    if (this.help) lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} counter`);

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const { labels, value } of this.values.values()) {
        lines.push(`${this.name}${formatLabels(labels)} ${value}`);
      }
    }
    return lines.join('\n');
  }
}

class Gauge {
  constructor(name, help = '') {
    this.name = name;
    this.help = help;
    this.type = 'gauge';
    this.values = new Map();
  }

  set(labelsOrValue, maybeValue) {
    let labels = {};
    let val = 0;

    if (typeof labelsOrValue === 'object' && labelsOrValue !== null) {
      labels = labelsOrValue;
      val = typeof maybeValue === 'number' ? maybeValue : 0;
    } else if (typeof labelsOrValue === 'number') {
      val = labelsOrValue;
    }

    const key = labelsKey(labels);
    this.values.set(key, { labels, value: val });
  }

  inc(labelsOrValue = 1, maybeValue = 1) {
    let labels = {};
    let val = 1;
    if (typeof labelsOrValue === 'object' && labelsOrValue !== null) {
      labels = labelsOrValue;
      val = typeof maybeValue === 'number' ? maybeValue : 1;
    } else if (typeof labelsOrValue === 'number') {
      val = labelsOrValue;
    }
    const key = labelsKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += val;
    } else {
      this.values.set(key, { labels, value: val });
    }
  }

  dec(labelsOrValue = 1, maybeValue = 1) {
    let labels = {};
    let val = 1;
    if (typeof labelsOrValue === 'object' && labelsOrValue !== null) {
      labels = labelsOrValue;
      val = typeof maybeValue === 'number' ? maybeValue : 1;
    } else if (typeof labelsOrValue === 'number') {
      val = labelsOrValue;
    }
    const key = labelsKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value -= val;
    } else {
      this.values.set(key, { labels, value: -val });
    }
  }

  get(labels = {}) {
    const item = this.values.get(labelsKey(labels));
    return item ? item.value : 0;
  }

  reset() {
    this.values.clear();
  }

  toPrometheus() {
    const lines = [];
    if (this.help) lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} gauge`);

    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const { labels, value } of this.values.values()) {
        lines.push(`${this.name}${formatLabels(labels)} ${value}`);
      }
    }
    return lines.join('\n');
  }
}

class Histogram {
  /**
   * @param {string} name
   * @param {string} help
   * @param {number[]} [buckets]
   */
  constructor(name, help = '', buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    this.name = name;
    this.help = help;
    this.type = 'histogram';
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.series = new Map(); // labelKey -> { labels, sum, count, bucketCounts }
  }

  observe(labelsOrValue, maybeValue) {
    let labels = {};
    let val = 0;

    if (typeof labelsOrValue === 'object' && labelsOrValue !== null) {
      labels = labelsOrValue;
      val = typeof maybeValue === 'number' ? maybeValue : 0;
    } else if (typeof labelsOrValue === 'number') {
      val = labelsOrValue;
    }

    const key = labelsKey(labels);
    let s = this.series.get(key);
    if (!s) {
      s = {
        labels,
        sum: 0,
        count: 0,
        bucketCounts: new Array(this.buckets.length).fill(0),
      };
      this.series.set(key, s);
    }

    s.sum += val;
    s.count += 1;

    for (let i = 0; i < this.buckets.length; i++) {
      if (val <= this.buckets[i]) {
        s.bucketCounts[i] += 1;
      }
    }
  }

  reset() {
    this.series.clear();
  }

  toPrometheus() {
    const lines = [];
    if (this.help) lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} histogram`);

    if (this.series.size === 0) {
      lines.push(`${this.name}_count 0`);
      lines.push(`${this.name}_sum 0`);
    } else {
      for (const { labels, sum, count, bucketCounts } of this.series.values()) {
        for (let i = 0; i < this.buckets.length; i++) {
          const bLabels = { ...labels, le: this.buckets[i] };
          lines.push(`${this.name}_bucket${formatLabels(bLabels)} ${bucketCounts[i]}`);
        }
        const infLabels = { ...labels, le: '+Inf' };
        lines.push(`${this.name}_bucket${formatLabels(infLabels)} ${count}`);
        lines.push(`${this.name}_sum${formatLabels(labels)} ${sum}`);
        lines.push(`${this.name}_count${formatLabels(labels)} ${count}`);
      }
    }
    return lines.join('\n');
  }
}

class MetricsRegistry {
  constructor() {
    this.metrics = new Map(); // name -> Metric
  }

  /**
   * Register or get Counter
   * @param {string} name
   * @param {string} [help]
   * @returns {Counter}
   */
  counter(name, help = '') {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, new Counter(name, help));
    }
    return this.metrics.get(name);
  }

  /**
   * Register or get Gauge
   * @param {string} name
   * @param {string} [help]
   * @returns {Gauge}
   */
  gauge(name, help = '') {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, new Gauge(name, help));
    }
    return this.metrics.get(name);
  }

  /**
   * Register or get Histogram
   * @param {string} name
   * @param {string} [help]
   * @param {number[]} [buckets]
   * @returns {Histogram}
   */
  histogram(name, help = '', buckets) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, new Histogram(name, help, buckets));
    }
    return this.metrics.get(name);
  }

  /**
   * Invalidate/remove a metric
   * @param {string} name
   */
  remove(name) {
    this.metrics.delete(name);
  }

  /**
   * Clear all metric series
   */
  reset() {
    for (const metric of this.metrics.values()) {
      metric.reset();
    }
  }

  /**
   * Format all registered metrics in standard Prometheus exposition format
   * @returns {string}
   */
  formatPrometheus() {
    const blocks = [];
    for (const metric of this.metrics.values()) {
      blocks.push(metric.toPrometheus());
    }
    return blocks.join('\n\n') + '\n';
  }

  /**
   * Format metrics as JSON structure
   * @returns {Record<string, any>}
   */
  formatJson() {
    const result = {};
    for (const [name, metric] of this.metrics.entries()) {
      if (metric.type === 'histogram') {
        const seriesData = [];
        for (const s of metric.series.values()) {
          seriesData.push({
            labels: s.labels,
            sum: s.sum,
            count: s.count,
            buckets: metric.buckets.map((le, i) => ({ le, count: s.bucketCounts[i] })),
          });
        }
        result[name] = { type: 'histogram', help: metric.help, series: seriesData };
      } else {
        const seriesData = [];
        for (const item of metric.values.values()) {
          seriesData.push({ labels: item.labels, value: item.value });
        }
        result[name] = { type: metric.type, help: metric.help, series: seriesData };
      }
    }
    return result;
  }
}

function createMetricsRegistry() {
  return new MetricsRegistry();
}

module.exports = {
  MetricsRegistry,
  createMetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  formatLabels,
};
