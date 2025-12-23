/* assets/github.js */
(function () {
  function b64EncodeUtf8(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64DecodeUtf8(b64) {
    return decodeURIComponent(escape(atob(b64)));
  }

  async function ghFetch(url, token, opts = {}) {
    const headers = Object.assign(
      {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      opts.headers || {}
    );
    if (token) headers.Authorization = `token ${token}`;
    const res = await fetch(url, { ...opts, headers });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`GitHub API hiba (${res.status}): ${txt.slice(0, 200)}`);
    }
    return res.json();
  }

  async function getFile({ owner, repo, path, branch, token }) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const data = await ghFetch(url, token);
    if (!data || !data.content) throw new Error("Nem jött content.");
    const text = b64DecodeUtf8(data.content.replace(/\n/g, ""));
    return { text, sha: data.sha };
  }

  async function putFile({ owner, repo, path, branch, token, message, contentText, sha }) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const body = {
      message: message || `Update ${path}`,
      content: b64EncodeUtf8(contentText),
      branch,
    };
    if (sha) body.sha = sha;

    return ghFetch(url, token, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async function readJson(cfg) {
    const { text } = await getFile(cfg);
    return JSON.parse(text);
  }

  async function writeJson(cfg, obj) {
    let sha = null;
    try {
      const current = await getFile(cfg);
      sha = current.sha;
    } catch (e) {
      // file may not exist yet
      sha = null;
    }
    const text = JSON.stringify(obj, null, 2);
    return putFile({ ...cfg, contentText: text, sha });
  }

  window.SV_GH = { getFile, putFile, readJson, writeJson };
})();
