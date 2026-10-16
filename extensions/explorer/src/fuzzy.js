const BOUNDARY = new Set(['/', '.', '-', '_', ' ']);
const FILENAME_BONUS = 100;
const BOUNDARY_BONUS = 5;

export function scoreTerm(term, lowerPath, lowerName) {
  let score = 0;
  let last = -1;
  for (const char of term) {
    const at = lowerPath.indexOf(char, last + 1);
    if (at === -1) return null;
    if (last !== -1) score += at - last - 1;
    if (at === 0 || BOUNDARY.has(lowerPath[at - 1])) score -= BOUNDARY_BONUS;
    last = at + char.length - 1;
  }
  if (lowerName.includes(term)) score -= FILENAME_BONUS;
  return score;
}

export function rankPaths(query, paths, limit = 200) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { results: [], total: 0 };
  const results = [];
  for (const path of paths) {
    const lowerPath = path.toLowerCase();
    const lowerName = lowerPath.slice(lowerPath.lastIndexOf('/') + 1);
    let score = 0;
    for (const term of terms) {
      const termScore = scoreTerm(term, lowerPath, lowerName);
      if (termScore === null) {
        score = null;
        break;
      }
      score += termScore;
    }
    if (score !== null) results.push({ path, score });
  }
  results.sort((a, b) => a.score - b.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1));
  return { results: results.slice(0, limit), total: results.length };
}
