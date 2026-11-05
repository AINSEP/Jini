# Code Review Request Prompt

Use this to dispatch a focused code review.

```text
Review this change set for production readiness.

What was implemented: {WHAT_WAS_IMPLEMENTED}
Summary: {DESCRIPTION}
Requirements or plan: {PLAN_REFERENCE}
Base SHA: {BASE_SHA}
Head SHA: {HEAD_SHA}

Check:
- correctness against requirements
- code quality and architecture
- testing quality and coverage gaps
- obvious security or regression risks

Return:
- Strengths
- Critical issues
- Important issues
- Minor issues
- Merge readiness verdict
```
