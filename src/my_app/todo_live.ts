/**
 * TodoLive -- Full CRUD Todo app with subtasks using LiveView + Ember ORM.
 *
 * Demonstrates the complete Blaze + Ember stack:
 * - Schema definition with defineSchema() and associations
 * - Changeset validation (validateRequired, validateLength)
 * - Repo CRUD (insert, update, delete, all)
 * - Migrations for schema setup
 * - PubSub for real-time sync across tabs/users
 * - LiveView for server-rendered reactive UI
 * - Tailwind CSS for styling
 * - Parent/child relationships (todos → subtasks)
 */

import { LiveView, type LiveViewSocket } from "../blaze/live_view.js";
import { bv, type Rendered } from "../blaze/rendered.js";
import { SQLiteAdapter } from "../ember/adapters/sqlite.js";
import { Repo } from "../ember/repo.js";
import { defineSchema, hasMany, belongsTo } from "../ember/schema.js";
import { changeset, validateRequired, validateLength } from "../ember/changeset.js";
import { defineMigration, migrate, type Migration } from "../ember/migration.js";
import * as PubSub from "../blaze/pub_sub.js";

// -- Schemas --

const SubtaskSchema = defineSchema("subtasks", {
  title: { type: "string" },
  completed: { type: "boolean", default: false },
  todo_id: { type: "integer" },
  position: { type: "integer" },
});

const TodoSchema = defineSchema("todos", {
  title: { type: "string" },
  completed: { type: "boolean", default: false },
  position: { type: "integer" },
}, {
  associations: {
    subtasks: hasMany(() => SubtaskSchema, "todo_id"),
  },
});

// -- Database setup --

const adapter = new SQLiteAdapter("todos.db");
const repo = new Repo(adapter);

const createTodos = defineMigration({
  up(m) {
    m.createTable("todos", {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      title: "TEXT NOT NULL",
      completed: "INTEGER NOT NULL DEFAULT 0",
      position: "INTEGER NOT NULL DEFAULT 0",
      inserted_at: "TEXT",
      updated_at: "TEXT",
    });
  },
  down(m) {
    m.dropTable("todos");
  },
});

const createSubtasks = defineMigration({
  up(m) {
    m.createTable("subtasks", {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      title: "TEXT NOT NULL",
      completed: "INTEGER NOT NULL DEFAULT 0",
      todo_id: "INTEGER NOT NULL",
      position: "INTEGER NOT NULL DEFAULT 0",
      inserted_at: "TEXT",
      updated_at: "TEXT",
    });
    m.addIndex("subtasks", ["todo_id"]);
  },
  down(m) {
    m.dropTable("subtasks");
  },
});

const migrations: Migration[] = [
  { version: "001", name: "create_todos", ...createTodos },
  { version: "002", name: "create_subtasks", ...createSubtasks },
];

const applied = migrate(adapter, migrations);
if (applied.length > 0) {
  console.log(`Todo migrations applied: ${applied.join(", ")}`);
}

// -- Types --

interface Subtask {
  id: number;
  title: string;
  completed: number;
  todo_id: number;
  position: number;
  inserted_at: string;
  updated_at: string;
}

interface Todo {
  id: number;
  title: string;
  completed: number;
  position: number;
  inserted_at: string;
  updated_at: string;
  subtasks: Subtask[];
}

// -- PubSub --

const TOPIC = "todos:updates";

// -- Helpers --

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadTodos(): Todo[] {
  const todos = repo.query<Todo>("SELECT * FROM todos ORDER BY position ASC, id ASC");
  // Load subtasks for each todo
  if (todos.length > 0) {
    const ids = todos.map((t) => t.id);
    const placeholders = ids.map(() => "?").join(", ");
    const subtasks = repo.query<Subtask>(
      `SELECT * FROM subtasks WHERE todo_id IN (${placeholders}) ORDER BY position ASC, id ASC`,
      ids,
    );
    const grouped = new Map<number, Subtask[]>();
    for (const st of subtasks) {
      if (!grouped.has(st.todo_id)) grouped.set(st.todo_id, []);
      grouped.get(st.todo_id)!.push(st);
    }
    for (const todo of todos) {
      todo.subtasks = grouped.get(todo.id) ?? [];
    }
  }
  return todos;
}

function nextPosition(table: string, parentId?: number): number {
  if (parentId !== undefined) {
    const row = repo.query<{ maxPos: number | null }>(
      `SELECT MAX(position) as maxPos FROM ${table} WHERE todo_id = ?`,
      [parentId],
    );
    return (row[0]?.maxPos ?? 0) + 1;
  }
  const row = repo.query<{ maxPos: number | null }>(
    `SELECT MAX(position) as maxPos FROM ${table}`,
  );
  return (row[0]?.maxPos ?? 0) + 1;
}

