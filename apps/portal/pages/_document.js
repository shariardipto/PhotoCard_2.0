import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html>
      <Head>
        {/* Default API base for client dev; can be overridden with a meta tag or window.__APP_API_BASE__ */}
        <meta name="api-base" content="http://localhost:4000" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
