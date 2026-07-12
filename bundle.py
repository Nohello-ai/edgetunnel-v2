#!/usr/bin/env python3
"""将 edgetunnel v2 模块化项目打包为 Cloudflare Workers 单文件"""

import os, re, sys

WORKSPACE = os.path.dirname(os.path.abspath(__file__))
ENTRY = os.path.join(WORKSPACE, '_worker.js')
SRC = os.path.join(WORKSPACE, 'src')
OUTPUT = os.path.join(WORKSPACE, '_worker.bundle.js')

# 收集顺序（BFS）
collected = {}
order = []

def resolve_path(base_dir, import_path):
    """解析 import 路径到绝对路径"""
    if import_path.startswith('./') or import_path.startswith('../'):
        resolved = os.path.normpath(os.path.join(base_dir, import_path))
    else:
        # 可能指向 src/ 下
        resolved = os.path.normpath(os.path.join(SRC, import_path))
    if not resolved.endswith('.js'):
        resolved += '.js'
    return resolved

def collect_deps(filepath):
    """BFS 收集依赖"""
    if filepath in collected:
        return
    collected[filepath] = True
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 匹配 import { ... } from '...' 和 export { ... } from '...'
    pattern = re.compile(
        r'(?:import|export)\s*\{([^}]+)\}\s*from\s*[\'\"]([^\'\"]+)[\'\"]\s*;?',
        re.MULTILINE
    )
    
    base = os.path.dirname(filepath)
    for m in pattern.finditer(content):
        import_path = m.group(2)
        resolved = resolve_path(base, import_path)
        if os.path.exists(resolved):
            collect_deps(resolved)
    
    order.append(filepath)

def strip_imports_exports(content, is_entry=False):
    """移除 import/export 关键字"""
    # 移除 import 行
    content = re.sub(r'^import\s*\{[^}]*\}\s*from\s*[\'\"][^\'\"]+[\'\"]\s*;?\s*$', '', content, flags=re.MULTILINE)
    # 移除 export { ... } from ... re-export 行
    content = re.sub(r'^export\s*\{[^}]*\}\s*from\s*[\'\"][^\'\"]+[\'\"]\s*;?\s*$', '', content, flags=re.MULTILINE)
    # 移除单独的 export { ... } 行
    content = re.sub(r'^export\s*\{[^}]*\}\s*;?\s*$', '', content, flags=re.MULTILINE)
    # 替换 export function/const/async/class 为普通声明
    content = re.sub(r'^export\s+(function\s)', r'\1', content, flags=re.MULTILINE)
    content = re.sub(r'^export\s+(const\s)', r'\1', content, flags=re.MULTILINE)
    content = re.sub(r'^export\s+(async\s)', r'\1', content, flags=re.MULTILINE)
    content = re.sub(r'^export\s+(class\s)', r'\1', content, flags=re.MULTILINE)
    content = re.sub(r'^export\s+(let\s)', r'\1', content, flags=re.MULTILINE)
    content = re.sub(r'^export\s+(var\s)', r'\1', content, flags=re.MULTILINE)
    # 动态 import 注释掉
    content = re.sub(r'const\s*\{[^}]*\}\s*=\s*await\s+import\([^)]+\)', '// [bundle] dynamic import removed', content)
    return content

def get_module_label(filepath):
    """获取模块标签"""
    rel = os.path.relpath(filepath, WORKSPACE)
    return f'// ====== {rel} ======'

# 主流程
collect_deps(ENTRY)

print(f'Collected {len(order)} modules:')
for i, f in enumerate(order):
    print(f'  [{i+1}] {os.path.relpath(f, WORKSPACE)}')

# 拼接
parts = []
parts.append('// edgetunnel v2 — bundled for Cloudflare Workers')
parts.append(f'// Generated from {len(order)} modules')
parts.append('')
parts.append('')

for filepath in order:
    rel = os.path.relpath(filepath, WORKSPACE)
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    is_entry = (filepath == ENTRY)
    stripped = strip_imports_exports(content, is_entry)
    
    parts.append(get_module_label(filepath))
    parts.append(stripped.strip())
    parts.append('')

bundle = '\n'.join(parts)

# 清理多余空行
bundle = re.sub(r'\n{3,}', '\n\n', bundle)

with open(OUTPUT, 'w', encoding='utf-8') as f:
    f.write(bundle)

print(f'\nBundle written: {OUTPUT}')
print(f'Size: {os.path.getsize(OUTPUT):,} bytes')
print(f'Lines: {len(bundle.splitlines())}')

# 验证：检查是否还有重复的 function getUUIDBytes
count = len(re.findall(r'function getUUIDBytes', bundle))
print(f'getUUIDBytes occurrences: {count}')
if count > 1:
    print('WARNING: getUUIDBytes still duplicated!')