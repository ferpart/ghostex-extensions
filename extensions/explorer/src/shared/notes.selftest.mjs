import assert from 'node:assert/strict';

const stored = new Map();
globalThis.window = {
  ghostex: {
    __bridgeVersion: 1,
    storage: { get: async (key) => stored.get(key), set: async (key, value) => stored.set(key, value) },
  },
};
const { addNote, loadNotes, removeNotes } = await import('./notes.js');

const project = '/tmp/project';
const first = await addNote(project, { filePath: 'a.js', startLine: 1, endLine: 2, body: 'one' });
const second = await addNote(project, { filePath: 'b.js', startLine: 3, endLine: 3, body: 'two' });
const addedDuringSend = await addNote(project, { filePath: 'c.js', startLine: 4, endLine: 4, body: 'three' });

await removeNotes(project, [first.id, second.id]);
assert.deepEqual((await loadNotes(project)).map((note) => note.id), [addedDuringSend.id]);
assert.deepEqual(await loadNotes('/tmp/other'), []);
console.log('notes selftest ok');
