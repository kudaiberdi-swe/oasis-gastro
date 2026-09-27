/** Per-page <title>/<meta description> (React 19 hoists these into <head>). */
export function Seo({ title, description }: { title: string; description: string }) {
  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
    </>
  )
}
