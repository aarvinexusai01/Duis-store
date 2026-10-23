import type { ReactNode } from "react"

/**
 * Email chrome. Email clients ignore stylesheets and modern layout, so this
 * uses tables and inline styles only.
 */
export function EmailLayout({
  preview,
  children,
}: {
  preview: string
  children: ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Duis</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: "#f4f4f5",
          color: "#111111",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div style={{ display: "none", maxHeight: 0, overflow: "hidden" }}>
          {preview}
        </div>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: "24px 12px" }}>
                <table
                  role="presentation"
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{ maxWidth: 560, backgroundColor: "#ffffff" }}
                >
                  <tbody>
                    <tr>
                      <td
                        style={{
                          backgroundColor: "#111111",
                          color: "#ffffff",
                          padding: "20px 24px",
                          fontSize: 24,
                          fontWeight: 900,
                          letterSpacing: 3,
                          textTransform: "uppercase",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- emails need a plain absolute image */}
                        <img
                          src={`${process.env.APP_URL ?? ""}/brand/emblem-128.png`}
                          width={40}
                          height={40}
                          alt=""
                          style={{
                            verticalAlign: "middle",
                            marginRight: 12,
                            border: 0,
                          }}
                        />
                        <span style={{ verticalAlign: "middle" }}>Duis</span>
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          padding: "32px 24px",
                          fontSize: 16,
                          lineHeight: "24px",
                        }}
                      >
                        {children}
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          padding: "16px 24px",
                          borderTop: "1px solid #e4e4e7",
                          color: "#71717a",
                          fontSize: 12,
                          lineHeight: "18px",
                        }}
                      >
                        You received this email because of activity on your Duis
                        account. If this wasn&apos;t you, you can ignore it.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  )
}

export function EmailButton({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      style={{ margin: "24px 0" }}
    >
      <tbody>
        <tr>
          <td style={{ backgroundColor: "#111111" }}>
            <a
              href={href}
              style={{
                display: "inline-block",
                padding: "14px 28px",
                color: "#ffffff",
                fontSize: 16,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

export function EmailText({ children }: { children: ReactNode }) {
  return <p style={{ margin: "0 0 16px" }}>{children}</p>
}
