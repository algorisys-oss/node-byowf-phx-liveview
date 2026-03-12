/**
 * Ember Schema -- Define typed database schemas.
 *
 * Equivalent to Ecto.Schema in Elixir.
 * Maps TypeScript types to database table columns with field definitions.
 */

export type FieldType = "string" | "integer" | "boolean" | "datetime" | "text" | "float";

export interface FieldDef {
  type: FieldType;
  default?: unknown;
  nullable?: boolean;
}

export interface AssociationDef {
  type: "hasMany" | "belongsTo" | "hasOne";
  schema: () => Schema;
  foreignKey: string;
}

export interface Schema {
  tableName: string;
  fields: Record<string, FieldDef>;
  primaryKey: string;
  timestamps: boolean;
  associations: Record<string, AssociationDef>;
}

export interface SchemaOptions {
  timestamps?: boolean;
  primaryKey?: string;
  associations?: Record<string, AssociationDef>;
}

/**
 * Define a database schema.
 *
 * Usage:
 *   const UserSchema = defineSchema("users", {
 *     username: { type: "string" },
 *     email: { type: "string", nullable: true },
 *     active: { type: "boolean", default: true },
 *   });
 */
export function defineSchema(
  tableName: string,
  fields: Record<string, FieldDef>,
  options: SchemaOptions = {},
): Schema {
  return {
    tableName,
    fields,
    primaryKey: options.primaryKey ?? "id",
    timestamps: options.timestamps !== false,
    associations: options.associations ?? {},
  };
}

/**
 * Get all field names (including id and timestamps if enabled).
 */
export function allFields(schema: Schema): string[] {
  const fields = [schema.primaryKey, ...Object.keys(schema.fields)];
  if (schema.timestamps) {
    fields.push("inserted_at", "updated_at");
  }
  return fields;
}

/**
 * Get insertable field names (excludes primary key).
 */
export function insertableFields(schema: Schema): string[] {
  const fields = Object.keys(schema.fields);
  if (schema.timestamps) {
    fields.push("inserted_at", "updated_at");
  }
  return fields;
}

/**
 * Declare a hasMany association.
 * The foreign key lives on the related table.
 *
 * Usage:
 *   const UserSchema = defineSchema("users", { ... }, {
 *     associations: {
 *       posts: hasMany(() => PostSchema, "user_id"),
 *     },
 *   });
 */
export function hasMany(schema: () => Schema, foreignKey: string): AssociationDef {
  return { type: "hasMany", schema, foreignKey };
}

/**
 * Declare a belongsTo association.
 * The foreign key lives on this table.
 *
 * Usage:
 *   const PostSchema = defineSchema("posts", {
 *     user_id: { type: "integer" },
 *     title: { type: "string" },
 *   }, {
 *     associations: {
 *       user: belongsTo(() => UserSchema, "user_id"),
 *     },
 *   });
 */
export function belongsTo(schema: () => Schema, foreignKey: string): AssociationDef {
  return { type: "belongsTo", schema, foreignKey };
}

/**
 * Declare a hasOne association.
 * The foreign key lives on the related table.
 */
export function hasOne(schema: () => Schema, foreignKey: string): AssociationDef {
  return { type: "hasOne", schema, foreignKey };
}
