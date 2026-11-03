/* 桌宠总管 · markdown-lite 渲染器
 * 支持：标题 / 粗体 / 斜体 / 行内代码 / 围栏代码块 / 无序·有序列表 / 链接 / 引用 / 分隔线 / 换行
 * 无第三方依赖，先转义再渲染，禁止 HTML 注入。
 */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(u) {
    var s = String(u || '').trim();
    if (/^(https?:\/\/|mailto:)/i.test(s)) return s;
    if (s.charAt(0) === '/' || s.charAt(0) === '#') return s;
    return '#';
  }

  // 行内：先摘出行内代码与链接，避免被后续转义/加粗破坏
  function inline(text) {
    var slots = [];
    function hold(html) {
      slots.push(html);
      return '\u0000' + (slots.length - 1) + '\u0000';
    }
    var s = String(text == null ? '' : text);

    s = s.replace(/`([^`\n]+)`/g, function (m, code) {
      return hold('<code>' + esc(code) + '</code>');
    });
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
      return hold('<a href="' + esc(safeUrl(url)) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>');
    });

    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

    s = s.replace(/\u0000(\d+)\u0000/g, function (m, i) {
      return slots[+i] || '';
    });
    return s;
  }

  function render(src) {
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var para = [];
    var i = 0;

    function flushPara() {
      if (!para.length) return;
      out.push('<p>' + para.map(inline).join('<br>') + '</p>');
      para = [];
    }

    while (i < lines.length) {
      var line = lines[i];

      // 围栏代码块
      var fence = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line);
      if (fence) {
        flushPara();
        var buf = [];
        var lang = fence[1] || '';
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++; // 跳过收尾围栏
        out.push(
          '<pre class="md-pre">' +
            (lang ? '<span class="md-lang">' + esc(lang) + '</span>' : '') +
            '<code>' + esc(buf.join('\n')) + '</code></pre>'
        );
        continue;
      }

      // 标题
      var head = /^(#{1,6})\s+(.*)$/.exec(line);
      if (head) {
        flushPara();
        var level = head[1].length;
        var title = head[2].replace(/\s+#+\s*$/, '');
        out.push('<h' + level + ' class="md-h md-h' + level + '">' + inline(title) + '</h' + level + '>');
        i++;
        continue;
      }

      // 引用
      if (/^>\s?/.test(line)) {
        flushPara();
        var quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        out.push('<blockquote class="md-quote">' + render(quote.join('\n')) + '</blockquote>');
        continue;
      }

      // 分隔线
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        flushPara();
        out.push('<hr class="md-hr">');
        i++;
        continue;
      }

      // 列表
      var item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (item) {
        flushPara();
        var ordered = /\d/.test(item[2]);
        var items = [];
        while (i < lines.length) {
          var m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (m) {
            items.push([m[3]]);
            i++;
            continue;
          }
          if (items.length && /^\s{2,}\S/.test(lines[i])) {
            items[items.length - 1].push(lines[i].trim());
            i++;
            continue;
          }
          if (!lines[i].trim()) {
            var j = i + 1;
            while (j < lines.length && !lines[j].trim()) j++;
            if (j < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[j])) {
              i = j;
              continue;
            }
          }
          break;
        }
        var tag = ordered ? 'ol' : 'ul';
        var listHtml = items
          .map(function (parts) {
            return '<li>' + parts.map(inline).join('<br>') + '</li>';
          })
          .join('');
        out.push('<' + tag + ' class="md-list">' + listHtml + '</' + tag + '>');
        continue;
      }

      // 空行
      if (!line.trim()) {
        flushPara();
        i++;
        continue;
      }

      para.push(line);
      i++;
    }
    flushPara();
    return out.join('');
  }

  // 纯文本摘要（用于工具/列表，去掉 markdown 记号）
  function plain(src, max) {
    var s = String(src == null ? '' : src)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_~`]/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (max && s.length > max) s = s.slice(0, max) + '…';
    return s;
  }

  root.YH_MD = { render: render, inline: inline, plain: plain, escape: esc };
})(window);
