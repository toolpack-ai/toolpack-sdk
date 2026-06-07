import { readFileSync, writeFileSync } from 'node:fs';
import type { EvalCase } from './eval-types.js';

/**
 * A collection of eval cases that can be loaded from / saved to JSON.
 *
 * @example
 * ```ts
 * const dataset = new EvalDataset([
 *   {
 *     id: 'q1',
 *     input: { message: 'What is 2 + 2?' },
 *     expectedOutput: '4',
 *   },
 * ]);
 *
 * dataset.save('./evals/math.json');
 *
 * const loaded = EvalDataset.load('./evals/math.json');
 * ```
 */
export class EvalDataset {
  private _cases: EvalCase[];

  constructor(cases: EvalCase[] = []) {
    this._cases = [...cases];
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  /** All cases in the dataset. */
  get cases(): EvalCase[] {
    return [...this._cases];
  }

  /** Number of cases. */
  get size(): number {
    return this._cases.length;
  }

  /**
   * Get a case by ID.
   * Returns `undefined` if not found.
   */
  get(id: string): EvalCase | undefined {
    return this._cases.find(c => c.id === id);
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  /**
   * Add one or more cases.
   * Throws if a case with the same ID already exists.
   */
  add(...cases: EvalCase[]): this {
    // Validate all before mutating — prevents partial add on duplicate within the batch
    const seen = new Set(this._cases.map(c => c.id));
    for (const c of cases) {
      if (seen.has(c.id)) {
        throw new Error(`EvalDataset: case with id "${c.id}" already exists.`);
      }
      seen.add(c.id);
    }
    this._cases.push(...cases);
    return this;
  }

  /**
   * Remove a case by ID.
   * Returns `true` if removed, `false` if not found.
   */
  remove(id: string): boolean {
    const before = this._cases.length;
    this._cases = this._cases.filter(c => c.id !== id);
    return this._cases.length < before;
  }

  /**
   * Filter cases by a predicate. Returns a new EvalDataset.
   */
  filter(predicate: (c: EvalCase) => boolean): EvalDataset {
    return new EvalDataset(this._cases.filter(predicate));
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  /**
   * Serialize to a plain array (suitable for `JSON.stringify`).
   */
  toJSON(): EvalCase[] {
    return [...this._cases];
  }

  /**
   * Save cases to a JSON file.
   *
   * @param filePath Absolute or relative path to the output file.
   */
  save(filePath: string): void {
    writeFileSync(filePath, JSON.stringify(this._cases, null, 2), 'utf-8');
  }

  /**
   * Load cases from a JSON file.
   * The file must contain a JSON array of `EvalCase` objects.
   *
   * @param filePath Absolute or relative path to the JSON file.
   */
  static load(filePath: string): EvalDataset {
    const raw = readFileSync(filePath, 'utf-8');
    const cases = JSON.parse(raw) as EvalCase[];
    return new EvalDataset(cases);
  }

  /**
   * Create an `EvalDataset` from a plain array (e.g. from a database query).
   */
  static from(cases: EvalCase[]): EvalDataset {
    return new EvalDataset(cases);
  }
}
