export type DashboardDocumentOptions = {
  title: string;
  body: string;
  styles: string;
  script: string;
};

export function renderDashboardDocument(options: DashboardDocumentOptions): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="theme-color" content="#0b1020" />
  <title>${options.title}</title>
  <style>${options.styles}</style>
</head>
<body>
${options.body}
<script>${options.script}</script>
</body>
</html>`;
}
