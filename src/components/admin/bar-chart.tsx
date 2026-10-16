import { formatPaise } from "@/lib/money"

/** A dependency-free daily bar chart with an accessible table fallback. */
export function RevenueChart({
  data,
}: {
  data: { day: string; revenuePaise: number; orders: number }[]
}) {
  const max = Math.max(1, ...data.map((d) => d.revenuePaise))
  const width = 600
  const height = 140
  const bar = width / Math.max(1, data.length)
  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-36 w-full"
        role="img"
        aria-label="Revenue per day"
      >
        {data.map((d, i) => {
          const h = Math.round((d.revenuePaise / max) * (height - 4))
          return (
            <rect
              key={d.day}
              x={i * bar + 1}
              y={height - h}
              width={Math.max(1, bar - 2)}
              height={h}
              className="fill-ink"
            >
              <title>{`${d.day}: ${formatPaise(d.revenuePaise)} (${d.orders} orders)`}</title>
            </rect>
          )
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{data[0]?.day}</span>
        <span>{data.at(-1)?.day}</span>
      </figcaption>
    </figure>
  )
}
