// 提交前的脱敏自检：在仓库里找「不该出现的东西」
//
//   node scripts/check-secrets.mjs            扫全部受控文件
//   node scripts/check-secrets.mjs --all      连 node_modules 一起扫（慢）
//
// 退出码 0 = 干净；1 = 有命中（会打印文件:行:原因，且不打印命中的完整内容）
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCAN_ALL = process.argv.includes('--all')
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'logs', 'out', 'tmp', 'dist', 'build'])
const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.txt', '.ps1', '.html', '.css', '.py',
  '.yml', '.yaml', '.env', '.example', '.gitignore', '.svg', '',
])

// 这些文件本身是「占位符示例」，允许出现 sk-xxxx 形式
const ALLOW_FILES = new Set(['.env.example', 'scripts/check-secrets.mjs'])

const RULES = [
  { id: 'deepseek-key', re: /\bsk-[A-Za-z0-9_-]{16,}/, hint: '疑似 DeepSeek API key' },
  { id: 'proxy-token', re: /\b(cx|wb|dc)-[A-Za-z0-9]{20,}/, hint: '疑似本地代理令牌' },
  { id: 'openai-key', re: /\bsk-proj-[A-Za-z0-9_-]{16,}/, hint: '疑似 OpenAI key' },
  { id: 'github-token', re: /\b(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{16,}/, hint: '疑似 GitHub token' },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/, hint: '疑似 AWS Access Key' },
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, hint: '私钥文件内容' },
  { id: 'bearer-literal', re: /Bearer\s+[A-Za-z0-9._-]{24,}/, hint: '硬编码的 Bearer token' },
  { id: 'password-literal', re: /(password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i, hint: '硬编码口令/密钥' },
  { id: 'win-user-path', re: /[A-Z]:[\\/]{1,2}Users[\\/]{1,2}[A-Za-z0-9._-]+/i, hint: '本机用户目录绝对路径' },
  { id: 'email', re: /[A-Za-z0-9._%+-]+@(qq|163|126|gmail|outlook|foxmail)\.com/i, hint: '邮箱地址' },
  { id: 'phone-cn', re: /(?<!\d)1[3-9]\d{9}(?!\d)/, hint: '疑似手机号' },
  { id: 'wechat-id', re: /\b(wxid_|wx)[a-z0-9]{8,}\b/i, hint: '疑似微信号' },
]

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (!SCAN_ALL && SKIP_DIRS.has(ent.name)) continue
      if (ent.name === '.git') continue
      walk(p, out)
    } else if (ent.isFile()) {
      out.push(p)
    }
  }
  return out
}

function isText(file) {
  const ext = path.extname(file).toLowerCase()
  if (TEXT_EXT.has(ext)) return true
  if (path.basename(file) === '.gitignore') return true
  const size = fs.statSync(file).size
  if (size > 512 * 1024) return false
  const head = fs.readFileSync(file).subarray(0, 512)
  return !head.includes(0)
}

const files = walk(ROOT)
const hits = []
let scanned = 0

for (const file of files) {
  if (!isText(file)) continue
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  if (ALLOW_FILES.has(rel)) continue
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
  scanned++
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 允许明显的占位符
    if (/sk-?x{6,}|xxxxxxxx|YOUR[_-]?KEY|your[_-]?key|<your|placeholder/i.test(line)) continue
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        hits.push({ file: rel, line: i + 1, rule: rule.id, hint: rule.hint })
        break
      }
    }
  }
}

const byRule = {}
for (const h of hits) byRule[h.rule] = (byRule[h.rule] || 0) + 1

console.log(`扫描 ${scanned} 个文本文件（仓库根：${ROOT}）`)
if (!hits.length) {
  console.log('✅ 没有发现密钥、口令、本机私有路径、联系方式')
  process.exit(0)
}
console.log(`❌ 命中 ${hits.length} 处，按规则：`)
for (const [k, n] of Object.entries(byRule)) console.log(`  - ${k}: ${n}`)
for (const h of hits.slice(0, 60)) console.log(`  ${h.file}:${h.line}  ${h.rule}  （${h.hint}）`)
if (hits.length > 60) console.log(`  …… 还有 ${hits.length - 60} 处`)
console.log('\n修完再提交。真实 key 请写进 .env（已 gitignore），不要在代码里出现。')
process.exit(1)
