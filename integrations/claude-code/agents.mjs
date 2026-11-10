#!/usr/bin/env node
// Claude Code subagent files for one saved AutoPets pet (planned host; not connected yet).
// The pet's plan/build stages map to Claude Code `model`/`effort` through the shared routing table.
// Writing requires an explicit --out directory: nothing is installed into ~/.claude automatically.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROUTING, routingSettings, routingHint } from '../../packages/contracts/routing.mjs';

const HOST = 'claude-code';
const MARKER = '<!-- AutoPets generated agent v1 -->';
const READ_ONLY_TOOLS = 'Read, Grep, Glob, WebFetch, WebSearch';
const yaml = value => JSON.stringify(String(value)); // JSON strings are valid YAML scalars

function validTemplate(template) {
  if (!template || typeof template.instruction !== 'string' || !template.instruction.trim() || Buffer.byteLength(template.instruction) > 1536
    || typeof template.name !== 'string' || !template.name.trim() || typeof template.planFirst !== 'boolean') throw Error('invalid-pet-template');
  return template;
}

/** Deterministic agent files: one plan agent (plan-first pets only) and the pet's build profile. */
export function renderClaudeAgents(template) {
  validTemplate(template);
  const hint = routingHint(template);
  if (!hint.execution || (template.planFirst && !hint.planning)) throw Error('pet-template-routing-unsupported');
  const stages = [];
  if (hint.planning) stages.push({ key: 'plan', ...hint.planning.hosts[HOST], readOnly: true });
  stages.push({ key: hint.execution.profile, ...routingSettings(hint.execution.profile, HOST), readOnly: false });
  return stages.map(stage => {
    const name = `autopets-${stage.key}`;
    const meta = ROUTING.profiles[stage.key];
    const role = stage.readOnly
      ? '계획만 제시하고 사용자 확인을 기다리세요. 파일을 변경하지 마세요.'
      : '확인된 계획이나 명확한 요청만 구현하고, 실행한 검사와 남은 문제를 짧게 돌려주세요.';
    const content = [
      '---',
      `name: ${name}`,
      `description: ${yaml(`AutoPets ${template.name} · ${meta.label}. ${stage.readOnly ? '새 업무의 계획을 세울 때' : '계획 확인 뒤 구현할 때'} 사용한다.`)}`,
      `model: ${stage.model}`,
      `effort: ${stage.effort}`,
      ...(stage.readOnly ? ['permissionMode: plan', `tools: ${READ_ONLY_TOOLS}`] : []),
      'disallowedTools: Agent',
      '---',
      MARKER,
      '',
      template.instruction.trim(),
      '',
      role,
      '추가 하위 에이전트를 만들지 마세요. 사용자 요청과 호스트 권한을 우선하세요.',
      '',
    ].join('\n');
    return { name: `${name}.md`, content, sha256: createHash('sha256').update(content).digest('hex') };
  });
}

/** Write into an explicit directory. Refuses to overwrite files AutoPets did not generate. */
export function writeClaudeAgents(template, outDir) {
  if (typeof outDir !== 'string' || !path.isAbsolute(outDir)) throw Error('absolute-out-dir-required');
  const files = renderClaudeAgents(template);
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    const target = path.join(outDir, file.name);
    if (fs.existsSync(target) && !fs.readFileSync(target, 'utf8').includes(MARKER)) throw Error(`not-autopets-agent: ${file.name}`);
  }
  for (const file of files) fs.writeFileSync(path.join(outDir, file.name), file.content);
  return { written: files.map(f => f.name), hostSettingsChanged: false, actualHostVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const templatePath = get('--template');
    if (!templatePath) throw Error('usage: agents.mjs --template <pet-template.json> [--out <absolute dir>]');
    const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    const out = get('--out');
    console.log(JSON.stringify(out ? writeClaudeAgents(template, path.resolve(out)) : renderClaudeAgents(template).map(({ name, sha256 }) => ({ name, sha256 })), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
