/**
 * Where the DPoP key pair is kept between logins: IndexedDB, which can hold
 * a CryptoKey object without exposing its private half (decision 0008). The
 * private key was made non-extractable, so not even code on this page can
 * read it out, only ask the browser to sign with it.
 *
 * Tokens are never stored here, or anywhere but memory.
 */

const databaseName = "solid-demonstrator";
const storeName = "keys";
const dpopKey = "dpop";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

/** The stored key pair, or null if there isn't one. */
export async function loadDpopKeyPair(): Promise<CryptoKeyPair | null> {
  const stored: unknown = await run("readonly", (store) => store.get(dpopKey));
  return isKeyPair(stored) ? stored : null;
}

export async function saveDpopKeyPair(keyPair: CryptoKeyPair): Promise<void> {
  await run("readwrite", (store) => store.put(keyPair, dpopKey));
}

function isKeyPair(value: unknown): value is CryptoKeyPair {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { privateKey, publicKey } = value as Record<string, unknown>;
  return privateKey instanceof CryptoKey && publicKey instanceof CryptoKey;
}

/** Removes the key pair, for logging out. A token bound to it can't be used without it. */
export async function deleteDpopKeyPair(): Promise<void> {
  await run("readwrite", (store) => store.delete(dpopKey));
}
