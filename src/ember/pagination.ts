/**
 * Ember Pagination — cursor and offset-based pagination helpers.
 *
 * Usage:
 *   const page = repo.paginate(UserSchema, { page: 2, perPage: 10 });
 *   // → { data: [...], page: 2, perPage: 10, total: 42, totalPages: 5 }
 *
 *   // With query builder:
 *   const q = from("users").where("active", "=", true).orderBy("username");
 *   const page = paginateQuery(repo, q, { page: 1, perPage: 20 });
 */

import type { Schema } from "./schema.js";
import type { Repo } from "./repo.js";
import type { Query } from "./query.js";

export interface PaginateOptions {
  page?: number;
  perPage?: number;
}

export interface Page<T> {
  data: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

/**
 * Paginate a schema's table with optional conditions.
 */
export function paginate<T>(
  repo: Repo,
  schema: Schema,
  options: PaginateOptions & { conditions?: Record<string, unknown> } = {},
): Page<T> {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.max(1, options.perPage ?? 20);
  const offset = (page - 1) * perPage;

  const conditions = options.conditions ?? {};
  const keys = Object.keys(conditions);
  const params: unknown[] = keys.map((k) => conditions[k]);

  let whereSql = "";
  if (keys.length > 0) {
    whereSql = " WHERE " + keys.map((k) => `${k} = ?`).join(" AND ");
  }

  const countRow = repo.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM ${schema.tableName}${whereSql}`,
    params,
  );
  const total = countRow[0]?.count ?? 0;

  const data = repo.query<T>(
    `SELECT * FROM ${schema.tableName}${whereSql} LIMIT ? OFFSET ?`,
    [...params, perPage, offset],
  );

  return {
    data,
    page,
    perPage,
    total,
    totalPages: Math.ceil(total / perPage),
  };
}

/**
 * Paginate using a Query builder instance.
 * The query's existing LIMIT/OFFSET will be overridden.
 */
export function paginateQuery<T>(
  repo: Repo,
  query: Query,
  options: PaginateOptions = {},
): Page<T> {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.max(1, options.perPage ?? 20);

  // Get count
  const [countSql, countParams] = query.toCountSql();
  const countRow = repo.query<{ count: number }>(countSql, countParams);
  const total = countRow[0]?.count ?? 0;

  // Get paginated data
  const paginatedQuery = Object.create(Object.getPrototypeOf(query));
  Object.assign(paginatedQuery, query);
  paginatedQuery.limit(perPage).offset((page - 1) * perPage);
  const [dataSql, dataParams] = paginatedQuery.toSql();
  const data = repo.query<T>(dataSql, dataParams);

  return {
    data,
    page,
    perPage,
    total,
    totalPages: Math.ceil(total / perPage),
  };
}
