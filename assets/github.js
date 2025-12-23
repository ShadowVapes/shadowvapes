// Minimal GitHub Contents API helper (GitHub Pages / static json)
// Stores config in localStorage via admin.js

(function(){
  const API = "https://api.github.com";

  async function ghRequest(token, method, url, body){
    const res = await fetch(url, {
      method,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `token ${token}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if(!res.ok){
      const msg = (data && data.message) ? data.message : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function getFile({token, owner, repo, path, branch}){
    const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
    const data = await ghRequest(token, "GET", url);
    // data.content base64
    const content = atob((data.content || "").replace(/\n/g, ""));
    return { sha: data.sha, content };
  }

  async function putFile({token, owner, repo, path, branch, message, content, sha}){
    const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
    const body = {
      message,
      branch,
      content: btoa(unescape(encodeURIComponent(content))),
    };
    if(sha) body.sha = sha;
    return await ghRequest(token, "PUT", url, body);
  }

  window.ShadowGH = { getFile, putFile };
})();
