module.exports = {
  forbidden: [
    {
      name: 'no-package-to-app-code',
      severity: 'error',
      comment: 'Pure packages must not depend on app/runtime folders.',
      from: { path: '^packages/[^/]+/src' },
      to: { path: '^(frontend|companion|controller|functions|firebase|apps)(/|$)' },
    },
    {
      name: 'no-package-to-god-files',
      severity: 'error',
      comment: 'Packages must not depend on denylisted legacy god-files.',
      from: { path: '^packages/[^/]+/src' },
      to: { path: '^(frontend/src/context|companion/src/main\\.ts)' },
    },
    {
      name: 'no-package-runtime-frameworks',
      severity: 'error',
      comment: 'Pure packages must stay free of product runtime frameworks.',
      from: { path: '^packages/[^/]+/src' },
      to: {
        path: '^(react|react-dom|electron|firebase|firebase-admin|firebase-functions|socket\\.io|socket\\.io-client)(/|$)',
      },
    },
    {
      name: 'no-cloud-to-local-sync',
      severity: 'error',
      comment: 'Cloud code must not depend on Local/Companion arbitration.',
      from: { path: '^(functions/src|apps/cloud-(web|functions)(/|$))' },
      to: { path: '(^packages/local-sync-arbitration|^@ontime/local-sync-arbitration)' },
    },
    {
      name: 'no-viewer-to-local-sync',
      severity: 'error',
      comment: 'Viewer apps must not depend on Local/Companion arbitration.',
      from: { path: '^apps/viewer(-|/)' },
      to: { path: '(^packages/local-sync-arbitration|^@ontime/local-sync-arbitration)' },
    },
    {
      name: 'ppt-timer-standalone',
      severity: 'error',
      comment: 'PPT Timer must remain standalone from room/cloud/sync runtimes.',
      from: { path: '^apps/ppt-timer(/|$)' },
      to: {
        path: '(firebase|cloud-adapter|local-sync|companion|^frontend/|^functions/|^packages/local-sync-arbitration)',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    exclude: {
      path: '(^node_modules|(^|/)(dist|dist-viewer|dist_out|build|coverage|\\.vite)(/|$))',
    },
    tsPreCompilationDeps: true,
  },
}
