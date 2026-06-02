// IndexedDB persistence. Projects and media stay on the device, nothing is uploaded.

const DB = 'clipora';
let dbp;

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('projects', { keyPath: 'id' });
      const m = d.createObjectStore('media', { keyPath: 'id' });
      m.createIndex('projectId', 'projectId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const res = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(res?.result ?? res);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage aborted (device may be out of space)'));
  });
}

export const saveProject = (p) => run('projects', 'readwrite', (s) => s.put(p));
export const getProject = (id) => run('projects', 'readonly', (s) => s.get(id));
export const listProjects = async () =>
  ((await run('projects', 'readonly', (s) => s.getAll())) || []).sort((a, b) => b.updatedAt - a.updatedAt);

export const putMedia = (m) => run('media', 'readwrite', (s) => s.put(m));
export const getMedia = (id) => run('media', 'readonly', (s) => s.get(id));
export const mediaForProject = (pid) => run('media', 'readonly', (s) => s.index('projectId').getAll(pid));

export async function deleteProject(id) {
  const media = await mediaForProject(id);
  await run('media', 'readwrite', (s) => media.forEach((m) => s.delete(m.id)));
  await run('projects', 'readwrite', (s) => s.delete(id));
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {}
}
