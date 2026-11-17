"use client"

import type { TodoItem } from "../service"
import { HELPER_NAME } from "../tips"
import { TodoList } from "./admin-helper"

/** The dashboard's "Today" card: what needs this person now. */
export function TodayCard({ todos }: { todos: TodoItem[] }) {
  return (
    <section
      data-tour="today"
      aria-labelledby="today-title"
      className="flex gap-4 rounded-sm border bg-card p-4"
    >
      {/* The cat's face, from the same sheet as the corner helper. */}
      <span
        aria-hidden
        className="hidden size-14 shrink-0 rounded-full bg-secondary bg-no-repeat sm:block"
        style={{
          backgroundImage: "url(/mascots/cat-reactions.webp)",
          backgroundSize: "300% 300%",
          // The reactions sheet is 3×3: wink with work to do, a heart without.
          backgroundPosition: todos.length > 0 ? "50% 50%" : "50% 0%",
        }}
      />
      <div className="min-w-0 flex-1">
        <h2 id="today-title" className="text-sm font-semibold">
          Today, from {HELPER_NAME}
        </h2>
        <TodoList todos={todos} />
      </div>
    </section>
  )
}
