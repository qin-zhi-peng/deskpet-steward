/* 桌宠总管 · API 客户端（原生 fetch + ReadableStream，无第三方依赖）
 * 契约见 docs/API.md。页面从 file:// 打开时自动指向本机 8795。
 */
(function (root) {
  'use strict';

  var BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8795' : '';

  // 手机入口 /m?token=… 打开时，把令牌透传给所有 /api 请求（服务端只认 query 或 X-Steward-Token）
  var TOKEN = (function () {
    var m = /[?&]token=([^&#]+)/.exec(location.search);
    return m ? decodeURIComponent(m[1]) : '';
  })();

  function abs(path) {
    if (!path) return path;
    if (/^(https?:)?\/\//i.test(path)) return path;
    var out = BASE + path;
    if (TOKEN && path.indexOf('/api/') === 0) {
      out += (path.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);
    }
    return out;
  }

  function token() {
    return TOKEN;
  }

  function timeoutSignal(ms) {
    if (typeof AbortController === 'undefined') return { signal: undefined, clear: function () {} };
    var ctl = new AbortController();
    var timer = setTimeout(function () {
      try {
        ctl.abort();
      } catch (e) {}
    }, ms);
    return {
      signal: ctl.signal,
      clear: function () {
        clearTimeout(timer);
      }
    };
  }

  function request(path, opts) {
    opts = opts || {};
    var t = timeoutSignal(opts.timeout || 12000);
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(abs(path), {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body,
      signal: t.signal,
      cache: 'no-store',
      credentials: 'same-origin'
    })
      .then(function (res) {
        t.clear();
        if (!res.ok) {
          return res
            .text()
            .catch(function () {
              return '';
            })
            .then(function (txt) {
              var msg = 'HTTP ' + res.status;
              try {
                var j = JSON.parse(txt);
                if (j && j.error) msg = j.error;
              } catch (e) {
                if (txt) msg += ' · ' + txt.slice(0, 120);
              }
              throw new Error(msg);
            });
        }
        return res;
      })
      .catch(function (err) {
        t.clear();
        throw err;
      });
  }

  function getJSON(path, ms) {
    return request(path, { timeout: ms }).then(function (res) {
      return res.json();
    });
  }

  function getState() {
    return getJSON('/api/state', 4500);
  }

  function getHealth() {
    return getJSON('/api/health', 5000);
  }

  function getHistory(sessionId, limit) {
    return getJSON('/api/chat/history?sessionId=' + encodeURIComponent(sessionId || 'main') + '&limit=' + (limit || 50), 6000);
  }

  function refreshIndex() {
    return request('/api/projects/refresh', { method: 'POST', timeout: 25000 }).then(function (res) {
      return res.json();
    });
  }

  function cancelTask(id) {
    return request('/api/tasks/' + encodeURIComponent(id) + '/cancel', { method: 'POST', timeout: 8000 }).then(function (res) {
      return res.json();
    });
  }

  function pinMemory(id, pinned) {
    return request('/api/memory/' + encodeURIComponent(id) + '/pin', {
      method: 'POST',
      timeout: 8000,
      body: JSON.stringify({ pinned: pinned !== false })
    }).then(function (res) {
      return res.json();
    });
  }

  function deleteMemory(id) {
    return request('/api/memory/' + encodeURIComponent(id), { method: 'DELETE', timeout: 8000 }).then(function (res) {
      return res.json();
    });
  }

  function phoneQrSrc() {
    return abs('/api/phone/qr?ts=' + Date.now());
  }

  /* 聊天流：POST /api/chat，逐块解析 `data: {json}\n\n` */
  function chatStream(payload, handlers) {
    var h = handlers || {};
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var finished = false;

    function fail(err) {
      if (finished) return;
      finished = true;
      if (h.onError) h.onError(err instanceof Error ? err : new Error(String(err)));
    }

    fetch(abs('/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctl ? ctl.signal : undefined,
      cache: 'no-store'
    })
      .then(function (res) {
        if (!res.ok) {
          return res
            .text()
            .catch(function () {
              return '';
            })
            .then(function (txt) {
              var msg = 'HTTP ' + res.status;
              try {
                var j = JSON.parse(txt);
                if (j && j.error) msg = j.error;
              } catch (e) {}
              throw new Error(msg);
            });
        }
        if (!res.body || typeof res.body.getReader !== 'function') {
          throw new Error('浏览器不支持流式读取');
        }
        var reader = res.body.getReader();
        var decoder = new TextDecoder('utf-8');
        var buffer = '';

        function dispatch(block) {
          var dataLines = [];
          block.split(/\r?\n/).forEach(function (line) {
            if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).replace(/^ /, ''));
          });
          if (!dataLines.length) return;
          var raw = dataLines.join('\n');
          if (!raw.trim()) return;
          var evt;
          try {
            evt = JSON.parse(raw);
          } catch (e) {
            return;
          }
          switch (evt.type) {
            case 'start':
              if (h.onStart) h.onStart(evt);
              break;
            case 'delta':
              if (h.onDelta) h.onDelta(evt);
              break;
            case 'tool':
              if (h.onTool) h.onTool(evt);
              break;
            case 'tool_result':
              if (h.onToolResult) h.onToolResult(evt);
              break;
            case 'task':
              if (h.onTask) h.onTask(evt);
              break;
            case 'done':
              finished = true;
              if (h.onDone) h.onDone(evt);
              break;
            case 'error':
              fail(new Error(evt.message || '服务端返回错误'));
              break;
          }
        }

        function pump() {
          return reader.read().then(function (chunk) {
            if (chunk.done) {
              buffer += decoder.decode();
              if (buffer.trim()) dispatch(buffer.replace(/\r?\n$/, ''));
              if (!finished) {
                finished = true;
                if (h.onDone) h.onDone({ text: null, interrupted: true });
              }
              return;
            }
            buffer += decoder.decode(chunk.value, { stream: true });
            var parts = buffer.split(/\r?\n\r?\n/);
            buffer = parts.pop();
            parts.forEach(dispatch);
            return pump();
          });
        }

        return pump();
      })
      .catch(function (err) {
        fail(err);
      });

    return {
      abort: function () {
        finished = true;
        if (ctl) ctl.abort();
      }
    };
  }

  root.YH_API = {
    abs: abs,
    token: token,
    getState: getState,
    getHealth: getHealth,
    getHistory: getHistory,
    refreshIndex: refreshIndex,
    cancelTask: cancelTask,
    pinMemory: pinMemory,
    deleteMemory: deleteMemory,
    phoneQrSrc: phoneQrSrc,
    chatStream: chatStream
  };
})(window);
