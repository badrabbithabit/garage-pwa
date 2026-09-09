/* In-memory git filesystem persisted to IndexedDB.
   isomorphic-git sees a Node-fs-promises-shaped client; every mutating op
   updates memory + marks dirty; flush() rewrites the whole (small) store. */

const DB_NAME = 'garage-tracker-git';
const STORE = 'fs';

type DirNode = { __dir: true };
type Node = DirNode | Uint8Array;

function isDirNode(n: Node | undefined): n is DirNode {
  return !!n && (n as DirNode).__dir === true;
}

function enoent(p: string): Error {
  const e = new Error(`ENOENT: no such file or directory, '${p}'`);
  (e as unknown as { code: string }).code = 'ENOENT';
  return e;
}

function dirent(name: string, file: boolean) {
  return {
    name,
    isFile: () => file,
    isDirectory: () => !file,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}

export class GarageFs {
  private nodes = new Map<string, Node>();
  private dirty = false;
  private idb: IDBDatabase | null = null;

  static key(p: string): string {
    let k = String(p).replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    if (!k.startsWith('/')) k = '/' + k;
    if (k.length > 1 && k.endsWith('/')) k = k.slice(0, -1);
    return k;
  }

  async open(): Promise<void> {
    this.nodes.clear();
    this.dirty = false;
    this.idb = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    // Load existing state
    await new Promise<void>((res, rej) => {
      const tx = this.idb!.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const cur = store.openCursor();
      cur.onsuccess = () => {
        if (cur.result) {
          this.nodes.set(String(cur.result.key), cur.result.value as Node);
          cur.result.continue();
        } else {
          res();
        }
      };
      tx.onerror = () => rej(tx.error);
    });
    // Root must always exist
    if (!this.nodes.has('/')) this.nodes.set('/', { __dir: true });
  }

  /** Rewrite the whole store from memory. Call after git operations. */
  async flush(): Promise<void> {
    if (!this.dirty || !this.idb) return;
    await new Promise<void>((res, rej) => {
      const tx = this.idb!.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.clear();
      for (const [k, v] of this.nodes) store.put(v, k);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
    this.dirty = false;
  }

  async reset(): Promise<void> {
    this.nodes.clear();
    this.nodes.set('/', { __dir: true });
    this.dirty = true;
    await this.flush();
  }

  private ensureParents(p: string) {
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const k = '/' + parts.slice(0, i).join('/');
      if (!this.nodes.has(k)) this.nodes.set(k, { __dir: true });
    }
  }

  private statOf(k: string): unknown {
    const n = this.nodes.get(k);
    const file = n !== undefined && !isDirNode(n);
    const size = file ? (n as Uint8Array).byteLength : 0;
    const t = Date.now();
    return {
      dev: 0, ino: 0, mode: file ? 0o100644 : 0o40755, nlink: 1, uid: 0, gid: 0,
      rdev: 0, blksize: 4096, blocks: Math.ceil(size / 512),
      size, xattr: '',
      atimeMs: t, mtimeMs: t, ctimeMs: t, birthtimeMs: t,
      isFile: () => file,
      isDirectory: () => !file,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };
  }

  /** PromiseFsClient — assign as `fs` to isomorphic-git calls. */
  get promises() {
    const self = this;
    return {
      async readFile(path: string, opts?: { encoding?: string }) {
        const k = GarageFs.key(path);
        const n = self.nodes.get(k);
        if (!n || isDirNode(n)) throw enoent(path);
        if (opts && (opts.encoding === 'utf8' || opts.encoding === 'utf-8')) {
          return new TextDecoder().decode(n);
        }
        return (n as Uint8Array).slice();
      },
      async writeFile(path: string, data: string | Uint8Array | ArrayBuffer, _opts?: unknown) {
        const k = GarageFs.key(path);
        self.ensureParents(k);
        let bytes: Uint8Array;
        if (typeof data === 'string') bytes = new TextEncoder().encode(data);
        else if (data instanceof Uint8Array) bytes = data.slice();
        else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data).slice();
        else bytes = new TextEncoder().encode(String(data));
        self.nodes.set(k, bytes);
        self.dirty = true;
      },
      async unlink(path: string) {
        const k = GarageFs.key(path);
        if (self.nodes.delete(k)) self.dirty = true;
      },
      async mkdir(path: string, _opts?: unknown) {
        // always recursive
        const k = GarageFs.key(path);
        self.ensureParents(k);
        if (!self.nodes.has(k)) {
          self.nodes.set(k, { __dir: true });
          self.dirty = true;
        }
      },
      async rmdir(path: string) {
        const k = GarageFs.key(path);
        if (isDirNode(self.nodes.get(k))) {
          self.nodes.delete(k);
          self.dirty = true;
        }
      },
      async readdir(path: string) {
        const k = GarageFs.key(path);
        if (!isDirNode(self.nodes.get(k))) throw enoent(path);
        const out = [];
        for (const [ck, cv] of self.nodes) {
          if (!ck.startsWith(k === '/' ? '/' : k + '/')) continue;
          if (ck === k) continue;
          const rest = k === '/' ? ck.slice(1) : ck.slice(k.length + 1);
          if (rest.includes('/')) continue;
          out.push(dirent(rest, !isDirNode(cv)));
        }
        out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        return out;
      },
      async stat(path: string) {
        const k = GarageFs.key(path);
        if (!self.nodes.has(k)) throw enoent(path);
        return self.statOf(k);
      },
      async lstat(path: string) {
        return this.stat(path);
      },
      async readlink(path: string) {
        throw enoent(path);
      },
      async symlink(target: string, path: string) {
        throw new Error('symlinks not supported');
      },
      async chmod(_path: string, _mode: number) {
        /* no-op */
      },
    };
  }
}
