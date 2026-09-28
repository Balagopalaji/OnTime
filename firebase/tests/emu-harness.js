/** Shared emulator-hub discovery and a minimal sequential test runner. */

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.json();
};

async function getEmulatorHosts() {
  const hub = process.env.FIREBASE_EMULATOR_HUB || '127.0.0.1:4400';
  const emulators = await fetchJson(`http://${hub}/emulators`);
  const { auth, firestore, functions } = emulators ?? {};
  if (!auth || !firestore || !functions) {
    throw new Error(`Missing emulator(s). auth=${!!auth} firestore=${!!firestore} functions=${!!functions}`);
  }
  return { auth, firestore, functions, projectId: process.env.GCLOUD_PROJECT || 'ontime-emulator' };
}

/** Runs every case, reports PASS/FAIL per case, and throws if any failed. */
async function runSuite(cases) {
  const failures = [];
  for (const [name, fn] of cases) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}\n  ${error && error.stack ? error.stack : error}`);
      failures.push(name);
    }
  }
  console.log(`${cases.length - failures.length}/${cases.length} passed`);
  if (failures.length > 0) throw new Error(`${failures.length} case(s) failed: ${failures.join('; ')}`);
}

module.exports = { getEmulatorHosts, runSuite };
