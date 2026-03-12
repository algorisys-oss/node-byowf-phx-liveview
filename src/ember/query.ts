/**
 * Ember Query Builder — chainable query DSL compiling to parameterized SQL.
 *
 * Equivalent to Ecto.Query in Elixir.
 *
 * Usage:
 *   const q = from("users")
 *     .select(["username", "email"])
 *     .where("active", "=", true)
 *     .where("age", ">=", 18)
 *     .orderBy("username", "asc")
 *     .limit(10)
 *     .offset(20);
 *
 *   const [sql, params] = q.toSql();
 *   // → ["SELECT username, email FROM users WHERE active = ? AND age >= ? ORDER BY username ASC LIMIT 10 OFFSET 20", [true, 18]]
 */

export type Operator = "=" | "!=" | ">" | ">=" | "<" | "<=" | "LIKE" | "IN" | "IS NULL" | "IS NOT NULL";
export type Direction = "ASC" | "DESC";

interface Condition {
  column: string;
  operator: Operator;
  value?: unknown;
}

interface OrderClause {
  column: string;
  direction: Direction;
}

export class Query {
  private table: string;
  private columns: string[] = ["*"];
  private conditions: Condition[] = [];
  private orders: OrderClause[] = [];
  private limitVal: number | null = null;
  private offsetVal: number | null = null;
  private groupByColumns: string[] = [];
  private havingConditions: Condition[] = [];
  private distinctFlag = false;

  constructor(table: string) {
    this.table = table;
  }

  /** Select specific columns. */
  select(cols: string[]): this {
    this.columns = cols;
    return this;
  }

  /** Add a DISTINCT modifier. */
  distinct(): this {
    this.distinctFlag = true;
    return this;
  }

  /** Add a WHERE condition. */
  where(column: string, operator: Operator, value?: unknown): this {
    this.conditions.push({ column, operator, value });
    return this;
  }

  /** Shorthand: where column = value. */
  whereEq(column: string, value: unknown): this {
    return this.where(column, "=", value);
  }

  /** WHERE column IN (...values). */
  whereIn(column: string, values: unknown[]): this {
    return this.where(column, "IN", values);
  }

  /** WHERE column IS NULL. */
  whereNull(column: string): this {
    return this.where(column, "IS NULL");
  }

  /** WHERE column IS NOT NULL. */
  whereNotNull(column: string): this {
    return this.where(column, "IS NOT NULL");
  }

  /** WHERE column LIKE pattern. */
  whereLike(column: string, pattern: string): this {
    return this.where(column, "LIKE", pattern);
  }

  /** Add ORDER BY clause. */
  orderBy(column: string, direction: "asc" | "desc" = "asc"): this {
    this.orders.push({ column, direction: direction.toUpperCase() as Direction });
    return this;
  }

  /** Set LIMIT. */
  limit(n: number): this {
    this.limitVal = n;
    return this;
  }

  /** Set OFFSET. */
  offset(n: number): this {
    this.offsetVal = n;
    return this;
  }

  /** Add GROUP BY columns. */
  groupBy(...cols: string[]): this {
    this.groupByColumns.push(...cols);
    return this;
  }

  /** Add a HAVING condition (used with GROUP BY). */
  having(column: string, operator: Operator, value?: unknown): this {
    this.havingConditions.push({ column, operator, value });
    return this;
  }

  /** Build SELECT SQL and params. */
  toSql(): [string, unknown[]] {
    const params: unknown[] = [];
    const dist = this.distinctFlag ? "DISTINCT " : "";
    let sql = `SELECT ${dist}${this.columns.join(", ")} FROM ${this.table}`;

    if (this.conditions.length > 0) {
      sql += " WHERE " + this.buildConditions(this.conditions, params);
    }

    if (this.groupByColumns.length > 0) {
      sql += ` GROUP BY ${this.groupByColumns.join(", ")}`;
    }

    if (this.havingConditions.length > 0) {
      sql += " HAVING " + this.buildConditions(this.havingConditions, params);
    }

    if (this.orders.length > 0) {
      const orderParts = this.orders.map((o) => `${o.column} ${o.direction}`);
      sql += ` ORDER BY ${orderParts.join(", ")}`;
    }

    if (this.limitVal !== null) {
      sql += ` LIMIT ${this.limitVal}`;
    }

    if (this.offsetVal !== null) {
      sql += ` OFFSET ${this.offsetVal}`;
    }

    return [sql, params];
  }

  /** Build DELETE SQL and params. */
  toDeleteSql(): [string, unknown[]] {
    const params: unknown[] = [];
    let sql = `DELETE FROM ${this.table}`;

    if (this.conditions.length > 0) {
      sql += " WHERE " + this.buildConditions(this.conditions, params);
    }

    return [sql, params];
  }

  /** Build COUNT SQL and params. */
  toCountSql(): [string, unknown[]] {
    const params: unknown[] = [];
    let sql = `SELECT COUNT(*) as count FROM ${this.table}`;

    if (this.conditions.length > 0) {
      sql += " WHERE " + this.buildConditions(this.conditions, params);
    }

    if (this.groupByColumns.length > 0) {
      sql += ` GROUP BY ${this.groupByColumns.join(", ")}`;
    }

    if (this.havingConditions.length > 0) {
      sql += " HAVING " + this.buildConditions(this.havingConditions, params);
    }

    return [sql, params];
  }

  private buildConditions(conditions: Condition[], params: unknown[]): string {
    return conditions
      .map((c) => {
        switch (c.operator) {
          case "IS NULL":
            return `${c.column} IS NULL`;
          case "IS NOT NULL":
            return `${c.column} IS NOT NULL`;
          case "IN": {
            const arr = c.value as unknown[];
            const placeholders = arr.map(() => "?").join(", ");
            params.push(...arr);
            return `${c.column} IN (${placeholders})`;
          }
          default:
            params.push(c.value);
            return `${c.column} ${c.operator} ?`;
        }
      })
      .join(" AND ");
  }
}

/** Create a new query for a table. */
export function from(table: string): Query {
  return new Query(table);
}
