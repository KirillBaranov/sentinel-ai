# Review Guide (Advisory)

## Output language
- All findings **in Russian**.
- Rule IDs/links **in English**.

## Output order (DUAL)
1) **Machine block (JSON)** — FIRST, fenced with ```json:
```json
{
  "ai_review": {
    "version": 1,
    "run_id": "",
    "findings": [
      {
        "rule": "<Rule ID>",
        "link": "<relative link>",
        "severity": "критично|рекомендация",
        "area": "архитектура|тестирование|доступность|DX|производительность|нейминг",
        "file": "relative/path.vue",
        "line": 0,
        "symbol": "Component|function|event",
        "locator": "one-line evidence",
        "fingerprint": "",
        "finding": ["bullet 1", "bullet 2"],
        "why": "≤1 short factual sentence",
        "suggestion": "concrete next step or fix"
      }
    ]
  }
}
