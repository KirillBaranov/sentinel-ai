export function renderRiskBadge(score: number, level: 'low'|'medium'|'high'): string {
  const color = level === 'high' ? '#E03A3A' : level === 'medium' ? '#F59E0B' : '#10B981'
  const label = `Risk ${score}`
  return `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="110" height="20" role="img" aria-label="${label}">
  <linearGradient id="g" x2="0" y2="100%">
    <stop offset="0" stop-color="#fff" stop-opacity=".7"/>
    <stop offset=".1" stop-opacity=".1"/>
    <stop offset=".9" stop-opacity=".3"/>
    <stop offset="1" stop-opacity=".5"/>
  </linearGradient>
  <rect rx="3" width="110" height="20" fill="${color}"/>
  <rect rx="3" width="110" height="20" fill="url(#g)"/>
  <g fill="#fff" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12">
    <text x="55" y="14">${label}</text>
  </g>
</svg>`
}
