import Head from "next/head";

/**
 * Página de respaldo del service worker (next-pwa la detecta por este nombre).
 *
 * Vive en Pages Router a propósito: no hereda el RootLayout ni el AppShell del
 * App Router, que redirigirían a `/login` y podrían reintentar peticiones que
 * justamente están fallando. Es estática y usa estilos en línea para que se
 * vea bien aunque no haya cargado ningún CSS del build.
 */
export default function PaginaOffline() {
  return (
    <>
      <Head>
        <title>Sin conexión — Sistema Hípico</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
      </Head>
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          boxSizing: "border-box",
          background: "#0f172a",
          color: "#e2e8f0",
          fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif",
        }}
      >
        <section
          style={{
            width: "100%",
            maxWidth: "440px",
            padding: "32px 28px",
            borderRadius: "20px",
            border: "1px solid rgba(245, 158, 11, 0.35)",
            background: "#111827",
            textAlign: "center",
            boxShadow: "0 18px 45px rgba(0, 0, 0, 0.35)",
          }}
        >
          <div style={{ fontSize: "48px", lineHeight: 1 }} aria-hidden="true">
            🏇
          </div>
          <h1
            style={{
              margin: "16px 0 8px",
              fontSize: "22px",
              fontWeight: 800,
              letterSpacing: "0.02em",
              color: "#fbbf24",
            }}
          >
            Sin conexión
          </h1>
          <p style={{ margin: "0 0 24px", fontSize: "14px", lineHeight: 1.6, color: "#cbd5e1" }}>
            No pudimos cargar la página. Revisa tu conexión e inténtalo de nuevo; tus datos no se han perdido.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: "11px 20px",
                borderRadius: "12px",
                border: "none",
                background: "#f59e0b",
                color: "#0f172a",
                fontWeight: 800,
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Reintentar
            </button>
            <a
              href="/"
              style={{
                padding: "11px 20px",
                borderRadius: "12px",
                border: "1px solid #475569",
                color: "#e2e8f0",
                fontWeight: 700,
                fontSize: "13px",
                textDecoration: "none",
              }}
            >
              Volver al inicio
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
