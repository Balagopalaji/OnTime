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
      name: 'ppt-bridge-node-only',
      severity: 'error',
      comment: 'The PPT bridge source is a Node-only native boundary with no app or package coupling.',
      from: { path: '^packages/ppt-bridge/src' },
      to: { path: '^(packages/(?!ppt-bridge/|presentation-core/)|@ontime/(?!presentation-core(?:/|$))|frontend/|companion/|controller/|functions/|firebase/|apps/)' },
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
      name: 'no-cloud-to-local-sync-transitive',
      severity: 'error',
      comment: 'Cloud code must not reach Local/Companion arbitration through ANY path.',
      from: { path: '^(functions/src|apps/cloud-(web|functions))' },
      to: { path: '(local-sync-arbitration)', reachable: true },
    },
    {
      name: 'no-viewer-to-local-sync-transitive',
      severity: 'error',
      comment: 'Viewer apps must not reach Local/Companion arbitration through ANY path.',
      from: { path: '^apps/viewer(-|/)' },
      to: { path: '(local-sync-arbitration)', reachable: true },
    },
    {
      name: 'session-viewer-no-room-contexts',
      severity: 'error',
      comment:
        'The ISSUE-002 cloud presentation viewer uses its own session adapter and isolated Firebase app; it must not import room/timer contexts or hooks, the default Firebase app (lib/firebase.ts), Companion, or local-sync arbitration.',
      from: { path: '^frontend/src/routes/session-viewer/' },
      to: {
        path: '(^frontend/src/(context|hooks)/|^frontend/src/lib/firebase\\.ts$|^frontend/src/routes/(ViewerPage|ControllerPage|DashboardPage)|local-sync-arbitration|socket\\.io|^companion/)',
      },
    },
    {
      name: 'ppt-timer-standalone',
      severity: 'error',
      comment:
        'apps/ppt-timer may depend only on @ontime/ppt-bridge, @ontime/presentation-core, the pure @ontime/timer-face, @ontime/remote-viewer-contracts, and @ontime/powerpoint-display (ISSUE-002); no rooms/cloud/sync/general-timer/interface contracts.',
      from: { path: '^apps/ppt-timer(/|$)' },
      to: {
        path: '(^@ontime/(?!ppt-bridge(?:/|$)|presentation-core(?:/|$)|timer-face(?:/|$)|remote-viewer-contracts(?:/|$)|powerpoint-display(?:/|$))|firebase|cloud-adapter|local-sync|^companion/|^frontend/|^functions/|socket\\.io|socket\\.io-client|interface-contracts|shared-types|timer-core|lock-view-model)',
      },
    },
    {
      name: 'downstage-view-viewer-only',
      severity: 'error',
      comment:
        'apps/downstage-view is a read-only shell around the hosted cloud viewer route (ISSUE-002 S8): no workspace packages, PowerPoint host/bridge/core, publisher, Firebase, Companion, or sync code.',
      from: { path: '^apps/downstage-view(/|$)' },
      to: {
        path: '(^@ontime/|^packages/|ppt-bridge|presentation-core|^apps/ppt-timer|firebase|cloud-adapter|local-sync|^companion/|^frontend/|^functions/|socket\\.io|interface-contracts)',
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
