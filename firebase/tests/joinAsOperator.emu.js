const fs = require('node:fs');
const path = require('node:path');
const { initializeApp } = require('firebase/app');
const {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  getAuth,
} = require('firebase/auth');
const {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
} = require('firebase/firestore');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} = require('firebase/functions');

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
};

const getEmulatorHost = async () => {
  const hub = process.env.FIREBASE_EMULATOR_HUB || '127.0.0.1:4400';
  const emulators = await fetchJson(`http://${hub}/emulators`);
  const auth = emulators?.auth;
  const firestore = emulators?.firestore;
  const functions = emulators?.functions;
  if (!auth || !firestore || !functions) {
    throw new Error(
      `Missing emulator(s). auth=${!!auth} firestore=${!!firestore} functions=${!!functions}`
    );
  }
  return {
    auth,
    firestore,
    functions,
    projectId: process.env.GCLOUD_PROJECT || 'ontime-emulator',
  };
};

const seedRoom = async ({ projectId, firestore }) => {
  const rules = fs.readFileSync(
    path.join(__dirname, '..', 'firestore.rules'),
    'utf8',
  );
  const testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: firestore.host,
      port: firestore.port,
      rules,
    },
  });

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'rooms/room-1'), {
      ownerId: 'owner-1',
      features: { showControl: true },
    });
    await setDoc(doc(db, 'rooms/room-1/config/invite'), {
      code: 'CREW-1234',
      enabled: true,
    });
  });

  await testEnv.cleanup();
};

const ensureAuth = async (auth) => {
  const email = 'op1@example.com';
  const password = 'test-pass-123';
  try {
    await createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
    if (error?.code !== 'auth/email-already-in-use') {
      throw error;
    }
  }
  return signInWithEmailAndPassword(auth, email, password);
};

const run = async () => {
  const { auth, firestore, functions, projectId } = await getEmulatorHost();
  const app = initializeApp({
    projectId,
    apiKey: 'fake-api-key',
    appId: 'ontime-emulator',
  });

  const authClient = getAuth(app);
  connectAuthEmulator(authClient, `http://${auth.host}:${auth.port}`, {
    disableWarnings: true,
  });

  const db = getFirestore(app);
  connectFirestoreEmulator(db, firestore.host, firestore.port);

  const func = getFunctions(app);
  connectFunctionsEmulator(func, functions.host, functions.port);

  await ensureAuth(authClient);
  await seedRoom({ projectId, firestore });

  const joinAsOperator = httpsCallable(func, 'joinAsOperator');
  const response = await joinAsOperator({
    roomId: 'room-1',
    inviteCode: 'CREW-1234',
    odRole: 'lx',
  });

  if (!response?.data?.success) {
    throw new Error(`joinAsOperator failed: ${JSON.stringify(response?.data)}`);
  }

  const opSnap = await getDoc(doc(db, 'rooms/room-1/operators', authClient.currentUser.uid));
  if (!opSnap.exists()) {
    throw new Error('Operator doc not created in emulator.');
  }

  console.log('joinAsOperator emulator test passed.');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
