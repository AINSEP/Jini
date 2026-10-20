// Compact report without source text or diagnostic values (which can contain secrets).
export default function sonarSummary(results) {
  const counts = new Map();
  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    errors += result.errorCount;
    warnings += result.warningCount;
    for (const message of result.messages) {
      const key = message.ruleId ?? '(parser/configuration)';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [
    `SonarJS: ${results.length} files, ${warnings} warnings, ${errors} errors`,
    ...[...counts].sort(([a], [b]) => a.localeCompare(b)).map(([rule, count]) => `${rule}: ${count}`),
    ...(counts.size ? [] : ['No findings reported; type-dependent rules require type information (see docs/quality-tools.md).']),
    'Report only. Parser/configuration errors are not rule findings; review them before trusting totals.',
    '',
  ].join('\n');
}