// -- LiveView --

export class TodoLive extends LiveView {
  mount(socket: LiveViewSocket) {
    const todos = loadTodos();

    socket.assign({
      todos,
      ...this.computeCounts(todos),
      filter: "all",
      editingId: null as number | null,
      editingType: "" as "todo" | "subtask" | "",
      editTitle: "",
      expandedTodos: new Set<number>(),
      addingSubtaskFor: null as number | null,
      errors: [] as string[],
    });

    socket.subscribe(TOPIC);
  }

  private computeCounts(todos: Todo[]) {
    const total = todos.length;
    const remaining = todos.filter((t) => !t.completed).length;
    const totalSubtasks = todos.reduce((sum, t) => sum + t.subtasks.length, 0);
    const remainingSubtasks = todos.reduce(
      (sum, t) => sum + t.subtasks.filter((s) => !s.completed).length,
      0,
    );
    return { total, remaining, totalSubtasks, remainingSubtasks };
  }

  handleEvent(event: string, params: Record<string, unknown>, socket: LiveViewSocket) {
    switch (event) {
      // -- Todo CRUD --
      case "add": {
        const title = ((params.title as string) ?? "").trim();
        const cs = changeset({} as any, { title, completed: 0, position: nextPosition("todos") }, ["title", "completed", "position"]);
        validateRequired(cs, ["title"]);
        validateLength(cs, "title", { min: 1, max: 200 });

        const result = repo.insert(TodoSchema, cs);
        if (result.ok) {
          this.reloadAndSync(socket);
          socket.assign({ errors: [] });
          socket.broadcast(TOPIC, { type: "changed" });
        } else {
          socket.assign({ errors: Object.values(result.changeset.errors).flat() });
        }
        break;
      }

      case "toggle": {
        const id = Number(params.value);
        const todo = repo.get<Todo>(TodoSchema, id);
        if (todo) {
          const newVal = todo.completed ? 0 : 1;
          repo.execute(`UPDATE todos SET completed = ?, updated_at = ? WHERE id = ?`, [newVal, new Date().toISOString(), id]);
          // Also toggle all subtasks to match parent
          repo.execute(`UPDATE subtasks SET completed = ?, updated_at = ? WHERE todo_id = ?`, [newVal, new Date().toISOString(), id]);
          this.reloadAndSync(socket);
          socket.broadcast(TOPIC, { type: "changed" });
        }
        break;
      }

      case "delete": {
        const id = Number(params.value);
        repo.execute("DELETE FROM subtasks WHERE todo_id = ?", [id]);
        repo.delete(TodoSchema, id);
        this.reloadAndSync(socket);
        socket.broadcast(TOPIC, { type: "changed" });
        break;
      }

      case "toggle_all": {
        const todos = socket.assigns.todos as Todo[];
        const allCompleted = todos.every((t) => t.completed);
        const newVal = allCompleted ? 0 : 1;
        const now = new Date().toISOString();
        repo.execute(`UPDATE todos SET completed = ?, updated_at = ? WHERE 1=1`, [newVal, now]);
        repo.execute(`UPDATE subtasks SET completed = ?, updated_at = ? WHERE 1=1`, [newVal, now]);
        this.reloadAndSync(socket);
        socket.broadcast(TOPIC, { type: "changed" });
        break;
      }

      case "clear_completed": {
        const completedIds = repo.query<{ id: number }>("SELECT id FROM todos WHERE completed = 1");
        if (completedIds.length > 0) {
          const ids = completedIds.map((r) => r.id);
          const ph = ids.map(() => "?").join(", ");
          repo.execute(`DELETE FROM subtasks WHERE todo_id IN (${ph})`, ids);
        }
        repo.execute("DELETE FROM todos WHERE completed = 1");
        this.reloadAndSync(socket);
        socket.broadcast(TOPIC, { type: "changed" });
        break;
      }

      case "filter": {
        socket.assign({ filter: params.value as string });
        break;
      }

      // -- Todo editing --
      case "edit_start": {
        const id = Number(params.value);
        const todo = repo.get<Todo>(TodoSchema, id);
        if (todo) {
          socket.assign({ editingId: id, editingType: "todo", editTitle: todo.title });
        }
        break;
      }

      case "edit_change": {
        socket.assign({ editTitle: params.title as string });
        break;
      }

      case "edit_save": {
        const editingId = socket.assigns.editingId as number | null;
        const editingType = socket.assigns.editingType as string;
        const editTitle = ((socket.assigns.editTitle as string) ?? "").trim();
        if (editingId && editTitle) {
          const schema = editingType === "subtask" ? SubtaskSchema : TodoSchema;
          const record = repo.get<any>(schema, editingId);
          if (record) {
            const cs = changeset(record, { title: editTitle }, ["title"]);
            validateRequired(cs, ["title"]);
            validateLength(cs, "title", { min: 1, max: 200 });
            repo.update(schema, cs);
          }
        }
        socket.assign({ editingId: null, editingType: "", editTitle: "" });
        this.reloadAndSync(socket);
        socket.broadcast(TOPIC, { type: "changed" });
        break;
      }

      case "edit_cancel": {
        socket.assign({ editingId: null, editingType: "", editTitle: "" });
        break;
      }

      // -- Expand / collapse subtasks --
      case "toggle_expand": {
        const id = Number(params.value);
        const expanded = new Set(socket.assigns.expandedTodos as Set<number>);
        if (expanded.has(id)) {
          expanded.delete(id);
        } else {
          expanded.add(id);
        }
        socket.assign({ expandedTodos: expanded });
        break;
      }

      // -- Subtask CRUD --
      case "subtask_show_add": {
        const todoId = Number(params.value);
        const expanded = new Set(socket.assigns.expandedTodos as Set<number>);
        expanded.add(todoId);
        socket.assign({ addingSubtaskFor: todoId, expandedTodos: expanded });
        break;
      }

      case "subtask_cancel_add": {
        socket.assign({ addingSubtaskFor: null });
        break;
      }

      case "subtask_add": {
        const todoId = Number(params.todo_id);
        const title = ((params.title as string) ?? "").trim();
        const cs = changeset(
          {} as any,
          { title, completed: 0, todo_id: todoId, position: nextPosition("subtasks", todoId) },
          ["title", "completed", "todo_id", "position"],
        );
        validateRequired(cs, ["title"]);
        validateLength(cs, "title", { min: 1, max: 200 });

        const result = repo.insert(SubtaskSchema, cs);
        if (result.ok) {
          socket.assign({ addingSubtaskFor: null, errors: [] });
          this.reloadAndSync(socket);
          socket.broadcast(TOPIC, { type: "changed" });
        } else {
          socket.assign({ errors: Object.values(result.changeset.errors).flat() });
        }
        break;
      }

      case "subtask_toggle": {
        const id = Number(params.value);
        const subtask = repo.get<Subtask>(SubtaskSchema, id);
        if (subtask) {
          const newVal = subtask.completed ? 0 : 1;
          repo.execute(`UPDATE subtasks SET completed = ?, updated_at = ? WHERE id = ?`, [newVal, new Date().toISOString(), id]);
          // Check if all subtasks are done → auto-complete parent
          const remaining = repo.query<{ cnt: number }>(
            "SELECT COUNT(*) as cnt FROM subtasks WHERE todo_id = ? AND completed = 0",
            [subtask.todo_id],
          );
          // If toggling to complete and was the last incomplete subtask, complete parent
          if (newVal === 1 && remaining[0]?.cnt === 0) {
            repo.execute(`UPDATE todos SET completed = 1, updated_at = ? WHERE id = ?`, [new Date().toISOString(), subtask.todo_id]);
          }
          // If toggling to incomplete, make sure parent is also incomplete
          if (newVal === 0) {
            repo.execute(`UPDATE todos SET completed = 0, updated_at = ? WHERE id = ? AND completed = 1`, [new Date().toISOString(), subtask.todo_id]);
          }
          this.reloadAndSync(socket);
          socket.broadcast(TOPIC, { type: "changed" });
        }
        break;
      }

      case "subtask_delete": {
        const id = Number(params.value);
        repo.delete(SubtaskSchema, id);
        this.reloadAndSync(socket);
        socket.broadcast(TOPIC, { type: "changed" });
        break;
      }

      case "subtask_edit_start": {
        const id = Number(params.value);
        const subtask = repo.get<Subtask>(SubtaskSchema, id);
        if (subtask) {
          socket.assign({ editingId: id, editingType: "subtask", editTitle: subtask.title });
        }
        break;
      }
    }
  }

