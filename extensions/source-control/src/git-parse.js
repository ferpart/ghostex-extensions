const STATUS_LETTER = { M: 'M', T: 'M', A: 'A', D: 'D', R: 'R', C: 'C', U: 'C' };

function splitFields(line, count) {
  const fields = [];
  let rest = line;
  for (let i = 0; i < count; i += 1) {
    const space = rest.indexOf(' ');
    fields.push(rest.slice(0, space));
    rest = rest.slice(space + 1);
  }
  fields.push(rest);
  return fields;
}

export function parseStatus(stdout) {
  const branch = { oid: null, head: null, upstream: null, ahead: 0, behind: 0 };
  const staged = [];
  const unstaged = [];
  const records = stdout.split('\0');
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;
    if (record.startsWith('# branch.oid ')) branch.oid = record.slice(13) === '(initial)' ? null : record.slice(13);
    else if (record.startsWith('# branch.head ')) branch.head = record.slice(14) === '(detached)' ? null : record.slice(14);
    else if (record.startsWith('# branch.upstream ')) branch.upstream = record.slice(18);
    else if (record.startsWith('# branch.ab ')) {
      const [ahead, behind] = record.slice(12).split(' ');
      branch.ahead = Math.abs(Number(ahead));
      branch.behind = Math.abs(Number(behind));
    } else if (record.startsWith('? ')) {
      unstaged.push({ path: record.slice(2), status: 'U', untracked: true });
    } else if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const isRename = record[0] === '2';
      const fields = splitFields(record, isRename ? 9 : 8);
      const [indexCode, worktreeCode] = fields[1];
      const path = fields.at(-1);
      const oldPath = isRename ? records[++i] : undefined;
      if (indexCode !== '.') staged.push({ path, oldPath, status: STATUS_LETTER[indexCode] ?? 'M' });
      if (worktreeCode !== '.') unstaged.push({ path, status: STATUS_LETTER[worktreeCode] ?? 'M' });
    } else if (record.startsWith('u ')) {
      unstaged.push({ path: splitFields(record, 10).at(-1), status: '!', conflict: true });
    }
  }
  return { branch, staged, unstaged };
}

export function parseNumstat(stdout) {
  const stats = new Map();
  const fields = stdout.split('\0');
  for (let i = 0; i < fields.length; i += 1) {
    const match = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(fields[i]);
    if (!match) continue;
    let path = match[3];
    if (path === '') {
      i += 2;
      path = fields[i];
    }
    const binary = match[1] === '-';
    stats.set(path, { added: binary ? 0 : Number(match[1]), removed: binary ? 0 : Number(match[2]), binary });
  }
  return stats;
}

export function withStats(entries, stats) {
  return entries.map((entry) => ({ ...entry, ...stats.get(entry.path) }));
}

export function changeListArgs(fromRev, toRev) {
  const format = '--raw --numstat -z -M';
  return fromRev
    ? `git diff ${format} ${fromRev} ${toRev} --`
    : `git diff-tree --root --no-commit-id -r ${format} ${toRev} --`;
}

export function parseChangeList(stdout) {
  const entries = [];
  let offset = 0;
  const readField = () => {
    const end = stdout.indexOf('\0', offset);
    if (end === -1) throw new Error('Incomplete git change record');
    const value = stdout.slice(offset, end);
    offset = end + 1;
    return value;
  };
  while (offset < stdout.length && stdout[offset] === ':') {
    const match = /^:[0-7]{6} [0-7]{6} [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/.exec(readField());
    if (!match) throw new Error('Invalid git change record');
    const code = match[1];
    const firstPath = readField();
    const oldPath = code === 'R' || code === 'C' ? firstPath : undefined;
    const path = oldPath === undefined ? firstPath : readField();
    entries.push({ path, oldPath, status: STATUS_LETTER[code] ?? 'M' });
  }
  return withStats(entries, parseNumstat(stdout.slice(offset)));
}

export function sumLines(entries) {
  return entries.reduce(
    (total, entry) => ({ added: total.added + (entry.added ?? 0), removed: total.removed + (entry.removed ?? 0) }),
    { added: 0, removed: 0 }
  );
}

export const BRANCH_LIST_FORMAT = '%(refname)%09%(refname:short)%09%(symref)';

export function parseBranchList(stdout) {
  const branches = [];
  for (const line of stdout.split('\n')) {
    const [fullName, name, symref] = line.split('\t');
    if (!name || symref || fullName.endsWith('/HEAD')) continue;
    branches.push({ name, remote: fullName.startsWith('refs/remotes/') });
  }
  return branches;
}
