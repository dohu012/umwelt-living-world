async function request(method, url, { json, form } = {}) {
  const opts = { method };
  if (form) {
    opts.body = form;
  } else if (json !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(json);
  }

  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${method} ${url} 请求失败：${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, json) => request('POST', url, { json }),
  put: (url, json) => request('PUT', url, { json }),
  del: (url) => request('DELETE', url),
  postForm: (url, form) => request('POST', url, { form }),
};