  handleInfo(message: unknown, socket: LiveViewSocket) {
    const msg = message as { type: string };
    if (msg.type === "changed") {
      this.reloadAndSync(socket);
    }
  }

  private reloadAndSync(socket: LiveViewSocket) {
    const todos = loadTodos();
    socket.assign({
      todos,
      ...this.computeCounts(todos),
    });
  }

  render(assigns: Record<string, unknown>): Rendered {
    const allTodos = assigns.todos as Todo[];
    const filter = assigns.filter as string;
    const total = assigns.total as number;
    const remaining = assigns.remaining as number;
    const completed = total - remaining;
    const editingId = assigns.editingId as number | null;
    const editingType = assigns.editingType as string;
    const editTitle = assigns.editTitle as string;
    const errors = assigns.errors as string[];
    const expandedTodos = assigns.expandedTodos as Set<number>;
    const addingSubtaskFor = assigns.addingSubtaskFor as number | null;

    // Filter todos
    const todos = allTodos.filter((t) => {
      if (filter === "active") return !t.completed;
      if (filter === "completed") return !!t.completed;
      return true;
    });

    // Error banner
    const errorHtml = errors.length > 0
      ? `<div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
           ${errors.map((e) => `<p>${escapeHtml(e)}</p>`).join("")}
         </div>`
      : "";

    // Todo items
    let todosHtml = "";
    for (const todo of todos) {
      const isEditing = editingId === todo.id && editingType === "todo";
      const isExpanded = expandedTodos.has(todo.id);
      const subtaskCount = todo.subtasks.length;
      const subtasksDone = todo.subtasks.filter((s) => s.completed).length;
      const isAddingSubtask = addingSubtaskFor === todo.id;

      if (isEditing) {
        todosHtml += `
          <li class="border-b border-gray-100">
            <div class="flex items-center gap-3 px-4 py-3 bg-blue-50">
              <form bv-submit="edit_save" class="flex-1 flex items-center gap-2">
                <input type="text" name="title" value="${escapeHtml(editTitle)}" bv-change="edit_change"
                  class="flex-1 px-3 py-1.5 border border-blue-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" autofocus />
                <button type="submit" class="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700">Save</button>
                <button type="button" bv-click="edit_cancel" class="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-300">Cancel</button>
              </form>
            </div>
          </li>`;
      } else {
        const checkedClass = todo.completed ? "line-through text-gray-400" : "text-gray-800";

        // Progress bar for subtasks
        const progressHtml = subtaskCount > 0
          ? `<div class="flex items-center gap-1.5 ml-9">
               <div class="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                 <div class="h-full bg-green-500 rounded-full transition-all" style="width: ${Math.round((subtasksDone / subtaskCount) * 100)}%"></div>
               </div>
               <span class="text-xs text-gray-400">${subtasksDone}/${subtaskCount}</span>
             </div>`
          : "";

        // Subtask list (when expanded)
        let subtasksHtml = "";
        if (isExpanded && subtaskCount > 0) {
          for (const st of todo.subtasks) {
            const isSubEditing = editingId === st.id && editingType === "subtask";
            if (isSubEditing) {
              subtasksHtml += `
                <div class="flex items-center gap-2 pl-12 pr-4 py-2 bg-blue-50">
                  <form bv-submit="edit_save" class="flex-1 flex items-center gap-2">
                    <input type="text" name="title" value="${escapeHtml(editTitle)}" bv-change="edit_change"
                      class="flex-1 px-2 py-1 border border-blue-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" autofocus />
                    <button type="submit" class="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Save</button>
                    <button type="button" bv-click="edit_cancel" class="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300">Cancel</button>
                  </form>
                </div>`;
            } else {
              subtasksHtml += `
                <div class="group/sub flex items-center gap-2 pl-12 pr-4 py-1.5 hover:bg-gray-50 transition-colors">
                  <button bv-click="subtask_toggle" bv-value="${st.id}" class="flex-shrink-0 w-4 h-4 rounded border ${st.completed ? "bg-green-500 border-green-500" : "border-gray-300 hover:border-green-400"} flex items-center justify-center transition-colors">
                    ${st.completed ? '<svg class="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ""}
                  </button>
                  <span class="flex-1 text-xs ${st.completed ? "line-through text-gray-400" : "text-gray-700"} cursor-pointer" bv-click="subtask_edit_start" bv-value="${st.id}">
                    ${escapeHtml(st.title)}
                  </span>
                  <button bv-click="subtask_delete" bv-value="${st.id}" class="opacity-0 group-hover/sub:opacity-100 px-1.5 py-0.5 text-red-400 hover:text-red-600 rounded transition-all text-xs">✕</button>
                </div>`;
            }
          }
        }

        // Add subtask form
        const addSubtaskHtml = isAddingSubtask
          ? `<div class="pl-12 pr-4 py-2 bg-gray-50">
               <form bv-submit="subtask_add" class="flex items-center gap-2">
                 <input type="hidden" name="todo_id" value="${todo.id}" />
                 <input type="text" name="title" placeholder="Add a subtask..." autofocus
                   class="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                 <button type="submit" class="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">Add</button>
                 <button type="button" bv-click="subtask_cancel_add" class="px-2 py-1 bg-gray-200 text-gray-600 text-xs rounded hover:bg-gray-300">Cancel</button>
               </form>
             </div>`
          : "";

        todosHtml += `
          <li class="border-b border-gray-100">
            <div class="group flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
              <button bv-click="toggle" bv-value="${todo.id}" class="flex-shrink-0 w-6 h-6 rounded-full border-2 ${todo.completed ? "bg-green-500 border-green-500" : "border-gray-300 hover:border-green-400"} flex items-center justify-center transition-colors">
                ${todo.completed ? '<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ""}
              </button>
              <span class="flex-1 text-sm ${checkedClass} cursor-pointer" bv-click="edit_start" bv-value="${todo.id}">
                ${escapeHtml(todo.title)}
              </span>
              <div class="flex items-center gap-1">
                ${subtaskCount > 0 ? `
                <button bv-click="toggle_expand" bv-value="${todo.id}" class="px-1.5 py-0.5 text-xs text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 transition-colors" title="${isExpanded ? "Collapse" : "Expand"} subtasks">
                  ${isExpanded ? "▾" : "▸"} ${String(subtasksDone)}/${String(subtaskCount)}
                </button>` : ""}
                <button bv-click="subtask_show_add" bv-value="${todo.id}" class="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 text-xs text-blue-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-all" title="Add subtask">+ sub</button>
                <button bv-click="delete" bv-value="${todo.id}" class="opacity-0 group-hover:opacity-100 px-2 py-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-all text-sm">✕</button>
              </div>
            </div>
            ${progressHtml}
            ${subtasksHtml}
            ${addSubtaskHtml}
          </li>`;
      }
    }

    // Empty state
    const emptyHtml = todos.length === 0
      ? `<li class="px-4 py-8 text-center text-gray-400 text-sm">
           ${filter === "all" ? "No todos yet. Add one above!" : `No ${filter} todos.`}
         </li>`
      : "";

    // Filter buttons
    const filterBtn = (value: string, label: string) => {
      const active = filter === value;
      return `<button bv-click="filter" bv-value="${value}" class="px-3 py-1 text-sm rounded-md transition-colors ${active ? "bg-blue-100 text-blue-700 font-medium" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}">${label}</button>`;
    };

    return bv`
      <div class="max-w-lg mx-auto py-8">
        <h1 class="text-3xl font-bold text-gray-800 mb-1">Todos</h1>
        <p class="text-gray-400 text-sm mb-6">Built with Blaze LiveView + Ember ORM</p>

        ${errorHtml}

        <form bv-submit="add" class="flex gap-2 mb-6">
          <input type="text" name="title" placeholder="What needs to be done?"
            class="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm" />
          <button type="submit" class="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-sm transition-colors">
            Add
          </button>
        </form>

        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          ${total > 0 ? `
          <div class="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <button bv-click="toggle_all" class="text-xs px-2.5 py-1 rounded-md ${remaining === 0 && total > 0 ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600 hover:bg-gray-300"} transition-colors">
              ${remaining === 0 && total > 0 ? "✓ All done" : "Mark all"}
            </button>
            <div class="flex-1 flex items-center justify-center gap-1">
              ${filterBtn("all", `All (${String(total)})`)}
              ${filterBtn("active", `Active (${String(remaining)})`)}
              ${filterBtn("completed", `Done (${String(completed)})`)}
            </div>
            ${completed > 0 ? `<button bv-click="clear_completed" class="text-xs px-2.5 py-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors">Clear done</button>` : '<span class="w-16"></span>'}
          </div>
          ` : ""}

          <ul class="divide-y divide-gray-100">
            ${todosHtml}${emptyHtml}
          </ul>

          ${total > 0 ? `
          <div class="px-4 py-2.5 bg-gray-50 border-t border-gray-200 text-xs text-gray-400 flex justify-between">
            <span>${String(remaining)} item${remaining !== 1 ? "s" : ""} remaining</span>
            <span>Hover for subtasks • Click title to edit</span>
          </div>
          ` : ""}
        </div>

        <div class="mt-6 flex gap-3 text-sm text-gray-400">
          <a bv-navigate="/counter" href="/counter" class="hover:text-blue-600">Counter</a>
          <a bv-navigate="/guestbook" href="/guestbook" class="hover:text-blue-600">Guestbook</a>
          <a bv-navigate="/streams" href="/streams" class="hover:text-blue-600">Streams</a>
          <a bv-navigate="/presence" href="/presence" class="hover:text-blue-600">Presence</a>
        </div>
      </div>`;
  }
}
