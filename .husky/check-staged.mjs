// Pre-commit guard: blocks files that must never reach the repository, even
// when they were force-added past .gitignore. Run from the repository root.
import { execFileSync } from 'node:child_process';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const BINARY_PROBE_BYTES = 8000;

const FORBIDDEN_PATHS = [
    { pattern: /(^|\/)\.env(\.(?!example$|sample$|template$)[^/]+)?$/, reason: '本地环境变量文件' },
    { pattern: /\.(pem|key|p12|pfx|crx|xpi|zip)$/i, reason: '密钥或打包产物' },
    { pattern: /(^|\/)(node_modules|dist|\.output|\.wxt|coverage|test-results|playwright-report)\//, reason: '依赖或构建/测试产物' },
    { pattern: /(^|\/)\.husky\/_\//, reason: 'husky 自动生成的脚本' },
];

const SECRET_PATTERNS = [
    { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: '私钥' },
    { pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/, label: 'OpenAI/Anthropic 风格的 API Key' },
    { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, label: 'Google API Key' },
    { pattern: /\bxai-[A-Za-z0-9]{40,}/, label: 'xAI API Key' },
    { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/, label: 'GitHub Token' },
    { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS Access Key' },
];

const CONFLICT_MARKER = /^(<{7}|>{7})( |$)/m;
const SKIP_CONTENT_SCAN = /(^|\/)pnpm-lock\.yaml$/;

function git(args, encoding = 'utf8') {
    return execFileSync('git', args, { encoding, maxBuffer: 64 * 1024 * 1024 });
}

function stagedFiles() {
    return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
        .split('\0')
        .filter(Boolean);
}

function stagedBlob(path) {
    return git(['show', `:${path}`], 'buffer');
}

function checkFile(path) {
    const problems = [];
    const forbidden = FORBIDDEN_PATHS.find(({ pattern }) => pattern.test(path));
    if (forbidden) problems.push(forbidden.reason);

    const blob = stagedBlob(path);
    if (blob.length > MAX_FILE_BYTES) {
        problems.push(`文件 ${(blob.length / 1024 / 1024).toFixed(1)} MB，超过 ${MAX_FILE_BYTES / 1024 / 1024} MB 上限`);
    }

    const isBinary = blob.subarray(0, BINARY_PROBE_BYTES).includes(0);
    if (!isBinary && !SKIP_CONTENT_SCAN.test(path)) {
        const text = blob.toString('utf8');
        for (const { pattern, label } of SECRET_PATTERNS) {
            if (pattern.test(text)) problems.push(`疑似包含${label}`);
        }
        if (CONFLICT_MARKER.test(text)) problems.push('残留合并冲突标记');
    }
    return problems;
}

const failures = stagedFiles()
    .map((path) => ({ path, problems: checkFile(path) }))
    .filter(({ problems }) => problems.length > 0);

if (failures.length > 0) {
    console.error('\n✖ 提交被拦截，以下暂存文件不应进入仓库：\n');
    for (const { path, problems } of failures) {
        console.error(`  ${path}`);
        for (const problem of problems) console.error(`    - ${problem}`);
    }
    console.error('\n用 git restore --staged <文件> 取消暂存。确认是误报时可用 git commit --no-verify 跳过。\n');
    process.exit(1);
}
