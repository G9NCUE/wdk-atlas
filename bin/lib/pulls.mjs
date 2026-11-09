// Pull requests for a set of repositories, read from each repository's own list.
//
// The collector used to search the whole organisation and keep the WDK results. GitHub's search
// stops at 1,000 results, and the organisation opened 2,047 pull requests in the thirty days to
// 2026-11-09, so every WDK pull request older than about eighteen days fell off the end. The run
// then cleared those days and had nothing to put back. A repository's own list has no ceiling.

/** The most pages read from one repository: ten thousand pull requests, a guard, not a limit. */
const MAX_PAGES = 100;

/**
 * Every pull request in `repos` updated on or after `from` (a day), shaped like a search result
 * (repository_url, user, author_association, created_at, pull_request.merged_at) so the code that
 * buckets them reads either. Anything opened or merged since `from` was updated since `from`, so
 * the list, newest update first, can stop at the first page that reaches back past it.
 * `get(path)` returns the parsed body, or null when there is none.
 */
export async function pullsSince(get, org, repos, from) {
  const out = [];
  for (const repo of repos) {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = await get(`/repos/${org}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`);
      if (!Array.isArray(body) || !body.length) break;
      for (const p of body) {
        if (String(p.updated_at).slice(0, 10) < from) continue;
        out.push({ repository_url: `https://api.github.com/repos/${org}/${repo}`, user: p.user, author_association: p.author_association, created_at: p.created_at, pull_request: { merged_at: p.merged_at } });
      }
      if (body.length < 100 || String(body[body.length - 1].updated_at).slice(0, 10) < from) break;
    }
  }
  return out;
}
