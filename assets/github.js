(function () {
  const API = "https://api.github.com";

  function encPath(path) {
    return String(path)
      .split("/")
      .map((p) => encodeURIComponent(p))
      .join("/");
  }

  function toB64Utf8(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function fromB64Utf8(b64) {
    return decodeURIComponent(escape(atob((b64 || "").replace(/\n/g, ""))));
  }

  async function ghFetch({ token, method, url, body }) {
    const headers = {
      Accept: "application/vnd.github+json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const txt = await res.text();
    let data = null;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch {
      data = txt;
    }

    if (!res.ok) {
      const msg =
        (data && data.message) ? data.message : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function getFile({ token, owner, repo, branch, path }) {
    const ref = branch && branch.trim() ? branch.trim() : "main";
    const url = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`;
    const data = await ghFetch({ token, method: "GET", url });
    return { sha: data.sha, text: fromB64Utf8(data.content) };
  }

  async function putFile({ token, owner, repo, branch, path, message, text, sha }) {
    const ref = branch && branch.trim() ? branch.trim() : "main";
    const url = `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encPath(path)}`;
    const body = {
      message: message || `Update ${path}`,
      branch: ref,
      content: toB64Utf8(text),
    };
    if (sha) body.sha = sha;

    const data = await ghFetch({ token, method: "PUT", url, body });
    const newSha = data?.content?.sha || data?.content?.git_url || sha;
    return { data, sha: newSha };
  }

  function rawUrl({ owner, repo, branch, path, cb }) {
    const ref = branch && branch.trim() ? branch.trim() : "main";
    const bust = cb ? `?cb=${encodeURIComponent(cb)}` : "";
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}${bust}`;
  }

  window.ShadowGH = { getFile, putFile, rawUrl };
})();
